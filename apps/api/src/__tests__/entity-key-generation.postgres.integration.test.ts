import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';
import { slugify } from '@falcon/validation';

import { bootstrapFirstAdmin } from '../admin/bootstrap.js';
import { PrismaAdminRepository } from '../admin/prisma-admin-repository.js';
import { PrismaConfigurationRepository } from '../configuration/prisma-configuration-repository.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { NotificationService } from '../notifications/service.js';
import { defaultAuthConfig } from '../auth/config.js';
import { buildServer } from '../http/build-server.js';
import type { ServerDependencies } from '../http/types.js';
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from './fixtures/synthetic-admin.js';

/**
 * "Auto-generate entity keys" — every entity that used to require an admin to
 * type an immutable `key` by hand now derives it from `name` instead.
 *
 * Proven end to end through the real HTTP surface and real Postgres unique
 * constraints, not the in-memory fakes the unit-level `configuration.test.ts`
 * uses: this is exactly where a scoping mistake (treating a per-Journey or
 * per-Department key as organization-wide, or vice versa) would surface as a
 * spurious collision or a missed one.
 *
 * Every name is synthetic (`AGENTS.md`) — none of them names a real Falcon
 * concept, so the generated keys below are exercise fixtures, not documentation
 * of what a deployment should actually call things.
 */
describe.runIf(shouldRunAdminPostgres)('auto-generated entity keys against real Postgres', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;
  const org = randomUUID();
  let adminUserId: string;
  let adminRoleId: string;

  const serverFor = () =>
    buildServer({
      authRepository: {
        findSessionByTokenHash: () =>
          Promise.resolve({
            id: randomUUID(),
            tokenHash: 'ignored',
            userId: adminUserId,
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
            id: adminUserId,
            organizationId: org,
            roleId: adminRoleId,
            active: true,
            departmentId: null,
            managerId: null,
          }),
      },
      permissionRepository: new PrismaPermissionRepository(prisma as never),
      adminRepository: new PrismaAdminRepository(prisma),
      configurationRepository: new PrismaConfigurationRepository(prisma),
      leadRepository: new PrismaLeadRepository(prisma as never),
      notificationService: new NotificationService(prisma),
      prisma,
      audit: {},
      emailSender: { sendPasswordReset: () => Promise.resolve(), sendEmail: () => Promise.resolve() },
      authConfig: { ...defaultAuthConfig, secureCookies: false },
      corsOrigins: [],
    } as unknown as ServerDependencies);

  const call = async (method: 'GET' | 'POST', url: string, payload?: unknown) => {
    const server = serverFor();
    try {
      const response = await server.inject({
        method,
        url,
        headers: { cookie: 'falcon_session=synthetic' },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      return { statusCode: response.statusCode, body: JSON.parse(response.body) as Json };
    } finally {
      await server.close();
    }
  };
  type Json = Record<string, unknown>;

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    await applyMigrations(db.sql);
    await prisma.organization.create({ data: { id: org, name: 'Synthetic organization' } });
    // Bootstrap rather than hand-rolled rolePermission rows: it grants every
    // catalog pair except `purge` (ADR-0017), which is every module this suite
    // touches, and it is itself the tested production path for "a fully
    // permissioned admin", not a fixture that could drift from it.
    const bootstrap = await bootstrapFirstAdmin({
      prisma,
      authConfig: defaultAuthConfig,
      organizationId: org,
      name: 'Synthetic bootstrap admin',
      email: 'bootstrap-admin@example.test',
      emailSender: { sendPasswordReset: () => Promise.resolve() },
    });
    adminUserId = bootstrap.user.id;
    adminRoleId = bootstrap.role.id;
  }, 120_000);

  afterAll(async () => db?.cleanup());

  it('generates a Department key from the name, with no key in the request', async () => {
    const name = 'Synthetic Onboarding Unit';
    const first = await call('POST', '/api/v1/departments', { name });
    expect(first.statusCode).toBe(201);
    expect(first.body.key).toBe(slugify(name));

    // Same name again: the server derives a distinct key rather than
    // rejecting the create or silently colliding on the unique constraint.
    const second = await call('POST', '/api/v1/departments', { name });
    expect(second.statusCode).toBe(201);
    expect(second.body.key).toBe(`${slugify(name)}_2`);
    expect(second.body.id).not.toBe(first.body.id);
  }, 30_000);

  it('generates a Role key from the name and resolves collisions the same way', async () => {
    const name = 'Synthetic Escalation Owner';
    const first = await call('POST', '/api/v1/roles', { name });
    expect(first.statusCode).toBe(201);
    expect(first.body.key).toBe(slugify(name));

    const second = await call('POST', '/api/v1/roles', { name });
    expect(second.statusCode).toBe(201);
    expect(second.body.key).toBe(`${slugify(name)}_2`);
  }, 30_000);

  it('scopes a Team key to its Department, not to the organization', async () => {
    const departmentA = await call('POST', '/api/v1/departments', {
      name: 'Synthetic Team Department A',
    });
    const departmentB = await call('POST', '/api/v1/departments', {
      name: 'Synthetic Team Department B',
    });
    expect(departmentA.statusCode).toBe(201);
    expect(departmentB.statusCode).toBe(201);

    // A member must belong to the Team's own Department (ADR-0014's
    // department-enforcing foreign key), so each gets its own synthetic user.
    const leaderA = randomUUID();
    const leaderB = randomUUID();
    await prisma.user.createMany({
      data: [
        {
          id: leaderA,
          organizationId: org,
          name: 'Synthetic leader A',
          email: 'leader-a@example.test',
          roleId: adminRoleId,
          departmentId: departmentA.body.id as string,
        },
        {
          id: leaderB,
          organizationId: org,
          name: 'Synthetic leader B',
          email: 'leader-b@example.test',
          roleId: adminRoleId,
          departmentId: departmentB.body.id as string,
        },
      ],
    });

    const name = 'Synthetic Frontline Team';
    const departmentAId = String(departmentA.body.id);
    const departmentBId = String(departmentB.body.id);
    const inA = await call('POST', `/api/v1/departments/${departmentAId}/teams`, {
      name,
      members: [{ userId: leaderA, isLeader: true }],
    });
    expect(inA.statusCode).toBe(201);
    expect(inA.body.key).toBe(slugify(name));

    // Same name, a different Department: the base slug is free again there,
    // because Team `key` is unique per Department (schema's `@@unique`), not
    // per organization — a global generator would wrongly suffix this one.
    const inB = await call('POST', `/api/v1/departments/${departmentBId}/teams`, {
      name,
      members: [{ userId: leaderB, isLeader: true }],
    });
    expect(inB.statusCode).toBe(201);
    expect(inB.body.key).toBe(slugify(name));

    // Same name, the same Department as the first: this one does collide.
    const secondInA = await call('POST', `/api/v1/departments/${departmentAId}/teams`, {
      name,
      members: [{ userId: leaderA, isLeader: true }],
    });
    expect(secondInA.statusCode).toBe(201);
    expect(secondInA.body.key).toBe(`${slugify(name)}_2`);
  }, 30_000);

  it('generates a Journey key from the name and resolves collisions', async () => {
    const name = 'Synthetic Renewal Journey';
    const first = await call('POST', '/api/v1/journeys', { name });
    expect(first.statusCode).toBe(201);
    expect(first.body.key).toBe(slugify(name));

    const second = await call('POST', '/api/v1/journeys', { name });
    expect(second.statusCode).toBe(201);
    expect(second.body.key).toBe(`${slugify(name)}_2`);
  }, 30_000);

  it('scopes a Status key to its Journey, not to the organization', async () => {
    const journeyA = await call('POST', '/api/v1/journeys', { name: 'Synthetic Status Journey A' });
    const journeyB = await call('POST', '/api/v1/journeys', { name: 'Synthetic Status Journey B' });
    expect(journeyA.statusCode).toBe(201);
    expect(journeyB.statusCode).toBe(201);

    const statusBody = {
      name: 'Ready For Onboarding',
      outcomeType: 'open',
      behaviorType: 'default',
      sortOrder: 1,
    };
    const journeyAId = String(journeyA.body.id);
    const journeyBId = String(journeyB.body.id);

    const inA = await call('POST', `/api/v1/journeys/${journeyAId}/statuses`, statusBody);
    expect(inA.statusCode).toBe(201);
    expect(inA.body.key).toBe(slugify(statusBody.name));

    // Same Status name, a different Journey: free again — Status `key` is
    // unique per Journey (schema's `@@unique`), matching ADR-0001's one flat
    // status field with no shared cross-Journey status vocabulary.
    const inB = await call('POST', `/api/v1/journeys/${journeyBId}/statuses`, statusBody);
    expect(inB.statusCode).toBe(201);
    expect(inB.body.key).toBe(slugify(statusBody.name));

    // Same name, same Journey as the first: this one collides.
    const secondInA = await call('POST', `/api/v1/journeys/${journeyAId}/statuses`, statusBody);
    expect(secondInA.statusCode).toBe(201);
    expect(secondInA.body.key).toBe(`${slugify(statusBody.name)}_2`);
  }, 30_000);

  it('generates a Service key from the name and resolves collisions', async () => {
    const name = 'Synthetic Advisory Service';
    const first = await call('POST', '/api/v1/services', { name });
    expect(first.statusCode).toBe(201);
    expect(first.body.key).toBe(slugify(name));

    const second = await call('POST', '/api/v1/services', { name });
    expect(second.statusCode).toBe(201);
    expect(second.body.key).toBe(`${slugify(name)}_2`);
  }, 30_000);

  it('generates a Field key from the name and resolves collisions', async () => {
    const name = 'Synthetic Preferred Contact Time';
    const body = { name, fieldType: 'text', editMode: 'manual', source: 'manual' };
    const first = await call('POST', '/api/v1/fields', body);
    expect(first.statusCode).toBe(201);
    expect(first.body.key).toBe(slugify(name));

    const second = await call('POST', '/api/v1/fields', body);
    expect(second.statusCode).toBe(201);
    expect(second.body.key).toBe(`${slugify(name)}_2`);
  }, 30_000);

  it('generates a Notification Rule key from the name and resolves collisions', async () => {
    const name = 'Synthetic Lead Deactivated Alert';
    const body = {
      name,
      triggerType: 'lead_deactivated',
      recipients: [{ resolverType: 'previous_assignment_holder' }],
    };
    const first = await call('POST', '/api/v1/notification-rules', body);
    expect(first.statusCode).toBe(201);
    expect(first.body.key).toBe(slugify(name));

    const second = await call('POST', '/api/v1/notification-rules', body);
    expect(second.statusCode).toBe(201);
    expect(second.body.key).toBe(`${slugify(name)}_2`);
  }, 30_000);

  it('generates a Campaign key from the name and resolves collisions', async () => {
    const name = 'Synthetic Renewal Reminder';
    const body = {
      name,
      subject: 'Synthetic subject line',
      bodyDocument: { blocks: [] },
      type: 'manual',
    };
    const first = await call('POST', '/api/v1/campaigns', body);
    expect(first.statusCode).toBe(201);
    expect(first.body.key).toBe(slugify(name));

    const second = await call('POST', '/api/v1/campaigns', body);
    expect(second.statusCode).toBe(201);
    expect(second.body.key).toBe(`${slugify(name)}_2`);
  }, 30_000);

  it('leaves an existing entity’s key untouched by later creations, and never accepts a client-supplied one', async () => {
    const seededKey = `synthetic_preexisting_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const seeded = await prisma.department.create({
      data: { organizationId: org, key: seededKey, name: 'Synthetic preexisting department' },
    });

    // A client that still sends `key` (an old client, or a hand-crafted
    // request) gets a generated one anyway — the field is never read back out
    // of the request body.
    const spoofed = await call('POST', '/api/v1/departments', {
      name: 'Synthetic spoofed department',
      key: 'attacker_supplied_key',
    });
    expect(spoofed.statusCode).toBe(201);
    expect(spoofed.body.key).toBe(slugify('Synthetic spoofed department'));
    expect(spoofed.body.key).not.toBe('attacker_supplied_key');

    const stillThere = await prisma.department.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: org, id: seeded.id } },
    });
    expect(stillThere.key).toBe(seededKey);
  }, 30_000);
});

describe.skipIf(shouldRunAdminPostgres)('auto-generated entity keys against real Postgres', () => {
  it('requires Docker/Testcontainers or FALCON_POSTGRES_URL to execute', () => {
    expect(shouldRunAdminPostgres).toBe(false);
  });
});
