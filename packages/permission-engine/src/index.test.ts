import { describe, expect, it } from 'vitest';

import { resolveAuthorization, workspaceName } from './index.js';
import {
  assignmentPrimary,
  createFixtureState,
  createRepository,
  journeyA,
  leadA,
  moduleLeads,
  orgA,
} from './__tests__/fixtures.js';

describe('workspace foundation', () => {
  it('exports its stable package name', () => {
    expect(workspaceName).toBe('@falcon/permission-engine');
  });

  it('exports a provider-independent decision contract with a workflow placeholder', async () => {
    const decision = await resolveAuthorization({
      repository: createRepository(),
      request: {
        organizationId: orgA,
        userId: 'user-child',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
        leadId: leadA,
        assignmentTypes: [assignmentPrimary],
      },
    });

    expect(decision.workflowCheck).toEqual({ status: 'not_enforced' });
  });

  it('scopes a multi-journey lead to the requested journey instead of the first active process', async () => {
    const state = createFixtureState();
    const journeyB = 'journey-synthetic-b';
    state.journeys.push({
      roleId: 'role-self',
      organizationId: orgA,
      journeyId: journeyB,
      active: true,
    });
    state.assignments.unshift({
      leadId: leadA,
      processInstanceId: 'process-first-not-requested',
      assignmentType: assignmentPrimary,
      userId: 'user-sibling',
      organizationId: orgA,
      isCurrent: true,
      journeyId: journeyB,
    });

    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: {
        organizationId: orgA,
        userId: 'user-child',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
        leadId: leadA,
        assignmentTypes: [assignmentPrimary],
      },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.recordPredicate?.journeyIds).toEqual([journeyA]);
  });
});
