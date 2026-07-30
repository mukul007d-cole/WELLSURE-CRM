import { existsSync } from 'node:fs';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';

import type { SecurityAuditInput, SecurityAuditWriter } from '../../auth/audit.js';
import type { LoginAttemptRecord, LoginRepository, LoginUserRecord } from '../../auth/login.js';
import type {
  PasswordResetRepository,
  PasswordResetTokenRecord,
  PasswordResetUserRecord,
} from '../../auth/password-reset.js';
import type { SessionRecord } from '../../auth/session.js';
import type { UserSnapshot } from '@falcon/permission-engine';

const directPostgresUrl = process.env.FALCON_POSTGRES_URL;
const canAttemptTestcontainers =
  process.env.DOCKER_HOST !== undefined || existsSync('/var/run/docker.sock');
export const shouldRunPostgresIntegration =
  directPostgresUrl !== undefined || canAttemptTestcontainers;

export async function createPostgresDatabase(): Promise<{
  sql: postgres.Sql;
  cleanup: () => Promise<void>;
}> {
  if (directPostgresUrl !== undefined) {
    const sql = postgres(directPostgresUrl, { max: 1 });
    return { sql, cleanup: () => sql.end() };
  }

  const container = await new PostgreSqlContainer('postgres:17.5-alpine3.21').start();
  const sql = postgres(container.getConnectionUri(), { max: 1 });
  return {
    sql,
    cleanup: async () => {
      await sql.end();
      await container.stop();
    },
  };
}

export async function setupAuthSchema(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TEMP TABLE auth_test_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      email text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      role_id uuid NOT NULL DEFAULT gen_random_uuid(),
      department_id uuid,
      manager_id uuid,
      password_hash text
    )
  `;
  await sql`
    CREATE TEMP TABLE auth_test_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      user_id uuid NOT NULL,
      token_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      ip_address text,
      user_agent text
    )
  `;
  await sql`
    CREATE TEMP TABLE auth_test_password_reset_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      user_id uuid NOT NULL,
      token_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      ip_address text,
      user_agent text
    )
  `;
  await sql`
    CREATE TEMP TABLE auth_test_failed_login_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      normalized_email text NOT NULL,
      failed_count integer NOT NULL DEFAULT 0,
      window_started_at timestamptz NOT NULL,
      locked_until timestamptz,
      UNIQUE (organization_id, normalized_email)
    )
  `;
  await sql`
    CREATE TEMP TABLE auth_test_system_audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      actor_user_id uuid,
      entity_type text NOT NULL,
      entity_id uuid NOT NULL,
      action text NOT NULL,
      old_value jsonb,
      new_value jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function seedUser(
  sql: postgres.Sql,
  input: { organizationId: string; email: string; passwordHash: string | null },
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth_test_users (organization_id, email, password_hash)
    VALUES (${input.organizationId}, ${input.email}, ${input.passwordHash})
    RETURNING id
  `;
  if (row === undefined) {
    throw new Error('failed to seed user');
  }
  return row.id;
}

export async function getAuditRows(
  sql: postgres.Sql,
  organizationId: string,
): Promise<SecurityAuditInput[]> {
  const rows = await sql<
    {
      organization_id: string;
      actor_user_id: string | null;
      entity_type: string;
      entity_id: string;
      action: string;
      old_value: unknown;
      new_value: unknown;
    }[]
  >`
    SELECT organization_id, actor_user_id, entity_type, entity_id, action, old_value, new_value
    FROM auth_test_system_audit_logs
    WHERE organization_id = ${organizationId}
    ORDER BY created_at ASC
  `;
  return rows.map((row) => ({
    organizationId: row.organization_id,
    actorUserId: row.actor_user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action as SecurityAuditInput['action'],
    oldValue: row.old_value,
    newValue: row.new_value,
  }));
}

export function createPostgresAuthRepository(
  sql: postgres.Sql,
): LoginRepository & PasswordResetRepository & SecurityAuditWriter {
  return {
    async createSession(input) {
      const [row] = await sql<SessionDbRow[]>`
        INSERT INTO auth_test_sessions
          (organization_id, user_id, token_hash, created_at, expires_at, revoked_at, last_seen_at, ip_address, user_agent)
        VALUES
          (${input.organizationId}, ${input.userId}, ${input.tokenHash}, ${input.createdAt},
           ${input.expiresAt}, ${input.revokedAt}, ${input.lastSeenAt}, ${input.ipAddress}, ${input.userAgent})
        RETURNING *
      `;
      return fromSessionRow(row!);
    },
    async findSessionByTokenHash(tokenHash) {
      const [row] = await sql<SessionDbRow[]>`
        SELECT * FROM auth_test_sessions WHERE token_hash = ${tokenHash}
      `;
      return row === undefined ? null : fromSessionRow(row);
    },
    async touchSession(sessionId, organizationId, at) {
      await sql`
        UPDATE auth_test_sessions SET last_seen_at = ${at}
        WHERE id = ${sessionId} AND organization_id = ${organizationId}
      `;
    },
    async revokeSession(sessionId, organizationId, at) {
      const [row] = await sql<SessionDbRow[]>`
        UPDATE auth_test_sessions SET revoked_at = ${at}
        WHERE id = ${sessionId} AND organization_id = ${organizationId}
        RETURNING *
      `;
      return row === undefined ? null : fromSessionRow(row);
    },
    async getUserSnapshot(userId, organizationId) {
      const [row] = await sql<UserDbRow[]>`
        SELECT id, organization_id, role_id, active, department_id, manager_id
        FROM auth_test_users WHERE id = ${userId} AND organization_id = ${organizationId}
      `;
      return row === undefined ? null : fromUserRow(row);
    },
    async findUserForLogin(organizationId, normalizedEmail) {
      const [row] = await sql<LoginUserDbRow[]>`
        SELECT id, organization_id, email, active, password_hash
        FROM auth_test_users
        WHERE organization_id = ${organizationId} AND lower(email) = ${normalizedEmail}
      `;
      return row === undefined ? null : fromLoginUserRow(row);
    },
    async getLoginAttempt(organizationId, normalizedEmail) {
      const [row] = await sql<AttemptDbRow[]>`
        SELECT organization_id, normalized_email, failed_count, window_started_at, locked_until
        FROM auth_test_failed_login_attempts
        WHERE organization_id = ${organizationId} AND normalized_email = ${normalizedEmail}
      `;
      return row === undefined ? null : fromAttemptRow(row);
    },
    async recordFailedLogin(input: LoginAttemptRecord) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO auth_test_failed_login_attempts
          (organization_id, normalized_email, failed_count, window_started_at, locked_until)
        VALUES (${input.organizationId}, ${input.normalizedEmail}, ${input.failedCount},
                ${input.windowStartedAt}, ${input.lockedUntil})
        ON CONFLICT (organization_id, normalized_email)
        DO UPDATE SET
          failed_count = EXCLUDED.failed_count,
          window_started_at = EXCLUDED.window_started_at,
          locked_until = EXCLUDED.locked_until
        RETURNING id
      `;
      return { id: row!.id };
    },
    async clearLoginAttempt(organizationId, normalizedEmail) {
      await sql`
        DELETE FROM auth_test_failed_login_attempts
        WHERE organization_id = ${organizationId} AND normalized_email = ${normalizedEmail}
      `;
    },
    async findUserForPasswordReset(organizationId, normalizedEmail): Promise<PasswordResetUserRecord | null> {
      const user = await this.findUserForLogin(organizationId, normalizedEmail);
      return user === null
        ? null
        : { id: user.id, organizationId: user.organizationId, email: user.email, active: user.active };
    },
    async createPasswordResetToken(input) {
      const [row] = await sql<ResetTokenDbRow[]>`
        INSERT INTO auth_test_password_reset_tokens
          (organization_id, user_id, token_hash, created_at, expires_at, used_at, ip_address, user_agent)
        VALUES (${input.organizationId}, ${input.userId}, ${input.tokenHash}, ${input.createdAt},
                ${input.expiresAt}, ${input.usedAt}, ${input.ipAddress}, ${input.userAgent})
        RETURNING *
      `;
      return fromResetTokenRow(row!);
    },
    async findPasswordResetToken(tokenHash) {
      const [row] = await sql<ResetTokenDbRow[]>`
        SELECT * FROM auth_test_password_reset_tokens WHERE token_hash = ${tokenHash}
      `;
      return row === undefined ? null : fromResetTokenRow(row);
    },
    async markPasswordResetTokenUsed(id, organizationId, usedAt) {
      await sql`
        UPDATE auth_test_password_reset_tokens SET used_at = ${usedAt}
        WHERE id = ${id} AND organization_id = ${organizationId}
      `;
    },
    async setUserPasswordHash(userId, organizationId, passwordHash) {
      await sql`
        UPDATE auth_test_users SET password_hash = ${passwordHash}
        WHERE id = ${userId} AND organization_id = ${organizationId}
      `;
    },
    async revokeUserSessions(userId, organizationId, revokedAt) {
      const rows = await sql<{ id: string }[]>`
        UPDATE auth_test_sessions SET revoked_at = ${revokedAt}
        WHERE user_id = ${userId} AND organization_id = ${organizationId} AND revoked_at IS NULL
        RETURNING id
      `;
      return rows.length;
    },
    async writeSystemAudit(input: SecurityAuditInput) {
      await sql`
        INSERT INTO auth_test_system_audit_logs
          (organization_id, actor_user_id, entity_type, entity_id, action, old_value, new_value)
        VALUES (${input.organizationId}, ${input.actorUserId}, ${input.entityType}, ${input.entityId},
                ${input.action}, ${sql.json(input.oldValue as object)}, ${sql.json(input.newValue as object)})
      `;
    },
  };
}

interface SessionDbRow {
  id: string;
  organization_id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at: Date;
  ip_address: string | null;
  user_agent: string | null;
}
function fromSessionRow(row: SessionDbRow): SessionRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastSeenAt: row.last_seen_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

interface UserDbRow {
  id: string;
  organization_id: string;
  role_id: string;
  active: boolean;
  department_id: string | null;
  manager_id: string | null;
}
function fromUserRow(row: UserDbRow): UserSnapshot {
  return {
    id: row.id,
    organizationId: row.organization_id,
    roleId: row.role_id,
    active: row.active,
    departmentId: row.department_id,
    managerId: row.manager_id,
  };
}

interface LoginUserDbRow {
  id: string;
  organization_id: string;
  email: string;
  active: boolean;
  password_hash: string | null;
}
function fromLoginUserRow(row: LoginUserDbRow): LoginUserRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    active: row.active,
    passwordHash: row.password_hash,
  };
}

interface AttemptDbRow {
  organization_id: string;
  normalized_email: string;
  failed_count: number;
  window_started_at: Date;
  locked_until: Date | null;
}
function fromAttemptRow(row: AttemptDbRow): LoginAttemptRecord {
  return {
    organizationId: row.organization_id,
    normalizedEmail: row.normalized_email,
    failedCount: row.failed_count,
    windowStartedAt: row.window_started_at,
    lockedUntil: row.locked_until,
  };
}

interface ResetTokenDbRow {
  id: string;
  organization_id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  ip_address: string | null;
  user_agent: string | null;
}
function fromResetTokenRow(row: ResetTokenDbRow): PasswordResetTokenRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}