import { describe, expect, it } from 'vitest';

import { resolveAuthorization } from '../decision.js';
import {
  actionView,
  assignmentPrimary,
  createFixtureState,
  createRepository,
  journeyA,
  leadA,
  moduleLeads,
  orgA,
  statusRestricted,
} from './fixtures.js';

/**
 * ADR-0025 (role reporting lines, REPORTING_ROLES scope) and ADR-0026
 * (journey members, journey-limited actions). `leadA` is assigned to
 * `user-child` (role-self); `lead-synthetic-sibling` to `user-sibling`
 * (role-self, no manager).
 */
function stateWithReportingManager() {
  const state = createFixtureState();
  state.roles.push({ id: 'role-manager', organizationId: orgA, active: true, version: 1 });
  state.users.push({
    id: 'user-role-manager',
    organizationId: orgA,
    roleId: 'role-manager',
    active: true,
    departmentId: null,
    managerId: null,
  });
  state.permissions.push({
    roleId: 'role-manager',
    organizationId: orgA,
    module: moduleLeads,
    action: actionView,
    scope: 'REPORTING_ROLES',
  });
  state.journeys.push({
    roleId: 'role-manager',
    organizationId: orgA,
    journeyId: journeyA,
    active: true,
  });
  state.reportingLines.push({
    roleId: 'role-self',
    reportsToRoleId: 'role-manager',
    organizationId: orgA,
  });
  return state;
}

function view(
  userId: string,
  extra: Partial<Parameters<typeof resolveAuthorization>[0]['request']>,
) {
  return {
    organizationId: orgA,
    userId,
    module: moduleLeads,
    action: actionView,
    journeyId: journeyA,
    assignmentTypes: [assignmentPrimary],
    ...extra,
  };
}

/** A list-level request: no single journey named. */
function listView(userId: string) {
  return {
    organizationId: orgA,
    userId,
    module: moduleLeads,
    action: actionView,
    assignmentTypes: [assignmentPrimary],
  };
}

describe('REPORTING_ROLES scope', () => {
  it('reaches leads owned by users whose role reports to the caller role, without any manager_id', async () => {
    const repository = createRepository(stateWithReportingManager());
    for (const leadId of [leadA, 'lead-synthetic-sibling', 'lead-synthetic-grandchild']) {
      const decision = await resolveAuthorization({
        repository,
        request: view('user-role-manager', { leadId }),
      });
      expect(decision.allowed, leadId).toBe(true);
    }
  });

  it('does not reach a role that does not report to it', async () => {
    const state = stateWithReportingManager();
    state.assignments.push({
      leadId: 'lead-owned-by-oversight',
      processInstanceId: 'pi-oversight',
      assignmentType: assignmentPrimary,
      userId: 'user-oversight',
      organizationId: orgA,
      isCurrent: true,
      journeyId: journeyA,
    });
    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: view('user-role-manager', { leadId: 'lead-owned-by-oversight' }),
    });
    expect(decision.deniedReasons).toContain('RECORD_SCOPE_DENIED');
  });

  it('includes inactive users of descendant roles, so a departed owner’s leads stay reachable', async () => {
    const state = stateWithReportingManager();
    state.assignments.push({
      leadId: 'lead-owned-by-inactive',
      processInstanceId: 'pi-inactive',
      assignmentType: assignmentPrimary,
      userId: 'user-inactive',
      organizationId: orgA,
      isCurrent: true,
      journeyId: journeyA,
    });
    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: view('user-role-manager', { leadId: 'lead-owned-by-inactive' }),
    });
    expect(decision.allowed).toBe(true);
  });

  it('follows reporting lines transitively and terminates on a cycle', async () => {
    const state = stateWithReportingManager();
    state.roles.push({ id: 'role-head', organizationId: orgA, active: true, version: 1 });
    state.users.push({
      id: 'user-head',
      organizationId: orgA,
      roleId: 'role-head',
      active: true,
      departmentId: null,
      managerId: null,
    });
    state.permissions.push({
      roleId: 'role-head',
      organizationId: orgA,
      module: moduleLeads,
      action: actionView,
      scope: 'REPORTING_ROLES',
    });
    state.journeys.push({
      roleId: 'role-head',
      organizationId: orgA,
      journeyId: journeyA,
      active: true,
    });
    state.reportingLines.push(
      { roleId: 'role-manager', reportsToRoleId: 'role-head', organizationId: orgA },
      // A cycle back to the top must not loop forever.
      { roleId: 'role-head', reportsToRoleId: 'role-self', organizationId: orgA },
    );
    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: view('user-head', { leadId: leadA }),
    });
    expect(decision.allowed).toBe(true);
  });
});

describe('status visibility ancestors include reporting roles (ADR-0025)', () => {
  it('lets a role-manager see a routed lead its role-report is assigned', async () => {
    const decision = await resolveAuthorization({
      repository: createRepository(stateWithReportingManager()),
      request: view('user-role-manager', { leadId: leadA, statusId: statusRestricted }),
    });
    expect(decision.deniedReasons).not.toContain('STATUS_VISIBILITY_DENIED');
  });

  it('still denies a peer outside both the manager chain and the reporting lines', async () => {
    const decision = await resolveAuthorization({
      repository: createRepository(stateWithReportingManager()),
      request: view('user-sibling', { leadId: leadA, statusId: statusRestricted }),
    });
    expect(decision.deniedReasons).toContain('STATUS_VISIBILITY_DENIED');
  });

  it('leaves TEAM scope on the manager chain alone', async () => {
    const state = stateWithReportingManager();
    // role-team (user-root) gains a reporting line from role-department, but
    // TEAM must not follow it.
    state.reportingLines.push({
      roleId: 'role-department',
      reportsToRoleId: 'role-team',
      organizationId: orgA,
    });
    state.assignments.push({
      leadId: 'lead-owned-by-no-dept',
      processInstanceId: 'pi-no-dept',
      assignmentType: assignmentPrimary,
      userId: 'user-no-dept',
      organizationId: orgA,
      isCurrent: true,
      journeyId: journeyA,
    });
    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: view('user-root', { leadId: 'lead-owned-by-no-dept' }),
    });
    expect(decision.deniedReasons).toContain('RECORD_SCOPE_DENIED');
  });
});

describe('journey members (ADR-0026)', () => {
  it('denies a restricted journey to a non-member even with role journey access', async () => {
    const state = createFixtureState();
    state.restrictedJourneyIds.push(journeyA);
    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: view('user-child', { leadId: leadA }),
    });
    expect(decision.deniedReasons).toContain('JOURNEY_DENIED');
  });

  it('allows a member, and drops the journey from a non-member’s list predicate', async () => {
    const state = createFixtureState();
    state.restrictedJourneyIds.push(journeyA);
    state.journeyMembers.push({ journeyId: journeyA, userId: 'user-child' });
    const repository = createRepository(state);
    const member = await resolveAuthorization({
      repository,
      request: view('user-child', { leadId: leadA }),
    });
    expect(member.allowed).toBe(true);
    const list = await resolveAuthorization({
      repository,
      request: listView('user-sibling'),
    });
    expect(list.recordPredicate?.journeyIds).toEqual([]);
  });
});

describe('journey-limited actions (ADR-0026)', () => {
  function limitedState() {
    const state = createFixtureState();
    const grant = state.permissions.find((row) => row.roleId === 'role-self')!;
    grant.journeyIds = ['journey-synthetic-other'];
    state.journeys.push({
      roleId: 'role-self',
      organizationId: orgA,
      journeyId: 'journey-synthetic-other',
      active: true,
    });
    return state;
  }

  it('denies the action in a journey outside its list', async () => {
    const decision = await resolveAuthorization({
      repository: createRepository(limitedState()),
      request: view('user-child', { leadId: leadA }),
    });
    expect(decision.deniedReasons).toContain('FEATURE_ACTION_DENIED');
  });

  it('narrows a list-level predicate to the listed journeys', async () => {
    const decision = await resolveAuthorization({
      repository: createRepository(limitedState()),
      request: listView('user-child'),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.recordPredicate?.journeyIds).toEqual(['journey-synthetic-other']);
  });

  it('treats an empty list as every accessible journey', async () => {
    const state = createFixtureState();
    state.permissions.find((row) => row.roleId === 'role-self')!.journeyIds = [];
    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: view('user-child', { leadId: leadA }),
    });
    expect(decision.allowed).toBe(true);
  });
});
