import { describe, expect, it } from 'vitest';

import { resolveAuthorization, workspaceName } from './index.js';
import {
  assignmentPrimary,
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
});
