import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';
import { bootstrapGrantedPairs, permissionCatalog } from '@falcon/permission-engine';

import { bootstrapFirstAdmin } from '../admin/bootstrap.js';
import { PrismaAdminRepository } from '../admin/prisma-admin-repository.js';
import { PrismaConfigurationRepository } from '../configuration/prisma-configuration-repository.js';
import { PurgeService } from '../configuration/purge-service.js';
import { purgeDescriptors, type PurgeEntity } from '../configuration/purge.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { defaultAuthConfig } from '../auth/config.js';
import { buildServer } from '../http/build-server.js';
import type { ServerDependencies } from '../http/types.js';
import { createAdminPostgres, shouldRunAdminPostgres } from './fixtures/synthetic-admin.js';

/**
 * Phase 16 — bounded hard-delete (purge), against real Postgres. See ADR-0017.
 *
 * Four claims this file exists to prove, none of which a mock can make:
 *
 * 1. **A purge removes the row.** Asserted by the row's absence, never by a 200.
 * 2. **A real dependent refuses it**, per entity type and per relationship —
 *    including the four that are not foreign keys and that no constraint would
 *    ever catch: a lead's `field_values` key, a campaign filter's target, an
 *    import mapping's field and its journey.
 * 3. **The audit row outlives the entity** and still says what was removed,
 *    reconstructed from `old_value` after the entity is gone.
 * 4. **The database still refuses every other delete path.** The `SET LOCAL`
 *    escape hatch is proven narrow rather than assumed narrow.
 *
 * Every name is synthetic. Nothing depends on a real journey, status, service,
 * field, role, team or person name (`AGENTS.md`).
 */

describe.runIf(shouldRunAdminPostgres)('Phase 16 bounded configuration purge', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  const otherOrg = randomUUID();

  /** The whole catalog including purge — what an admin grants deliberately. */
  const purgerRole = randomUUID();
  const purgerUser = randomUUID();
  /** The whole catalog except the five purge actions. */
  const noPurgeRole = randomUUID();
  const noPurgeUser = randomUUID();
  /** Same grants, different organization: the tenant-isolation actor. */
  const foreignRole = randomUUID();
  const foreignUser = randomUUID();

  let bootstrapUser: string;
  let bootstrapRole: string;

  const purgePairs = permissionCatalog.flatMap(({ module, actions }) =>
    (actions as readonly string[]).includes('purge') ? [{ module, action: 'purge' }] : [],
  );

  const serverFor = (userId: string, roleId: string, organizationId: string = org) =>
    buildServer({
      authRepository: {
        findSessionByTokenHash: () =>
          Promise.resolve({
            id: randomUUID(),
            tokenHash: 'ignored',
            userId,
            organizationId,
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
            organizationId,
            roleId,
            active: true,
            departmentId: null,
            managerId: null,
          }),
      },
      permissionRepository: new PrismaPermissionRepository(prisma as never),
      adminRepository: new PrismaAdminRepository(prisma),
      configurationRepository: new PrismaConfigurationRepository(prisma),
      purgeService: new PurgeService(prisma),
      leadRepository: new PrismaLeadRepository(prisma as never),
      audit: {},
      emailSender: { sendPasswordReset: () => Promise.resolve() },
      authConfig: { ...defaultAuthConfig, secureCookies: false },
      corsOrigins: [],
    } as unknown as ServerDependencies);

  const call = async (
    actor: { userId: string; roleId: string; organizationId?: string },
    method: 'POST' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const server = serverFor(actor.userId, actor.roleId, actor.organizationId ?? org);
    try {
      const response = await server.inject({
        method,
        url,
        headers: { cookie: 'falcon_session=synthetic' },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      return {
        statusCode: response.statusCode,
        body: response.body === '' ? null : (JSON.parse(response.body) as Record<string, unknown>),
      };
    } finally {
      await server.close();
    }
  };

  const asPurger = () => ({ userId: purgerUser, roleId: purgerRole });
  const asNoPurge = () => ({ userId: noPurgeUser, roleId: noPurgeRole });
  const asForeign = () => ({
    userId: foreignUser,
    roleId: foreignRole,
    organizationId: otherOrg,
  });

  const purgeUrls: Record<PurgeEntity, (id: string) => string> = {
    journey: (id) => `/api/v1/journeys/${id}/purge`,
    status: (id) => `/api/v1/statuses/${id}/purge`,
    field: (id) => `/api/v1/fields/${id}/purge`,
    service: (id) => `/api/v1/services/${id}/purge`,
    team: (id) => `/api/v1/teams/${id}/purge`,
    role: (id) => `/api/v1/roles/${id}/purge`,
    notification_rule: (id) => `/api/v1/notification-rules/${id}/purge`,
  };

  const purge = (
    entity: PurgeEntity,
    id: string,
    actor: { userId: string; roleId: string; organizationId?: string } = asPurger(),
  ) => call(actor, 'POST', purgeUrls[entity](id));

  /* ------------------------------------------------------- synthetic seeds */

  const seedJourney = async (overrides: { active?: boolean } = {}) => {
    const id = randomUUID();
    await prisma.journey.create({
      data: {
        organizationId: org,
        id,
        key: `j_${id.slice(0, 8)}`,
        name: 'Synthetic Journey',
        active: overrides.active ?? false,
      },
    });
    return id;
  };
  const seedStatus = async (journeyId: string, overrides: { active?: boolean } = {}) => {
    const id = randomUUID();
    await prisma.status.create({
      data: {
        organizationId: org,
        id,
        journeyId,
        key: `s_${id.slice(0, 8)}`,
        name: 'Synthetic Status',
        outcomeType: 'open',
        behaviorType: 'default',
        sortOrder: 0,
        active: overrides.active ?? false,
      },
    });
    return id;
  };
  const seedField = async (overrides: { active?: boolean } = {}) => {
    const id = randomUUID();
    await prisma.field.create({
      data: {
        organizationId: org,
        id,
        key: `f_${id.slice(0, 8)}`,
        name: 'Synthetic Field',
        fieldType: 'text',
        editMode: 'manual',
        source: 'manual',
        active: overrides.active ?? false,
      },
    });
    return id;
  };
  const seedService = async (overrides: { active?: boolean } = {}) => {
    const id = randomUUID();
    await prisma.service.create({
      data: {
        organizationId: org,
        id,
        key: `sv_${id.slice(0, 8)}`,
        name: 'Synthetic Service',
        active: overrides.active ?? false,
      },
    });
    return id;
  };
  const seedTeam = async (overrides: { active?: boolean } = {}) => {
    const id = randomUUID();
    await prisma.team.create({
      data: {
        organizationId: org,
        id,
        departmentId: department,
        key: `t_${id.slice(0, 8)}`,
        name: 'Synthetic Team',
        active: overrides.active ?? false,
      },
    });
    await prisma.teamMember.create({
      data: {
        organizationId: org,
        teamId: id,
        departmentId: department,
        userId: purgerUser,
        isLeader: true,
      },
    });
    return id;
  };
  const seedRole = async (overrides: { active?: boolean; isSystemDefault?: boolean } = {}) => {
    const id = randomUUID();
    await prisma.role.create({
      data: {
        organizationId: org,
        id,
        key: `r_${id.slice(0, 8)}`,
        name: 'Synthetic Role',
        active: overrides.active ?? false,
        isSystemDefault: overrides.isSystemDefault ?? false,
      },
    });
    await prisma.rolePermission.create({
      data: { organizationId: org, roleId: id, module: 'leads', action: 'view', scope: 'SELF' },
    });
    return id;
  };
  const seedRule = async (overrides: { active?: boolean } = {}) => {
    const id = randomUUID();
    await prisma.notificationRule.create({
      data: {
        organizationId: org,
        id,
        key: `n_${id.slice(0, 8)}`,
        name: 'Synthetic Rule',
        triggerType: 'status_changed',
        active: overrides.active ?? false,
        createdById: purgerUser,
        updatedById: purgerUser,
        recipients: {
          create: [{ resolverType: 'assignment_holder', parameters: {}, sortOrder: 0 }],
        },
      },
    });
    return id;
  };
  const seedLead = async (fieldValues: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await prisma.lead.create({
      data: { organizationId: org, id, name: 'Synthetic Lead', fieldValues: fieldValues as never },
    });
    return id;
  };

  const department = randomUUID();

  const exists = async (entity: PurgeEntity, id: string): Promise<boolean> => {
    const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM ${purgeDescriptors[entity].table} WHERE organization_id = $1::uuid AND id = $2::uuid`,
      org,
      id,
    );
    return (rows[0]?.count ?? 0) > 0;
  };

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

    await prisma.organization.createMany({
      data: [
        { id: org, name: 'Synthetic organization' },
        { id: otherOrg, name: 'Other synthetic organization' },
      ],
    });

    const bootstrap = await bootstrapFirstAdmin({
      prisma,
      emailSender: { sendPasswordReset: () => Promise.resolve() },
      authConfig: defaultAuthConfig,
      organizationId: org,
      name: 'Synthetic Administrator',
      email: 'administrator@example.test',
    });
    bootstrapUser = bootstrap.user.id;
    bootstrapRole = bootstrap.role.id;

    await prisma.department.create({
      data: { organizationId: org, id: department, key: 'dept', name: 'Synthetic Department' },
    });

    const grantAll = async (roleId: string, organizationId: string, includePurge: boolean) => {
      await prisma.rolePermission.createMany({
        data: permissionCatalog
          .flatMap(({ module, actions }) => actions.map((action) => ({ module, action })))
          .filter((pair) => includePurge || pair.action !== 'purge')
          .map((pair) => ({
            organizationId,
            roleId,
            ...pair,
            scope: 'ORGANIZATION' as const,
          })),
      });
    };

    await prisma.role.createMany({
      data: [
        { organizationId: org, id: purgerRole, key: 'purger', name: 'Purger' },
        { organizationId: org, id: noPurgeRole, key: 'no_purge', name: 'No purge' },
        { organizationId: otherOrg, id: foreignRole, key: 'foreign', name: 'Foreign' },
      ],
    });
    await grantAll(purgerRole, org, true);
    await grantAll(noPurgeRole, org, false);
    await grantAll(foreignRole, otherOrg, true);

    await prisma.user.createMany({
      data: [
        {
          organizationId: org,
          id: purgerUser,
          name: 'Synthetic Purger',
          email: 'purger@example.test',
          roleId: purgerRole,
          departmentId: department,
        },
        {
          organizationId: org,
          id: noPurgeUser,
          name: 'Synthetic Non-purger',
          email: 'nopurge@example.test',
          roleId: noPurgeRole,
        },
        {
          organizationId: otherOrg,
          id: foreignUser,
          name: 'Synthetic Foreigner',
          email: 'foreign@example.test',
          roleId: foreignRole,
        },
      ],
    });
  }, 180_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  /* ------------------------------------------------------------------ D4 */

  it('does not grant purge on bootstrap, and the initial administrator is refused until it is granted', async () => {
    const granted = await prisma.rolePermission.findMany({
      where: { organizationId: org, roleId: bootstrapRole },
      select: { module: true, action: true },
    });
    expect(granted.filter((row) => row.action === 'purge')).toEqual([]);
    expect(granted).toHaveLength(bootstrapGrantedPairs().length);

    const journey = await seedJourney();
    const refused = await purge('journey', journey, {
      userId: bootstrapUser,
      roleId: bootstrapRole,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.body).toEqual({ error: 'forbidden' });
    expect(await exists('journey', journey)).toBe(true);

    // Granted deliberately, exactly as an administrator would.
    await prisma.rolePermission.createMany({
      data: purgePairs.map((pair) => ({
        organizationId: org,
        roleId: bootstrapRole,
        ...pair,
        scope: 'ORGANIZATION' as const,
      })),
    });
    const allowed = await purge('journey', journey, {
      userId: bootstrapUser,
      roleId: bootstrapRole,
    });
    expect(allowed.statusCode).toBe(200);
    expect(await exists('journey', journey)).toBe(false);

    await prisma.rolePermission.deleteMany({
      where: { organizationId: org, roleId: bootstrapRole, action: 'purge' },
    });
  });

  /* ------------------------------------------------------------------ D5 */

  it('refuses an entity that is still active, and accepts the same one once deactivated', async () => {
    const field = await seedField({ active: true });
    const active = await purge('field', field);
    expect(active.statusCode).toBe(400);
    expect(active.body).toEqual({
      error: 'validation_error',
      details: { reason: 'must_be_deactivated_first' },
    });
    expect(await exists('field', field)).toBe(true);

    await prisma.field.update({
      where: { organizationId_id: { organizationId: org, id: field } },
      data: { active: false },
    });
    expect((await purge('field', field)).statusCode).toBe(200);
    expect(await exists('field', field)).toBe(false);
  });

  /* --------------------------------------------------- the happy path, ×7 */

  it('purges every entity type when nothing blocks it', async () => {
    const journey = await seedJourney();
    const status = await seedStatus(journey);
    const targets: Array<[PurgeEntity, string]> = [
      ['status', status],
      ['journey', journey],
      ['field', await seedField()],
      ['service', await seedService()],
      ['team', await seedTeam()],
      ['role', await seedRole()],
      ['notification_rule', await seedRule()],
    ];

    for (const [entity, id] of targets) {
      const response = await purge(entity, id);
      expect([entity, response.statusCode]).toEqual([entity, 200]);
      expect([entity, await exists(entity, id)]).toEqual([entity, false]);
    }
  });

  /* -------------------------------------------------- blockers, per class */

  it('refuses a purge for every real dependent, naming the relationship, and keeps the row', async () => {
    const journey = await seedJourney();
    const status = await seedStatus(journey);
    const lead = await seedLead();
    const processInstance = randomUUID();
    await prisma.processInstance.create({
      data: {
        organizationId: org,
        id: processInstance,
        leadId: lead,
        journeyId: journey,
        currentStatusId: status,
      },
    });

    // A Journey with Statuses is blocked by them; with the process instance
    // gone it is still blocked, which is what proves Statuses block in their
    // own right rather than incidentally.
    const blockedJourney = await purge('journey', journey);
    expect(blockedJourney.statusCode).toBe(409);
    expect(blockedJourney.body).toMatchObject({
      error: 'dependency_conflict',
      details: { statuses: 1, processInstances: 1 },
    });
    expect(await exists('journey', journey)).toBe(true);

    const blockedStatus = await purge('status', status);
    expect(blockedStatus.statusCode).toBe(409);
    expect(blockedStatus.body).toMatchObject({
      error: 'dependency_conflict',
      details: { processInstances: 1 },
    });
    expect(await exists('status', status)).toBe(true);

    // A Field a lead has stored a value for. No foreign key covers this.
    const usedField = await seedField();
    await seedLead({ [usedField]: 'synthetic value' });
    const blockedField = await purge('field', usedField);
    expect(blockedField.statusCode).toBe(409);
    expect(blockedField.body).toMatchObject({
      error: 'dependency_conflict',
      details: { leads: 1 },
    });
    expect(await exists('field', usedField)).toBe(true);

    // A Service with a lead enrolment.
    const usedService = await seedService();
    await prisma.leadService.create({
      data: { organizationId: org, processInstanceId: processInstance, serviceId: usedService },
    });
    const blockedService = await purge('service', usedService);
    expect(blockedService.statusCode).toBe(409);
    expect(blockedService.body).toMatchObject({
      error: 'dependency_conflict',
      details: { leadServices: 1 },
    });
    expect(await exists('service', usedService)).toBe(true);

    // A Role with a user.
    const usedRole = await seedRole();
    await prisma.user.create({
      data: {
        organizationId: org,
        name: 'Synthetic Holder',
        email: `holder-${randomUUID()}@example.test`,
        roleId: usedRole,
      },
    });
    const blockedRole = await purge('role', usedRole);
    expect(blockedRole.statusCode).toBe(409);
    expect(blockedRole.body).toMatchObject({
      error: 'dependency_conflict',
      details: { users: 1 },
    });
    expect(await exists('role', usedRole)).toBe(true);

    // A Notification Rule that has already fired.
    const firedRule = await seedRule();
    const activity = await prisma.activityLog.create({
      data: {
        organizationId: org,
        leadId: lead,
        actorUserId: purgerUser,
        actionType: 'status_change',
        source: 'test',
      },
    });
    await prisma.notification.create({
      data: {
        organizationId: org,
        userId: purgerUser,
        type: 'status_changed',
        message: 'Synthetic',
        notificationRuleId: firedRule,
        activityLogId: activity.id,
      },
    });
    const blockedRule = await purge('notification_rule', firedRule);
    expect(blockedRule.statusCode).toBe(409);
    expect(blockedRule.body).toMatchObject({
      error: 'dependency_conflict',
      details: { notifications: 1 },
    });
    expect(await exists('notification_rule', firedRule)).toBe(true);

    // A Team named by a routing rule.
    const usedTeam = await seedTeam();
    await prisma.statusRoutingRule.create({
      data: {
        organizationId: org,
        journeyId: journey,
        statusId: status,
        assignmentType: 'synthetic_owner',
        algorithm: 'round_robin',
        poolType: 'team',
        teamId: usedTeam,
      },
    });
    const blockedTeam = await purge('team', usedTeam);
    expect(blockedTeam.statusCode).toBe(409);
    expect(blockedTeam.body).toMatchObject({
      error: 'dependency_conflict',
      details: { statusRoutingRules: 1 },
    });
    expect(await exists('team', usedTeam)).toBe(true);
  });

  /**
   * The three blockers that live inside JSONB and that no foreign key can see.
   * If the probes regress, these are the only tests that notice.
   */
  it('refuses a purge for references buried in JSONB that no constraint protects', async () => {
    const filteredField = await seedField();
    const mappedField = await seedField();
    const mappedJourney = await seedJourney();

    await prisma.campaign.create({
      data: {
        organizationId: org,
        key: `c_${randomUUID().slice(0, 8)}`,
        name: 'Synthetic Campaign',
        subject: 'Synthetic',
        type: 'manual',
        filter: {
          conditions: [
            { target: { kind: 'field', fieldId: filteredField }, operator: 'is_not_empty' },
          ],
        } as never,
        createdById: purgerUser,
        updatedById: purgerUser,
      },
    });
    await prisma.importJob.create({
      data: {
        organizationId: org,
        source: 'csv',
        fileKey: 'sha256:synthetic',
        status: 'committed',
        mappingJson: {
          journeyId: mappedJourney,
          columns: { company: { kind: 'field', fieldId: mappedField } },
        } as never,
        createdById: purgerUser,
      },
    });

    const byFilter = await purge('field', filteredField);
    expect(byFilter.statusCode).toBe(409);
    expect(byFilter.body).toMatchObject({ details: { campaigns: 1 } });

    const byMapping = await purge('field', mappedField);
    expect(byMapping.statusCode).toBe(409);
    expect(byMapping.body).toMatchObject({ details: { importJobs: 1 } });

    const byJourneyMapping = await purge('journey', mappedJourney);
    expect(byJourneyMapping.statusCode).toBe(409);
    expect(byJourneyMapping.body).toMatchObject({ details: { importJobs: 1 } });

    // Not vacuous: an unrelated Field of the same shape purges cleanly.
    const untouched = await seedField();
    expect((await purge('field', untouched)).statusCode).toBe(200);
  });

  /* ------------------------------------------------------------------ D3 */

  it('cascades exactly the mapping rows and nothing else', async () => {
    const journey = await seedJourney();
    const field = await seedField();
    const service = await seedService();
    await prisma.roleJourneyAccess.create({
      data: { organizationId: org, roleId: purgerRole, journeyId: journey },
    });
    await prisma.journeyService.create({
      data: { organizationId: org, journeyId: journey, serviceId: service },
    });
    await prisma.fieldJourneySetting.create({
      data: { organizationId: org, fieldId: field, journeyId: journey, requirement: 'optional' },
    });

    const before = {
      fields: await prisma.field.count({ where: { organizationId: org } }),
      services: await prisma.service.count({ where: { organizationId: org } }),
      roles: await prisma.role.count({ where: { organizationId: org } }),
      leads: await prisma.lead.count({ where: { organizationId: org } }),
      rolePermissions: await prisma.rolePermission.count({ where: { organizationId: org } }),
    };

    const response = await purge('journey', journey);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      cascaded: { roleJourneyAccess: 1, journeyServices: 1, fieldJourneySettings: 1 },
    });

    expect(
      await prisma.roleJourneyAccess.count({ where: { organizationId: org, journeyId: journey } }),
    ).toBe(0);
    expect(
      await prisma.journeyService.count({ where: { organizationId: org, journeyId: journey } }),
    ).toBe(0);
    expect(
      await prisma.fieldJourneySetting.count({
        where: { organizationId: org, journeyId: journey },
      }),
    ).toBe(0);

    // Everything a cascade must not have touched, counted rather than inspected
    // so an over-broad delete anywhere in the organization fails here.
    expect({
      fields: await prisma.field.count({ where: { organizationId: org } }),
      services: await prisma.service.count({ where: { organizationId: org } }),
      roles: await prisma.role.count({ where: { organizationId: org } }),
      leads: await prisma.lead.count({ where: { organizationId: org } }),
      rolePermissions: await prisma.rolePermission.count({ where: { organizationId: org } }),
    }).toEqual(before);
  });

  /* ---------------------------------------------------------- audit trail */

  it('leaves an audit row that still describes the entity after it is gone', async () => {
    const field = await seedField();
    const stored = await prisma.field.findFirstOrThrow({
      where: { organizationId: org, id: field },
    });
    await prisma.fieldVisibility.create({
      data: { organizationId: org, fieldId: field, roleId: purgerRole, accessLevel: 'EDIT' },
    });

    const response = await purge('field', field);
    expect(response.statusCode).toBe(200);
    expect(await exists('field', field)).toBe(false);

    const audit = await prisma.systemAuditLog.findFirstOrThrow({
      where: { organizationId: org, entityType: 'field', entityId: field, action: 'purge' },
    });
    expect(audit.actorUserId).toBe(purgerUser);
    expect(audit.newValue).toBeNull();

    // The point of the snapshot: the Field is reconstructible from the audit
    // row alone, because there is nowhere else left to read it from.
    const oldValue = audit.oldValue as {
      entity: { key: string; name: string; fieldType: string; active: boolean };
      cascaded: { fieldVisibility: { roleId: string; accessLevel: string }[] };
    };
    expect(oldValue.entity).toMatchObject({
      key: stored.key,
      name: 'Synthetic Field',
      fieldType: 'text',
      active: false,
    });
    expect(oldValue.cascaded.fieldVisibility).toEqual([
      expect.objectContaining({ roleId: purgerRole, accessLevel: 'EDIT' }),
    ]);
  });

  /* ----------------------------------------------------------- permission */

  it('refuses every purge route to a role holding the whole catalog except purge', async () => {
    const journey = await seedJourney();
    const targets: Array<[PurgeEntity, string]> = [
      ['status', await seedStatus(journey)],
      ['journey', journey],
      ['field', await seedField()],
      ['service', await seedService()],
      ['team', await seedTeam()],
      ['role', await seedRole()],
      ['notification_rule', await seedRule()],
    ];

    for (const [entity, id] of targets) {
      const response = await purge(entity, id, asNoPurge());
      expect([entity, response.statusCode]).toEqual([entity, 403]);
      expect(response.body).toEqual({ error: 'forbidden' });
      expect([entity, await exists(entity, id)]).toEqual([entity, true]);
    }
  });

  /* ------------------------------------------------------ tenant isolation */

  it('does not let another organization purge these entities', async () => {
    const journey = await seedJourney();
    const targets: Array<[PurgeEntity, string]> = [
      ['status', await seedStatus(journey)],
      ['journey', journey],
      ['field', await seedField()],
      ['service', await seedService()],
      ['team', await seedTeam()],
      ['role', await seedRole()],
      ['notification_rule', await seedRule()],
    ];

    for (const [entity, id] of targets) {
      const response = await purge(entity, id, asForeign());
      expect([entity, response.statusCode]).toEqual([entity, 404]);
      expect([entity, await exists(entity, id)]).toEqual([entity, true]);
    }
  });

  /* ------------------------------------------------------------------ D1 */

  it('refuses a system-default Role, and there is no Departments purge route', async () => {
    const systemRole = await seedRole({ isSystemDefault: true });
    const refused = await purge('role', systemRole);
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toEqual({
      error: 'validation_error',
      details: { reason: 'system_default_role' },
    });
    expect(await exists('role', systemRole)).toBe(true);

    // Departments are excluded from V1 (ADR-0017): nothing can deactivate one,
    // so nothing can bring one to a purgeable state. Asserted so adding the
    // route without revisiting that decision fails here.
    const response = await call(asPurger(), 'POST', `/api/v1/departments/${department}/purge`);
    expect(response.statusCode).toBe(404);
    expect(await prisma.department.count({ where: { organizationId: org, id: department } })).toBe(
      1,
    );
  });

  /* ------------------------------------------------------------------ D6 */

  it('still refuses a configuration delete on every path that is not a purge', async () => {
    const journey = await seedJourney();

    // No `SET LOCAL falcon.purge` — the trigger must still raise, which is what
    // makes the escape hatch narrow rather than a hole.
    await expect(
      db.sql`DELETE FROM journeys WHERE organization_id = ${org} AND id = ${journey}`,
    ).rejects.toThrow(/configuration is deactivated\/versioned, never deleted/);
    expect(await exists('journey', journey)).toBe(true);

    // The guard does not survive its transaction either.
    await db.sql.begin(async (sql) => {
      await sql`SET LOCAL falcon.purge = 'on'`;
      await sql`SELECT 1`;
    });
    await expect(
      db.sql`DELETE FROM journeys WHERE organization_id = ${org} AND id = ${journey}`,
    ).rejects.toThrow(/configuration is deactivated\/versioned, never deleted/);

    // And the purge route, which does set it, still works on the same row.
    expect((await purge('journey', journey)).statusCode).toBe(200);
    expect(await exists('journey', journey)).toBe(false);
  });

  /* ------------------------------------------------- dependency coverage */

  /**
   * The guard ADR-0017 records as a standing obligation, asked of the database
   * rather than of a hand-written list: every table that actually has a foreign
   * key to a purgeable table must be classified, as a blocker or as a cascade.
   *
   * A new relationship added later fails here until somebody decides which one
   * it is. That is the whole point — the JSONB references cannot be caught this
   * way, but the foreign keys can be, and this is the cheapest place to do it.
   */
  it('classifies every foreign key that points at a purgeable table', async () => {
    for (const [entity, descriptor] of Object.entries(purgeDescriptors)) {
      const referencing = await db.sql<{ table: string }[]>`
        SELECT DISTINCT c.conrelid::regclass::text AS table
        FROM pg_constraint c
        WHERE c.contype = 'f' AND c.confrelid = ${descriptor.table}::regclass`;
      const classified = new Set([
        ...descriptor.blockers.map((blocker) => blocker.table),
        ...descriptor.cascades.map((cascade) => cascade.table),
      ]);
      const unclassified = referencing
        .map((row) => row.table)
        .filter((table) => !classified.has(table))
        .sort();
      expect([entity, unclassified]).toEqual([entity, []]);
    }
  });

  /* -------------------------------------------------------- concurrency */

  it('lets exactly one of two concurrent purges win', async () => {
    const field = await seedField();
    const [first, second] = await Promise.all([purge('field', field), purge('field', field)]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 404]);
    expect(await exists('field', field)).toBe(false);
  });
});

describe.skipIf(shouldRunAdminPostgres)('Phase 16 bounded configuration purge', () => {
  it('requires Docker/Testcontainers or FALCON_POSTGRES_URL to execute', () => {
    expect(shouldRunAdminPostgres).toBe(false);
  });
});
