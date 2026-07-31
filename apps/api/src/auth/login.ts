import type { AuthConfig } from './config.js';
import { normalizeEmail, verifyPassword, hashPassword } from './password.js';
import { issueSession, type IssuedSession, type SessionRepository } from './session.js';
import type { SecurityAuditWriter } from './audit.js';

export interface LoginUserRecord {
  id: string;
  organizationId: string;
  email: string;
  active: boolean;
  passwordHash: string | null;
}

export interface LoginAttemptRecord {
  organizationId: string;
  normalizedEmail: string;
  failedCount: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
}

export interface LoginRepository extends SessionRepository {
  findUserForLogin(
    organizationId: string,
    normalizedEmail: string,
  ): Promise<LoginUserRecord | null>;
  getLoginAttempt(
    organizationId: string,
    normalizedEmail: string,
  ): Promise<LoginAttemptRecord | null>;
  recordFailedLogin(input: LoginAttemptRecord): Promise<{ id: string }>;
  clearLoginAttempt(organizationId: string, normalizedEmail: string): Promise<void>;
}

export type LoginResult =
  | { ok: true; session: IssuedSession }
  | { ok: false; reason: 'INVALID_CREDENTIALS' | 'LOCKED_OUT' };

let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  if (dummyHashPromise === null) {
    dummyHashPromise = hashPassword('falcon-timing-safety-placeholder');
  }
  return dummyHashPromise;
}

export async function login(input: {
  repository: LoginRepository;
  audit: SecurityAuditWriter;
  config: AuthConfig;
  organizationId: string;
  email: string;
  password: string;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  now?: Date | undefined;
}): Promise<LoginResult> {
  const now = input.now ?? new Date();
  const normalizedEmail = normalizeEmail(input.email);
  const attempt = await input.repository.getLoginAttempt(input.organizationId, normalizedEmail);
  if (
    attempt?.lockedUntil !== null &&
    attempt?.lockedUntil !== undefined &&
    attempt.lockedUntil > now
  ) {
    return { ok: false, reason: 'LOCKED_OUT' };
  }

  const user = await input.repository.findUserForLogin(input.organizationId, normalizedEmail);
  const passwordHash = user?.active === true ? user.passwordHash : await getDummyHash();
  const passwordMatches = await verifyPassword(input.password, passwordHash);
  const valid = user?.active === true && passwordMatches;

  if (!valid) {
    await recordFailure({
      ...input,
      normalizedEmail,
      userId: user?.id ?? null,
      now,
      previous: attempt,
    });
    return { ok: false, reason: 'INVALID_CREDENTIALS' };
  }

  await input.repository.clearLoginAttempt(input.organizationId, normalizedEmail);
  return {
    ok: true,
    session: await issueSession({
      repository: input.repository,
      config: input.config,
      userId: user.id,
      organizationId: input.organizationId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      now,
    }),
  };
}

async function recordFailure(input: {
  repository: LoginRepository;
  audit: SecurityAuditWriter;
  config: AuthConfig;
  organizationId: string;
  normalizedEmail: string;
  userId: string | null;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  now: Date;
  previous: LoginAttemptRecord | null;
}): Promise<void> {
  const withinWindow =
    input.previous !== null &&
    input.now.getTime() - input.previous.windowStartedAt.getTime() <= input.config.lockoutWindowMs;
  const failedCount = withinWindow && input.previous !== null ? input.previous.failedCount + 1 : 1;
  const lockedUntil =
    failedCount >= input.config.lockoutMaxAttempts
      ? new Date(input.now.getTime() + input.config.lockoutDurationMs)
      : null;

  const attempt = await input.repository.recordFailedLogin({
    organizationId: input.organizationId,
    normalizedEmail: input.normalizedEmail,
    failedCount,
    windowStartedAt: withinWindow ? (input.previous?.windowStartedAt ?? input.now) : input.now,
    lockedUntil,
  });

  const entityType = input.userId !== null ? 'user' : 'login_attempt';
  const entityId = input.userId ?? attempt.id;

  await input.audit.writeSystemAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    entityType,
    entityId,
    action: 'auth.login_failed',
    oldValue: {
      failedCount: input.previous?.failedCount ?? 0,
      lockedUntil: input.previous?.lockedUntil?.toISOString() ?? null,
    },
    newValue: {
      failedCount,
      lockedUntil: lockedUntil?.toISOString() ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
  if (lockedUntil !== null) {
    await input.audit.writeSystemAudit({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      entityType: 'login_attempt',
      entityId: attempt.id,
      action: 'auth.lockout_created',
      oldValue: { lockedUntil: null },
      newValue: { lockedUntil: lockedUntil.toISOString(), failedCount },
    });
  }
}
