import { describe, expect, it } from 'vitest';

import { resolveAuthorization } from '../decision.js';
import {
  assignmentPrimary,
  createFixtureState,
  createRepository,
  journeyA,
  moduleLeads,
  orgA,
} from './fixtures.js';

const now = new Date('2026-01-15T00:00:00.000Z');

describe('direct record grants', () => {
  it('add only record-scope access and preserve feature, journey, field, and workflow clauses', async () => {
    const state = createFixtureState();
    state.grants.push({
      id: 'grant-active',
      leadId: 'lead-synthetic-other-dept',
      userId: 'user-child',
      organizationId: orgA,
      expiresAt: new Date('2026-01-16T00:00:00.000Z'),
      revokedAt: null,
    });

    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: {
        organizationId: orgA,
        userId: 'user-child',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
        leadId: 'lead-synthetic-other-dept',
        requestedFieldIds: ['field-visible'],
        requestedEditFieldIds: ['field-visible'],
        assignmentTypes: [assignmentPrimary],
        now,
      },
    });

    expect(decision.directGrantId).toBe('grant-active');
    expect(decision.recordAllowed).toBe(true);
    expect(decision.allowed).toBe(false);
    expect(decision.deniedReasons).toEqual(['FIELD_EDIT_DENIED']);
    expect(decision.workflowCheck).toEqual({ status: 'not_enforced' });
  });

  it('ignores expired and revoked grants', async () => {
    const state = createFixtureState();
    state.grants.push(
      {
        id: 'grant-expired',
        leadId: 'lead-synthetic-other-dept',
        userId: 'user-child',
        organizationId: orgA,
        expiresAt: new Date('2026-01-14T00:00:00.000Z'),
        revokedAt: null,
      },
      {
        id: 'grant-revoked',
        leadId: 'lead-synthetic-other-dept',
        userId: 'user-child',
        organizationId: orgA,
        expiresAt: null,
        revokedAt: new Date('2026-01-14T00:00:00.000Z'),
      },
    );

    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: {
        organizationId: orgA,
        userId: 'user-child',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
        leadId: 'lead-synthetic-other-dept',
        assignmentTypes: [assignmentPrimary],
        now,
      },
    });

    expect(decision.directGrantId).toBeNull();
    expect(decision.deniedReasons).toContain('RECORD_SCOPE_DENIED');
  });
});
