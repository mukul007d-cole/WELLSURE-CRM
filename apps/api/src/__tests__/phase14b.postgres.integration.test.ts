import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';
import { resolveAuthorization } from '@falcon/permission-engine';

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
import { createAdminPostgres, shouldRunAdminPostgres } from './fixtures/synthetic-admin.js';

/**
 * Phase 14b — per-status assignment routing, against real Postgres.
 *
 * The assertion this file exists for: **when a rule reassigns a lead, the
 * previous holder genuinely loses it.** SELF scope resolves through
 * `assignments.is_current`, so that claim is about one row — and it is proven on
 * the list, the record fetch and `authorize()` at once, because a leak on any
 * one of them is a leak.
 *
 * The other load-bearing claims here are the two concurrency ones. Both
 * algorithms are wrong under concurrent status changes for the same reason (a
 * shared cursor; counts invalidated by the pick in flight), so both are driven
 * genuinely in parallel rather than in a loop that would pass either way.
 *
 * Every name is synthetic. Nothing may depend on a real journey, status, role,
 * department or person name (`AGENTS.md`).
 */

describe.runIf(shouldRunAdminPostgres)('Phase 14b per-status assignment routing', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  const otherOrg = randomUUID();
  const adminRole = randomUUID();
  /** SELF scope — the role whose visibility the security assertion is about. */
  const repRole = randomUUID();
  const foreignRole = randomUUID();

  const adminUser = randomUUID();
  const repA = randomUUID();
  const repB = randomUUID();
  const repC = randomUUID();
  const foreignUser = randomUUID();

  const department = randomUUID();
  const journey = randomUUID();
  const sourceStatus = randomUUID();
  const otherStatus = randomUUID();
  const closedStatus = randomUUID();
  /**
   * A fresh routed Status per test.
   *
   * `activity_logs` and `system_audit_logs` are append-only by database trigger,
   * so tests cannot be isolated by deleting what they wrote. They are isolated by
   * never sharing a Status instead: one test's rule, audit trail and assignments
   * are unreachable from another's.
   */
  let routedStatus: string;
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
            departmentId: department,
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
  const asRep = (userId: string) => ({ userId, roleId: repRole });

  /** Everything one rep can reach for one lead, on every surface at once. */
  const repSees = async (userId: string, leadId: string) => {
    const context = `assignmentTypes=${assignmentType}`;
    const [list, detail] = await Promise.all([
      call(asRep(userId), 'GET', `/api/v1/leads?${context}`),
      call(asRep(userId), 'GET', `/api/v1/leads/${leadId}?${context}`),
    ]);
    const decision = await resolveAuthorization({
      repository: new PrismaPermissionRepository(prisma as never),
      request: {
        organizationId: org,
        userId,
        module: 'leads',
        action: 'view',
        journeyId: journey,
        leadId,
        assignmentTypes: [assignmentType],
      },
    });
    return { list, detail, decision };
  };

  /** A candidate with no history, for tests whose assertion is about load. */
  const makeRep = async (tag: string) => {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        organizationId: org,
        name: `Synthetic ${tag} rep`,
        email: `${tag}-${id.slice(0, 8)}@example.test`,
        roleId: repRole,
        departmentId: department,
      },
    });
    return id;
  };

  /** A lead sitting in `sourceStatus`, owned by `ownerId`. */
  const seedLead = async (ownerId: string) => {
    const leadId = randomUUID();
    const processInstanceId = randomUUID();
    await prisma.lead.create({
      data: { id: leadId, organizationId: org, name: `Synthetic lead ${leadId.slice(0, 8)}` },
    });
    await prisma.processInstance.create({
      data: {
        id: processInstanceId,
        organizationId: org,
        leadId,
        journeyId: journey,
        currentStatusId: sourceStatus,
        isPrimary: true,
      },
    });
    await prisma.assignment.create({
      data: { organizationId: org, processInstanceId, assignmentType, userId: ownerId },
    });
    return { leadId, processInstanceId };
  };

  /** Move a lead into a status through the real edit path, as a rep would. */
  const moveToStatus = (lead: { leadId: string; processInstanceId: string }, statusId: string) =>
    call(asAdmin(), 'PATCH', `/api/v1/leads/${lead.leadId}`, {
      processInstanceId: lead.processInstanceId,
      journeyId: journey,
      statusId,
      assignmentTypes: [assignmentType],
    });

  const putRule = (body: Record<string, unknown>) =>
    call(asAdmin(), 'PUT', `/api/v1/statuses/${routedStatus}/routing`, body);

  const currentOwner = (processInstanceId: string) =>
    prisma.assignment.findFirst({
      where: { organizationId: org, processInstanceId, assignmentType, isCurrent: true },
      select: { userId: true },
    });

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    for (const file of [
      '00000000000000_initial',
      '00000000000001_custom_session_auth',
      '00000000000002_lead_sharing_notifications',
      '00000000000003_attachment_metadata',
      '00000000000004_campaigns',
      '00000000000005_teams',
      '00000000000006_status_routing',
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
        { id: repRole, organizationId: org, key: 'synthetic_rep', name: 'Synthetic rep' },
        {
          id: foreignRole,
          organizationId: otherOrg,
          key: 'synthetic_foreign',
          name: 'Synthetic foreign',
        },
      ],
    });
    await prisma.department.create({
      data: { id: department, organizationId: org, key: 'synthetic_unit', name: 'Synthetic unit' },
    });
    await prisma.user.createMany({
      data: [
        {
          id: adminUser,
          organizationId: org,
          name: 'Synthetic admin user',
          email: 'admin@example.test',
          roleId: adminRole,
          departmentId: department,
        },
        ...[
          [repA, 'a'],
          [repB, 'b'],
          [repC, 'c'],
        ].map(([id, tag]) => ({
          id: id!,
          organizationId: org,
          name: `Synthetic rep ${tag}`,
          email: `rep-${tag}@example.test`,
          roleId: repRole,
          departmentId: department,
        })),
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
        ...['view', 'create', 'edit', 'deactivate'].map((action) => ({
          organizationId: org,
          roleId: adminRole,
          module: 'users',
          action,
          scope: 'ORGANIZATION' as const,
        })),
        // The rep sees only what is assigned to them. This is the scope the
        // supersession has to actually move.
        ...['view', 'edit'].map((action) => ({
          organizationId: org,
          roleId: repRole,
          module: 'leads',
          action,
          scope: 'SELF' as const,
        })),
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
      data: [adminRole, repRole].map((roleId) => ({
        organizationId: org,
        roleId,
        journeyId: journey,
      })),
    });
    await prisma.status.createMany({
      data: [
        [sourceStatus, 'synthetic_source', 'open', 0],
        [otherStatus, 'synthetic_other', 'open', 2],
        // Terminal: leads here must not count as load.
        [closedStatus, 'synthetic_closed', 'closed_won', 3],
      ].map(([id, key, outcomeType, sortOrder]) => ({
        id: id as string,
        organizationId: org,
        journeyId: journey,
        key: key as string,
        name: `Status ${key as string}`,
        outcomeType: outcomeType as 'open' | 'closed_won',
        behaviorType: 'default' as const,
        sortOrder: sortOrder as number,
      })),
    });
    // The admin role is granted routing on every status; per-status grants for
    // other roles are added by the tests that care about them.
    await prisma.statusRoutingPermission.createMany({
      data: [sourceStatus, otherStatus, closedStatus].flatMap((statusId) =>
        ['view', 'configure', 'operate'].map((action) => ({
          organizationId: org,
          statusId,
          roleId: adminRole,
          action,
        })),
      ),
    });
  }, 180_000);

  beforeEach(async () => {
    routedStatus = randomUUID();
    await prisma.status.create({
      data: {
        id: routedStatus,
        organizationId: org,
        journeyId: journey,
        key: `synthetic_routed_${routedStatus.replaceAll('-', '')}`,
        name: 'Routed status',
        outcomeType: 'open',
        behaviorType: 'default',
        sortOrder: 10,
      },
    });
    await prisma.statusRoutingPermission.createMany({
      data: ['view', 'configure', 'operate'].map((action) => ({
        organizationId: org,
        statusId: routedStatus,
        roleId: adminRole,
        action,
      })),
    });
  });

  afterAll(async () => {
    await db?.cleanup();
  });

  /* ---------------------------------------------------------------------- */
  /* The core security assertion.                                           */
  /* ---------------------------------------------------------------------- */

  it('takes the lead away from the previous holder on every surface at once', async () => {
    const lead = await seedLead(repA);
    expect(
      (
        await putRule({
          assignmentType,
          algorithm: 'round_robin',
          poolType: 'users',
          userIds: [repB],
        })
      ).statusCode,
    ).toBe(200);

    // Baseline, so the after-assertion is not vacuous: repA holds it, repB does
    // not.
    const beforeA = await repSees(repA, lead.leadId);
    const beforeB = await repSees(repB, lead.leadId);
    expect(beforeA.list.body).toContain(lead.leadId);
    expect(beforeA.detail.statusCode).toBe(200);
    expect(beforeB.list.body).not.toContain(lead.leadId);
    expect(beforeB.detail.statusCode).toBe(403);

    expect((await moveToStatus(lead, routedStatus)).statusCode).toBe(200);

    const afterA = await repSees(repA, lead.leadId);
    const afterB = await repSees(repB, lead.leadId);

    // Gone from the previous holder, on all three surfaces. The list assertion
    // is on the whole response body: the id must not appear anywhere in it, in
    // any shape.
    expect(afterA.list.statusCode).toBe(200);
    expect(afterA.list.body).not.toContain(lead.leadId);
    expect(afterA.detail.statusCode).toBe(403);
    expect(afterA.decision.allowed).toBe(false);
    expect(afterA.decision.deniedReasons).toContain('RECORD_SCOPE_DENIED');

    // …and arrived at the new one, on all three.
    expect(afterB.list.body).toContain(lead.leadId);
    expect(afterB.detail.statusCode).toBe(200);
    expect(afterB.decision.allowed).toBe(true);

    // Superseded, not duplicated: exactly one live assignment of this type.
    const rows = await prisma.assignment.findMany({
      where: { organizationId: org, processInstanceId: lead.processInstanceId, assignmentType },
      select: { userId: true, isCurrent: true },
    });
    expect(rows.filter((row) => row.isCurrent)).toEqual([{ userId: repB, isCurrent: true }]);
    expect(rows.filter((row) => !row.isCurrent)).toEqual([{ userId: repA, isCurrent: false }]);

    // Both holders are in the timeline, in the shape Phase 9's
    // `previous_assignment_holder` resolver reads.
    const activity = await prisma.activityLog.findFirst({
      where: { organizationId: org, leadId: lead.leadId, actionType: 'reassignment' },
    });
    expect(activity?.oldValue).toEqual({ assignmentType, userId: repA });
    expect(activity?.newValue).toEqual({ assignmentType, userId: repB });
    expect(activity?.source).toBe('routing');
  }, 120_000);

  it('leaves a live share intact — the one documented way a previous holder still sees it', async () => {
    const lead = await seedLead(repA);
    await putRule({ assignmentType, algorithm: 'round_robin', poolType: 'users', userIds: [repB] });
    await prisma.userAccessGrant.create({
      data: {
        organizationId: org,
        leadId: lead.leadId,
        userId: repA,
        grantedByUserId: adminUser,
        actions: ['view'],
      },
    });

    await moveToStatus(lead, routedStatus);

    // The assignment is gone…
    expect(await currentOwner(lead.processInstanceId)).toEqual({ userId: repB });
    // …but the share is an independent OR branch, so access survives. Asserted
    // so the boundary is documented by a test rather than found as a surprise.
    const after = await repSees(repA, lead.leadId);
    expect(after.detail.statusCode).toBe(200);
    expect(after.list.body).toContain(lead.leadId);
  }, 120_000);

  /* ---------------------------------------------------------------- Firing */

  it('fires on an exact status match only, and not on creation or a journey move', async () => {
    await putRule({ assignmentType, algorithm: 'round_robin', poolType: 'users', userIds: [repB] });

    const wrongStatus = await seedLead(repA);
    await moveToStatus(wrongStatus, otherStatus);
    expect(await currentOwner(wrongStatus.processInstanceId)).toEqual({ userId: repA });

    // Creation lands in a status without a `status_change` activity, so routing
    // does not fire. Asserted as current behaviour so changing it is deliberate.
    const created = await call(asAdmin(), 'POST', '/api/v1/leads', {
      journeyId: journey,
      statusId: routedStatus,
      name: 'Synthetic created-into-routed lead',
      assignments: [{ assignmentType, userId: repA }],
      assignmentTypes: [assignmentType],
    });
    expect(created.statusCode).toBe(201);
    const createdProcess = (JSON.parse(created.body) as { process: { id: string } }).process;
    expect(await currentOwner(createdProcess.id)).toEqual({ userId: repA });

    const right = await seedLead(repA);
    await moveToStatus(right, routedStatus);
    expect(await currentOwner(right.processInstanceId)).toEqual({ userId: repB });
  }, 120_000);

  it('assigns once per transition and does not re-enter through its own reassignment', async () => {
    const lead = await seedLead(repA);
    await putRule({ assignmentType, algorithm: 'round_robin', poolType: 'users', userIds: [repB] });
    await moveToStatus(lead, routedStatus);

    // One hop: the `reassignment` routing writes dispatches `lead_reassigned`,
    // which routing ignores. A loop would show up as extra activities and extra
    // superseded assignment rows.
    expect(
      await prisma.activityLog.count({
        where: { organizationId: org, leadId: lead.leadId, actionType: 'reassignment' },
      }),
    ).toBe(1);
    expect(
      await prisma.assignment.count({
        where: { organizationId: org, processInstanceId: lead.processInstanceId },
      }),
    ).toBe(2);
  }, 120_000);

  it('skips without assigning, and still commits the status change', async () => {
    const dormantTeam = randomUUID();
    await prisma.team.create({
      data: {
        id: dormantTeam,
        organizationId: org,
        departmentId: department,
        key: `synthetic_dormant_${dormantTeam.replaceAll('-', '')}`,
        name: 'Dormant team',
      },
    });
    await prisma.teamMember.create({
      data: {
        organizationId: org,
        teamId: dormantTeam,
        departmentId: department,
        userId: repB,
        isLeader: true,
      },
    });
    expect(
      (
        await putRule({
          assignmentType,
          algorithm: 'round_robin',
          poolType: 'team',
          teamId: dormantTeam,
        })
      ).statusCode,
    ).toBe(200);
    // Deactivated *after* the rule exists — the sequence 14a's leaderless
    // cascade actually produces, and the one that leaves a rule pointing at an
    // unusable pool.
    await prisma.team.update({
      where: { organizationId_id: { organizationId: org, id: dormantTeam } },
      data: { active: false },
    });

    const lead = await seedLead(repA);
    const moved = await moveToStatus(lead, routedStatus);

    // The status change commits — an admin's unusable pool must not reject an
    // ordinary user's edit.
    expect(moved.statusCode).toBe(200);
    expect(
      await prisma.processInstance.findFirst({
        where: { organizationId: org, id: lead.processInstanceId },
        select: { currentStatusId: true },
      }),
    ).toEqual({ currentStatusId: routedStatus });
    // The lead keeps the assignment it had, and the skip is on the record.
    expect(await currentOwner(lead.processInstanceId)).toEqual({ userId: repA });
    const skip = await prisma.activityLog.findFirst({
      where: { organizationId: org, leadId: lead.leadId, actionType: 'routing_skipped' },
    });
    expect(skip?.newValue).toEqual({ reason: 'inactive_team' });
  }, 120_000);

  /* ------------------------------------------------------------ Algorithms */

  it('distributes evenly under genuinely concurrent round-robin triggers', async () => {
    const candidates = await Promise.all(['rr-a', 'rr-b', 'rr-c'].map(makeRep));
    await putRule({
      assignmentType,
      algorithm: 'round_robin',
      poolType: 'users',
      userIds: candidates,
    });
    // Six leads, none owned by a pool member, so every assignment is a real
    // move and no pick can be a no-op.
    const leads = await Promise.all([1, 2, 3, 4, 5, 6].map(() => seedLead(adminUser)));

    const responses = await Promise.all(leads.map((lead) => moveToStatus(lead, routedStatus)));
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);

    const owners = await prisma.assignment.groupBy({
      by: ['userId'],
      where: {
        organizationId: org,
        isCurrent: true,
        assignmentType,
        processInstanceId: { in: leads.map((lead) => lead.processInstanceId) },
      },
      _count: { _all: true },
    });
    // Six leads across three candidates: exactly two each. Two transactions
    // reading the same cursor would show up here as 3/2/1 or worse.
    expect(owners.map((row) => row._count._all).sort()).toEqual([2, 2, 2]);
    expect(owners).toHaveLength(3);
  }, 180_000);

  it('does not hand every concurrent least-loaded pick to the same candidate', async () => {
    /*
     * Dedicated candidates, so all three genuinely start on zero.
     *
     * With shared users this assertion would be wrong rather than flaky: if one
     * candidate starts several leads lighter than the others, sending it every
     * one of three leads is the *correct* answer, and the test would fail while
     * the code was right. Equal starting load is what makes "one each" the only
     * correct outcome.
     */
    const candidates = await Promise.all(['even-a', 'even-b', 'even-c'].map(makeRep));
    await putRule({
      assignmentType,
      algorithm: 'least_loaded',
      poolType: 'users',
      userIds: candidates,
    });
    const leads = await Promise.all([1, 2, 3].map(() => seedLead(adminUser)));

    const responses = await Promise.all(leads.map((lead) => moveToStatus(lead, routedStatus)));
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);

    // Concurrent transactions reading the same counts would give one candidate
    // all three; serializing on the rule row gives one each.
    const owners = await prisma.assignment.findMany({
      where: {
        organizationId: org,
        isCurrent: true,
        assignmentType,
        processInstanceId: { in: leads.map((lead) => lead.processInstanceId) },
      },
      select: { userId: true },
    });
    expect(new Set(owners.map((row) => row.userId)).size).toBe(3);
  }, 180_000);

  it('counts only open assignments of its own type when measuring load', async () => {
    // Dedicated users: the pool's counts are the whole point of this test, so
    // they must not include load another test happened to create.
    const [busy, light] = await Promise.all(['busy', 'light'].map(makeRep));

    // `busy` is buried in terminal leads and in a different assignment type;
    // neither is load, so `busy` must still be picked over `light`.
    for (let i = 0; i < 5; i += 1) {
      const closed = await seedLead(busy!);
      await prisma.processInstance.update({
        where: { organizationId_id: { organizationId: org, id: closed.processInstanceId } },
        data: { currentStatusId: closedStatus },
      });
    }
    const otherType = await seedLead(adminUser);
    await prisma.assignment.create({
      data: {
        organizationId: org,
        processInstanceId: otherType.processInstanceId,
        assignmentType: 'synthetic_collaborator',
        userId: busy!,
      },
    });
    // `light` carries one genuinely open lead of the routed type.
    await seedLead(light!);

    await putRule({
      assignmentType,
      algorithm: 'least_loaded',
      poolType: 'users',
      userIds: [busy!, light!],
    });
    const lead = await seedLead(adminUser);
    await moveToStatus(lead, routedStatus);
    expect(await currentOwner(lead.processInstanceId)).toEqual({ userId: busy });
  }, 120_000);

  it('routes to a 14a Team pool and skips a member who has been deactivated', async () => {
    const team = randomUUID();
    await prisma.team.create({
      data: {
        id: team,
        organizationId: org,
        departmentId: department,
        key: 'synthetic_routing_team',
        name: 'Routing team',
      },
    });
    await prisma.teamMember.createMany({
      data: [repB, repC].map((userId) => ({
        organizationId: org,
        teamId: team,
        departmentId: department,
        userId,
        isLeader: userId === repB,
      })),
    });
    await putRule({ assignmentType, algorithm: 'round_robin', poolType: 'team', teamId: team });

    const first = await seedLead(adminUser);
    await moveToStatus(first, routedStatus);
    const firstOwner = await currentOwner(first.processInstanceId);
    expect([repB, repC]).toContain(firstOwner?.userId);

    // 14a ends the memberships of a deactivated user, so the pool shrinks
    // without routing needing to know why.
    await call(asAdmin(), 'POST', `/api/v1/users/${repC}/deactivate`);
    const second = await seedLead(adminUser);
    await moveToStatus(second, routedStatus);
    expect(await currentOwner(second.processInstanceId)).toEqual({ userId: repB });

    await prisma.user.update({
      where: { organizationId_id: { organizationId: org, id: repC } },
      data: { active: true },
    });
  }, 120_000);

  /* ---------------------------------------------------------- Permissions */

  it('requires configure and operate independently, and both on top of the per-status grant', async () => {
    await putRule({ assignmentType, algorithm: 'round_robin', poolType: 'users', userIds: [repB] });
    const lead = await seedLead(repA);

    // The rep holds leads:edit but no `lead_routing` action at all.
    for (const [method, url, payload] of [
      ['GET', `/api/v1/statuses/${routedStatus}/routing`, undefined],
      [
        'PUT',
        `/api/v1/statuses/${routedStatus}/routing`,
        { assignmentType, algorithm: 'round_robin', poolType: 'users', userIds: [repB] },
      ],
      ['POST', `/api/v1/statuses/${routedStatus}/routing/deactivate`, undefined],
    ] as const) {
      const response = await call(asRep(repA), method, url, payload);
      expect({ url, status: response.statusCode }).toEqual({ url, status: 403 });
    }

    // Give the rep the module action but no per-status grant: still refused.
    // This is the layer that makes one journey's statuses separately operable.
    await prisma.rolePermission.create({
      data: {
        organizationId: org,
        roleId: repRole,
        module: 'lead_routing',
        action: 'operate',
        scope: 'ORGANIZATION',
      },
    });
    const withoutGrant = await call(
      asRep(repA),
      'POST',
      `/api/v1/leads/${lead.leadId}/routing-assign`,
      {
        processInstanceId: lead.processInstanceId,
        statusId: routedStatus,
        assignmentTypes: [assignmentType],
      },
    );
    expect(withoutGrant.statusCode).toBe(403);

    // Grant it on this status only, and the same call succeeds.
    await prisma.statusRoutingPermission.create({
      data: { organizationId: org, statusId: routedStatus, roleId: repRole, action: 'operate' },
    });
    const withGrant = await call(
      asRep(repA),
      'POST',
      `/api/v1/leads/${lead.leadId}/routing-assign`,
      {
        processInstanceId: lead.processInstanceId,
        statusId: routedStatus,
        assignmentTypes: [assignmentType],
      },
    );
    expect(withGrant.statusCode).toBe(200);
    expect(await currentOwner(lead.processInstanceId)).toEqual({ userId: repB });

    // `operate` is an additional gate, never a replacement: the same rep cannot
    // reach a lead outside their own record scope, even holding it.
    const foreignLead = await seedLead(repC);
    const outOfScope = await call(
      asRep(repA),
      'POST',
      `/api/v1/leads/${foreignLead.leadId}/routing-assign`,
      {
        processInstanceId: foreignLead.processInstanceId,
        statusId: routedStatus,
        assignmentTypes: [assignmentType],
      },
    );
    expect(outOfScope.statusCode).toBe(403);
    expect(await currentOwner(foreignLead.processInstanceId)).toEqual({ userId: repC });

    await prisma.statusRoutingPermission.deleteMany({
      where: { organizationId: org, roleId: repRole },
    });
    await prisma.rolePermission.deleteMany({
      where: { organizationId: org, roleId: repRole, module: 'lead_routing' },
    });
  }, 120_000);

  it('gates the per-status grant editor on permissions administration, not on routing configuration', async () => {
    // A role that can configure routing but cannot edit permissions must not be
    // able to grant itself routing rights — the self-escalation `field_visibility`
    // already refuses.
    const configuratorRole = randomUUID();
    const configurator = randomUUID();
    await prisma.role.create({
      data: {
        id: configuratorRole,
        organizationId: org,
        key: 'synthetic_configurator',
        name: 'Routing configurator',
      },
    });
    await prisma.rolePermission.createMany({
      data: ['view', 'configure'].map((action) => ({
        organizationId: org,
        roleId: configuratorRole,
        module: 'lead_routing',
        action,
        scope: 'ORGANIZATION' as const,
      })),
    });
    await prisma.statusRoutingPermission.createMany({
      data: ['view', 'configure'].map((action) => ({
        organizationId: org,
        statusId: routedStatus,
        roleId: configuratorRole,
        action,
      })),
    });
    await prisma.user.create({
      data: {
        id: configurator,
        organizationId: org,
        name: 'Synthetic configurator',
        email: 'configurator@example.test',
        roleId: configuratorRole,
        departmentId: department,
      },
    });
    const asConfigurator = { userId: configurator, roleId: configuratorRole };

    // It can configure the rule…
    expect(
      (
        await call(asConfigurator, 'PUT', `/api/v1/statuses/${routedStatus}/routing`, {
          assignmentType,
          algorithm: 'round_robin',
          poolType: 'users',
          userIds: [repB],
        })
      ).statusCode,
    ).toBe(200);
    // …and cannot read or write the grants that decide who may operate it.
    expect(
      (await call(asConfigurator, 'GET', `/api/v1/statuses/${routedStatus}/routing/permissions`))
        .statusCode,
    ).toBe(403);
    const escalation = await call(
      asConfigurator,
      'PUT',
      `/api/v1/statuses/${routedStatus}/routing/permissions`,
      { permissions: [{ roleId: configuratorRole, action: 'operate' }] },
    );
    expect(escalation.statusCode).toBe(403);
    expect(
      await prisma.statusRoutingPermission.count({
        where: { organizationId: org, roleId: configuratorRole, action: 'operate' },
      }),
    ).toBe(0);
  }, 120_000);

  it('replaces a Status’s grant set wholesale, bumps every affected role, and audits both sides', async () => {
    const before = await prisma.role.findFirst({
      where: { organizationId: org, id: repRole },
      select: { version: true },
    });
    const replaced = await call(
      asAdmin(),
      'PUT',
      `/api/v1/statuses/${routedStatus}/routing/permissions`,
      {
        permissions: [
          { roleId: repRole, action: 'view' },
          { roleId: repRole, action: 'operate' },
        ],
      },
    );
    expect(replaced.statusCode).toBe(200);

    const cleared = await call(
      asAdmin(),
      'PUT',
      `/api/v1/statuses/${routedStatus}/routing/permissions`,
      { permissions: [] },
    );
    expect(cleared.statusCode).toBe(200);
    expect(
      await prisma.statusRoutingPermission.count({
        where: { organizationId: org, statusId: routedStatus, roleId: repRole },
      }),
    ).toBe(0);

    // A role losing a grant is bumped too, or its cached decisions would look
    // unchanged.
    const after = await prisma.role.findFirst({
      where: { organizationId: org, id: repRole },
      select: { version: true },
    });
    expect(after!.version).toBeGreaterThan(before!.version);

    const audit = await prisma.systemAuditLog.findFirst({
      where: {
        organizationId: org,
        entityType: 'status_routing_permission',
        entityId: routedStatus,
      },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit?.oldValue).toEqual([
      { roleId: repRole, action: 'operate' },
      { roleId: repRole, action: 'view' },
    ]);
    expect(audit?.newValue).toEqual([]);
  }, 120_000);

  it('audits rule configuration and isolates tenants', async () => {
    expect(
      (
        await putRule({
          assignmentType,
          algorithm: 'round_robin',
          poolType: 'users',
          userIds: [repB],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call(asAdmin(), 'POST', `/api/v1/statuses/${routedStatus}/routing/deactivate`))
        .statusCode,
    ).toBe(200);
    const audits = await prisma.systemAuditLog.findMany({
      where: { organizationId: org, entityType: 'status_routing_rule', entityId: routedStatus },
      orderBy: { timestamp: 'asc' },
    });
    expect(audits.map((row) => row.action)).toEqual(['replace', 'deactivate']);

    // A deactivated rule stops firing without being deleted.
    const lead = await seedLead(repA);
    await moveToStatus(lead, routedStatus);
    expect(await currentOwner(lead.processInstanceId)).toEqual({ userId: repA });

    expect(
      (await call(asAdmin(), 'GET', `/api/v1/statuses/${randomUUID()}/routing`)).statusCode,
    ).toBe(403);
    const foreignPool = await putRule({
      assignmentType,
      algorithm: 'round_robin',
      poolType: 'users',
      userIds: [foreignUser],
    });
    expect(foreignPool.statusCode).toBe(400);
    expect(JSON.parse(foreignPool.body)).toMatchObject({ details: { userIds: [foreignUser] } });
  }, 120_000);
});
