import type { UserSnapshot } from '@falcon/permission-engine';

import type { AuthConfig } from './config.js';
import { hashOpaqueToken, createOpaqueToken } from './tokens.js';
import type { SecurityAuditWriter } from './audit.js';

export interface SessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  organizationId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface SessionRepository {
  createSession(input: Omit<SessionRecord, 'id'>): Promise<SessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(sessionId: string, organizationId: string, at: Date): Promise<void>;
  revokeSession(sessionId: string, organizationId: string, at: Date): Promise<SessionRecord | null>;
  getUserSnapshot(userId: string, organizationId: string): Promise<UserSnapshot | null>;
}

export interface IssuedSession {
  token: string;
  record: SessionRecord;
}

export async function issueSession(input: {
  repository: SessionRepository;
  config: AuthConfig;
  userId: string;
  organizationId: string;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  now?: Date | undefined;
}): Promise<IssuedSession> {
  const now = input.now ?? new Date();
  const token = createOpaqueToken();
  const record = await input.repository.createSession({
    tokenHash: hashOpaqueToken(token),
    userId: input.userId,
    organizationId: input.organizationId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + input.config.sessionTtlMs),
    revokedAt: null,
    lastSeenAt: now,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
  return { token, record };
}

export async function validateSession(input: {
  repository: SessionRepository;
  token: string | null;
  now?: Date | undefined;
}): Promise<{ session: SessionRecord; user: UserSnapshot } | null> {
  if (input.token === null) {
    return null;
  }
  const now = input.now ?? new Date();
  const session = await input.repository.findSessionByTokenHash(hashOpaqueToken(input.token));
  if (session === null || session.revokedAt !== null || session.expiresAt <= now) {
    return null;
  }
  const user = await input.repository.getUserSnapshot(session.userId, session.organizationId);
  if (user === null || !user.active) {
    return null;
  }
  await input.repository.touchSession(session.id, session.organizationId, now);
  return { session: { ...session, lastSeenAt: now }, user };
}

export async function revokeSession(input: {
  repository: SessionRepository;
  audit: SecurityAuditWriter;
  sessionId: string;
  organizationId: string;
  actorUserId: string | null;
  now?: Date | undefined;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const revoked = await input.repository.revokeSession(input.sessionId, input.organizationId, now);
  if (revoked === null) {
    return false;
  }
  await input.audit.writeSystemAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: 'session',
    entityId: revoked.id,
    action: 'auth.session_revoked',
    oldValue: { revokedAt: null },
    newValue: { revokedAt: now.toISOString() },
  });
  return true;
}
