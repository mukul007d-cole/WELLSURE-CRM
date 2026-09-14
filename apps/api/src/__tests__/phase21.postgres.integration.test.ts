import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';
import { resolveAuthorization } from '@falcon/permission-engine';

import { PrismaAdminRepository } from '../admin/prisma-admin-repository.js';
import { PrismaConfigurationRepository } from '../configuration/prisma-configuration-repository.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { PrismaAuthRepository } from '../auth/prisma-auth-repository.js';
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
 * Phase 21 Part 2 — post-reassignment grace visibility.
 *
 * The assertions this file exists for, beyond what `phase9`/`phase14b`
 * already extend for the mechanics of manual reassignment and routing: (1)
 * the outgoing owner's opt-in *and* their Role's eligibility are both
 * required, checked live, for both reassignment paths; (2) eligibility
 * revoked at the Role level stops *new* grants without touching ones
 * already issued; (3) the self-service preference endpoint enforces
 * eligibility server-side and audits every change; (4) expiry actually
 * stops access, not just the column; (5) the grace grant survives Status
 * Visibility's routing-based narrowing — the exact scenario it exists for,
 * and the Phase 21 fix to `decision.ts`/`filter-sql.ts` this depends on;
 * (6) cross-organization isolation throughout.
 *
 * Every name is synthetic. Nothing may depend on a real journey, status,
 * role, department or person name (`AGENTS.md`).
 */
describe.runIf(shouldRunAdminPostgres)('Phase 21 Part 2 — reassignment grace visibility', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  const otherOrg = randomUUID();
  const adminRole = randomUUID();
  const eligibleRole = randomUUID();
  const ineligibleRole = randomUUID();
  const otherOrgRole = randomUUID();

  const adminUser = randomUUID();
  const newOwner = randomUUID();
  const otherOrgUser = randomUUID();

  const department = randomUUID();
  const journeyId = randomUUID();
  const openStatus = randomUUID();
  const routedStatus = randomUUID();
  const assignmentType = 'synthetic_owner';

  const serverFor = (userId: string, roleId: string, organizationId: string) => {
    const realAuthRepository = new PrismaAuthRepository(prisma);
    return buildServer({
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
            departmentId: organizationId === org ? department : null,
            managerId: null,
          }),
        // Real, not synthetic: `PATCH /auth/preferences` needs an actual
        // write path (and audit trail), which the class above owns.
        setRetainViewAfterReassignment:
          realAuthRepository.setRetainViewAfterReassignment.bind(realAuthRepository),
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
  };

  const call = async (
    actor: { userId: string; roleId: string; organizationId: string },
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    payload?: unknown,
  ) => {
    const server = serverFor(actor.userId, actor.roleId, actor.organizationId);
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

  const asAdmin = () => ({ userId: adminUser, roleId: adminRole, organizationId: org });

  /** A fresh lead assigned to `ownerId`, in `statusId`. */
  const seedLead = async (ownerId: string, statusId: string, organizationId = org) => {
    const leadId = randomUUID();
    const processInstanceId = randomUUID();
    await prisma.lead.create({
      data: { id: leadId, organizationId, name: `Synthetic lead ${leadId.slice(0, 8)}` },
    });
    await prisma.processInstance.create({
      data: {
        id: processInstanceId,
        organizationId,
        leadId,
        journeyId,
        currentStatusId: statusId,
        isPrimary: true,
      },
    });
    await prisma.assignment.create({
      data: { organizationId, processInstanceId, assignmentType, userId: ownerId },
    });
    return { leadId, processInstanceId };
  };

  /** A fresh user, opted in or not, under `roleId`. */
  const makeUser = async (roleId: string, retainViewAfterReassignment: boolean) => {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        organizationId: org,
        name: `Synthetic user ${id.slice(0, 8)}`,
        email: `user-${id.slice(0, 8)}@example.test`,
        roleId,
        departmentId: department,
        retainViewAfterReassignment,
      },
    });
    return id;
  };

  const activeGrant = (leadId: string, userId: string) =>
    prisma.userAccessGrant.findFirst({
      where: { organizationId: org, leadId, userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
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
        {
          id: eligibleRole,
          organizationId: org,
          key: 'synthetic_eligible',
          name: 'Synthetic eligible rep',
        },
        {
          id: ineligibleRole,
          organizationId: org,
          key: 'synthetic_ineligible',
          name: 'Synthetic ineligible rep',
        },
        // Same key/name as `eligibleRole` on purpose, in a different
        // organization — proves eligibility never leaks across the
        // `(organizationId, roleId)` compound key by coincidence of naming.
        {
          id: otherOrgRole,
          organizationId: otherOrg,
          key: 'synthetic_eligible',
          name: 'Synthetic eligible rep',
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
        {
          id: newOwner,
          organizationId: org,
          name: 'Synthetic new owner',
          email: 'new-owner@example.test',
          roleId: eligibleRole,
          departmentId: department,
        },
        {
          id: otherOrgUser,
          organizationId: otherOrg,
          name: 'Synthetic other-org user',
          email: 'other-org@example.test',
          roleId: otherOrgRole,
          retainViewAfterReassignment: true,
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
        ...['view', 'edit'].map((action) => ({
          organizationId: org,
          roleId: eligibleRole,
          module: 'leads',
          action,
          scope: 'SELF' as const,
        })),
        {
          organizationId: org,
          roleId: eligibleRole,
          module: 'leads',
          action: 'retain_view_after_reassignment',
          scope: 'SELF' as const,
        },
        ...['view', 'edit'].map((action) => ({
          organizationId: org,
          roleId: ineligibleRole,
          module: 'leads',
          action,
          scope: 'SELF' as const,
        })),
        // `otherOrg`'s identically-keyed role never grants this action —
        // the cross-org isolation test relies on that absence.
      ],
    });
    await prisma.journey.create({
      data: {
        id: journeyId,
        organizationId: org,
        key: 'synthetic_journey',
        name: 'Synthetic journey',
      },
    });
    await prisma.roleJourneyAccess.createMany({
      data: [adminRole, eligibleRole, ineligibleRole].map((roleId) => ({
        organizationId: org,
        roleId,
        journeyId,
      })),
    });
    await prisma.status.createMany({
      data: [
        { id: openStatus, key: 'synthetic_open', sortOrder: 0 },
        { id: routedStatus, key: 'synthetic_routed', sortOrder: 1 },
      ].map(({ id, key, sortOrder }) => ({
        id,
        organizationId: org,
        journeyId,
        key,
        name: `Status ${key}`,
        outcomeType: 'open' as const,
        behaviorType: 'default' as const,
        sortOrder,
      })),
    });
    await prisma.statusRoutingPermission.createMany({
      data: [openStatus, routedStatus].flatMap((statusId) =>
        ['view', 'configure', 'operate'].map((action) => ({
          organizationId: org,
          statusId,
          roleId: adminRole,
          action,
        })),
      ),
    });
    await prisma.statusRoutingRule.create({
      data: {
        organizationId: org,
        journeyId,
        statusId: routedStatus,
        active: true,
        algorithm: 'round_robin',
        poolType: 'users',
        assignmentType,
        members: { create: { userId: newOwner } },
      },
    });
  }, 180_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  /* ------------------------------------------------------------------ */
  /* Manual reassignment                                                 */
  /* ------------------------------------------------------------------ */

  it('grants view-only access to an opted-in, eligible previous owner on manual reassignment', async () => {
    const sharing = new LeadSharingService(prisma);
    const previousOwner = await makeUser(eligibleRole, true);
    const lead = await seedLead(previousOwner, openStatus);

    await sharing.reassign({
      organizationId: org,
      leadId: lead.leadId,
      processInstanceId: lead.processInstanceId,
      assignmentType,
      userId: newOwner,
      actorUserId: adminUser,
    });

    const grant = await activeGrant(lead.leadId, previousOwner);
    expect(grant).not.toBeNull();
    expect(grant?.actions).toEqual(['view']);
    expect(grant?.expiresAt).not.toBeNull();
    const daysOut = (grant!.expiresAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(29);
    expect(daysOut).toBeLessThan(31);

    const activity = await prisma.activityLog.findFirst({
      where: { organizationId: org, leadId: lead.leadId, actionType: 'share_changed' },
      orderBy: { timestamp: 'desc' },
    });
    expect(activity?.newValue).toMatchObject({
      userId: previousOwner,
      automatic: true,
      reason: 'reassignment_grace_period',
    });
  });

  it('grants nothing when the previous owner did not opt in', async () => {
    const sharing = new LeadSharingService(prisma);
    const previousOwner = await makeUser(eligibleRole, false);
    const lead = await seedLead(previousOwner, openStatus);

    await sharing.reassign({
      organizationId: org,
      leadId: lead.leadId,
      processInstanceId: lead.processInstanceId,
      assignmentType,
      userId: newOwner,
      actorUserId: adminUser,
    });

    expect(await activeGrant(lead.leadId, previousOwner)).toBeNull();
  });

  it('grants nothing when the previous owner opted in but their Role is not eligible', async () => {
    const sharing = new LeadSharingService(prisma);
    const previousOwner = await makeUser(ineligibleRole, true);
    const lead = await seedLead(previousOwner, openStatus);

    await sharing.reassign({
      organizationId: org,
      leadId: lead.leadId,
      processInstanceId: lead.processInstanceId,
      assignmentType,
      userId: newOwner,
      actorUserId: adminUser,
    });

    expect(await activeGrant(lead.leadId, previousOwner)).toBeNull();
  });

  it('grants nothing on a same-user "reassignment" — no genuine change of holder', async () => {
    const sharing = new LeadSharingService(prisma);
    const previousOwner = await makeUser(eligibleRole, true);
    const lead = await seedLead(previousOwner, openStatus);

    await sharing.reassign({
      organizationId: org,
      leadId: lead.leadId,
      processInstanceId: lead.processInstanceId,
      assignmentType,
      userId: previousOwner,
      actorUserId: adminUser,
    });

    expect(await activeGrant(lead.leadId, previousOwner)).toBeNull();
  });

  it('does not duplicate or renew an already-active grant on this lead', async () => {
    const sharing = new LeadSharingService(prisma);
    const previousOwner = await makeUser(eligibleRole, true);
    const lead = await seedLead(previousOwner, openStatus);
    // A short-lived pre-existing grant, standing in for "already has view
    // access some other way" — not renewed as a side effect of reassignment.
    await prisma.userAccessGrant.create({
      data: {
        organizationId: org,
        leadId: lead.leadId,
        userId: previousOwner,
        grantedByUserId: adminUser,
        actions: ['view'],
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await sharing.reassign({
      organizationId: org,
      leadId: lead.leadId,
      processInstanceId: lead.processInstanceId,
      assignmentType,
      userId: newOwner,
      actorUserId: adminUser,
    });

    const grants = await prisma.userAccessGrant.findMany({
      where: { organizationId: org, leadId: lead.leadId, userId: previousOwner, revokedAt: null },
    });
    expect(grants).toHaveLength(1);
    // Untouched — not extended to a fresh 30 days.
    expect(grants[0]!.expiresAt!.getTime()).toBeLessThan(Date.now() + 61_000);
  });

  /* ------------------------------------------------------------------ */
  /* Automatic Status-Routing reassignment                               */
  /* ------------------------------------------------------------------ */

  it('grants view-only access to an opted-in, eligible previous owner on automatic routing reassignment', async () => {
    const previousOwner = await makeUser(eligibleRole, true);
    const lead = await seedLead(previousOwner, openStatus);

    const moved = await call(asAdmin(), 'PATCH', `/api/v1/leads/${lead.leadId}`, {
      processInstanceId: lead.processInstanceId,
      journeyId,
      statusId: routedStatus,
      assignmentTypes: [assignmentType],
    });
    expect(moved.statusCode).toBe(200);
    expect(
      await prisma.assignment.findFirst({
        where: {
          organizationId: org,
          processInstanceId: lead.processInstanceId,
          assignmentType,
          isCurrent: true,
        },
        select: { userId: true },
      }),
    ).toEqual({ userId: newOwner });

    const grant = await activeGrant(lead.leadId, previousOwner);
    expect(grant).not.toBeNull();
    expect(grant?.actions).toEqual(['view']);
  });

  it('grants nothing on routing reassignment when not opted in or not eligible', async () => {
    const notOptedIn = await makeUser(eligibleRole, false);
    const leadA = await seedLead(notOptedIn, openStatus);
    const ineligible = await makeUser(ineligibleRole, true);
    const leadB = await seedLead(ineligible, openStatus);

    await Promise.all([
      call(asAdmin(), 'PATCH', `/api/v1/leads/${leadA.leadId}`, {
        processInstanceId: leadA.processInstanceId,
        journeyId,
        statusId: routedStatus,
        assignmentTypes: [assignmentType],
      }),
      call(asAdmin(), 'PATCH', `/api/v1/leads/${leadB.leadId}`, {
        processInstanceId: leadB.processInstanceId,
        journeyId,
        statusId: routedStatus,
        assignmentTypes: [assignmentType],
      }),
    ]);

    expect(await activeGrant(leadA.leadId, notOptedIn)).toBeNull();
    expect(await activeGrant(leadB.leadId, ineligible)).toBeNull();
  });

  /* ------------------------------------------------------------------ */
  /* The Status Visibility interaction this feature exists for           */
  /* ------------------------------------------------------------------ */

  it('the grace grant survives Status Visibility’s routing-based narrowing (Phase 21 fix)', async () => {
    // `previousOwner` is not `newOwner`'s manager, so once routing reassigns
    // the lead, ordinary Status Visibility would exclude them entirely — the
    // exact scenario this feature exists for. The grant, once created, is
    // its own individual-record exception to that narrowing (Phase 21's
    // decision.ts/filter-sql.ts fix), so it must survive it, not be
    // silently defeated by it.
    const previousOwner = await makeUser(eligibleRole, true);
    const lead = await seedLead(previousOwner, openStatus);

    expect(
      (
        await call(asAdmin(), 'PATCH', `/api/v1/leads/${lead.leadId}`, {
          processInstanceId: lead.processInstanceId,
          journeyId,
          statusId: routedStatus,
          assignmentTypes: [assignmentType],
        })
      ).statusCode,
    ).toBe(200);

    const grant = await activeGrant(lead.leadId, previousOwner);
    expect(grant).not.toBeNull();

    const decision = await resolveAuthorization({
      repository: new PrismaPermissionRepository(prisma as never),
      request: {
        organizationId: org,
        userId: previousOwner,
        module: 'leads',
        action: 'view',
        journeyId,
        statusId: routedStatus,
        leadId: lead.leadId,
        assignmentTypes: [assignmentType],
      },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.deniedReasons).toEqual([]);
    expect(decision.directGrantId).toBe(grant!.id);

    const detail = await call(
      { userId: previousOwner, roleId: eligibleRole, organizationId: org },
      'GET',
      `/api/v1/leads/${lead.leadId}?assignmentTypes=${assignmentType}`,
    );
    expect(detail.statusCode).toBe(200);
  });

  /* ------------------------------------------------------------------ */
  /* Eligibility revoked: honored to natural expiry, not retroactive     */
  /* ------------------------------------------------------------------ */

  it('honors an already-issued grant after the Role loses eligibility, but stops issuing new ones', async () => {
    const temporarilyEligibleRole = randomUUID();
    await prisma.role.create({
      data: {
        id: temporarilyEligibleRole,
        organizationId: org,
        key: `synthetic_temp_${temporarilyEligibleRole.replaceAll('-', '')}`,
        name: 'Synthetic temporarily-eligible role',
      },
    });
    await prisma.rolePermission.createMany({
      data: [
        { module: 'leads', action: 'view', scope: 'SELF' as const },
        { module: 'leads', action: 'edit', scope: 'SELF' as const },
        { module: 'leads', action: 'retain_view_after_reassignment', scope: 'SELF' as const },
      ].map((row) => ({ organizationId: org, roleId: temporarilyEligibleRole, ...row })),
    });
    await prisma.roleJourneyAccess.create({
      data: { organizationId: org, roleId: temporarilyEligibleRole, journeyId },
    });
    const previousOwner = await makeUser(temporarilyEligibleRole, true);
    const firstLead = await seedLead(previousOwner, openStatus);

    const sharing = new LeadSharingService(prisma);
    await sharing.reassign({
      organizationId: org,
      leadId: firstLead.leadId,
      processInstanceId: firstLead.processInstanceId,
      assignmentType,
      userId: newOwner,
      actorUserId: adminUser,
    });
    const firstGrant = await activeGrant(firstLead.leadId, previousOwner);
    expect(firstGrant).not.toBeNull();

    // Admin revokes the Role's eligibility — a plain permission replacement,
    // the same mechanism (and audit trail) every other catalog action uses.
    const revoke = await call(
      asAdmin(),
      'PUT',
      `/api/v1/roles/${temporarilyEligibleRole}/permissions`,
      {
        permissions: [
          { module: 'leads', action: 'view', scope: 'SELF' },
          { module: 'leads', action: 'edit', scope: 'SELF' },
        ],
      },
    );
    expect(revoke.statusCode).toBe(200);

    // The grant already issued is untouched — honored to its natural expiry,
    // not retroactively revoked.
    const stillActive = await activeGrant(firstLead.leadId, previousOwner);
    expect(stillActive?.id).toBe(firstGrant!.id);
    expect(stillActive?.revokedAt).toBeNull();

    // A *new* reassignment, after eligibility was revoked, grants nothing.
    const secondLead = await seedLead(previousOwner, openStatus);
    await sharing.reassign({
      organizationId: org,
      leadId: secondLead.leadId,
      processInstanceId: secondLead.processInstanceId,
      assignmentType,
      userId: newOwner,
      actorUserId: adminUser,
    });
    expect(await activeGrant(secondLead.leadId, previousOwner)).toBeNull();
  });

  /* ------------------------------------------------------------------ */
  /* Self-service preference endpoint                                    */
  /* ------------------------------------------------------------------ */

  it('rejects turning the preference on for an ineligible Role, over HTTP, and audits nothing', async () => {
    const ineligibleUser = await makeUser(ineligibleRole, false);
    const before = await prisma.systemAuditLog.count({
      where: { organizationId: org, entityType: 'user', entityId: ineligibleUser },
    });
    const response = await call(
      { userId: ineligibleUser, roleId: ineligibleRole, organizationId: org },
      'PATCH',
      '/api/v1/auth/preferences',
      { retainViewAfterReassignment: true },
    );
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: 'ineligible' });
    expect(
      (await prisma.user.findFirst({ where: { id: ineligibleUser } }))?.retainViewAfterReassignment,
    ).toBe(false);
    expect(
      await prisma.systemAuditLog.count({
        where: { organizationId: org, entityType: 'user', entityId: ineligibleUser },
      }),
    ).toBe(before);
  });

  it('accepts turning the preference on for an eligible Role, over HTTP, and audits it', async () => {
    const eligibleUser = await makeUser(eligibleRole, false);
    const response = await call(
      { userId: eligibleUser, roleId: eligibleRole, organizationId: org },
      'PATCH',
      '/api/v1/auth/preferences',
      { retainViewAfterReassignment: true },
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ retainViewAfterReassignment: true });
    expect(
      (await prisma.user.findFirst({ where: { id: eligibleUser } }))?.retainViewAfterReassignment,
    ).toBe(true);
    const audit = await prisma.systemAuditLog.findFirst({
      where: {
        organizationId: org,
        entityType: 'user',
        entityId: eligibleUser,
        action: 'auth.reassignment_grace_preference_changed',
      },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit?.oldValue).toEqual({ retainViewAfterReassignment: false });
    expect(audit?.newValue).toEqual({ retainViewAfterReassignment: true });
  });

  it('always allows turning the preference off, regardless of eligibility', async () => {
    const ineligibleUser = await makeUser(ineligibleRole, true);
    const response = await call(
      { userId: ineligibleUser, roleId: ineligibleRole, organizationId: org },
      'PATCH',
      '/api/v1/auth/preferences',
      { retainViewAfterReassignment: false },
    );
    expect(response.statusCode).toBe(200);
    expect(
      (await prisma.user.findFirst({ where: { id: ineligibleUser } }))?.retainViewAfterReassignment,
    ).toBe(false);
  });

  /* ------------------------------------------------------------------ */
  /* Expiry actually stops access, not just the field being set          */
  /* ------------------------------------------------------------------ */

  it('stops satisfying access once expires_at has passed, on every surface — not merely the field being set', async () => {
    const sharing = new LeadSharingService(prisma);
    const previousOwner = await makeUser(eligibleRole, true);
    const lead = await seedLead(previousOwner, openStatus);

    await sharing.reassign({
      organizationId: org,
      leadId: lead.leadId,
      processInstanceId: lead.processInstanceId,
      assignmentType,
      userId: newOwner,
      actorUserId: adminUser,
    });
    const grant = await activeGrant(lead.leadId, previousOwner);
    expect(grant).not.toBeNull();

    // The exact technique `phase9.postgres.integration.test.ts` already uses
    // to prove passive expiry: mutate the row directly, rather than trusting
    // the column alone. `expires_at` must stay after `created_at`
    // (`user_access_grants_check`), so this sets it to just after creation —
    // already in the past by the time the assertions below run.
    await prisma.userAccessGrant.update({
      where: { organizationId_id: { organizationId: org, id: grant!.id } },
      data: { expiresAt: new Date(grant!.createdAt.getTime() + 1) },
    });

    const decision = await resolveAuthorization({
      repository: new PrismaPermissionRepository(prisma as never),
      request: {
        organizationId: org,
        userId: previousOwner,
        module: 'leads',
        action: 'view',
        journeyId,
        leadId: lead.leadId,
        assignmentTypes: [assignmentType],
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.directGrantId).toBeNull();

    const detail = await call(
      { userId: previousOwner, roleId: eligibleRole, organizationId: org },
      'GET',
      `/api/v1/leads/${lead.leadId}?assignmentTypes=${assignmentType}`,
    );
    expect(detail.statusCode).toBe(403);
    const list = await call(
      { userId: previousOwner, roleId: eligibleRole, organizationId: org },
      'GET',
      `/api/v1/leads?assignmentTypes=${assignmentType}`,
    );
    expect(list.body).not.toContain(lead.leadId);
  });

  /* ------------------------------------------------------------------ */
  /* Cross-organization isolation                                        */
  /* ------------------------------------------------------------------ */

  it('never grants eligibility or a grant across organizations', async () => {
    // `otherOrgUser` is opted in and sits under a role with the identical
    // key/name as `eligibleRole`, in a different organization that never
    // granted the new action — eligibility must not follow the name.
    const decision = await resolveAuthorization({
      repository: new PrismaPermissionRepository(prisma as never),
      request: {
        organizationId: otherOrg,
        userId: otherOrgUser,
        module: 'leads',
        action: 'retain_view_after_reassignment',
        assignmentTypes: [assignmentType],
      },
    });
    expect(decision.deniedReasons).toContain('FEATURE_ACTION_DENIED');

    // And a grant created in `org` is never visible from `otherOrg`.
    const previousOwner = await makeUser(eligibleRole, true);
    const lead = await seedLead(previousOwner, openStatus);
    const sharing = new LeadSharingService(prisma);
    await sharing.reassign({
      organizationId: org,
      leadId: lead.leadId,
      processInstanceId: lead.processInstanceId,
      assignmentType,
      userId: newOwner,
      actorUserId: adminUser,
    });
    const grant = await activeGrant(lead.leadId, previousOwner);
    expect(grant).not.toBeNull();
    expect(
      await prisma.userAccessGrant.findFirst({
        where: { organizationId: otherOrg, leadId: lead.leadId },
      }),
    ).toBeNull();
  });
});
