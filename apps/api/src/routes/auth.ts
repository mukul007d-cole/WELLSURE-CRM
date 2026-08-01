import { defaultAuthConfig, type AuthConfig } from '../auth/config.js';
import { serializeClearedSessionCookie, serializeSessionCookie } from '../auth/cookies.js';
import { login, type LoginRepository } from '../auth/login.js';
import {
  completePasswordReset,
  requestPasswordReset,
  type EmailSender,
  type PasswordResetRepository,
} from '../auth/password-reset.js';
import { revokeSession, type SessionRepository } from '../auth/session.js';
import type { SecurityAuditWriter } from '../auth/audit.js';
import type { AuthenticatedContext } from '../auth/middleware.js';
import type { PermissionRepository } from '@falcon/permission-engine';

export interface CapabilityReader {
  listRolePermissions(input: { roleId: string; organizationId: string }): Promise<readonly { module: string; action: string; scope: 'SELF' | 'TEAM' | 'DEPARTMENT' | 'ORGANIZATION' }[]>;
  listAccessibleJourneyIds(input: { roleId: string; organizationId: string }): Promise<readonly string[]>;
  listFieldVisibility(input: { roleId: string; organizationId: string }): Promise<readonly { fieldId: string; accessLevel: 'VIEW' | 'EDIT' }[]>;
}

export async function capabilitiesRoute(input: {
  auth: AuthenticatedContext;
  repository: PermissionRepository & CapabilityReader;
}) {
  const identity = {
    roleId: input.auth.user.roleId,
    organizationId: input.auth.user.organizationId,
  };
  const [permissions, journeyIds, fieldVisibility] = await Promise.all([
    input.repository.listRolePermissions(identity),
    input.repository.listAccessibleJourneyIds(identity),
    input.repository.listFieldVisibility(identity),
  ]);
  return {
    status: 200 as const,
    body: {
      permissions,
      journeyIds: [...journeyIds].sort(),
      fieldVisibility,
    },
  };
}

export async function loginRoute(input: {
  repository: LoginRepository;
  audit: SecurityAuditWriter;
  body: { organizationId: string; email: string; password: string };
  config?: AuthConfig;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  now?: Date | undefined;
}): Promise<{ status: number; headers?: Record<string, string>; body: unknown }> {
  const config = input.config ?? defaultAuthConfig;
  const result = await login({
    repository: input.repository,
    audit: input.audit,
    config,
    organizationId: input.body.organizationId,
    email: input.body.email,
    password: input.body.password,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    now: input.now,
  });
  if (!result.ok) {
    return {
      status: result.reason === 'LOCKED_OUT' ? 423 : 401,
      body: { error: result.reason === 'LOCKED_OUT' ? 'account_locked' : 'invalid_credentials' },
    };
  }
  return {
    status: 200,
    headers: {
      'set-cookie': serializeSessionCookie(
        result.session.token,
        config,
        result.session.record.expiresAt,
      ),
    },
    body: { userId: result.session.record.userId },
  };
}

export async function logoutRoute(input: {
  repository: SessionRepository;
  audit: SecurityAuditWriter;
  sessionId: string;
  organizationId: string;
  actorUserId: string;
  config?: AuthConfig;
  now?: Date | undefined;
}): Promise<{ status: 204; headers: Record<string, string>; body: null }> {
  const config = input.config ?? defaultAuthConfig;
  await revokeSession({
    repository: input.repository,
    audit: input.audit,
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    now: input.now,
  });
  return {
    status: 204,
    headers: { 'set-cookie': serializeClearedSessionCookie(config) },
    body: null,
  };
}

export async function requestPasswordResetRoute(input: {
  repository: PasswordResetRepository;
  audit: SecurityAuditWriter;
  emailSender: EmailSender;
  body: { organizationId: string; email: string };
  config?: AuthConfig;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  now?: Date | undefined;
}): Promise<{ status: 202; body: { accepted: true } }> {
  await requestPasswordReset({
    repository: input.repository,
    audit: input.audit,
    emailSender: input.emailSender,
    config: input.config ?? defaultAuthConfig,
    organizationId: input.body.organizationId,
    email: input.body.email,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    now: input.now,
  });
  return { status: 202, body: { accepted: true } };
}

export async function completePasswordResetRoute(input: {
  repository: PasswordResetRepository;
  audit: SecurityAuditWriter;
  body: { token: string; newPassword: string };
  now?: Date | undefined;
}): Promise<{ status: 204 | 400; body: null | { error: string } }> {
  const result = await completePasswordReset({
    repository: input.repository,
    audit: input.audit,
    token: input.body.token,
    newPassword: input.body.newPassword,
    now: input.now,
  });
  return result.ok
    ? { status: 204, body: null }
    : { status: 400, body: { error: 'invalid_or_expired_token' } };
}
