import type { UserSnapshot } from '@falcon/permission-engine';

import type { SecurityAuditInput, SecurityAuditWriter } from './audit.js';
import type { LoginAttemptRecord, LoginRepository, LoginUserRecord } from './login.js';
import type {
  PasswordResetRepository,
  PasswordResetTokenRecord,
  PasswordResetUserRecord,
} from './password-reset.js';
import type { SessionRecord, SessionRepository } from './session.js';

interface PrismaAuthClient {
  user: {
    findUnique(args: unknown): Promise<UserRow | null>;
    findFirst(args: unknown): Promise<UserRow | null>;
    update(args: unknown): Promise<unknown>;
  };
  session: {
    create(args: unknown): Promise<SessionRow>;
    findFirst(args: unknown): Promise<SessionRow | null>;
    update(args: unknown): Promise<SessionRow>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  passwordResetToken: {
    create(args: unknown): Promise<PasswordResetTokenRow>;
    findFirst(args: unknown): Promise<PasswordResetTokenRow | null>;
    update(args: unknown): Promise<unknown>;
  };
  failedLoginAttempt: {
    findUnique(args: unknown): Promise<LoginAttemptRow | null>;
    upsert(args: unknown): Promise<LoginAttemptRow>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  systemAuditLog: { create(args: unknown): Promise<unknown> };
}

interface UserRow {
  id: string;
  organizationId: string;
  email: string;
  active: boolean;
  roleId: string;
  departmentId: string | null;
  managerId: string | null;
  passwordHash: string | null;
}

type SessionRow = SessionRecord;
type PasswordResetTokenRow = PasswordResetTokenRecord;
interface LoginAttemptRow extends LoginAttemptRecord {
    id: string;
  }

export class PrismaAuthRepository
  implements LoginRepository, SessionRepository, PasswordResetRepository, SecurityAuditWriter
{
  constructor(private readonly prisma: PrismaAuthClient) {}

  async findUserForLogin(
    organizationId: string,
    normalizedEmail: string,
  ): Promise<LoginUserRecord | null> {
    const row = await this.prisma.user.findFirst({
      where: { organizationId, email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, organizationId: true, email: true, active: true, passwordHash: true },
    });
    return row === null
      ? null
      : {
          id: row.id,
          organizationId: row.organizationId,
          email: row.email.toLowerCase(),
          active: row.active,
          passwordHash: row.passwordHash,
        };
  }

  async createSession(input: Omit<SessionRecord, 'id'>): Promise<SessionRecord> {
    return this.prisma.session.create({ data: input });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.prisma.session.findFirst({ where: { tokenHash } });
  }

  async touchSession(sessionId: string, organizationId: string, at: Date): Promise<void> {
    await this.prisma.session.update({
      where: { organizationId_id: { organizationId, id: sessionId } },
      data: { lastSeenAt: at },
    });
  }

  async revokeSession(
    sessionId: string,
    organizationId: string,
    at: Date,
  ): Promise<SessionRecord | null> {
    return this.prisma.session.update({
      where: { organizationId_id: { organizationId, id: sessionId } },
      data: { revokedAt: at },
    });
  }

  async getUserSnapshot(userId: string, organizationId: string): Promise<UserSnapshot | null> {
    const row = await this.prisma.user.findUnique({
      where: { organizationId_id: { organizationId, id: userId } },
      select: {
        id: true,
        organizationId: true,
        roleId: true,
        active: true,
        departmentId: true,
        managerId: true,
      },
    });
    return row === null
      ? null
      : {
          id: row.id,
          organizationId: row.organizationId,
          roleId: row.roleId,
          active: row.active,
          departmentId: row.departmentId,
          managerId: row.managerId,
        };
  }

  async getLoginAttempt(
    organizationId: string,
    normalizedEmail: string,
  ): Promise<LoginAttemptRecord | null> {
    return this.prisma.failedLoginAttempt.findUnique({
      where: { organizationId_normalizedEmail: { organizationId, normalizedEmail } },
    });
  }

async recordFailedLogin(input: LoginAttemptRecord): Promise<{ id: string }> {
    const row = await this.prisma.failedLoginAttempt.upsert({
      where: {
        organizationId_normalizedEmail: {
          organizationId: input.organizationId,
          normalizedEmail: input.normalizedEmail,
        },
      },
      create: input,
      update: {
        failedCount: input.failedCount,
        windowStartedAt: input.windowStartedAt,
        lockedUntil: input.lockedUntil,
      },
    });
    return { id: row.id };
  }

  async clearLoginAttempt(organizationId: string, normalizedEmail: string): Promise<void> {
    await this.prisma.failedLoginAttempt.deleteMany({ where: { organizationId, normalizedEmail } });
  }

  async findUserForPasswordReset(
    organizationId: string,
    normalizedEmail: string,
  ): Promise<PasswordResetUserRecord | null> {
    const row = await this.findUserForLogin(organizationId, normalizedEmail);
    return row === null
      ? null
      : { id: row.id, organizationId: row.organizationId, email: row.email, active: row.active };
  }

  async createPasswordResetToken(
    input: Omit<PasswordResetTokenRecord, 'id'>,
  ): Promise<PasswordResetTokenRecord> {
    return this.prisma.passwordResetToken.create({ data: input });
  }

  async findPasswordResetToken(tokenHash: string): Promise<PasswordResetTokenRecord | null> {
    return this.prisma.passwordResetToken.findFirst({ where: { tokenHash } });
  }

  async markPasswordResetTokenUsed(
    id: string,
    organizationId: string,
    usedAt: Date,
  ): Promise<void> {
    await this.prisma.passwordResetToken.update({
      where: { organizationId_id: { organizationId, id } },
      data: { usedAt },
    });
  }

  async setUserPasswordHash(
    userId: string,
    organizationId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { organizationId_id: { organizationId, id: userId } },
      data: { passwordHash },
    });
  }

  async revokeUserSessions(
    userId: string,
    organizationId: string,
    revokedAt: Date,
  ): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { organizationId, userId, revokedAt: null },
      data: { revokedAt },
    });
    return result.count;
  }

  async writeSystemAudit(input: SecurityAuditInput): Promise<void> {
    await this.prisma.systemAuditLog.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        oldValue: input.oldValue,
        newValue: input.newValue,
      },
    });
  }
}
