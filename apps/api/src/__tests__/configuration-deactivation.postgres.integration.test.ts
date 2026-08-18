import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';
import { permissionCatalog } from '@falcon/permission-engine';

import { bootstrapFirstAdmin } from '../admin/bootstrap.js';
import { PrismaAdminRepository } from '../admin/prisma-admin-repository.js';
import { PrismaConfigurationRepository } from '../configuration/prisma-configuration-repository.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { defaultAuthConfig } from '../auth/config.js';
import { buildServer } from '../http/build-server.js';
import type { ServerDependencies } from '../http/types.js';
import { createAdminPostgres, shouldRunAdminPostgres } from './fixtures/synthetic-admin.js';

/**
 * Configuration deactivation, against real Postgres and the real permission
 * engine.
 *
 * The regression this file exists for: `DELETE /journeys/:id`,
 * `/statuses/:id`, `/services/:id` and `/fields/:id` checked a
 * `<module>:deactivate` permission the catalog has never defined. Rows outside
 * the catalog cannot be stored (`admin/validation.ts`) and `bootstrapFirstAdmin`
 * creates the catalog and nothing else, so no role in any deployment could hold
 * one and all four routes answered 403 to everybody.
 *
 * What makes this test different from the unit cases in `configuration.test.ts`:
 * the grants come from the real bootstrap command writing real `role_permissions`
 * rows, and the decision comes from `PrismaPermissionRepository` reading them
 * back. A route asking for a pair that cannot exist has nowhere to hide.
 *
 * Every name is synthetic. Nothing here depends on a real journey, status,
 * service, field, role or person name (`AGENTS.md`).
 */

describe.runIf(shouldRunAdminPostgres)('configuration deactivation permissions', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  /** Holds the whole catalog minus the three actions deactivation needs. */
  const restrictedRole = randomUUID();
  const restrictedUser = randomUUID();

  let adminUser: string;
  let adminRole: string;

  const serverFor = (userId: string, roleId: string) =>
    buildServer({
      authRepository: {
        findSessionByTokenHash: () =>
          Promise.resolve({
            id: randomUUID(),
            tokenHash: 'ignored',
            userId,
            organizationId: org,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            lastSeenAt: new Date(),
            ipAddress: null,
            userAgent: null,
          }),
        touchSession: () => Promise.resolve(),
        getUserSnapshot: () =>
          Promise.resolve({
            id: userId,
            organizationId: org,
            roleId,
            active: true,
            departmentId: null,
            managerId: null,
          }),
      },
      permissionRepository: new PrismaPermissionRepository(prisma as never),
      adminRepository: new PrismaAdminRepository(prisma),
      configurationRepository: new PrismaConfigurationRepository(prisma),
      leadRepository: new PrismaLeadRepository(prisma as never),
      audit: {},
      emailSender: { sendPasswordReset: () => Promise.resolve() },
      authConfig: { ...defaultAuthConfig, secureCookies: false },
      corsOrigins: [],
    } as unknown as ServerDependencies);

  const call = async (
    actor: { userId: string; roleId: string },
    method: 'POST' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const server = serverFor(actor.userId, actor.roleId);
    try {
      const response = await server.inject({
        method,
        url,
        headers: { cookie: 'falcon_session=synthetic' },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      return { statusCode: response.statusCode, body: response.body };
    } finally {
      await server.close();
    }
  };

  const asAdmin = () => ({ userId: adminUser, roleId: adminRole });
  const asRestricted = () => ({ userId: restrictedUser, roleId: restrictedRole });

  const created = async (url: string, payload: unknown): Promise<{ id: string }> => {
    const response = await call(asAdmin(), 'POST', url, payload);
    expect(response.statusCode).toBe(201);
    return JSON.parse(response.body) as { id: string };
  };

  /**
   * The three pairs the four deactivation routes require, withheld from the
   * restricted role. `services` is the one configuration module with no
   * `delete` action in the catalog, so its route gates on `edit` — see the
   * comments in `routes/configuration.ts`.
   */
  const withheld = new Set(['journeys_statuses:delete', 'services:edit', 'fields:delete']);

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    const directory = new URL('../../../../packages/database/prisma/migrations/', import.meta.url);
    const migrations = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const migration of migrations)
      await db.sql.unsafe(await readFile(new URL(`${migration}/migration.sql`, directory), 'utf8'));

    await prisma.organization.create({ data: { id: org, name: 'Synthetic organization' } });

    // The real command, not a hand-built imitation of it: what the initial
    // administrator can do is exactly the claim under test.
    const bootstrap = await bootstrapFirstAdmin({
      prisma,
      emailSender: { sendPasswordReset: () => Promise.resolve() },
      authConfig: defaultAuthConfig,
      organizationId: org,
      name: 'Synthetic Administrator',
      email: 'administrator@example.test',
    });
    adminUser = bootstrap.user.id;
    adminRole = bootstrap.role.id;

    await prisma.role.create({
      data: { organizationId: org, id: restrictedRole, key: 'restricted', name: 'Restricted' },
    });
    await prisma.rolePermission.createMany({
      data: permissionCatalog
        .flatMap(({ module, actions }) => actions.map((action) => ({ module, action })))
        .filter((pair) => !withheld.has(`${pair.module}:${pair.action}`))
        .map((pair) => ({
          organizationId: org,
          roleId: restrictedRole,
          ...pair,
          scope: 'ORGANIZATION' as const,
        })),
    });
    await prisma.user.create({
      data: {
        organizationId: org,
        id: restrictedUser,
        name: 'Synthetic Restricted User',
        email: 'restricted@example.test',
        roleId: restrictedRole,
      },
    });
  }, 120_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  it('lets the bootstrapped administrator deactivate a Journey, Status, Service and Field', async () => {
    const journey = await created('/api/v1/journeys', {
      key: 'synthetic_journey',
      name: 'Synthetic Journey',
    });
    const status = await created(`/api/v1/journeys/${journey.id}/statuses`, {
      key: 'synthetic_status',
      name: 'Synthetic Status',
      outcomeType: 'open',
      behaviorType: 'default',
      sortOrder: 0,
    });
    const service = await created('/api/v1/services', {
      key: 'synthetic_service',
      name: 'Synthetic Service',
    });
    const field = await created('/api/v1/fields', {
      key: 'synthetic_field',
      name: 'Synthetic Field',
      fieldType: 'text',
      editMode: 'manual',
      source: 'manual',
    });

    // Creating a Journey grants it to every role holding
    // `journeys_statuses:view`, the restricted one included. Asserted rather
    // than assumed: it is what makes the denials below attributable to the
    // missing module action instead of to journey access.
    expect(
      await prisma.roleJourneyAccess.count({
        where: { organizationId: org, roleId: restrictedRole, journeyId: journey.id },
      }),
    ).toBe(1);

    const denials = await Promise.all([
      call(asRestricted(), 'DELETE', `/api/v1/journeys/${journey.id}`),
      call(asRestricted(), 'DELETE', `/api/v1/statuses/${status.id}`, { journeyId: journey.id }),
      call(asRestricted(), 'DELETE', `/api/v1/services/${service.id}`),
      call(asRestricted(), 'DELETE', `/api/v1/fields/${field.id}`),
    ]);
    expect(denials.map((response) => response.statusCode)).toEqual([403, 403, 403, 403]);
    expect(denials.map((response) => JSON.parse(response.body) as unknown)).toEqual(
      Array.from({ length: 4 }, () => ({ error: 'forbidden' })),
    );

    // Innermost first: a Status is deactivated while its Journey is still
    // active, and a Field while nothing maps it.
    const allowed = [
      await call(asAdmin(), 'DELETE', `/api/v1/fields/${field.id}`),
      await call(asAdmin(), 'DELETE', `/api/v1/services/${service.id}`),
      await call(asAdmin(), 'DELETE', `/api/v1/statuses/${status.id}`, { journeyId: journey.id }),
      await call(asAdmin(), 'DELETE', `/api/v1/journeys/${journey.id}`),
    ];
    expect(allowed.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);

    const [journeyRow, statusRow, serviceRow, fieldRow] = await Promise.all([
      prisma.journey.findFirst({ where: { organizationId: org, id: journey.id } }),
      prisma.status.findFirst({ where: { organizationId: org, id: status.id } }),
      prisma.service.findFirst({ where: { organizationId: org, id: service.id } }),
      prisma.field.findFirst({ where: { organizationId: org, id: field.id } }),
    ]);
    expect([journeyRow?.active, statusRow?.active, serviceRow?.active, fieldRow?.active]).toEqual([
      false,
      false,
      false,
      false,
    ]);

    const audits = await prisma.systemAuditLog.findMany({
      where: { organizationId: org, action: 'deactivate' },
      orderBy: { timestamp: 'asc' },
    });
    expect(audits.map((row) => ({ entityType: row.entityType, entityId: row.entityId }))).toEqual([
      { entityType: 'field', entityId: field.id },
      { entityType: 'service', entityId: service.id },
      { entityType: 'status', entityId: status.id },
      { entityType: 'journey', entityId: journey.id },
    ]);
    // The audit row is worth writing only if it says what changed.
    for (const row of audits) {
      expect(row.actorUserId).toBe(adminUser);
      expect(row.oldValue).toMatchObject({ active: true });
      expect(row.newValue).toMatchObject({ active: false });
    }
  }, 120_000);
});

describe.skipIf(shouldRunAdminPostgres)('configuration deactivation permissions', () => {
  it('requires Docker/Testcontainers or FALCON_POSTGRES_URL to execute', () => {
    expect(shouldRunAdminPostgres).toBe(false);
  });
});
