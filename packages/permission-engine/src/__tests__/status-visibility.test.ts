import { describe, expect, it } from 'vitest';

import { resolveAuthorization } from '../decision.js';
import {
  createFixtureState,
  createRepository,
  journeyA,
  moduleLeads,
  orgA,
  statusOpen,
  statusRestricted,
} from './fixtures.js';

/**
 * Phase 19 — the whole feature turns on one default: a Status with zero
 * `status_visibility` rows is unrestricted, and a Status with any row at all
 * restricts to the Roles it names. Table-driven against the engine directly,
 * no database — `permission-matrix.test.ts`'s own style, one axis at a time.
 */
describe('status visibility', () => {
  it('is unrestricted when the caller names no Status at all', async () => {
    // `statusId` omitted entirely — the bulk/list shape, checked separately
    // via RecordPredicate.roleId, not this per-request clause.
    const decision = await resolveAuthorization({
      repository: createRepository(),
      request: {
        organizationId: orgA,
        userId: 'user-root',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
      },
    });
    expect(decision.deniedReasons).not.toContain('STATUS_VISIBILITY_DENIED');
  });

  const cases = [
    { userId: 'user-root', roleId: 'role-team', statusId: statusOpen, allowed: true },
    { userId: 'user-child', roleId: 'role-self', statusId: statusOpen, allowed: true },
    // A Status with zero rows denies nobody, regardless of Role.
    { userId: 'user-no-dept', roleId: 'role-department', statusId: statusOpen, allowed: true },
    // `statusRestricted`'s one fixture row names `role-self` only.
    { userId: 'user-child', roleId: 'role-self', statusId: statusRestricted, allowed: true },
    { userId: 'user-root', roleId: 'role-team', statusId: statusRestricted, allowed: false },
    {
      userId: 'user-no-dept',
      roleId: 'role-department',
      statusId: statusRestricted,
      allowed: false,
    },
  ] as const;

  it.each(cases)(
    '$roleId on $statusId is allowed=$allowed',
    async ({ userId, statusId, allowed }) => {
      const decision = await resolveAuthorization({
        repository: createRepository(),
        request: {
          organizationId: orgA,
          userId,
          module: moduleLeads,
          action: 'action.synthetic.view',
          journeyId: journeyA,
          statusId,
        },
      });
      expect(decision.deniedReasons.includes('STATUS_VISIBILITY_DENIED')).toBe(!allowed);
    },
  );

  it('adds STATUS_VISIBILITY_DENIED alongside other denials rather than in place of them — AND, never OR', async () => {
    // No Role is granted `action.synthetic.missing`, and `user-no-dept`
    // (role-department) is also outside `statusRestricted`'s one row
    // (role-self only). Neither denial substitutes for the other.
    const decision = await resolveAuthorization({
      repository: createRepository(),
      request: {
        organizationId: orgA,
        userId: 'user-no-dept',
        module: moduleLeads,
        action: 'action.synthetic.missing',
        journeyId: journeyA,
        statusId: statusRestricted,
      },
    });
    expect(decision.deniedReasons).toEqual(
      expect.arrayContaining(['FEATURE_ACTION_DENIED', 'STATUS_VISIBILITY_DENIED']),
    );
  });

  it('carries the caller’s Role id on the record predicate, for the list/SQL form of this same rule', async () => {
    const decision = await resolveAuthorization({
      repository: createRepository(),
      request: {
        organizationId: orgA,
        userId: 'user-child',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
      },
    });
    expect(decision.recordPredicate?.roleId).toBe('role-self');
  });

  it('clearing every row for a Status returns it to unrestricted, not to denied-for-everyone', async () => {
    const state = createFixtureState();
    state.statusVisibility = []; // no rows anywhere, including for statusRestricted
    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: {
        organizationId: orgA,
        userId: 'user-root',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
        statusId: statusRestricted,
      },
    });
    expect(decision.deniedReasons).not.toContain('STATUS_VISIBILITY_DENIED');
  });
});
