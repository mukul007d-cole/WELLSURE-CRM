import { readFile } from 'node:fs/promises';

import { afterAll, describe, expect, it } from 'vitest';

import { bootstrapFirstAdmin } from '../admin/bootstrap.js';
import { defaultAuthConfig } from '../auth/config.js';
import { createAdminPostgres, shouldRunAdminPostgres } from './fixtures/synthetic-admin.js';

let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => cleanup?.());

describe.runIf(shouldRunAdminPostgres)('administration against real Postgres', () => {
  it('serializes bootstrap and provisions the canonical four authorization axes once', async () => {
    const db = await createAdminPostgres();
    cleanup = db.cleanup;
    const migration = await readFile(
      new URL(
        '../../../../packages/database/prisma/migrations/00000000000000_initial/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await db.sql.unsafe(migration);
    const authMigration = await readFile(
      new URL(
        '../../../../packages/database/prisma/migrations/00000000000001_custom_session_auth/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await db.sql.unsafe(authMigration);
    const organization = await db.prisma.organization.create({
      data: { name: 'Synthetic Organization' },
    });
    const delivered: string[] = [];
    const input = {
      prisma: db.prisma,
      authConfig: defaultAuthConfig,
      organizationId: organization.id,
      name: 'Synthetic Administrator',
      email: 'admin@example.test',
      emailSender: {
        sendPasswordReset(message: { token: string }) {
          delivered.push(message.token);
          return Promise.resolve();
        },
      },
    };
    const [first, second] = await Promise.allSettled([
      bootstrapFirstAdmin(input),
      bootstrapFirstAdmin(input),
    ]);
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(await db.prisma.user.count({ where: { organizationId: organization.id } })).toBe(1);
    const role = await db.prisma.role.findFirstOrThrow({
      where: { organizationId: organization.id },
      include: { permissions: true, journeyAccess: true, fieldVisibility: true },
    });
    expect(role.permissions.length).toBeGreaterThan(0);
    expect(delivered).toHaveLength(1);
    expect(
      await db.prisma.systemAuditLog.count({
        where: { organizationId: organization.id, actorUserId: null },
      }),
    ).toBe(2);
  }, 120_000);
});
