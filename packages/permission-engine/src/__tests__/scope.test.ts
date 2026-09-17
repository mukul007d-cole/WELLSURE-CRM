import { describe, expect, it } from 'vitest';

import { assignmentScopeAllowsLead, expandTeamUserIds } from '../scope.js';
import { createFixtureState, createRepository, orgA } from './fixtures.js';
import type { AssignmentSnapshot } from '../types.js';

/**
 * `expandTeamUserIds` — the downward hierarchy walk TEAM scope (ADR-0006)
 * and, since Phase 20, Status Visibility both depend on.
 *
 * Fast, fixture-only coverage alongside `scope.integration.test.ts`'s
 * real-Postgres version of the same claims.
 */
describe('expandTeamUserIds', () => {
  it('includes every active user reachable downward through manager_id, at any depth', async () => {
    const repository = createRepository();
    const user = createFixtureState().users.find((row) => row.id === 'user-root')!;
    await expect(expandTeamUserIds(repository, user)).resolves.toEqual(
      expect.arrayContaining(['user-root', 'user-child', 'user-grandchild']),
    );
  });

  it('excludes a deactivated user from the result, but still walks through them to their still-active reports', async () => {
    const repository = createRepository();
    const user = createFixtureState().users.find((row) => row.id === 'user-root')!;
    const ids = await expandTeamUserIds(repository, user);

    // `user-inactive` reports directly to `user-root` and is deactivated —
    // excluded, an inactive user is never a valid scope member.
    expect(ids).not.toContain('user-inactive');
    // `user-orphaned-report` reports to `user-inactive`, two levels below
    // `user-root`. Before this fix, `user-inactive`'s own exclusion also
    // stopped the walk from ever reaching this row — a deactivated manager
    // silently cut their entire remaining team off from anyone above them.
    // `user-orphaned-report` is still an active employee and must still be
    // reachable through the org chart.
    expect(ids).toContain('user-orphaned-report');
  });

  it('never loops forever on a manager cycle', async () => {
    // Cycles are rejected at write time (`validateUserRefs`), but the walk
    // defends independently: a `visited` guard that includes inactive ids
    // too, not just the ones it returns.
    const state = createFixtureState();
    state.users.push(
      {
        id: 'user-cycle-a',
        organizationId: orgA,
        roleId: 'role-self',
        active: true,
        departmentId: 'dept-alpha',
        managerId: 'user-cycle-b',
      },
      {
        id: 'user-cycle-b',
        organizationId: orgA,
        roleId: 'role-self',
        active: true,
        departmentId: 'dept-alpha',
        managerId: 'user-cycle-a',
      },
    );
    const repository = createRepository(state);
    await expect(
      expandTeamUserIds(
        repository,
        state.users.find((row) => row.id === 'user-cycle-a')!,
      ),
    ).resolves.toEqual(expect.arrayContaining(['user-cycle-a', 'user-cycle-b']));
  });
});

describe('assignmentScopeAllowsLead', () => {
  const organizationId = orgA;
  const leadId = 'lead-a';
  const userId = 'user-owner';

  function assignment(overrides: Partial<AssignmentSnapshot> = {}): AssignmentSnapshot {
    return {
      leadId,
      processInstanceId: 'process-a',
      assignmentType: 'owner',
      userId,
      organizationId,
      isCurrent: true,
      journeyId: 'journey-a',
      ...overrides,
    };
  }

  /**
   * A caller that names no assignment types must not be treated as having
   * named the empty set of types. Before this fix, an empty `assignmentTypes`
   * denied every single-record decision (GET /leads/:id, shares, comments,
   * reassign) for a user who was genuinely the record's own assignee, purely
   * because the caller omitted a parameter — the identical inconsistency
   * `seller-list-predicate.test.ts` already documents and fixes for the list
   * query's assignment clause, just not yet applied here.
   */
  it('treats an empty assignmentTypes as no type restriction, not as matching no assignment', () => {
    const allowed = assignmentScopeAllowsLead({
      assignments: [assignment()],
      leadId,
      organizationId,
      assignmentTypes: [],
      allowedUserIds: [userId],
    });
    expect(allowed).toBe(true);
  });

  it('still filters by type when the caller named some, and denies a non-matching type', () => {
    const allowed = assignmentScopeAllowsLead({
      assignments: [assignment({ assignmentType: 'owner' })],
      leadId,
      organizationId,
      assignmentTypes: ['technical_lead'],
      allowedUserIds: [userId],
    });
    expect(allowed).toBe(false);
  });

  it('dropping the type filter never widens who counts as an authorized user', () => {
    // The fix must only stop an absent type list from matching nothing; it
    // must never let a bogus or absent type list substitute for the real
    // user-scope check.
    const allowed = assignmentScopeAllowsLead({
      assignments: [assignment({ userId: 'someone-else' })],
      leadId,
      organizationId,
      assignmentTypes: [],
      allowedUserIds: [userId],
    });
    expect(allowed).toBe(false);
  });
});
