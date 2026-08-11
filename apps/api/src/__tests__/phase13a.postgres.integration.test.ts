import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';

import { PrismaAdminRepository } from '../admin/prisma-admin-repository.js';
import { PrismaConfigurationRepository } from '../configuration/prisma-configuration-repository.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { defaultAuthConfig } from '../auth/config.js';
import { buildServer } from '../http/build-server.js';
import type { ServerDependencies } from '../http/types.js';
import { createAdminPostgres, shouldRunAdminPostgres } from './fixtures/synthetic-admin.js';

/**
 * Phase 13a — setting a Field's role visibility from the Field side.
 *
 * The assertion this file exists for is §"core security assertion" of
 * `docs/planning/phase-13a-field-role-visibility-at-creation.md`: a role with
 * no `field_visibility` row must not be able to reach the field's values on
 * *any* surface — list, record, or activity timeline — immediately after the
 * field is created. Everything else here supports that claim or proves it
 * isn't vacuous.
 *
 * Every name is synthetic. Nothing in this file may depend on a real journey,
 * status, role or field name (`AGENTS.md`).
 */

const SECRET_VALUE = 'synthetic-restricted-value-8f2c';

describe.runIf(shouldRunAdminPostgres)('Phase 13a field-side role visibility', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  const otherOrg = randomUUID();
  const adminRole = randomUUID();
  const roleA = randomUUID();
  const roleB = randomUUID();
  const dormantRole = randomUUID();
  const foreignRole = randomUUID();
  const adminUser = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const journey = randomUUID();
  const status = randomUUID();
  const lead = randomUUID();
  const processInstance = randomUUID();
  const assignmentType = 'synthetic_owner';

  /**
   * One server per acting user: the session repository is the only thing that
   * differs, and building it per call keeps each request's identity explicit at
   * the call site.
   */
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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
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
  const asUserA = () => ({ userId: userA, roleId: roleA });
  const asUserB = () => ({ userId: userB, roleId: roleB });

  /** The three read surfaces the security assertion has to cover at once. */
  const readAllSurfaces = async (actor: { userId: string; roleId: string }, fieldId: string) => {
    const context = `requestedFieldIds=${fieldId}&assignmentTypes=${assignmentType}`;
    const [list, detail, activity] = await Promise.all([
      call(actor, 'GET', `/api/v1/leads?${context}`),
      call(actor, 'GET', `/api/v1/leads/${lead}?${context}`),
      call(actor, 'GET', `/api/v1/leads/${lead}/activity?${context}`),
    ]);
    return { list, detail, activity };
  };

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    for (const file of [
      '00000000000000_initial',
      '00000000000001_custom_session_auth',
      '00000000000002_lead_sharing_notifications',
      '00000000000003_attachment_metadata',
    ])
      await db.sql.unsafe(
        await readFile(
          new URL(
            `../../../../packages/database/prisma/migrations/${file}/migration.sql`,
            import.meta.url,
          ),
          'utf8',
        ),
      );

    await prisma.organization.createMany({
      data: [
        { id: org, name: 'Synthetic organization' },
        { id: otherOrg, name: 'Other synthetic organization' },
      ],
    });
    await prisma.role.createMany({
      data: [
        { id: adminRole, organizationId: org, key: 'synthetic_admin', name: 'Synthetic admin' },
        { id: roleA, organizationId: org, key: 'synthetic_role_a', name: 'Synthetic role A' },
        { id: roleB, organizationId: org, key: 'synthetic_role_b', name: 'Synthetic role B' },
        {
          id: dormantRole,
          organizationId: org,
          key: 'synthetic_dormant',
          name: 'Synthetic dormant role',
          active: false,
        },
        {
          id: foreignRole,
          organizationId: otherOrg,
          key: 'synthetic_foreign',
          name: 'Synthetic foreign role',
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: adminUser,
          organizationId: org,
          name: 'Synthetic admin user',
          email: 'admin@example.test',
          roleId: adminRole,
        },
        {
          id: userA,
          organizationId: org,
          name: 'Synthetic granted user',
          email: 'granted@example.test',
          roleId: roleA,
        },
        {
          id: userB,
          organizationId: org,
          name: 'Synthetic denied user',
          email: 'denied@example.test',
          roleId: roleB,
        },
      ],
    });
    await prisma.rolePermission.createMany({
      data: [
        // The admin role configures fields and permissions.
        ...['view', 'create', 'edit', 'delete'].map((action) => ({
          organizationId: org,
          roleId: adminRole,
          module: 'fields',
          action,
          scope: 'ORGANIZATION' as const,
        })),
        ...['view', 'create', 'edit'].map((action) => ({
          organizationId: org,
          roleId: adminRole,
          module: 'roles_permissions',
          action,
          scope: 'ORGANIZATION' as const,
        })),
        ...['view', 'edit'].map((action) => ({
          organizationId: org,
          roleId: adminRole,
          module: 'journeys_statuses',
          action,
          scope: 'ORGANIZATION' as const,
        })),
        // Role A writes lead data. It deliberately also holds fields:edit and
        // no roles_permissions:edit — that pairing is the self-escalation the
        // module gate has to refuse.
        ...['view', 'edit'].map((action) => ({
          organizationId: org,
          roleId: roleA,
          module: 'leads',
          action,
          scope: 'ORGANIZATION' as const,
        })),
        {
          organizationId: org,
          roleId: roleA,
          module: 'fields',
          action: 'edit',
          scope: 'ORGANIZATION' as const,
        },
        // Role B can read every lead in the organization. Only field-level
        // visibility stands between it and the restricted value.
        {
          organizationId: org,
          roleId: roleB,
          module: 'leads',
          action: 'view',
          scope: 'ORGANIZATION' as const,
        },
      ],
    });
    await prisma.journey.create({
      data: {
        id: journey,
        organizationId: org,
        key: 'synthetic_journey',
        name: 'Synthetic journey',
      },
    });
    await prisma.roleJourneyAccess.createMany({
      data: [adminRole, roleA, roleB].map((roleId) => ({
        organizationId: org,
        roleId,
        journeyId: journey,
      })),
    });
    await prisma.status.create({
      data: {
        id: status,
        organizationId: org,
        journeyId: journey,
        key: 'synthetic_status',
        name: 'Synthetic status',
        outcomeType: 'open',
        behaviorType: 'default',
        sortOrder: 0,
      },
    });
    await prisma.lead.create({
      data: { id: lead, organizationId: org, name: 'Synthetic lead' },
    });
    await prisma.processInstance.create({
      data: {
        id: processInstance,
        organizationId: org,
        leadId: lead,
        journeyId: journey,
        currentStatusId: status,
        isPrimary: true,
      },
    });
    await prisma.assignment.create({
      data: {
        organizationId: org,
        processInstanceId: processInstance,
        assignmentType,
        userId: userA,
      },
    });
  }, 180_000);

  afterAll(async () => db?.cleanup());

  /** Creates a Field, maps it to the journey, and returns its id. */
  const createField = async (key: string) => {
    const created = await call(asAdmin(), 'POST', '/api/v1/fields', {
      key,
      name: `Synthetic ${key}`,
      fieldType: 'text',
      editMode: 'manual',
      source: 'manual',
    });
    expect(created.statusCode).toBe(201);
    const fieldId = (JSON.parse(created.body) as { id: string }).id;
    const mapped = await call(asAdmin(), 'PUT', `/api/v1/journeys/${journey}/fields/${fieldId}`, {
      requirement: 'optional',
    });
    expect(mapped.statusCode).toBe(200);
    return fieldId;
  };

  it('hides a new Field from every role until it is granted, on every read surface', async () => {
    const fieldId = await createField('restricted_field');

    // A brand-new Field is granted to nobody. This is the default the picker
    // must not quietly change.
    const initial = await call(asAdmin(), 'GET', `/api/v1/fields/${fieldId}/visibility`);
    expect(initial.statusCode).toBe(200);
    expect(JSON.parse(initial.body)).toEqual([]);

    const granted = await call(asAdmin(), 'PUT', `/api/v1/fields/${fieldId}/visibility`, {
      visibility: [{ roleId: roleA, accessLevel: 'EDIT' }],
    });
    expect(granted.statusCode).toBe(200);

    const written = await call(asUserA(), 'PATCH', `/api/v1/leads/${lead}`, {
      processInstanceId: processInstance,
      journeyId: journey,
      assignmentTypes: [assignmentType],
      fieldValues: { [fieldId]: SECRET_VALUE },
    });
    expect(written.statusCode).toBe(200);
    // The writer sees what it wrote, so the reads below are testing visibility
    // rather than an empty database.
    expect(written.body).toContain(SECRET_VALUE);

    const denied = await readAllSurfaces(asUserB(), fieldId);
    for (const [surface, response] of Object.entries(denied)) {
      expect(response.statusCode, surface).toBe(200);
      // Whole-response assertion, per ADR-0011: neither the value nor the
      // field id may appear anywhere in the serialized body — not in
      // fieldValues, not in an activity snapshot's old_value/new_value.
      expect(response.body, surface).not.toContain(SECRET_VALUE);
      expect(response.body, surface).not.toContain(fieldId);
    }

    const capabilities = await call(asUserB(), 'GET', '/api/v1/auth/capabilities');
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.body).not.toContain(fieldId);

    // Non-vacuity: the same three reads, after a grant, must show the value.
    // Without this the assertions above would pass on an empty response.
    const revealed = await call(asAdmin(), 'PUT', `/api/v1/fields/${fieldId}/visibility`, {
      visibility: [
        { roleId: roleA, accessLevel: 'EDIT' },
        { roleId: roleB, accessLevel: 'VIEW' },
      ],
    });
    expect(revealed.statusCode).toBe(200);

    const allowed = await readAllSurfaces(asUserB(), fieldId);
    for (const [surface, response] of Object.entries(allowed)) {
      expect(response.statusCode, surface).toBe(200);
      expect(response.body, surface).toContain(SECRET_VALUE);
    }
  }, 120_000);

  it('replaces the whole set, bumps every affected role, and audits old and new', async () => {
    const fieldId = await createField('replaced_field');
    await call(asAdmin(), 'PUT', `/api/v1/fields/${fieldId}/visibility`, {
      visibility: [
        { roleId: roleA, accessLevel: 'EDIT' },
        { roleId: roleB, accessLevel: 'VIEW' },
      ],
    });
    const versionsAfterGrant = await prisma.role.findMany({
      where: { organizationId: org, id: { in: [roleA, roleB] } },
      select: { id: true, version: true },
      orderBy: { id: 'asc' },
    });

    // Dropping role A from the payload must delete its row, not merge.
    const replaced = await call(asAdmin(), 'PUT', `/api/v1/fields/${fieldId}/visibility`, {
      visibility: [{ roleId: roleB, accessLevel: 'EDIT' }],
    });
    expect(replaced.statusCode).toBe(200);
    const afterReplace = await call(asAdmin(), 'GET', `/api/v1/fields/${fieldId}/visibility`);
    expect(JSON.parse(afterReplace.body)).toEqual([{ roleId: roleB, accessLevel: 'EDIT' }]);

    // The role that *lost* access must be bumped too, or a cached decision
    // would look unchanged.
    const versionsAfterReplace = await prisma.role.findMany({
      where: { organizationId: org, id: { in: [roleA, roleB] } },
      select: { id: true, version: true },
      orderBy: { id: 'asc' },
    });
    for (const [index, row] of versionsAfterReplace.entries())
      expect(row.version, row.id).toBeGreaterThan(versionsAfterGrant[index]!.version);

    const audits = await prisma.systemAuditLog.findMany({
      where: { organizationId: org, entityType: 'field_visibility', entityId: fieldId },
      orderBy: { timestamp: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect(audits.every((row) => row.action === 'replace_field_roles')).toBe(true);
    expect(audits[0]!.oldValue).toEqual([]);
    // Both sides are stored roleId-ordered, so sort the expectation rather than
    // depending on the order the roles happen to have been declared in.
    const byRoleId = (rows: unknown) =>
      [...(rows as Array<{ roleId: string }>)].sort((a, b) => a.roleId.localeCompare(b.roleId));
    expect(audits[1]!.oldValue).toEqual(
      byRoleId([
        { roleId: roleA, accessLevel: 'EDIT' },
        { roleId: roleB, accessLevel: 'VIEW' },
      ]),
    );
    expect(audits[1]!.newValue).toEqual([{ roleId: roleB, accessLevel: 'EDIT' }]);
    expect(audits.every((row) => row.actorUserId === adminUser)).toBe(true);

    // An empty replacement revokes the Field everywhere — the state a Field
    // has to reach before it can be deactivated.
    const cleared = await call(asAdmin(), 'PUT', `/api/v1/fields/${fieldId}/visibility`, {
      visibility: [],
    });
    expect(cleared.statusCode).toBe(200);
    const afterClear = await call(asAdmin(), 'GET', `/api/v1/fields/${fieldId}/visibility`);
    expect(JSON.parse(afterClear.body)).toEqual([]);
  }, 120_000);

  it('round-trips a grant held by an inactive role without dropping it', async () => {
    const fieldId = await createField('dormant_role_field');
    const stored = await call(asAdmin(), 'PUT', `/api/v1/fields/${fieldId}/visibility`, {
      visibility: [{ roleId: dormantRole, accessLevel: 'VIEW' }],
    });
    expect(stored.statusCode).toBe(200);
    const read = await call(asAdmin(), 'GET', `/api/v1/fields/${fieldId}/visibility`);
    expect(JSON.parse(read.body)).toEqual([{ roleId: dormantRole, accessLevel: 'VIEW' }]);
  }, 120_000);

  it('refuses the write to a Fields administrator who cannot edit permissions', async () => {
    const fieldId = await createField('gated_field');

    // Role A holds fields:edit. That must not be enough to grant itself sight
    // of a Field, which is the whole reason these routes are gated on
    // roles_permissions.
    const forbiddenWrite = await call(asUserA(), 'PUT', `/api/v1/fields/${fieldId}/visibility`, {
      visibility: [{ roleId: roleA, accessLevel: 'EDIT' }],
    });
    expect(forbiddenWrite.statusCode).toBe(403);
    const forbiddenRead = await call(asUserA(), 'GET', `/api/v1/fields/${fieldId}/visibility`);
    expect(forbiddenRead.statusCode).toBe(403);
    expect(await prisma.fieldVisibility.count({ where: { organizationId: org, fieldId } })).toBe(0);

    const foreignField = await call(asAdmin(), 'GET', `/api/v1/fields/${randomUUID()}/visibility`);
    expect(foreignField.statusCode).toBe(404);
    const foreignWrite = await call(asAdmin(), 'PUT', `/api/v1/fields/${fieldId}/visibility`, {
      visibility: [{ roleId: foreignRole, accessLevel: 'VIEW' }],
    });
    expect(foreignWrite.statusCode).toBe(400);
    expect(JSON.parse(foreignWrite.body)).toMatchObject({ error: 'validation_error' });
  }, 120_000);

  it('serializes concurrent replaces of the same Field without deadlocking', async () => {
    const fieldId = await createField('contended_field');
    const [first, second] = await Promise.all([
      call(asAdmin(), 'PUT', `/api/v1/fields/${fieldId}/visibility`, {
        visibility: [
          { roleId: roleA, accessLevel: 'EDIT' },
          { roleId: roleB, accessLevel: 'VIEW' },
        ],
      }),
      call(asAdmin(), 'PUT', `/api/v1/fields/${fieldId}/visibility`, {
        visibility: [{ roleId: roleB, accessLevel: 'EDIT' }],
      }),
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);

    // Whichever ordering won, the result is one of the two payloads intact —
    // never a merge, a partial write, or a deadlock error.
    const final = await call(asAdmin(), 'GET', `/api/v1/fields/${fieldId}/visibility`);
    const rows = JSON.parse(final.body) as Array<{ roleId: string; accessLevel: string }>;
    const candidates = [
      [
        { roleId: roleA, accessLevel: 'EDIT' },
        { roleId: roleB, accessLevel: 'VIEW' },
      ].sort((a, b) => a.roleId.localeCompare(b.roleId)),
      [{ roleId: roleB, accessLevel: 'EDIT' }],
    ];
    expect(candidates).toContainEqual(rows);
    expect(
      await prisma.systemAuditLog.count({
        where: { organizationId: org, entityType: 'field_visibility', entityId: fieldId },
      }),
    ).toBe(2);
  }, 120_000);
});
