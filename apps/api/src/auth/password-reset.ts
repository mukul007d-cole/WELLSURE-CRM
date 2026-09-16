import type { AuthConfig } from './config.js';
import { hashPassword, normalizeEmail, passwordPolicyReasons, verifyPassword } from './password.js';
import { createOpaqueToken, hashOpaqueToken } from './tokens.js';
import type { SecurityAuditWriter } from './audit.js';

export interface PasswordResetUserRecord {
  id: string;
  organizationId: string;
  email: string;
  active: boolean;
}

export interface PasswordResetTokenRecord {
  id: string;
  organizationId: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export type CompletePasswordResetResult =
  | { ok: true; userId: string; organizationId: string; revokedSessions: number }
  | { ok: false; reason: 'invalid_token' | 'expired_token' };

export interface PasswordResetRepository {
  findUserForPasswordReset(
    organizationId: string,
    normalizedEmail: string,
  ): Promise<PasswordResetUserRecord | null>;
  createPasswordResetToken(
    input: Omit<PasswordResetTokenRecord, 'id'>,
  ): Promise<PasswordResetTokenRecord>;
  /**
   * Atomically claims a still-valid, unused token and applies every
   * security-relevant change as one unit: password hash, token consumption,
   * session revocation, and the audit row.
   *
   * The claim itself must be a single conditional write (e.g. `UPDATE ...
   * WHERE id = $id AND used_at IS NULL`, checking the affected row count) so
   * two concurrent calls racing the same token can never both succeed —
   * Postgres serializes concurrent writers to the same row, so the loser's
   * conditional write always sees the winner's committed `used_at` and
   * matches zero rows. A token that is unknown, already used, or lost that
   * race all return `invalid_token` — deliberately indistinguishable, so a
   * caller can never tell a genuine replay from a lost race.
   *
   * Everything here — including the audit write — must happen inside one
   * database transaction: a failure partway through (a transient error
   * before the audit row, say) must never leave the password changed while
   * the token stays valid and replayable.
   */
  completePasswordResetTransaction(input: {
    tokenHash: string;
    newPasswordHash: string;
    now: Date;
  }): Promise<CompletePasswordResetResult>;
}

export interface PasswordChangeRepository {
  findPasswordHashForUser(userId: string, organizationId: string): Promise<string | null>;
  replacePasswordAndRevokeOtherSessions(input: {
    userId: string;
    organizationId: string;
    currentSessionId: string;
    expectedPasswordHash: string;
    newPasswordHash: string;
    changedAt: Date;
  }): Promise<{ changed: boolean; revokedSessions: number }>;
}

export interface EmailSender {
  sendPasswordReset(input: { to: string; token: string; expiresAt: Date }): Promise<void>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

/**
 * Generic delivery, kept as its own role interface rather than a second method
 * on `EmailSender`.
 *
 * One implementation provides both — `createEmailSender` returns
 * `EmailSender & CampaignEmailSender`, so there is still exactly one transport
 * selection and no second email pipeline. Splitting the interfaces means the
 * existing password-reset test doubles keep satisfying the contract they were
 * written for, and a caller that only sends campaigns can depend on only what
 * it uses.
 */
export interface CampaignEmailSender {
  sendEmail(message: EmailMessage): Promise<void>;
}

export function preparePasswordReset(config: AuthConfig, now = new Date()) {
  const token = createOpaqueToken();
  const expiresAt = new Date(now.getTime() + config.resetTokenTtlMs);
  return { token, tokenHash: hashOpaqueToken(token), expiresAt };
}

/** Issue a reset for a user already resolved inside a trusted admin flow. */
export async function issuePasswordResetForKnownUser(input: {
  repository: PasswordResetRepository;
  audit: SecurityAuditWriter;
  emailSender: EmailSender;
  config: AuthConfig;
  user: PasswordResetUserRecord;
  actorUserId: string | null;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  now?: Date;
}): Promise<{ tokenId: string }> {
  const now = input.now ?? new Date();
  const { token, tokenHash, expiresAt } = preparePasswordReset(input.config, now);
  const record = await input.repository.createPasswordResetToken({
    organizationId: input.user.organizationId,
    userId: input.user.id,
    tokenHash,
    createdAt: now,
    expiresAt,
    usedAt: null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
  await input.audit.writeSystemAudit({
    organizationId: input.user.organizationId,
    actorUserId: input.actorUserId,
    entityType: 'password_reset_token',
    entityId: record.id,
    action: 'auth.password_reset_requested',
    oldValue: null,
    newValue: {
      subjectUserId: input.user.id,
      expiresAt: expiresAt.toISOString(),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
  await input.emailSender.sendPasswordReset({ to: input.user.email, token, expiresAt });
  return { tokenId: record.id };
}

export async function requestPasswordReset(input: {
  repository: PasswordResetRepository;
  audit: SecurityAuditWriter;
  emailSender: EmailSender;
  config: AuthConfig;
  organizationId: string;
  email: string;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  now?: Date | undefined;
}): Promise<{ accepted: true }> {
  const now = input.now ?? new Date();
  const normalizedEmail = normalizeEmail(input.email);
  const user = await input.repository.findUserForPasswordReset(
    input.organizationId,
    normalizedEmail,
  );
  if (user?.active === true) {
    await issuePasswordResetForKnownUser({
      repository: input.repository,
      audit: input.audit,
      emailSender: input.emailSender,
      config: input.config,
      user,
      actorUserId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      now,
    });
  }
  return { accepted: true };
}

export async function completePasswordReset(input: {
  repository: PasswordResetRepository;
  token: string;
  newPassword: string;
  now?: Date | undefined;
}): Promise<
  | { ok: true }
  | { ok: false; reason: 'invalid_token' | 'expired_token' | 'weak_password'; details?: string[] }
> {
  const now = input.now ?? new Date();
  // Checked before touching the database: a doomed-to-fail password never
  // needs to reach the atomic claim below.
  const policyReasons = passwordPolicyReasons(input.newPassword);
  if (policyReasons.length) return { ok: false, reason: 'weak_password', details: policyReasons };
  const passwordHash = await hashPassword(input.newPassword);
  const result = await input.repository.completePasswordResetTransaction({
    tokenHash: hashOpaqueToken(input.token),
    newPasswordHash: passwordHash,
    now,
  });
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export async function changeAuthenticatedPassword(input: {
  repository: PasswordChangeRepository;
  userId: string;
  organizationId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
  now?: Date;
}): Promise<
  | { ok: true; revokedSessions: number }
  | { ok: false; reason: 'invalid_current_password' | 'weak_password'; details?: string[] }
> {
  const policyReasons = passwordPolicyReasons(input.newPassword);
  if (policyReasons.length) return { ok: false, reason: 'weak_password', details: policyReasons };
  const currentHash = await input.repository.findPasswordHashForUser(
    input.userId,
    input.organizationId,
  );
  if (!(await verifyPassword(input.currentPassword, currentHash))) {
    return { ok: false, reason: 'invalid_current_password' };
  }
  const result = await input.repository.replacePasswordAndRevokeOtherSessions({
    userId: input.userId,
    organizationId: input.organizationId,
    currentSessionId: input.currentSessionId,
    expectedPasswordHash: currentHash!,
    newPasswordHash: await hashPassword(input.newPassword),
    changedAt: input.now ?? new Date(),
  });
  return result.changed
    ? { ok: true, revokedSessions: result.revokedSessions }
    : { ok: false, reason: 'invalid_current_password' };
}
