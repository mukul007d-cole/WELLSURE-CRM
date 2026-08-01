/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from 'vitest';

import { defaultAuthConfig } from '../auth/config.js';
import { serializeSessionCookie } from '../auth/cookies.js';
import { login } from '../auth/login.js';
import { hashPassword, normalizeEmail, verifyPassword } from '../auth/password.js';
import { completePasswordReset, requestPasswordReset } from '../auth/password-reset.js';
import {
  issueSession,
  revokeSession,
  validateSession,
  type SessionRecord,
} from '../auth/session.js';
import { capabilitiesRoute } from '../routes/auth.js';
import type { LoginAttemptRecord, LoginRepository, LoginUserRecord } from '../auth/login.js';
import type { PasswordResetRepository, PasswordResetTokenRecord } from '../auth/password-reset.js';
import type { SecurityAuditInput, SecurityAuditWriter } from '../auth/audit.js';
import type { UserSnapshot } from '@falcon/permission-engine';

const now = new Date('2026-01-01T00:00:00.000Z');

describe('password hashing', () => {
  it('hashes with argon2id metadata and verifies without accepting null hashes', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword('correct horse', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong horse', hash)).resolves.toBe(false);
    await expect(verifyPassword('correct horse', null)).resolves.toBe(false);
    expect(normalizeEmail(' Admin@Example.TEST ')).toBe('admin@example.test');
  });
});

describe('sessions', () => {
  it('creates, validates, expires, and revokes sessions', async () => {
    const repo = new MemoryAuthRepository();
    const issued = await issueSession({
      repository: repo,
      config: defaultAuthConfig,
      userId: repo.user.id,
      organizationId: repo.user.organizationId,
      now,
    });
    expect(issued.record.expiresAt.toISOString()).toBe('2026-01-01T08:00:00.000Z');
    await expect(
      validateSession({ repository: repo, token: issued.token, now }),
    ).resolves.not.toBeNull();
    await expect(
      validateSession({
        repository: repo,
        token: issued.token,
        now: new Date('2026-01-01T09:00:00.000Z'),
      }),
    ).resolves.toBeNull();
    await expect(
      revokeSession({
        repository: repo,
        audit: repo,
        sessionId: issued.record.id,
        organizationId: repo.user.organizationId,
        actorUserId: repo.user.id,
        now,
      }),
    ).resolves.toBe(true);
    await expect(
      validateSession({ repository: repo, token: issued.token, now }),
    ).resolves.toBeNull();
    expect(repo.audits.map((audit) => audit.action)).toContain('auth.session_revoked');
  });

  it('serializes httpOnly secure sameSite cookies', async () => {
    const cookie = serializeSessionCookie(
      'abc',
      defaultAuthConfig,
      new Date('2026-01-01T08:00:00.000Z'),
    );
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });
});

describe('self capabilities', () => {
  it('returns the authenticated caller role grants without a role-management check', async () => {
    const body = await capabilitiesRoute({
      auth: {
        user: {
          id: 'user',
          organizationId: 'org',
          roleId: 'role',
          active: true,
          departmentId: null,
          managerId: null,
        },
        session: {} as never,
      },
      repository: {
        listRolePermissions: async () => [{ module: 'users', action: 'view', scope: 'TEAM' }],
        listAccessibleJourneyIds: async () => ['journey-b', 'journey-a'],
        listFieldVisibility: async () => [{ fieldId: 'field-a', accessLevel: 'VIEW' }],
      } as never,
    });
    expect(body.body).toEqual({
      permissions: [{ module: 'users', action: 'view', scope: 'TEAM' }],
      journeyIds: ['journey-a', 'journey-b'],
      fieldVisibility: [{ fieldId: 'field-a', accessLevel: 'VIEW' }],
    });
  });
});

describe('login lockout', () => {
  it('audits failed logins and locks after configured attempts', async () => {
    const repo = new MemoryAuthRepository();
    repo.loginUser.passwordHash = await hashPassword('good');
    for (let i = 0; i < defaultAuthConfig.lockoutMaxAttempts; i += 1) {
      await login({
        repository: repo,
        audit: repo,
        config: defaultAuthConfig,
        organizationId: repo.user.organizationId,
        email: repo.loginUser.email,
        password: 'bad',
        now,
      });
    }
    const locked = await login({
      repository: repo,
      audit: repo,
      config: defaultAuthConfig,
      organizationId: repo.user.organizationId,
      email: repo.loginUser.email,
      password: 'good',
      now,
    });
    expect(locked).toEqual({ ok: false, reason: 'LOCKED_OUT' });
    expect(repo.audits.map((audit) => audit.action)).toContain('auth.lockout_created');
  });

  it('rejects users without password hashes', async () => {
    const repo = new MemoryAuthRepository();
    const result = await login({
      repository: repo,
      audit: repo,
      config: defaultAuthConfig,
      organizationId: repo.user.organizationId,
      email: repo.loginUser.email,
      password: 'anything',
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });
  });
});

describe('password reset', () => {
  it('uses generic request responses and single-use expiring tokens', async () => {
    const repo = new MemoryAuthRepository();
    const sent: string[] = [];
    await requestPasswordReset({
      repository: repo,
      audit: repo,
      emailSender: {
        sendPasswordReset: async ({ token }) => {
          sent.push(token);
        },
      },
      config: defaultAuthConfig,
      organizationId: repo.user.organizationId,
      email: repo.loginUser.email,
      now,
    });
    await requestPasswordReset({
      repository: repo,
      audit: repo,
      emailSender: {
        sendPasswordReset: async ({ token }) => {
          sent.push(token);
        },
      },
      config: defaultAuthConfig,
      organizationId: repo.user.organizationId,
      email: 'missing@example.test',
      now,
    });
    expect(sent).toHaveLength(1);
    await expect(
      completePasswordReset({
        repository: repo,
        audit: repo,
        token: sent[0] ?? '',
        newPassword: 'new-password',
        now,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      completePasswordReset({
        repository: repo,
        audit: repo,
        token: sent[0] ?? '',
        newPassword: 'new-password',
        now,
      }),
    ).resolves.toEqual({ ok: false });
    expect(repo.audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(['auth.password_reset_requested', 'auth.password_reset_completed']),
    );
    const expiredRepo = new MemoryAuthRepository();
    const expiredTokens: string[] = [];
    await requestPasswordReset({
      repository: expiredRepo,
      audit: expiredRepo,
      emailSender: {
        sendPasswordReset: async ({ token }) => {
          expiredTokens.push(token);
        },
      },
      config: defaultAuthConfig,
      organizationId: expiredRepo.user.organizationId,
      email: expiredRepo.loginUser.email,
      now,
    });
    await expect(
      completePasswordReset({
        repository: expiredRepo,
        audit: expiredRepo,
        token: expiredTokens[0] ?? '',
        newPassword: 'new-password',
        now: new Date('2026-01-01T00:31:00.000Z'),
      }),
    ).resolves.toEqual({ ok: false });
  });
});

class MemoryAuthRepository
  implements LoginRepository, PasswordResetRepository, SecurityAuditWriter
{
  readonly user: UserSnapshot = {
    id: 'user-a',
    organizationId: 'org-a',
    roleId: 'role-a',
    active: true,
    departmentId: null,
    managerId: null,
  };
  readonly loginUser: LoginUserRecord = {
    id: 'user-a',
    organizationId: 'org-a',
    email: 'admin@example.test',
    active: true,
    passwordHash: null,
  };
  readonly sessions = new Map<string, SessionRecord>();
  readonly attempts = new Map<string, LoginAttemptRecord>();
  readonly resets = new Map<string, PasswordResetTokenRecord>();
  readonly audits: SecurityAuditInput[] = [];

  async createSession(input: Omit<SessionRecord, 'id'>): Promise<SessionRecord> {
    const row = { ...input, id: `session-${this.sessions.size + 1}` };
    this.sessions.set(row.tokenHash, row);
    return row;
  }
  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.sessions.get(tokenHash) ?? null;
  }
  async touchSession(): Promise<void> {}
  async revokeSession(
    sessionId: string,
    organizationId: string,
    at: Date,
  ): Promise<SessionRecord | null> {
    const row = [...this.sessions.values()].find(
      (session) => session.id === sessionId && session.organizationId === organizationId,
    );
    if (row === undefined) return null;
    row.revokedAt = at;
    return row;
  }
  async getUserSnapshot(userId: string, organizationId: string): Promise<UserSnapshot | null> {
    return userId === this.user.id && organizationId === this.user.organizationId
      ? this.user
      : null;
  }
  async findUserForLogin(
    organizationId: string,
    normalizedEmail: string,
  ): Promise<LoginUserRecord | null> {
    return organizationId === this.loginUser.organizationId &&
      normalizedEmail === this.loginUser.email
      ? this.loginUser
      : null;
  }
  async getLoginAttempt(
    organizationId: string,
    normalizedEmail: string,
  ): Promise<LoginAttemptRecord | null> {
    return this.attempts.get(`${organizationId}:${normalizedEmail}`) ?? null;
  }
  async recordFailedLogin(input: LoginAttemptRecord): Promise<{ id: string }> {
    const id = `attempt-${this.attempts.size + 1}`;
    this.attempts.set(`${input.organizationId}:${input.normalizedEmail}`, input);
    return { id };
  }
  async clearLoginAttempt(organizationId: string, normalizedEmail: string): Promise<void> {
    this.attempts.delete(`${organizationId}:${normalizedEmail}`);
  }
  async writeSystemAudit(input: SecurityAuditInput): Promise<void> {
    this.audits.push(input);
  }
  async findUserForPasswordReset(
    organizationId: string,
    normalizedEmail: string,
  ): Promise<LoginUserRecord | null> {
    return this.findUserForLogin(organizationId, normalizedEmail);
  }
  async createPasswordResetToken(
    input: Omit<PasswordResetTokenRecord, 'id'>,
  ): Promise<PasswordResetTokenRecord> {
    const row = { ...input, id: `reset-${this.resets.size + 1}` };
    this.resets.set(row.tokenHash, row);
    return row;
  }
  async findPasswordResetToken(tokenHash: string): Promise<PasswordResetTokenRecord | null> {
    return this.resets.get(tokenHash) ?? null;
  }
  async markPasswordResetTokenUsed(
    id: string,
    organizationId: string,
    usedAt: Date,
  ): Promise<void> {
    for (const row of this.resets.values())
      if (row.id === id && row.organizationId === organizationId) row.usedAt = usedAt;
  }
  async setUserPasswordHash(
    userId: string,
    organizationId: string,
    passwordHash: string,
  ): Promise<void> {
    if (userId === this.loginUser.id && organizationId === this.loginUser.organizationId)
      this.loginUser.passwordHash = passwordHash;
  }
  async revokeUserSessions(): Promise<number> {
    return 0;
  }
}
