import type { AuthConfig } from './config.js';
import { hashPassword, normalizeEmail } from './password.js';
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

export interface PasswordResetRepository {
  findUserForPasswordReset(
    organizationId: string,
    normalizedEmail: string,
  ): Promise<PasswordResetUserRecord | null>;
  createPasswordResetToken(
    input: Omit<PasswordResetTokenRecord, 'id'>,
  ): Promise<PasswordResetTokenRecord>;
  findPasswordResetToken(tokenHash: string): Promise<PasswordResetTokenRecord | null>;
  markPasswordResetTokenUsed(id: string, organizationId: string, usedAt: Date): Promise<void>;
  setUserPasswordHash(userId: string, organizationId: string, passwordHash: string): Promise<void>;
  revokeUserSessions(userId: string, organizationId: string, revokedAt: Date): Promise<number>;
}

export interface EmailSender {
  sendPasswordReset(input: { to: string; token: string; expiresAt: Date }): Promise<void>;
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
  audit: SecurityAuditWriter;
  token: string;
  newPassword: string;
  now?: Date | undefined;
}): Promise<{ ok: boolean }> {
  const now = input.now ?? new Date();
  const record = await input.repository.findPasswordResetToken(hashOpaqueToken(input.token));
  if (record === null || record.usedAt !== null || record.expiresAt <= now) {
    return { ok: false };
  }
  const passwordHash = await hashPassword(input.newPassword);
  await input.repository.setUserPasswordHash(record.userId, record.organizationId, passwordHash);
  await input.repository.markPasswordResetTokenUsed(record.id, record.organizationId, now);
  const revokedSessions = await input.repository.revokeUserSessions(
    record.userId,
    record.organizationId,
    now,
  );
  await input.audit.writeSystemAudit({
    organizationId: record.organizationId,
    actorUserId: record.userId,
    entityType: 'user',
    entityId: record.userId,
    action: 'auth.password_reset_completed',
    oldValue: { passwordHashSet: false, resetTokenUsedAt: null },
    newValue: { passwordHashSet: true, resetTokenUsedAt: now.toISOString(), revokedSessions },
  });
  return { ok: true };
}
