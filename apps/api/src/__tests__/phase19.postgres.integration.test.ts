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
 * Phase 19/20 — Status Visibility, against real Postgres.
 *
 * Originally (Phase 19) a Role-level allow-list, independent of Status
 * Routing. Phase 20 united the two: visibility of a lead sitting in a
 * Status with an active routing rule is now computed from the routing
 * assignment itself — the lead's current assignee, plus everyone above the
 * assignee in the reporting hierarchy (`users.manager_id`, any depth) — and
 * no one else. There is no more admin-configured allow-list; routing
 * decides visibility.
 *
 * The assertion this file exists for, restated for the new mechanism: **the
 * assignee of a lead in a routed Status can always see it, and their
 * manager chain can too, but nobody else can — regardless of how broad
 * their own Role's DataScope grant otherwise is** — on every surface at
 * once, additive on top of ordinary data scope, and now structurally
 * guaranteed rather than admin-configured.
 *
 * Every security assertion is whole-response, per ADR-0011: the denied
 * caller's response body must not contain the lead's id anywhere, in any
 * shape, and a list's `total` must match its `rows.length` on every case.
 *
 * Every name is synthetic. Nothing here depends on a real Journey, Status,
 * Role, or person name (`AGENTS.md`).
 */

describe.runIf(shouldRunAdminPostgres)('Phase 19/20 Status Visibility', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();

  const adminRole = randomUUID();
  /** SELF scope. The assignee whose lead everything else revolves around. */
  const roleSelf = randomUUID();
  /** TEAM scope, direct manager of `userSelf`. */
  const roleManager = randomUUID();
  /** TEAM scope, manager of `userManager` — proves "any depth". */
  const roleGrandManager = randomUUID();
  /** SELF scope, manager of `userReport2` but with inadequate own scope. */
  const roleManagerSelfOnly = randomUUID();
  /** SELF scope, a second, unrelated assignee for the AND-not-OR case. */
  const roleReport2 = randomUUID();
  /** ORGANIZATION scope, unrelated to anyone's hierarchy below. */
  const roleWide = randomUUID();

  const adminUser = randomUUID();
  const userSelf = randomUUID();
  const userManager = randomUUID();
  const userGrandManager = randomUUID();
  const userManagerSelfOnly = randomUUID();
  const userReport2 = randomUUID();
  const userWide = randomUUID();
  const userOtherOwner = randomUUID();

  const journey1 = randomUUID();
  const journey2 = randomUUID();
  /** Unrestricted for the life of the suite — no routing rule ever lands here. */
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
  const asSelf = () => ({ userId: userSelf, roleId: roleSelf });
  const asManager = () => ({ userId: userManager, roleId: roleManager });
  const asGrandManager = () => ({ userId: userGrandManager, roleId: roleGrandManager });
  const asManagerSelfOnly = () => ({ userId: userManagerSelfOnly, roleId: roleManagerSelfOnly });
  const asWide = () => ({ userId: userWide, roleId: roleWide });

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

  const grantRouting = (statusId: string, roleId: string, actions: readonly string[]) =>
    prisma.statusRoutingPermission.createMany({
      data: actions.map((action) => ({ organizationId: org, statusId, roleId, action })),
    });

  /**
   * Turns a Status's routing on — the one thing that now flips Status
   * Visibility from unrestricted to hierarchy-restricted. The pool is a
   * placeholder (`adminUser`); no test here depends on the algorithm
   * actually picking anyone, only on the rule being active.
   */
  const activateRouting = async (
    statusId: string,
    poolUserIds: readonly string[] = [adminUser],
  ) => {
    await grantRouting(statusId, adminRole, ['configure', 'operate']);
    const response = await call(asAdmin(), 'PUT', `/api/v1/statuses/${statusId}/routing`, {
      assignmentType,
      algorithm: 'round_robin',
      poolType: 'users',
      userIds: [...poolUserIds],
    });
    expect(response.statusCode).toBe(200);
  };
  const deactivateRouting = (statusId: string) =>
    call(asAdmin(), 'POST', `/api/v1/statuses/${statusId}/routing/deactivate`);

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

  const currentOwner = (processInstanceId: string) =>
    prisma.assignment.findFirst({
      where: { organizationId: org, processInstanceId, assignmentType, isCurrent: true },
      select: { userId: true },
    });

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    await applyMigrations(db.sql);

    await prisma.organization.create({ data: { id: org, name: 'Synthetic organization' } });
    await prisma.role.createMany({
      data: [
        { id: adminRole, organizationId: org, key: 'synthetic_admin', name: 'Synthetic admin' },
        { id: roleSelf, organizationId: org, key: 'synthetic_self', name: 'Synthetic self' },
        {
          id: roleManager,
          organizationId: org,
          key: 'synthetic_manager',
          name: 'Synthetic manager',
        },
        {
          id: roleGrandManager,
          organizationId: org,
          key: 'synthetic_grand_manager',
          name: 'Synthetic grand manager',
        },
        {
          id: roleManagerSelfOnly,
          organizationId: org,
          key: 'synthetic_manager_self_only',
          name: 'Synthetic manager, self-scoped',
        },
        {
          id: roleReport2,
          organizationId: org,
          key: 'synthetic_report_two',
          name: 'Synthetic report two',
        },
        { id: roleWide, organizationId: org, key: 'synthetic_wide', name: 'Synthetic wide' },
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
          id: userGrandManager,
          organizationId: org,
          name: 'Synthetic grand manager',
          email: 'grand-manager@example.test',
          roleId: roleGrandManager,
        },
        {
          id: userManager,
          organizationId: org,
          name: 'Synthetic manager',
          email: 'manager@example.test',
          roleId: roleManager,
          managerId: userGrandManager,
        },
        {
          id: userSelf,
          organizationId: org,
          name: 'Synthetic self user',
          email: 'self@example.test',
          roleId: roleSelf,
          managerId: userManager,
        },
        {
          id: userManagerSelfOnly,
          organizationId: org,
          name: 'Synthetic manager, self-scoped',
          email: 'manager-self-only@example.test',
          roleId: roleManagerSelfOnly,
        },
        {
          id: userReport2,
          organizationId: org,
          name: 'Synthetic report two',
          email: 'report-two@example.test',
          roleId: roleReport2,
          managerId: userManagerSelfOnly,
        },
        {
          id: userWide,
          organizationId: org,
          name: 'Synthetic wide user',
          email: 'wide@example.test',
          roleId: roleWide,
        },
        {
          id: userOtherOwner,
          organizationId: org,
          name: 'Synthetic other owner',
          email: 'other-owner@example.test',
          roleId: roleWide,
        },
      ],
    });
    await prisma.rolePermission.createMany({
      data: [
        ...['view', 'create', 'edit', 'delete', 'comment'].map((action) => ({
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
        ...[roleSelf, roleReport2, roleManagerSelfOnly].flatMap((roleId) =>
          ['view', 'create', 'edit', 'comment'].map((action) => ({
            organizationId: org,
            roleId,
            module: 'leads',
            action,
            scope: 'SELF' as const,
          })),
        ),
        ...[roleManager, roleGrandManager].flatMap((roleId) =>
          ['view', 'create', 'edit', 'comment'].map((action) => ({
            organizationId: org,
            roleId,
            module: 'leads',
            action,
            scope: 'TEAM' as const,
          })),
        ),
        ...['view', 'create', 'edit', 'comment'].map((action) => ({
          organizationId: org,
          roleId: roleWide,
          module: 'leads',
          action,
          scope: 'ORGANIZATION' as const,
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
      data: [
        adminRole,
        roleSelf,
        roleManager,
        roleGrandManager,
        roleManagerSelfOnly,
        roleReport2,
        roleWide,
      ].flatMap((roleId) =>
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

  it('makes the assignee visible on every surface the instant a Status routes, with no separate configuration step', async () => {
    const routed = await makeStatus(journey1, 'security_gate');
    await activateRouting(routed);
    const lead = await seedLead(routed, journey1, userSelf);

    const allowedList = await list(asSelf());
    expect(allowedList.statusCode).toBe(200);
    expect(allowedList.body).toContain(lead.leadId);
    const allowedBody = JSON.parse(allowedList.body) as { total: number; rows: unknown[] };
    expect(allowedBody.total).toBe(allowedBody.rows.length);
    expect((await detail(asSelf(), lead.leadId)).statusCode).toBe(200);
    expect((await activity(asSelf(), lead.leadId)).statusCode).toBe(200);

    // Not vacuous, and proves this narrows *below* ordinary DataScope: userWide
    // holds ORGANIZATION scope — would see every lead in the org — but is not
    // in userSelf's reporting hierarchy, so Status Visibility excludes them.
    const deniedList = await list(asWide());
    expect(deniedList.body).not.toContain(lead.leadId);
    const deniedBody = JSON.parse(deniedList.body) as { total: number; rows: unknown[] };
    expect(deniedBody.total).toBe(deniedBody.rows.length);
    expect((await detail(asWide(), lead.leadId)).statusCode).toBe(403);
    expect((await activity(asWide(), lead.leadId)).statusCode).toBe(403);
    const searchResult = await list(asWide(), `&search=${lead.leadId.slice(0, 8)}`);
    const searchBody = JSON.parse(searchResult.body) as { total: number; rows: unknown[] };
    expect(searchBody.rows).toHaveLength(0);
    expect(searchBody.total).toBe(0);
  }, 120_000);

  it('extends visibility up the reporting hierarchy, any depth, but never sideways to an unrelated broad-scope caller', async () => {
    const routed = await makeStatus(journey1, 'hierarchy_gate');
    await activateRouting(routed);
    const lead = await seedLead(routed, journey1, userSelf);

    // userManager (direct) and userGrandManager (two levels up) both reach
    // userSelf through `manager_id`, transitively — the same relation TEAM
    // scope already resolves (ADR-0006), just asked from the other end.
    expect((await detail(asManager(), lead.leadId)).statusCode).toBe(200);
    expect((await detail(asGrandManager(), lead.leadId)).statusCode).toBe(200);
    expect((await detail(asWide(), lead.leadId)).statusCode).toBe(403);
  }, 120_000);

  it('narrows on top of data scope but never substitutes for it (AND, not OR)', async () => {
    const routed = await makeStatus(journey1, 'scope_and_gate');
    await activateRouting(routed);
    const lead = await seedLead(routed, journey1, userReport2);

    // userManagerSelfOnly *is* userReport2's manager — the hierarchy
    // relation Status Visibility asks about is satisfied — but their own
    // Role holds only SELF scope, which never reaches a report's lead at
    // all. Being an ancestor grants no reach beyond what ordinary DataScope
    // already permits; it only ever narrows.
    expect((await detail(asManagerSelfOnly(), lead.leadId)).statusCode).toBe(403);
  }, 120_000);

  it('imposes no restriction while unrouted, restricts once routing activates, and reopens once it deactivates', async () => {
    const status = await makeStatus(journey1, 'progressive_gate');
    const lead = await seedLead(status, journey1, userSelf);

    // Baseline: no rule at all — userWide's ORGANIZATION scope applies unchanged.
    expect((await detail(asWide(), lead.leadId)).statusCode).toBe(200);

    // Activating routing restricts immediately — no caching, per-request
    // re-evaluation, matching 13a's "immediately after creation" property.
    await activateRouting(status);
    const afterActive = await detail(asWide(), lead.leadId);
    expect(afterActive.statusCode).toBe(403);
    expect(afterActive.body).not.toContain(lead.leadId);

    // Deactivating returns the Status to unrestricted — not to
    // denied-for-everyone, matching Phase 19's original default exactly.
    expect((await deactivateRouting(status)).statusCode).toBe(200);
    expect((await detail(asWide(), lead.leadId)).statusCode).toBe(200);
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
    await activateRouting(deniedGate);
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

    // userSelf is not userOtherOwner's manager (nor userOtherOwner), so the
    // hierarchy check excludes them even with a grant in hand.
    const plainDenied = await list(asSelf());
    expect(plainDenied.body).not.toContain(deniedLead.leadId);

    const sharedDenied = await list(asSelf(), '&accessMode=shared_with_me');
    expect(sharedDenied.body).not.toContain(deniedLead.leadId);
    const sharedDeniedBody = JSON.parse(sharedDenied.body) as { total: number; rows: unknown[] };
    expect(sharedDeniedBody.total).toBe(sharedDeniedBody.rows.length);
    expect(sharedDeniedBody.rows).toHaveLength(0);

    expect((await detail(asSelf(), deniedLead.leadId)).statusCode).toBe(403);

    // Not vacuous: the identical mismatch (grant recipient isn't the
    // assignee or their manager) — but an *unrouted* Status imposes no
    // restriction at all, so the grant alone is sufficient. Proves the
    // absence above is Status Visibility denying it, not the grant
    // mechanism failing outright.
    const allowedLead = await seedLead(openStatus1, journey1, userOtherOwner);
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
    await activateRouting(gate);

    const lead = await seedLead(gate, journey1, userSelf);
    const openProcess = await addProcess(lead.leadId, journey2, openStatus2, userWide);
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

    // userWide cannot see the gated process instance (not userSelf's
    // manager), but the lead survives through the open one — their own
    // assignment there — the per-process union already proven for Journey
    // access, now proven for this axis.
    const listBody = await list(asWide());
    expect(listBody.body).toContain(lead.leadId);
    const parsed = JSON.parse(listBody.body) as { total: number; rows: unknown[] };
    expect(parsed.total).toBe(parsed.rows.length);

    const detailResponse = await detail(asWide(), lead.leadId);
    expect(detailResponse.statusCode).toBe(200);
    const detailBody = JSON.parse(detailResponse.body) as {
      processInstances: Array<{ processInstanceId: string }>;
    };
    expect(detailBody.processInstances.map((p) => p.processInstanceId)).toEqual([openProcess]);

    const activityResponse = await activity(asWide(), lead.leadId);
    expect(activityResponse.statusCode).toBe(200);
    const activityBody = JSON.parse(activityResponse.body) as {
      items: Array<{ newValue: unknown }>;
    };
    expect(activityBody.items.map((row) => row.newValue)).toEqual([{ via: 'open process' }]);
  }, 120_000);

  it('gates a status change against the pre-edit Status, not the destination', async () => {
    const destination = await makeStatus(journey1, 'destination_gate');
    // The pool is userSelf themselves: entering a routed Status re-fires
    // the algorithm (round robin over a single-candidate pool always picks
    // that candidate), so the assignee stays userSelf across the move — what
    // changes here is purely whether the *mover* (admin, not the assignee)
    // can still see it.
    await activateRouting(destination, [userSelf]);
    const lead = await seedLead(openStatus1, journey1, userSelf);

    const moved = await call(asAdmin(), 'PATCH', `/api/v1/leads/${lead.leadId}`, {
      processInstanceId: lead.processInstanceId,
      journeyId: journey1,
      statusId: destination,
      assignmentTypes: [assignmentType],
    });
    // The move itself succeeds — checked against the pre-edit (open, so
    // unrestricted) Status, not the routed destination.
    expect(moved.statusCode).toBe(200);

    // Immediately after, admin (ORGANIZATION scope, but not userSelf's
    // manager) has lost visibility of the very lead they just moved.
    const after = await detail(asAdmin(), lead.leadId);
    expect(after.statusCode).toBe(403);
    const afterList = await list(asAdmin());
    expect(afterList.body).not.toContain(lead.leadId);

    // The assignee themselves, unaffected by the move, still sees it.
    expect((await detail(asSelf(), lead.leadId)).statusCode).toBe(200);
  }, 120_000);

  it('never blocks creating a lead into a routed Status, or moving one into a routed target Journey — there is no assignee yet to check', async () => {
    // Phase 19 checked the landing Status at creation time. Phase 20 removes
    // that check's bite entirely: Status Visibility is now derived from an
    // assignment, and neither `createLead` nor `moveLeadJourney`'s target
    // check has an existing assignment to test hierarchy reach against, so
    // both default to unrestricted — the same "no record named" default
    // `recordAllowed` already used everywhere else in this engine.
    const createGate = await makeStatus(journey1, 'create_landing_gate');
    await activateRouting(createGate);
    const created = await call(asWide(), 'POST', '/api/v1/leads', {
      journeyId: journey1,
      statusId: createGate,
      name: 'Synthetic created-into-routed-status lead',
      fieldValues: {},
      assignments: [{ assignmentType, userId: userWide }],
      assignmentTypes: [assignmentType],
    });
    expect(created.statusCode).toBe(201);

    const moveTargetJourney = randomUUID();
    await prisma.journey.create({
      data: {
        id: moveTargetJourney,
        organizationId: org,
        key: 'synthetic_move_target',
        name: 'Move target journey',
      },
    });
    await prisma.roleJourneyAccess.createMany({
      data: [roleSelf, roleWide].map((roleId) => ({
        organizationId: org,
        roleId,
        journeyId: moveTargetJourney,
      })),
    });
    const moveTargetGate = await makeStatus(moveTargetJourney, 'move_target_gate', true);
    await activateRouting(moveTargetGate);

    const lead = await seedLead(openStatus1, journey1, userWide);
    const moved = await call(asWide(), 'PATCH', `/api/v1/leads/${lead.leadId}/journey`, {
      processInstanceId: lead.processInstanceId,
      journeyId: journey1,
      targetJourneyId: moveTargetJourney,
      assignmentTypes: [assignmentType],
    });
    expect(moved.statusCode).toBe(200);
  }, 120_000);

  it('extends the same per-process check to comment routes', async () => {
    const gate = await makeStatus(journey1, 'folded_in_gate');
    await activateRouting(gate);
    const lead = await seedLead(gate, journey1, userSelf);

    const denied = await call(asWide(), 'POST', `/api/v1/leads/${lead.leadId}/comments`, {
      text: 'synthetic comment',
      assignmentTypes: [assignmentType],
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await call(asSelf(), 'POST', `/api/v1/leads/${lead.leadId}/comments`, {
      text: 'synthetic comment',
      assignmentTypes: [assignmentType],
    });
    expect(allowed.statusCode).toBe(201);
  }, 120_000);

  /* ---------------------------------------------------------- Routing */

  describe('routing interaction', () => {
    it('a manual override grants the new assignee visibility immediately, with no separate visibility step', async () => {
      const routed = await makeStatus(journey1, 'operate_gate');
      await activateRouting(routed);
      // `operate` is an *additional* gate, never a replacement (ADR-0015):
      // the actor still needs to already see the lead through their own
      // scope and hierarchy reach before they may reassign it, so the lead
      // starts out assigned to the actor themselves (admin, trivially
      // visible to admin).
      const lead = await seedLead(routed, journey1, adminUser);

      // userSelf cannot see it yet — not the current assignee, not their manager.
      expect((await detail(asSelf(), lead.leadId)).statusCode).toBe(403);

      const override = await call(
        asAdmin(),
        'POST',
        `/api/v1/leads/${lead.leadId}/routing-assign`,
        {
          processInstanceId: lead.processInstanceId,
          statusId: routed,
          assignmentTypes: [assignmentType],
          userId: userSelf,
        },
      );
      expect(override.statusCode).toBe(200);
      expect(await currentOwner(lead.processInstanceId)).toEqual({ userId: userSelf });

      // The instant they're assigned, they can see it — no admin action
      // beyond the assignment itself. This is the manual-override gap Phase
      // 19's own candidate filter never covered; uniting the two features
      // closes it structurally rather than with a second check.
      expect((await detail(asSelf(), lead.leadId)).statusCode).toBe(200);
      // The previous holder, in turn, has lost it — an ordinary consequence
      // of losing the assignment, not a new rule.
      expect((await detail(asAdmin(), lead.leadId)).statusCode).toBe(403);
    }, 120_000);

    it('round robin still distributes across the pool — visibility plays no part in candidate selection anymore', async () => {
      const routed = await makeStatus(journey1, 'routing_pool_gate');
      await grantRouting(routed, adminRole, ['configure', 'operate']);
      await call(asAdmin(), 'PUT', `/api/v1/statuses/${routed}/routing`, {
        assignmentType,
        algorithm: 'round_robin',
        poolType: 'users',
        userIds: [userWide, userOtherOwner],
      });

      const leads = await Promise.all(
        [1, 2, 3, 4].map(() => seedLead(openStatus1, journey1, adminUser)),
      );
      const responses = await Promise.all(
        leads.map((lead) =>
          call(asAdmin(), 'PATCH', `/api/v1/leads/${lead.leadId}`, {
            processInstanceId: lead.processInstanceId,
            journeyId: journey1,
            statusId: routed,
            assignmentTypes: [assignmentType],
          }),
        ),
      );
      expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
      const owners = await Promise.all(leads.map((lead) => currentOwner(lead.processInstanceId)));
      expect(new Set(owners.map((owner) => owner?.userId))).toEqual(
        new Set([userWide, userOtherOwner]),
      );
    }, 120_000);
  });
});
