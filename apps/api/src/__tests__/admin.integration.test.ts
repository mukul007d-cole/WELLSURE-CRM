import { readFile } from 'node:fs/promises';

import { bootstrapGrantedPairs, permissionCatalog } from '@falcon/permission-engine';
import { afterAll, describe, expect, it } from 'vitest';

import { bootstrapFirstAdmin } from '../admin/bootstrap.js';
import { defaultAuthConfig } from '../auth/config.js';
import { createEmailSender } from '../auth/email-sender.js';
import { runBootstrap } from '../bootstrap-cli.js';
import { createAdminPostgres, shouldRunAdminPostgres } from './fixtures/synthetic-admin.js';

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => Promise.all(cleanups.map((cleanup) => cleanup())));

describe.runIf(shouldRunAdminPostgres)('administration against real Postgres', () => {
  it('runs the CLI operation once and refuses a second run without duplicates', async () => {
    const db = await createAdminPostgres();
    cleanups.push(db.cleanup);
    for (const path of [
      '../../../../packages/database/prisma/migrations/00000000000000_initial/migration.sql',
      '../../../../packages/database/prisma/migrations/00000000000001_custom_session_auth/migration.sql',
    ]) {
      await db.sql.unsafe(await readFile(new URL(path, import.meta.url), 'utf8'));
    }
    const consoleMessages: string[] = [];
    const dependencies = {
      prisma: db.prisma,
      authConfig: defaultAuthConfig,
      emailSender: createEmailSender({
        transport: 'console',
        httpPort: 3000,
        write: (message) => consoleMessages.push(message),
      }),
    };
    const options = {
      organizationName: 'Synthetic CLI Organization',
      adminName: 'Synthetic CLI Administrator',
      adminEmail: 'cli-admin@example.test',
    };

    const firstRun = await runBootstrap(options, dependencies);
    expect(firstRun.organizationId).toEqual(expect.any(String) as string);
    expect(firstRun.userId).toEqual(expect.any(String) as string);
    await expect(runBootstrap(options, dependencies)).rejects.toThrow('Bootstrap refused');
    expect(await db.prisma.organization.count()).toBe(1);
    expect(await db.prisma.user.count()).toBe(1);
    /*
     * The catalog *less* what it marks `withheldFromBootstrap` — today `purge`
     * and nothing else, per ADR-0017 amending ADR-0009. Asserted against
     * `bootstrapGrantedPairs()` rather than a literal so the two cannot drift,
     * and with the purge rows asserted absent so the amendment is explicit
     * rather than implied by an arithmetic difference.
     */
    expect(await db.prisma.rolePermission.count()).toBe(bootstrapGrantedPairs().length);
    expect(await db.prisma.rolePermission.count({ where: { scope: 'ORGANIZATION' } })).toBe(
      bootstrapGrantedPairs().length,
    );
    expect(await db.prisma.rolePermission.count({ where: { action: 'purge' } })).toBe(0);
    expect(bootstrapGrantedPairs().length).toBeLessThan(
      permissionCatalog.reduce((total, entry) => total + entry.actions.length, 0),
    );
    expect(consoleMessages).toHaveLength(1);
    expect(consoleMessages[0]).toContain('Reset token:');
    expect(consoleMessages[0]).toContain(
      "curl --request POST 'http://localhost:3000/api/v1/auth/password-reset/complete'",
    );
  }, 120_000);

  it('serializes bootstrap and provisions the canonical four authorization axes once', async () => {
    const db = await createAdminPostgres();
    cleanups.push(db.cleanup);
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
