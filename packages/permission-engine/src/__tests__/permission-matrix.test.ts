import { describe, expect, it } from 'vitest';

import { resolveAuthorization } from '../decision.js';
import {
  assignmentPrimary,
  createFixtureState,
  createRepository,
  journeyA,
  leadA,
  moduleLeads,
  orgA,
} from './fixtures.js';

const cases = [
  { userId: 'user-child', leadId: leadA, allowed: true, scope: 'SELF' },
  { userId: 'user-root', leadId: 'lead-synthetic-grandchild', allowed: true, scope: 'TEAM' },
  { userId: 'user-root', leadId: 'lead-synthetic-other-dept', allowed: false, scope: 'TEAM' },
  { userId: 'user-no-dept', leadId: 'lead-synthetic-sibling', allowed: false, scope: 'DEPARTMENT' },
] as const;

describe('table-driven permission matrix', () => {
  it.each(cases)(
    'resolves $scope access for $userId on $leadId',
    async ({ userId, leadId, allowed, scope }) => {
      const decision = await resolveAuthorization({
        repository: createRepository(),
        request: {
          organizationId: orgA,
          userId,
          module: moduleLeads,
          action: 'action.synthetic.view',
          journeyId: journeyA,
          leadId,
          requestedFieldIds: [],
          requestedEditFieldIds: [],
          assignmentTypes: [assignmentPrimary],
        },
      });

      expect(decision.effectiveScope).toBe(scope);
      expect(decision.allowed).toBe(allowed);
    },
  );

  it('denies when feature/action, journey, or active principals are missing', async () => {
    const state = createFixtureState();
    state.journeys = state.journeys.filter((row) => row.roleId !== 'role-self');

    const denied = await resolveAuthorization({
      repository: createRepository(state),
      request: {
        organizationId: orgA,
        userId: 'user-child',
        module: moduleLeads,
        action: 'action.synthetic.missing',
        journeyId: journeyA,
        leadId: leadA,
        assignmentTypes: [assignmentPrimary],
      },
    });

    expect(denied.deniedReasons).toEqual(
      expect.arrayContaining(['FEATURE_ACTION_DENIED', 'JOURNEY_DENIED', 'RECORD_SCOPE_DENIED']),
    );

    const inactive = await resolveAuthorization({
      repository: createRepository(),
      request: {
        organizationId: orgA,
        userId: 'user-inactive',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
      },
    });

    expect(inactive.deniedReasons).toEqual(['USER_INACTIVE']);
  });
});
