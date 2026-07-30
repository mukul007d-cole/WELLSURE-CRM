import { existsSync } from 'node:fs';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { expandScopeUserIds } from '../scope.js';
import type { PermissionRepository, UserSnapshot } from '../types.js';

const directPostgresUrl = process.env.FALCON_POSTGRES_URL;
const canAttemptTestcontainers =
  process.env.DOCKER_HOST !== undefined || existsSync('/var/run/docker.sock');
const shouldRunPostgresIntegration = directPostgresUrl !== undefined || canAttemptTestcontainers;

let cleanup: (() => Promise<void>) | undefined;

afterAll(async () => {
  await cleanup?.();
});

describe.runIf(shouldRunPostgresIntegration)('scope resolution against real Postgres', () => {
  it('uses tenant-scoped, cycle-safe hierarchy queries for TEAM and DEPARTMENT scope', async () => {
    const database = await createPostgresDatabase();
    cleanup = database.cleanup;

    await database.sql`
      CREATE TEMP TABLE permission_engine_test_users (
        id text PRIMARY KEY,
        organization_id text NOT NULL,
        role_id text NOT NULL,
        active boolean NOT NULL,
        department_id text,
        manager_id text
      )
    `;

    await database.sql`
      INSERT INTO permission_engine_test_users
        (id, organization_id, role_id, active, department_id, manager_id)
      VALUES
        ('pg-root', 'pg-org-a', 'pg-role', true, 'pg-dept-a', null),
        ('pg-child', 'pg-org-a', 'pg-role', true, 'pg-dept-a', 'pg-root'),
        ('pg-grandchild', 'pg-org-a', 'pg-role', true, 'pg-dept-a', 'pg-child'),
        ('pg-sibling', 'pg-org-a', 'pg-role', true, 'pg-dept-a', null),
        ('pg-inactive-child', 'pg-org-a', 'pg-role', false, 'pg-dept-a', 'pg-root'),
        ('pg-other-dept', 'pg-org-a', 'pg-role', true, 'pg-dept-b', null),
        ('pg-cycle-a', 'pg-org-a', 'pg-role', true, 'pg-dept-cycle', 'pg-cycle-b'),
        ('pg-cycle-b', 'pg-org-a', 'pg-role', true, 'pg-dept-cycle', 'pg-cycle-a'),
        ('pg-cross-tenant-child', 'pg-org-b', 'pg-role', true, 'pg-dept-a', 'pg-root')
    `;

    const repository = createPostgresScopeRepository(database.sql);
    const root = user('pg-root', 'pg-org-a', 'pg-dept-a', null);
    const cycleUser = user('pg-cycle-a', 'pg-org-a', 'pg-dept-cycle', 'pg-cycle-b');

    await expect(expandScopeUserIds({ repository, user: root, scope: 'TEAM' })).resolves.toEqual([
      'pg-root',
      'pg-child',
      'pg-grandchild',
    ]);
    await expect(
      expandScopeUserIds({ repository, user: root, scope: 'DEPARTMENT' }),
    ).resolves.toEqual(['pg-root', 'pg-child', 'pg-grandchild', 'pg-sibling']);
    await expect(
      expandScopeUserIds({ repository, user: cycleUser, scope: 'TEAM' }),
    ).resolves.toEqual(['pg-cycle-a', 'pg-cycle-b']);
  });
});

describe.skipIf(shouldRunPostgresIntegration)('scope resolution against real Postgres', () => {
  it('requires Docker/Testcontainers or FALCON_POSTGRES_URL to execute', () => {
    expect(shouldRunPostgresIntegration).toBe(false);
  });
});

async function createPostgresDatabase(): Promise<{
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

function createPostgresScopeRepository(sql: postgres.Sql): PermissionRepository {
  return {
    getUser(userId, organizationId) {
      return findUser(sql, userId, organizationId);
    },
    getRole() {
      return Promise.resolve(null);
    },
    getRolePermission() {
      return Promise.resolve(null);
    },
    hasJourneyAccess() {
      return Promise.resolve(false);
    },
    getFieldVisibility() {
      return Promise.resolve([]);
    },
    getLeadScope() {
      return Promise.resolve(null);
    },
    async listActiveUserIds(input) {
      const rows = await sql<{ id: string }[]>`
        SELECT id
        FROM permission_engine_test_users
        WHERE organization_id = ${input.organizationId}
          AND active = true
        ORDER BY id
      `;
      return rows.map((row) => row.id);
    },
    async listDepartmentUserIds(input) {
      const rows = await sql<{ id: string }[]>`
        SELECT id
        FROM permission_engine_test_users
        WHERE organization_id = ${input.organizationId}
          AND active = true
          AND department_id = ${input.departmentId}
        ORDER BY CASE id
          WHEN 'pg-root' THEN 1
          WHEN 'pg-child' THEN 2
          WHEN 'pg-grandchild' THEN 3
          WHEN 'pg-sibling' THEN 4
          ELSE 99
        END,
        id
      `;
      return rows.map((row) => row.id);
    },
    async listReports(input) {
      const rows = await sql<UserRow[]>`
        SELECT id, organization_id, role_id, active, department_id, manager_id
        FROM permission_engine_test_users
        WHERE organization_id = ${input.organizationId}
          AND manager_id = ${input.managerId}
        ORDER BY CASE id
          WHEN 'pg-child' THEN 1
          WHEN 'pg-grandchild' THEN 2
          WHEN 'pg-cycle-b' THEN 3
          WHEN 'pg-cycle-a' THEN 4
          ELSE 99
        END,
        id
      `;
      return rows.map(fromUserRow);
    },
    getActiveDirectGrant() {
      return Promise.resolve(null);
    },
    listCurrentAssignments() {
      return Promise.resolve([]);
    },
  };
}

async function findUser(
  sql: postgres.Sql,
  userId: string,
  organizationId: string,
): Promise<UserSnapshot | null> {
  const rows = await sql<UserRow[]>`
    SELECT id, organization_id, role_id, active, department_id, manager_id
    FROM permission_engine_test_users
    WHERE id = ${userId}
      AND organization_id = ${organizationId}
  `;
  const row = rows[0];
  return row === undefined ? null : fromUserRow(row);
}

interface UserRow {
  id: string;
  organization_id: string;
  role_id: string;
  active: boolean;
  department_id: string | null;
  manager_id: string | null;
}

function fromUserRow(row: UserRow): UserSnapshot {
  return {
    id: row.id,
    organizationId: row.organization_id,
    roleId: row.role_id,
    active: row.active,
    departmentId: row.department_id,
    managerId: row.manager_id,
  };
}

function user(
  id: string,
  organizationId: string,
  departmentId: string,
  managerId: string | null,
): UserSnapshot {
  return { id, organizationId, departmentId, managerId, roleId: 'pg-role', active: true };
}
