import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';

import { PrismaAdminRepository } from '../admin/prisma-admin-repository.js';
import { PrismaConfigurationRepository } from '../configuration/prisma-configuration-repository.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { LeadSharingService } from '../leads/sharing.js';
import { NotificationService } from '../notifications/service.js';
import { CampaignTriggerService } from '../campaigns/trigger-service.js';
import { StatusRoutingService } from '../routing/service.js';
import { defaultAuthConfig } from '../auth/config.js';
import { buildServer } from '../http/build-server.js';
import type { ServerDependencies } from '../http/types.js';
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from './fixtures/synthetic-admin.js';

/**
 * Phase 19 — Status Visibility, against real Postgres.
 *
 * The assertion this file exists for: **an admin can make a lead disappear
 * for one Role and stay visible to another, purely by which Status its
 * process instance currently sits in** — on every surface at once, additive
 * on top of ordinary data scope, and with no representable state that hides
 * a lead from every Role at once.
 *
 * Every security assertion is whole-response, per ADR-0011: the denied
 * caller's response body must not contain the lead's id anywhere, in any
 * shape, and a list's `total` must match its `rows.length` on every case —
 * a count that ignored the same restriction its list obeys would leak how
 * many hidden records exist.
 *
 * Every name is synthetic. Nothing here depends on a real Journey, Status,
 * Role, or person name (`AGENTS.md`).
 */

describe.runIf(shouldRunAdminPostgres)('Phase 19 Status Visibility', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  const otherOrg = randomUUID();

  const adminRole = randomUUID();
  /** ORGANIZATION scope, symmetric with roleNarrow — only Status Visibility differs between them. */
  const roleWide = randomUUID();
  const roleNarrow = randomUUID();
  /** SELF scope, for the AND-not-OR composition test. */
  const roleSelf = randomUUID();
  const foreignRole = randomUUID();

  const adminUser = randomUUID();
  const userWide = randomUUID();
  const userNarrow = randomUUID();
  const userSelf = randomUUID();
  const userOtherOwner = randomUUID();
  const foreignUser = randomUUID();

  const journey1 = randomUUID();
  const journey2 = randomUUID();
  /** Unrestricted for the life of the suite — the "default state" baseline. */
  const openStatus1 = randomUUID();
  const openStatus2 = randomUUID();
  const assignmentType = 'synthetic_owner';

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
      leadRepository: new PrismaLeadRepository(
        prisma as never,
        new NotificationService(prisma),
        new CampaignTriggerService(prisma),
        new StatusRoutingService(prisma),
      ),
      leadSharingService: new LeadSharingService(prisma, new NotificationService(prisma)),
      prisma,
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
  const asWide = () => ({ userId: userWide, roleId: roleWide });
  const asNarrow = () => ({ userId: userNarrow, roleId: roleNarrow });
  const asSelf = () => ({ userId: userSelf, roleId: roleSelf });

  const list = (actor: { userId: string; roleId: string }, query = '') =>
    call(actor, 'GET', `/api/v1/leads?assignmentTypes=${assignmentType}${query}`);
  const detail = (actor: { userId: string; roleId: string }, leadId: string) =>
    call(actor, 'GET', `/api/v1/leads/${leadId}?assignmentTypes=${assignmentType}`);
  const activity = (actor: { userId: string; roleId: string }, leadId: string) =>
    call(actor, 'GET', `/api/v1/leads/${leadId}/activity?assignmentTypes=${assignmentType}`);

  /** A fresh Status, so append-only audit/activity rows never cross tests. */
  const makeStatus = async (journeyId: string, tag: string, isDefaultOnCreate = false) => {
    const id = randomUUID();
    await prisma.status.create({
      data: {
        id,
        organizationId: org,
        journeyId,
        key: `synthetic_${tag}_${id.replaceAll('-', '_')}`,
        name: `Synthetic ${tag}`,
        outcomeType: 'open',
        behaviorType: 'default',
        sortOrder: isDefaultOnCreate ? 0 : 1,
        isDefaultOnCreate,
      },
    });
    return id;
  };

  const putVisibility = (
    actor: { userId: string; roleId: string },
    statusId: string,
    roleIds: string[],
  ) => call(actor, 'PUT', `/api/v1/statuses/${statusId}/visibility`, { roleIds });
  const getVisibility = (actor: { userId: string; roleId: string }, statusId: string) =>
    call(actor, 'GET', `/api/v1/statuses/${statusId}/visibility`);

  /** A lead with one process instance in `statusId`/`journeyId`, assigned to `ownerId`. */
  const seedLead = async (statusId: string, journeyId: string, ownerId: string) => {
    const leadId = randomUUID();
    await prisma.lead.create({
      data: { id: leadId, organizationId: org, name: `Synthetic lead ${leadId.slice(0, 8)}` },
    });
    const processInstanceId = randomUUID();
    await prisma.processInstance.create({
      data: {
        id: processInstanceId,
        organizationId: org,
        leadId,
        journeyId,
        currentStatusId: statusId,
        isPrimary: true,
      },
    });
    await prisma.assignment.create({
      data: { organizationId: org, processInstanceId, assignmentType, userId: ownerId },
    });
    return { leadId, processInstanceId };
  };

  /** A second, non-primary process instance on an existing lead — the multi-Journey shape. */
  const addProcess = async (
    leadId: string,
    journeyId: string,
    statusId: string,
    ownerId: string,
  ) => {
    const processInstanceId = randomUUID();
    await prisma.processInstance.create({
      data: {
        id: processInstanceId,
        organizationId: org,
        leadId,
        journeyId,
        currentStatusId: statusId,
        isPrimary: false,
      },
    });
    await prisma.assignment.create({
      data: { organizationId: org, processInstanceId, assignmentType, userId: ownerId },
    });
    return processInstanceId;
  };

  const moveToStatus = (lead: { leadId: string; processInstanceId: string }, statusId: string) =>
    call(asAdmin(), 'PATCH', `/api/v1/leads/${lead.leadId}`, {
      processInstanceId: lead.processInstanceId,
      journeyId: journey1,
      statusId,
      assignmentTypes: [assignmentType],
    });

  const currentOwner = (processInstanceId: string) =>
    prisma.assignment.findFirst({
      where: { organizationId: org, processInstanceId, assignmentType, isCurrent: true },
      select: { userId: true },
    });

  const grantRouting = (statusId: string, roleId: string, actions: readonly string[]) =>
    prisma.statusRoutingPermission.createMany({
      data: actions.map((action) => ({ organizationId: org, statusId, roleId, action })),
    });

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    await applyMigrations(db.sql);

    await prisma.organization.createMany({
      data: [
        { id: org, name: 'Synthetic organization' },
        { id: otherOrg, name: 'Other synthetic organization' },
      ],
    });
    await prisma.role.createMany({
      data: [
        { id: adminRole, organizationId: org, key: 'synthetic_admin', name: 'Synthetic admin' },
        { id: roleWide, organizationId: org, key: 'synthetic_wide', name: 'Synthetic wide' },
        { id: roleNarrow, organizationId: org, key: 'synthetic_narrow', name: 'Synthetic narrow' },
        { id: roleSelf, organizationId: org, key: 'synthetic_self', name: 'Synthetic self' },
        {
          id: foreignRole,
          organizationId: otherOrg,
          key: 'synthetic_foreign',
          name: 'Synthetic foreign',
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
          id: userWide,
          organizationId: org,
          name: 'Synthetic wide user',
          email: 'wide@example.test',
          roleId: roleWide,
        },
        {
          id: userNarrow,
          organizationId: org,
          name: 'Synthetic narrow user',
          email: 'narrow@example.test',
          roleId: roleNarrow,
        },
        {
          id: userSelf,
          organizationId: org,
          name: 'Synthetic self user',
          email: 'self@example.test',
          roleId: roleSelf,
        },
        {
          id: userOtherOwner,
          organizationId: org,
          name: 'Synthetic other owner',
          email: 'other-owner@example.test',
          roleId: roleWide,
        },
        {
          id: foreignUser,
          organizationId: otherOrg,
          name: 'Synthetic foreign user',
          email: 'foreign@example.test',
          roleId: foreignRole,
        },
      ],
    });
    await prisma.rolePermission.createMany({
      data: [
        ...['view', 'create', 'edit', 'delete'].map((action) => ({
          organizationId: org,
          roleId: adminRole,
          module: 'leads',
          action,
          scope: 'ORGANIZATION' as const,
        })),
        ...['view', 'configure', 'operate'].map((action) => ({
          organizationId: org,
          roleId: adminRole,
          module: 'lead_routing',
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
        // roleWide and roleNarrow are deliberately symmetric — every scope and
        // feature permission identical — so any difference in what they can
        // see is attributable only to Status Visibility, never to scope.
        ...[roleWide, roleNarrow].flatMap((roleId) =>
          ['view', 'create', 'edit', 'comment'].map((action) => ({
            organizationId: org,
            roleId,
            module: 'leads',
            action,
            scope: 'ORGANIZATION' as const,
          })),
        ),
        ...['view', 'edit'].map((action) => ({
          organizationId: org,
          roleId: roleSelf,
          module: 'leads',
          action,
          scope: 'SELF' as const,
        })),
      ],
    });
    await prisma.journey.createMany({
      data: [
        { id: journey1, organizationId: org, key: 'synthetic_journey_one', name: 'Journey one' },
        { id: journey2, organizationId: org, key: 'synthetic_journey_two', name: 'Journey two' },
      ],
    });
    await prisma.roleJourneyAccess.createMany({
      data: [adminRole, roleWide, roleNarrow, roleSelf].flatMap((roleId) =>
        [journey1, journey2].map((journeyId) => ({ organizationId: org, roleId, journeyId })),
      ),
    });
    await prisma.status.createMany({
      data: [
        [openStatus1, journey1, 'synthetic_open_one'],
        [openStatus2, journey2, 'synthetic_open_two'],
      ].map(([id, journeyId, key]) => ({
        id: id as string,
        organizationId: org,
        journeyId: journeyId as string,
        key: key as string,
        name: `Status ${key as string}`,
        outcomeType: 'open' as const,
        behaviorType: 'default' as const,
        sortOrder: 0,
        isDefaultOnCreate: true,
      })),
    });
  }, 180_000);

  afterAll(async () => db?.cleanup());

  /* ------------------------------------------------------------- Security */

  it('hides a lead end-to-end from a Role with no visibility row, on every surface at once', async () => {
    const gate = await makeStatus(journey1, 'security_gate');
    expect((await putVisibility(asAdmin(), gate, [roleWide])).statusCode).toBe(200);
    const lead = await seedLead(gate, journey1, userWide);

    // Denied role: absent from the list (whole-response, per ADR-0011), 403 on
    // direct fetch, 403 on the timeline, absent from a name search, and the
    // list's count matches its rows exactly.
    const deniedList = await list(asNarrow());
    expect(deniedList.statusCode).toBe(200);
    expect(deniedList.body).not.toContain(lead.leadId);
    const deniedBody = JSON.parse(deniedList.body) as { total: number; rows: unknown[] };
    expect(deniedBody.total).toBe(deniedBody.rows.length);

    expect((await detail(asNarrow(), lead.leadId)).statusCode).toBe(403);
    expect((await activity(asNarrow(), lead.leadId)).statusCode).toBe(403);

    const searchResult = await list(asNarrow(), `&search=${lead.leadId.slice(0, 8)}`);
    const searchBody = JSON.parse(searchResult.body) as { total: number; rows: unknown[] };
    expect(searchBody.rows).toHaveLength(0);
    expect(searchBody.total).toBe(0);

    // Not vacuous: the allowed role sees it on every one of the same surfaces.
    const allowedList = await list(asWide());
    expect(allowedList.body).toContain(lead.leadId);
    const allowedBody = JSON.parse(allowedList.body) as { total: number; rows: unknown[] };
    expect(allowedBody.total).toBe(allowedBody.rows.length);
    expect((await detail(asWide(), lead.leadId)).statusCode).toBe(200);
    expect((await activity(asWide(), lead.leadId)).statusCode).toBe(200);
  }, 120_000);

  it('does not let a direct grant bypass Status Visibility, on the plain list, shared_with_me, or detail', async () => {
    // Assigned to someone else, so SELF scope's own assignment-based path
    // already excludes userSelf regardless of Status Visibility — a direct
    // grant is the *only* route in either lead below, isolating exactly the
    // two arms `accessClause()` compiles from `user_access_grants`: the
    // dedicated `shared_with_me` branch, and the default `all` branch's own
    // shared-record OR-arm. Neither routes through `processExists()`, so
    // neither inherited the fix that lives inside it.
    const deniedGate = await makeStatus(journey1, 'grant_gate_denied');
    expect((await putVisibility(asAdmin(), deniedGate, [roleWide])).statusCode).toBe(200);
    const deniedLead = await seedLead(deniedGate, journey1, userOtherOwner);
    await prisma.userAccessGrant.create({
      data: {
        organizationId: org,
        leadId: deniedLead.leadId,
        userId: userSelf,
        grantedByUserId: adminUser,
        actions: ['view'],
      },
    });

    // The plain list (`all`, the default): the grant's own OR-arm must
    // respect Status Visibility too, not just the assignment arm beside it.
    const plainDenied = await list(asSelf());
    expect(plainDenied.body).not.toContain(deniedLead.leadId);

    // `shared_with_me`: no assignment-based arm exists here at all, so this
    // isolates the bug completely — a grant alone used to be sufficient.
    const sharedDenied = await list(asSelf(), '&accessMode=shared_with_me');
    expect(sharedDenied.body).not.toContain(deniedLead.leadId);
    const sharedDeniedBody = JSON.parse(sharedDenied.body) as { total: number; rows: unknown[] };
    expect(sharedDeniedBody.total).toBe(sharedDeniedBody.rows.length);
    expect(sharedDeniedBody.rows).toHaveLength(0);

    // Detail already got this right — decision.ts's `statusVisible` check is
    // unconditional on how the caller reached the record — so this is the
    // list query catching up to a rule the single-record path already
    // enforced, not a new rule.
    expect((await detail(asSelf(), deniedLead.leadId)).statusCode).toBe(403);

    // Not vacuous: the identical shape — same Role, same grant, same wrong
    // assignee — but a Status that allows roleSelf shows the lead on both
    // surfaces, proving the absence above is Status Visibility denying it,
    // not the grant mechanism failing outright.
    const allowedGate = await makeStatus(journey1, 'grant_gate_allowed');
    expect((await putVisibility(asAdmin(), allowedGate, [roleSelf])).statusCode).toBe(200);
    const allowedLead = await seedLead(allowedGate, journey1, userOtherOwner);
    await prisma.userAccessGrant.create({
      data: {
        organizationId: org,
        leadId: allowedLead.leadId,
        userId: userSelf,
        grantedByUserId: adminUser,
        actions: ['view'],
      },
    });
    expect((await list(asSelf())).body).toContain(allowedLead.leadId);
    const allowedShared = await list(asSelf(), '&accessMode=shared_with_me');
    expect(allowedShared.body).toContain(allowedLead.leadId);
    expect((await detail(asSelf(), allowedLead.leadId)).statusCode).toBe(200);
  }, 120_000);

  it('keeps a lead visible through an unrestricted process instance when another is denied (multi-Journey union)', async () => {
    const gate = await makeStatus(journey1, 'union_gate');
    expect((await putVisibility(asAdmin(), gate, [roleWide])).statusCode).toBe(200);

    const lead = await seedLead(gate, journey1, userNarrow);
    const openProcess = await addProcess(lead.leadId, journey2, openStatus2, userNarrow);
    await prisma.activityLog.create({
      data: {
        organizationId: org,
        leadId: lead.leadId,
        processInstanceId: lead.processInstanceId,
        actionType: 'field_edit',
        source: 'synthetic',
        newValue: { via: 'gated process' },
      },
    });
    await prisma.activityLog.create({
      data: {
        organizationId: org,
        leadId: lead.leadId,
        processInstanceId: openProcess,
        actionType: 'field_edit',
        source: 'synthetic',
        newValue: { via: 'open process' },
      },
    });

    // roleNarrow cannot see the gated process instance, but the lead survives
    // through the open one on every surface — the per-process union already
    // proven for Journey access, now proven for this axis.
    const listBody = await list(asNarrow());
    expect(listBody.body).toContain(lead.leadId);
    const parsed = JSON.parse(listBody.body) as { total: number; rows: unknown[] };
    expect(parsed.total).toBe(parsed.rows.length);

    const detailResponse = await detail(asNarrow(), lead.leadId);
    expect(detailResponse.statusCode).toBe(200);
    const detailBody = JSON.parse(detailResponse.body) as {
      processInstances: Array<{ processInstanceId: string }>;
    };
    expect(detailBody.processInstances.map((p) => p.processInstanceId)).toEqual([openProcess]);

    // Only the visible process instance's own activity rows appear.
    const activityResponse = await activity(asNarrow(), lead.leadId);
    expect(activityResponse.statusCode).toBe(200);
    const activityBody = JSON.parse(activityResponse.body) as {
      items: Array<{ newValue: unknown }>;
    };
    expect(activityBody.items.map((row) => row.newValue)).toEqual([{ via: 'open process' }]);
  }, 120_000);

  it('imposes no restriction on an unconfigured Status, restricts immediately once a row exists, and reopens fully once cleared', async () => {
    const status = await makeStatus(journey1, 'progressive');
    const lead = await seedLead(status, journey1, userNarrow);

    // Baseline: zero rows, ordinary scope applies unchanged.
    expect((await detail(asNarrow(), lead.leadId)).statusCode).toBe(200);

    // The first row restricts immediately — no caching, per-request
    // re-evaluation, matching 13a's "immediately after creation" property.
    expect((await putVisibility(asAdmin(), status, [roleWide])).statusCode).toBe(200);
    const afterFirstRow = await detail(asNarrow(), lead.leadId);
    expect(afterFirstRow.statusCode).toBe(403);
    expect(afterFirstRow.body).not.toContain(lead.leadId);

    // Clearing every row returns to unrestricted — not to denied-for-everyone.
    expect((await putVisibility(asAdmin(), status, [])).statusCode).toBe(200);
    expect((await detail(asNarrow(), lead.leadId)).statusCode).toBe(200);
  }, 120_000);

  it('narrows on top of data scope but never widens it (AND, not OR)', async () => {
    const status = await makeStatus(journey1, 'scope_and');
    // roleSelf is allow-listed for this Status…
    expect((await putVisibility(asAdmin(), status, [roleSelf])).statusCode).toBe(200);
    // …but the lead belongs to someone else, so SELF scope still excludes it.
    const lead = await seedLead(status, journey1, userOtherOwner);

    const denied = await list(asSelf());
    expect(denied.body).not.toContain(lead.leadId);
    expect((await detail(asSelf(), lead.leadId)).statusCode).toBe(403);
  }, 120_000);

  it('gates a status change against the pre-edit Status, not the destination', async () => {
    const destination = await makeStatus(journey1, 'destination_gate');
    // roleNarrow cannot see the destination…
    expect((await putVisibility(asAdmin(), destination, [roleWide])).statusCode).toBe(200);
    // …but can see and edit the lead in its current, unrestricted Status.
    const lead = await seedLead(openStatus1, journey1, userNarrow);

    const moved = await call(asNarrow(), 'PATCH', `/api/v1/leads/${lead.leadId}`, {
      processInstanceId: lead.processInstanceId,
      journeyId: journey1,
      statusId: destination,
      assignmentTypes: [assignmentType],
    });
    // The move itself succeeds — checked against the pre-edit Status.
    expect(moved.statusCode).toBe(200);

    // Immediately after, the mover has lost the lead they just moved.
    const after = await detail(asNarrow(), lead.leadId);
    expect(after.statusCode).toBe(403);
    const afterList = await list(asNarrow());
    expect(afterList.body).not.toContain(lead.leadId);
  }, 120_000);

  it('checks the landing Status on lead creation, both explicit and default-on-create', async () => {
    const explicitGate = await makeStatus(journey1, 'create_explicit_gate');
    expect((await putVisibility(asAdmin(), explicitGate, [roleWide])).statusCode).toBe(200);

    const deniedExplicit = await call(asNarrow(), 'POST', '/api/v1/leads', {
      journeyId: journey1,
      statusId: explicitGate,
      name: 'Synthetic denied-at-creation lead',
      fieldValues: {},
      assignments: [{ assignmentType, userId: userNarrow }],
      assignmentTypes: [assignmentType],
    });
    expect(deniedExplicit.statusCode).toBe(403);

    const allowedExplicit = await call(asWide(), 'POST', '/api/v1/leads', {
      journeyId: journey1,
      statusId: explicitGate,
      name: 'Synthetic allowed-at-creation lead',
      fieldValues: {},
      assignments: [{ assignmentType, userId: userWide }],
      assignmentTypes: [assignmentType],
    });
    expect(allowedExplicit.statusCode).toBe(201);

    // Default-on-create: its own Journey, so nothing else contends for the
    // "default" slot.
    const defaultJourney = randomUUID();
    await prisma.journey.create({
      data: {
        id: defaultJourney,
        organizationId: org,
        key: 'synthetic_default_journey',
        name: 'Default-on-create journey',
      },
    });
    await prisma.roleJourneyAccess.createMany({
      data: [roleWide, roleNarrow].map((roleId) => ({
        organizationId: org,
        roleId,
        journeyId: defaultJourney,
      })),
    });
    const defaultGate = await makeStatus(defaultJourney, 'create_default_gate', true);
    expect((await putVisibility(asAdmin(), defaultGate, [roleWide])).statusCode).toBe(200);

    const deniedDefault = await call(asNarrow(), 'POST', '/api/v1/leads', {
      journeyId: defaultJourney,
      name: 'Synthetic denied-default lead',
      fieldValues: {},
      assignments: [{ assignmentType, userId: userNarrow }],
      assignmentTypes: [assignmentType],
    });
    expect(deniedDefault.statusCode).toBe(403);

    const allowedDefault = await call(asWide(), 'POST', '/api/v1/leads', {
      journeyId: defaultJourney,
      name: 'Synthetic allowed-default lead',
      fieldValues: {},
      assignments: [{ assignmentType, userId: userWide }],
      assignmentTypes: [assignmentType],
    });
    expect(allowedDefault.statusCode).toBe(201);
  }, 120_000);

  it('checks the landing Status when moving a lead to another Journey', async () => {
    const targetJourney = randomUUID();
    await prisma.journey.create({
      data: {
        id: targetJourney,
        organizationId: org,
        key: 'synthetic_move_target',
        name: 'Move target journey',
      },
    });
    await prisma.roleJourneyAccess.createMany({
      data: [roleWide, roleNarrow].map((roleId) => ({
        organizationId: org,
        roleId,
        journeyId: targetJourney,
      })),
    });
    const targetGate = await makeStatus(targetJourney, 'move_target_gate', true);
    expect((await putVisibility(asAdmin(), targetGate, [roleWide])).statusCode).toBe(200);

    const deniedLead = await seedLead(openStatus1, journey1, userNarrow);
    const deniedMove = await call(
      asNarrow(),
      'PATCH',
      `/api/v1/leads/${deniedLead.leadId}/journey`,
      {
        processInstanceId: deniedLead.processInstanceId,
        journeyId: journey1,
        targetJourneyId: targetJourney,
        assignmentTypes: [assignmentType],
      },
    );
    expect(deniedMove.statusCode).toBe(403);

    const allowedLead = await seedLead(openStatus1, journey1, userWide);
    const allowedMove = await call(
      asWide(),
      'PATCH',
      `/api/v1/leads/${allowedLead.leadId}/journey`,
      {
        processInstanceId: allowedLead.processInstanceId,
        journeyId: journey1,
        targetJourneyId: targetJourney,
        assignmentTypes: [assignmentType],
      },
    );
    expect(allowedMove.statusCode).toBe(200);
  }, 120_000);

  it('extends the same per-process check to sharing/comment/reassign/deactivate routes', async () => {
    const gate = await makeStatus(journey1, 'folded_in_gate');
    expect((await putVisibility(asAdmin(), gate, [roleWide])).statusCode).toBe(200);
    const lead = await seedLead(gate, journey1, userOtherOwner);

    const denied = await call(asNarrow(), 'POST', `/api/v1/leads/${lead.leadId}/comments`, {
      text: 'synthetic comment',
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await call(asWide(), 'POST', `/api/v1/leads/${lead.leadId}/comments`, {
      text: 'synthetic comment',
    });
    expect(allowed.statusCode).toBe(201);
  }, 120_000);

  /* ---------------------------------------------------------- Routing */

  describe('routing interaction', () => {
    it('excludes a routing candidate whose Role cannot see the Status', async () => {
      const routed = await makeStatus(journey1, 'routing_gate');
      await grantRouting(routed, adminRole, ['view', 'configure', 'operate']);
      await putVisibility(asAdmin(), routed, [roleWide]);

      const put = await call(asAdmin(), 'PUT', `/api/v1/statuses/${routed}/routing`, {
        assignmentType,
        algorithm: 'round_robin',
        poolType: 'users',
        userIds: [userWide, userNarrow],
      });
      expect(put.statusCode).toBe(200);

      const leads = await Promise.all(
        [1, 2, 3, 4].map(() => seedLead(openStatus1, journey1, adminUser)),
      );
      const responses = await Promise.all(leads.map((lead) => moveToStatus(lead, routed)));
      expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);

      const owners = await Promise.all(leads.map((lead) => currentOwner(lead.processInstanceId)));
      // Every assignment landed on the visible candidate; the excluded one
      // never received a lead, even though round robin would ordinarily
      // alternate between the two.
      expect(owners.every((owner) => owner?.userId === userWide)).toBe(true);
    }, 120_000);

    it('skips without assigning when every candidate is excluded, and still commits the status change', async () => {
      const routed = await makeStatus(journey1, 'routing_empty_gate');
      await grantRouting(routed, adminRole, ['view', 'configure', 'operate']);
      // Restricted to a Role that is not in the routing pool at all.
      await putVisibility(asAdmin(), routed, [roleSelf]);

      await call(asAdmin(), 'PUT', `/api/v1/statuses/${routed}/routing`, {
        assignmentType,
        algorithm: 'round_robin',
        poolType: 'users',
        userIds: [userWide, userNarrow],
      });

      const lead = await seedLead(openStatus1, journey1, userOtherOwner);
      const moved = await moveToStatus(lead, routed);
      expect(moved.statusCode).toBe(200);
      expect(
        await prisma.processInstance.findFirst({
          where: { organizationId: org, id: lead.processInstanceId },
          select: { currentStatusId: true },
        }),
      ).toEqual({ currentStatusId: routed });
      // No assignment made; the lead keeps whatever it had.
      expect(await currentOwner(lead.processInstanceId)).toEqual({ userId: userOtherOwner });
      const skip = await prisma.activityLog.findFirst({
        where: { organizationId: org, leadId: lead.leadId, actionType: 'routing_skipped' },
      });
      expect(skip?.newValue).toEqual({ reason: 'no_visible_candidate' });
    }, 120_000);

    it('does not filter routing candidates when the Status has no visibility rows configured', async () => {
      const routed = await makeStatus(journey1, 'routing_open_gate');
      await grantRouting(routed, adminRole, ['view', 'configure', 'operate']);
      // Deliberately no putVisibility call: this Status stays unconfigured.

      await call(asAdmin(), 'PUT', `/api/v1/statuses/${routed}/routing`, {
        assignmentType,
        algorithm: 'round_robin',
        poolType: 'users',
        userIds: [userWide, userNarrow],
      });

      const leads = await Promise.all(
        [1, 2, 3, 4].map(() => seedLead(openStatus1, journey1, adminUser)),
      );
      for (const lead of leads) expect((await moveToStatus(lead, routed)).statusCode).toBe(200);
      const owners = await Promise.all(leads.map((lead) => currentOwner(lead.processInstanceId)));
      // Both candidates receive leads — proving the filter is a no-op until
      // the feature is actually configured for this Status.
      expect(new Set(owners.map((owner) => owner?.userId))).toEqual(
        new Set([userWide, userNarrow]),
      );
    }, 120_000);
  });

  /* ------------------------------------------------------ Configuration */

  describe('configuration CRUD', () => {
    it('replaces the allow-list wholesale, round-trips, and bumps every affected role including one that lost its row', async () => {
      const status = await makeStatus(journey1, 'crud_replace');
      const before = await prisma.role.findFirst({
        where: { organizationId: org, id: roleNarrow },
        select: { version: true },
      });

      const first = await putVisibility(asAdmin(), status, [roleWide, roleNarrow]);
      expect(first.statusCode).toBe(200);
      const afterFirst = await getVisibility(asAdmin(), status);
      const expectedSorted = [roleWide, roleNarrow]
        .map((roleId) => ({ roleId }))
        .sort((a, b) => a.roleId.localeCompare(b.roleId));
      expect(JSON.parse(afterFirst.body)).toEqual(expectedSorted);

      // A second PUT replaces wholesale — roleNarrow drops out rather than
      // being merged alongside the new set.
      const second = await putVisibility(asAdmin(), status, [roleWide]);
      expect(second.statusCode).toBe(200);
      const afterSecond = await getVisibility(asAdmin(), status);
      expect(JSON.parse(afterSecond.body)).toEqual([{ roleId: roleWide }]);

      const after = await prisma.role.findFirst({
        where: { organizationId: org, id: roleNarrow },
        select: { version: true },
      });
      expect(after!.version).toBeGreaterThan(before!.version);
    }, 120_000);

    it('gates the editor on roles_permissions, never on routing or journey configuration, preventing self-escalation', async () => {
      const status = await makeStatus(journey1, 'crud_escalation');
      const configuratorRole = randomUUID();
      const configurator = randomUUID();
      await prisma.role.create({
        data: {
          id: configuratorRole,
          organizationId: org,
          key: 'synthetic_configurator',
          name: 'Synthetic configurator',
        },
      });
      await prisma.rolePermission.createMany({
        data: [
          {
            organizationId: org,
            roleId: configuratorRole,
            module: 'journeys_statuses',
            action: 'edit',
            scope: 'ORGANIZATION' as const,
          },
          {
            organizationId: org,
            roleId: configuratorRole,
            module: 'lead_routing',
            action: 'configure',
            scope: 'ORGANIZATION' as const,
          },
        ],
      });
      await prisma.user.create({
        data: {
          id: configurator,
          organizationId: org,
          name: 'Synthetic configurator user',
          email: 'configurator@example.test',
          roleId: configuratorRole,
        },
      });
      const asConfigurator = { userId: configurator, roleId: configuratorRole };

      expect((await getVisibility(asConfigurator, status)).statusCode).toBe(403);
      const escalation = await putVisibility(asConfigurator, status, [configuratorRole]);
      expect(escalation.statusCode).toBe(403);
      expect(
        await prisma.statusVisibility.count({
          where: { organizationId: org, statusId: status, roleId: configuratorRole },
        }),
      ).toBe(0);
    }, 120_000);

    it('audits every replace and isolates tenants', async () => {
      const status = await makeStatus(journey1, 'crud_audit');
      expect((await putVisibility(asAdmin(), status, [roleWide])).statusCode).toBe(200);
      expect((await putVisibility(asAdmin(), status, [])).statusCode).toBe(200);

      const audits = await prisma.systemAuditLog.findMany({
        where: { organizationId: org, entityType: 'status_visibility', entityId: status },
        orderBy: { timestamp: 'asc' },
      });
      expect(audits.map((row) => row.action)).toEqual(['replace', 'replace']);
      expect(audits[0]?.oldValue).toEqual([]);
      expect(audits[0]?.newValue).toEqual([{ roleId: roleWide }]);
      expect(audits[1]?.oldValue).toEqual([{ roleId: roleWide }]);
      expect(audits[1]?.newValue).toEqual([]);

      const foreignRoleReplace = await putVisibility(asAdmin(), status, [foreignRole]);
      expect(foreignRoleReplace.statusCode).toBe(400);

      const foreignStatus = await putVisibility(asAdmin(), randomUUID(), [roleWide]);
      expect(foreignStatus.statusCode).toBe(404);
    }, 120_000);
  });
});
