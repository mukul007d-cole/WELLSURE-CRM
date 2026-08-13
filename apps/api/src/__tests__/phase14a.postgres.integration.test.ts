import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';
import { expandScopeUserIds, resolveAuthorization } from '@falcon/permission-engine';

import { PrismaAdminRepository } from '../admin/prisma-admin-repository.js';
import { PrismaConfigurationRepository } from '../configuration/prisma-configuration-repository.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { defaultAuthConfig } from '../auth/config.js';
import { buildServer } from '../http/build-server.js';
import type { ServerDependencies } from '../http/types.js';
import { createAdminPostgres, shouldRunAdminPostgres } from './fixtures/synthetic-admin.js';

/**
 * Phase 14a — Teams within Departments, against real Postgres.
 *
 * The assertion this file exists for is ADR-0014: **creating Teams does not
 * change what `TEAM` permission scope means.** That scope resolves through
 * `users.manager_id` and must keep resolving through it after Teams exist, or
 * every role holding TEAM scope silently changes meaning. It is proven through
 * the real permission engine and the real HTTP surface, before and after the
 * Team is created — not by observing that we did not edit `scope.ts`.
 *
 * Everything else here supports that claim or proves it isn't vacuous.
 *
 * Every name is synthetic. Nothing in this file may depend on a real journey,
 * status, role, department or person name (`AGENTS.md`).
 */

describe.runIf(shouldRunAdminPostgres)('Phase 14a Teams within Departments', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  const otherOrg = randomUUID();
  const adminRole = randomUUID();
  const scopedRole = randomUUID();
  const foreignRole = randomUUID();

  const adminUser = randomUUID();
  /** Top of the reporting line, and the actor whose TEAM scope is under test. */
  const manager = randomUUID();
  /** Reports to `manager`. */
  const directReport = randomUUID();
  /** Reports to `directReport` — so transitivity is exercised, not assumed. */
  const nestedReport = randomUUID();
  /** Same Department as `manager`, but nowhere in their reporting line. */
  const outsider = randomUUID();
  /** Belongs to the other Department, for the cross-department rejection. */
  const otherDepartmentUser = randomUUID();
  const foreignUser = randomUUID();

  const department = randomUUID();
  const otherDepartment = randomUUID();
  const journey = randomUUID();
  const status = randomUUID();
  const assignmentType = 'synthetic_owner';

  /** Lead assigned to `nestedReport` — visible to `manager` through hierarchy. */
  const hierarchyLead = randomUUID();
  /** Lead assigned to `outsider` — must never be visible to `manager`. */
  const outsiderLead = randomUUID();

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
  const asManager = () => ({ userId: manager, roleId: scopedRole });

  /**
   * What `manager` can actually reach, on every surface at once.
   *
   * The list body is returned raw so the caller can assert on the *whole*
   * response rather than on a parsed field — a lead id appearing anywhere in
   * the payload is a leak, whatever shape it arrives in.
   */
  const managerSees = async () => {
    const context = `assignmentTypes=${assignmentType}`;
    const [list, hierarchyDetail, outsiderDetail] = await Promise.all([
      call(asManager(), 'GET', `/api/v1/leads?${context}`),
      call(asManager(), 'GET', `/api/v1/leads/${hierarchyLead}?${context}`),
      call(asManager(), 'GET', `/api/v1/leads/${outsiderLead}?${context}`),
    ]);
    const decision = await resolveAuthorization({
      repository: new PrismaPermissionRepository(prisma as never),
      request: {
        organizationId: org,
        userId: manager,
        module: 'leads',
        action: 'view',
        journeyId: journey,
        leadId: outsiderLead,
        assignmentTypes: [assignmentType],
      },
    });
    const teamScope = await expandScopeUserIds({
      repository: new PrismaPermissionRepository(prisma as never),
      user: {
        id: manager,
        organizationId: org,
        roleId: scopedRole,
        active: true,
        departmentId: department,
        managerId: null,
      },
      scope: 'TEAM',
    });
    return { list, hierarchyDetail, outsiderDetail, decision, teamScope };
  };

  const createTeamAs = (actor: { userId: string; roleId: string }, body: unknown) =>
    call(actor, 'POST', `/api/v1/departments/${department}/teams`, body);

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
        {
          id: scopedRole,
          organizationId: org,
          key: 'synthetic_scoped',
          name: 'Synthetic team-scoped role',
        },
        {
          id: foreignRole,
          organizationId: otherOrg,
          key: 'synthetic_foreign',
          name: 'Synthetic foreign role',
        },
      ],
    });
    await prisma.department.createMany({
      data: [
        { id: department, organizationId: org, key: 'synthetic_dept_a', name: 'Synthetic unit A' },
        {
          id: otherDepartment,
          organizationId: org,
          key: 'synthetic_dept_b',
          name: 'Synthetic unit B',
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
          id: manager,
          organizationId: org,
          name: 'Synthetic manager',
          email: 'manager@example.test',
          roleId: scopedRole,
          departmentId: department,
        },
        {
          id: directReport,
          organizationId: org,
          name: 'Synthetic direct report',
          email: 'direct@example.test',
          roleId: scopedRole,
          departmentId: department,
          managerId: manager,
        },
        {
          id: nestedReport,
          organizationId: org,
          name: 'Synthetic nested report',
          email: 'nested@example.test',
          roleId: scopedRole,
          departmentId: department,
          managerId: directReport,
        },
        {
          id: outsider,
          organizationId: org,
          name: 'Synthetic outsider',
          email: 'outsider@example.test',
          roleId: scopedRole,
          departmentId: department,
        },
        {
          id: otherDepartmentUser,
          organizationId: org,
          name: 'Synthetic other-unit user',
          email: 'otherunit@example.test',
          roleId: scopedRole,
          departmentId: otherDepartment,
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
        ...['view', 'create', 'edit', 'deactivate'].map((action) => ({
          organizationId: org,
          roleId: adminRole,
          module: 'users',
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
        // The role under test: leads at TEAM scope, and nothing else. What it
        // can see is exactly what ADR-0006 says TEAM means.
        {
          organizationId: org,
          roleId: scopedRole,
          module: 'leads',
          action: 'view',
          scope: 'TEAM' as const,
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
      data: [adminRole, scopedRole].map((roleId) => ({
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
    for (const [leadId, ownerId] of [
      [hierarchyLead, nestedReport],
      [outsiderLead, outsider],
    ] as const) {
      await prisma.lead.create({
        data: { id: leadId, organizationId: org, name: `Synthetic lead ${leadId.slice(0, 8)}` },
      });
      const processInstance = randomUUID();
      await prisma.processInstance.create({
        data: {
          id: processInstance,
          organizationId: org,
          leadId,
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
          userId: ownerId,
        },
      });
    }
  }, 180_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  /* ---------------------------------------------------------------------- */
  /* The core security assertion: Teams do not move the TEAM scope boundary. */
  /* ---------------------------------------------------------------------- */

  it('leaves TEAM scope resolving through the reporting hierarchy after a Team exists', async () => {
    // Baseline, so the after-assertion is not vacuous: the hierarchy already
    // grants the nested report's lead and already withholds the outsider's.
    const before = await managerSees();
    expect(before.list.statusCode).toBe(200);
    expect(before.list.body).toContain(hierarchyLead);
    expect(before.list.body).not.toContain(outsiderLead);
    expect(before.hierarchyDetail.statusCode).toBe(200);
    expect(before.outsiderDetail.statusCode).toBe(403);
    expect(before.decision.allowed).toBe(false);
    expect(before.decision.deniedReasons).toContain('RECORD_SCOPE_DENIED');
    expect([...before.teamScope].sort()).toEqual([manager, directReport, nestedReport].sort());

    // Now put the manager and the outsider in the same Team. Under a
    // membership-derived scope this would hand the manager the outsider's lead.
    const created = await createTeamAs(asAdmin(), {
      key: 'synthetic_team',
      name: 'Synthetic team',
      members: [
        { userId: manager, isLeader: true },
        { userId: outsider, isLeader: false },
      ],
    });
    expect(created.statusCode).toBe(201);
    expect(
      await prisma.teamMember.count({
        where: { organizationId: org, userId: outsider },
      }),
    ).toBe(1);

    const after = await managerSees();

    // The whole-response assertion: the outsider's lead id appears nowhere in
    // the list payload, in any shape.
    expect(after.list.statusCode).toBe(200);
    expect(after.list.body).not.toContain(outsiderLead);
    // …and the surfaces agree with each other, which is the property
    // `access-model.md` names: counts and lists use one filter.
    expect(after.outsiderDetail.statusCode).toBe(403);
    expect(after.decision.allowed).toBe(false);
    expect(after.decision.deniedReasons).toContain('RECORD_SCOPE_DENIED');
    expect(after.decision.effectiveScope).toBe('TEAM');

    // Nothing the hierarchy granted was lost either — the other direction of
    // the same claim.
    expect(after.list.body).toBe(before.list.body);
    expect(after.hierarchyDetail.statusCode).toBe(200);
    expect([...after.teamScope].sort()).toEqual([...before.teamScope].sort());
  }, 120_000);

  it('gains nothing for a Team member outside the reporting line, and loses nothing for a report outside the Team', async () => {
    // The nested report is deliberately in no Team at all. Membership-derived
    // scope would have dropped them; hierarchy keeps them.
    expect(
      await prisma.teamMember.count({ where: { organizationId: org, userId: nestedReport } }),
    ).toBe(0);

    const scope = await expandScopeUserIds({
      repository: new PrismaPermissionRepository(prisma as never),
      user: {
        id: manager,
        organizationId: org,
        roleId: scopedRole,
        active: true,
        departmentId: department,
        managerId: null,
      },
      scope: 'TEAM',
    });
    expect([...scope].sort()).toEqual([manager, directReport, nestedReport].sort());
    expect([...scope]).not.toContain(outsider);
  }, 120_000);

  /* ------------------------------------------------------------ Team CRUD */

  it('creates, edits, deactivates and audits a Team, bumping its version each time', async () => {
    const created = await createTeamAs(asAdmin(), {
      key: 'synthetic_lifecycle',
      name: 'Synthetic lifecycle team',
      members: [{ userId: directReport, isLeader: true }],
    });
    expect(created.statusCode).toBe(201);
    const teamId = (JSON.parse(created.body) as { id: string }).id;

    const renamed = await call(asAdmin(), 'PUT', `/api/v1/teams/${teamId}`, { name: 'Renamed' });
    expect(renamed.statusCode).toBe(200);
    expect(JSON.parse(renamed.body)).toMatchObject({ name: 'Renamed', version: 2 });

    const deactivated = await call(asAdmin(), 'POST', `/api/v1/teams/${teamId}/deactivate`);
    expect(deactivated.statusCode).toBe(200);
    expect(JSON.parse(deactivated.body)).toMatchObject({ active: false, version: 3 });

    // Nothing is hard deleted: the row is still readable, just inactive.
    const read = await call(asAdmin(), 'GET', `/api/v1/teams/${teamId}`);
    expect(read.statusCode).toBe(200);
    expect(JSON.parse(read.body)).toMatchObject({ id: teamId, active: false });

    const audits = await prisma.systemAuditLog.findMany({
      where: { organizationId: org, entityType: 'team', entityId: teamId },
      orderBy: { timestamp: 'asc' },
    });
    expect(audits.map((row) => row.action)).toEqual(['create', 'edit', 'deactivate']);

    // An inactive Team refuses further configuration rather than silently
    // accepting it.
    const afterDeactivation = await call(asAdmin(), 'PUT', `/api/v1/teams/${teamId}/members`, {
      members: [{ userId: directReport, isLeader: true }],
    });
    expect(afterDeactivation.statusCode).toBe(409);
  }, 120_000);

  it('replaces the whole member set, audits both sides, and refuses a leaderless set', async () => {
    const created = await createTeamAs(asAdmin(), {
      key: 'synthetic_members',
      name: 'Synthetic membership team',
      members: [
        { userId: manager, isLeader: true },
        { userId: directReport, isLeader: false },
      ],
    });
    const teamId = (JSON.parse(created.body) as { id: string }).id;

    const replaced = await call(asAdmin(), 'PUT', `/api/v1/teams/${teamId}/members`, {
      members: [{ userId: nestedReport, isLeader: true }],
    });
    expect(replaced.statusCode).toBe(200);

    // A true replacement: the previous members are gone, not merged.
    const rows = await prisma.teamMember.findMany({
      where: { organizationId: org, teamId },
      select: { userId: true, isLeader: true },
    });
    expect(rows).toEqual([{ userId: nestedReport, isLeader: true }]);

    const audit = await prisma.systemAuditLog.findFirst({
      where: {
        organizationId: org,
        entityType: 'team_member',
        entityId: teamId,
        action: 'replace',
      },
    });
    // Both sets are stored in userId order, so the expectation is too — the
    // ids are random per run and cannot be written down in a fixed sequence.
    expect(audit?.oldValue).toEqual(
      [
        { userId: manager, isLeader: true },
        { userId: directReport, isLeader: false },
      ].sort((a, b) => a.userId.localeCompare(b.userId)),
    );
    expect(audit?.newValue).toEqual([{ userId: nestedReport, isLeader: true }]);

    // The at-least-one-leader rule binds every configuration path.
    for (const members of [[], [{ userId: directReport, isLeader: false }]]) {
      const leaderless = await call(asAdmin(), 'PUT', `/api/v1/teams/${teamId}/members`, {
        members,
      });
      expect(leaderless.statusCode).toBe(400);
      expect(JSON.parse(leaderless.body)).toMatchObject({ error: 'validation_error' });
    }
    const stillCreatable = await createTeamAs(asAdmin(), {
      key: 'synthetic_never_created',
      name: 'Never created',
      members: [{ userId: directReport, isLeader: false }],
    });
    expect(stillCreatable.statusCode).toBe(400);
    expect(
      await prisma.team.count({ where: { organizationId: org, key: 'synthetic_never_created' } }),
    ).toBe(0);
  }, 120_000);

  it('refuses a member from another Department in the service and in the database', async () => {
    const rejected = await createTeamAs(asAdmin(), {
      key: 'synthetic_cross_department',
      name: 'Cross-department team',
      members: [
        { userId: manager, isLeader: true },
        { userId: otherDepartmentUser, isLeader: false },
      ],
    });
    expect(rejected.statusCode).toBe(400);
    expect(JSON.parse(rejected.body)).toMatchObject({
      error: 'validation_error',
      details: { userIds: [otherDepartmentUser] },
    });

    // With the service check bypassed entirely, the invariant still holds —
    // this is what makes it an invariant rather than a validation rule. Both
    // escape routes are closed: an honest department_id fails the team key, and
    // one spoofed to match the team fails the user key.
    const created = await createTeamAs(asAdmin(), {
      key: 'synthetic_fk_probe',
      name: 'Foreign key probe',
      members: [{ userId: manager, isLeader: true }],
    });
    const teamId = (JSON.parse(created.body) as { id: string }).id;
    await expect(
      prisma.teamMember.create({
        data: {
          organizationId: org,
          teamId,
          departmentId: otherDepartment,
          userId: otherDepartmentUser,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.teamMember.create({
        data: {
          organizationId: org,
          teamId,
          departmentId: department,
          userId: otherDepartmentUser,
        },
      }),
    ).rejects.toThrow();

    // An inactive user is not eligible either — a rule no key can express.
    const dormant = randomUUID();
    await prisma.user.create({
      data: {
        id: dormant,
        organizationId: org,
        name: 'Synthetic dormant user',
        email: 'dormant@example.test',
        roleId: scopedRole,
        departmentId: department,
        active: false,
      },
    });
    const withDormant = await call(asAdmin(), 'PUT', `/api/v1/teams/${teamId}/members`, {
      members: [
        { userId: manager, isLeader: true },
        { userId: dormant, isLeader: false },
      ],
    });
    expect(withDormant.statusCode).toBe(400);
  }, 120_000);

  /* ------------------------------------------------------------- Cascades */

  it('ends memberships when a user changes Department, and deactivates a Team left with no leader', async () => {
    const mover = randomUUID();
    await prisma.user.create({
      data: {
        id: mover,
        organizationId: org,
        name: 'Synthetic mover',
        email: 'mover@example.test',
        roleId: scopedRole,
        departmentId: department,
      },
    });
    // Two teams: one where the mover is the only leader, one where they are an
    // ordinary member. Only the first should end up deactivated.
    const led = JSON.parse(
      (
        await createTeamAs(asAdmin(), {
          key: 'synthetic_led_by_mover',
          name: 'Led by the mover',
          members: [{ userId: mover, isLeader: true }],
        })
      ).body,
    ) as { id: string };
    const shared = JSON.parse(
      (
        await createTeamAs(asAdmin(), {
          key: 'synthetic_shared_with_mover',
          name: 'Shared with the mover',
          members: [
            { userId: manager, isLeader: true },
            { userId: mover, isLeader: false },
          ],
        })
      ).body,
    ) as { id: string };

    const moved = await call(asAdmin(), 'PUT', `/api/v1/users/${mover}`, {
      name: 'Synthetic mover',
      email: 'mover@example.test',
      roleId: scopedRole,
      departmentId: otherDepartment,
    });
    expect(moved.statusCode).toBe(200);
    expect(JSON.parse(moved.body)).toMatchObject({ departmentId: otherDepartment });

    // Every membership in the old Department is gone…
    expect(await prisma.teamMember.count({ where: { organizationId: org, userId: mover } })).toBe(
      0,
    );
    // …the team that lost its only leader is deactivated, so "an active Team
    // has at least one leader" still holds…
    expect(
      await prisma.team.findFirst({ where: { organizationId: org, id: led.id } }),
    ).toMatchObject({ active: false });
    // …and the team that kept a leader is untouched apart from its version.
    expect(
      await prisma.team.findFirst({ where: { organizationId: org, id: shared.id } }),
    ).toMatchObject({ active: true });
    expect(
      await prisma.teamMember.findMany({
        where: { organizationId: org, teamId: shared.id },
        select: { userId: true },
      }),
    ).toEqual([{ userId: manager }]);

    // Both removals are on the record, with why.
    const removals = await prisma.systemAuditLog.findMany({
      where: { organizationId: org, entityType: 'team_member', action: 'remove_user' },
    });
    expect(removals.length).toBeGreaterThanOrEqual(2);
    expect(removals.every((row) => (row.newValue as { reason: string }).reason !== undefined)).toBe(
      true,
    );
    const deactivation = await prisma.systemAuditLog.findFirst({
      where: {
        organizationId: org,
        entityType: 'team',
        entityId: led.id,
        action: 'deactivate',
      },
    });
    expect(deactivation?.newValue).toMatchObject({ reason: 'last_leader_removed' });
  }, 120_000);

  it('ends memberships when a user is deactivated', async () => {
    const leaver = randomUUID();
    await prisma.user.create({
      data: {
        id: leaver,
        organizationId: org,
        name: 'Synthetic leaver',
        email: 'leaver@example.test',
        roleId: scopedRole,
        departmentId: department,
      },
    });
    const team = JSON.parse(
      (
        await createTeamAs(asAdmin(), {
          key: 'synthetic_leaver_team',
          name: 'Leaver team',
          members: [
            { userId: manager, isLeader: true },
            { userId: leaver, isLeader: false },
          ],
        })
      ).body,
    ) as { id: string };

    const deactivated = await call(asAdmin(), 'POST', `/api/v1/users/${leaver}/deactivate`);
    expect(deactivated.statusCode).toBe(200);
    expect(await prisma.teamMember.count({ where: { organizationId: org, userId: leaver } })).toBe(
      0,
    );
    expect(
      await prisma.teamMember.findMany({
        where: { organizationId: org, teamId: team.id },
        select: { userId: true },
      }),
    ).toEqual([{ userId: manager }]);
  }, 120_000);

  /* --------------------------------------------------- Concurrency, tenancy */

  it('serializes concurrent member replaces of the same Team without deadlocking', async () => {
    const created = await createTeamAs(asAdmin(), {
      key: 'synthetic_contended',
      name: 'Contended team',
      members: [{ userId: manager, isLeader: true }],
    });
    const teamId = (JSON.parse(created.body) as { id: string }).id;

    const [first, second] = await Promise.all([
      call(asAdmin(), 'PUT', `/api/v1/teams/${teamId}/members`, {
        members: [
          { userId: manager, isLeader: true },
          { userId: directReport, isLeader: false },
        ],
      }),
      call(asAdmin(), 'PUT', `/api/v1/teams/${teamId}/members`, {
        members: [{ userId: nestedReport, isLeader: true }],
      }),
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);

    // Whichever ordering won, the result is one of the two payloads intact —
    // never a merge, a partial write, or a deadlock error.
    const rows = (
      await prisma.teamMember.findMany({
        where: { organizationId: org, teamId },
        select: { userId: true, isLeader: true },
        orderBy: { userId: 'asc' },
      })
    ).sort((a, b) => a.userId.localeCompare(b.userId));
    const candidates = [
      [
        { userId: manager, isLeader: true },
        { userId: directReport, isLeader: false },
      ].sort((a, b) => a.userId.localeCompare(b.userId)),
      [{ userId: nestedReport, isLeader: true }],
    ];
    expect(candidates).toContainEqual(rows);
    expect(
      await prisma.systemAuditLog.count({
        where: { organizationId: org, entityType: 'team_member', entityId: teamId },
      }),
    ).toBe(2);
  }, 120_000);

  it('isolates tenants and rejects unknown parents', async () => {
    const unknownDepartment = await call(
      asAdmin(),
      'POST',
      `/api/v1/departments/${randomUUID()}/teams`,
      { key: 'synthetic_orphan', name: 'Orphan', members: [{ userId: manager, isLeader: true }] },
    );
    expect(unknownDepartment.statusCode).toBe(404);

    expect((await call(asAdmin(), 'GET', `/api/v1/teams/${randomUUID()}`)).statusCode).toBe(404);
    expect(
      (await call(asAdmin(), 'PUT', `/api/v1/teams/${randomUUID()}`, { name: 'x' })).statusCode,
    ).toBe(404);
    expect(
      (await call(asAdmin(), 'GET', `/api/v1/departments/${randomUUID()}/teams`)).statusCode,
    ).toBe(404);

    // A user from another organization is not an eligible member.
    const foreign = await createTeamAs(asAdmin(), {
      key: 'synthetic_foreign_member',
      name: 'Foreign member team',
      members: [
        { userId: manager, isLeader: true },
        { userId: foreignUser, isLeader: false },
      ],
    });
    expect(foreign.statusCode).toBe(400);
    expect(JSON.parse(foreign.body)).toMatchObject({ details: { userIds: [foreignUser] } });
  }, 120_000);

  it('gates every Team route on the users module, read included', async () => {
    const created = await createTeamAs(asAdmin(), {
      key: 'synthetic_gated',
      name: 'Gated team',
      members: [{ userId: manager, isLeader: true }],
    });
    const teamId = (JSON.parse(created.body) as { id: string }).id;

    // `scopedRole` holds leads:view only — no `users` action at all.
    for (const [method, url, payload] of [
      ['GET', `/api/v1/departments/${department}/teams`, undefined],
      ['GET', `/api/v1/teams/${teamId}`, undefined],
      ['POST', `/api/v1/departments/${department}/teams`, { key: 'x', name: 'x', members: [] }],
      ['PUT', `/api/v1/teams/${teamId}`, { name: 'x' }],
      ['POST', `/api/v1/teams/${teamId}/deactivate`, undefined],
      ['PUT', `/api/v1/teams/${teamId}/members`, { members: [] }],
    ] as const) {
      const response = await call(asManager(), method, url, payload);
      expect({ url, status: response.statusCode }).toEqual({ url, status: 403 });
    }

    // users:view alone reads but cannot mutate.
    const readerRole = randomUUID();
    const reader = randomUUID();
    await prisma.role.create({
      data: { id: readerRole, organizationId: org, key: 'synthetic_reader', name: 'Reader' },
    });
    await prisma.rolePermission.create({
      data: {
        organizationId: org,
        roleId: readerRole,
        module: 'users',
        action: 'view',
        scope: 'ORGANIZATION',
      },
    });
    await prisma.user.create({
      data: {
        id: reader,
        organizationId: org,
        name: 'Synthetic reader',
        email: 'reader@example.test',
        roleId: readerRole,
      },
    });
    const asReader = { userId: reader, roleId: readerRole };
    expect((await call(asReader, 'GET', `/api/v1/teams/${teamId}`)).statusCode).toBe(200);
    expect(
      (await call(asReader, 'PUT', `/api/v1/teams/${teamId}`, { name: 'nope' })).statusCode,
    ).toBe(403);
  }, 120_000);
});
