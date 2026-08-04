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
      actions: ['action.synthetic.view'],
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
        actions: ['action.synthetic.view'],
      },
      {
        id: 'grant-revoked',
        leadId: 'lead-synthetic-other-dept',
        userId: 'user-child',
        organizationId: orgA,
        expiresAt: null,
        revokedAt: new Date('2026-01-14T00:00:00.000Z'),
        actions: ['action.synthetic.view'],
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

  it('opens record scope only for the action carried by the share', async () => {
    const state = createFixtureState();
    state.grants.push({
      id: 'view-only-share',
      leadId: 'lead-synthetic-other-dept',
      userId: 'user-child',
      organizationId: orgA,
      expiresAt: null,
      revokedAt: null,
      actions: ['action.synthetic.view'],
    });
    state.permissions.push({
      roleId: 'role-self',
      organizationId: orgA,
      module: moduleLeads,
      action: 'action.synthetic.edit',
      scope: 'SELF',
    });
    const base = {
      organizationId: orgA,
      userId: 'user-child',
      module: moduleLeads,
      journeyId: journeyA,
      leadId: 'lead-synthetic-other-dept',
      assignmentTypes: [assignmentPrimary],
      now,
    };
    const view = await resolveAuthorization({
      repository: createRepository(state),
      request: { ...base, action: 'action.synthetic.view' },
    });
    const edit = await resolveAuthorization({
      repository: createRepository(state),
      request: { ...base, action: 'action.synthetic.edit' },
    });
    expect(view.recordAllowed).toBe(true);
    expect(view.directGrantId).toBe('view-only-share');
    expect(edit.recordAllowed).toBe(false);
    expect(edit.directGrantId).toBeNull();
  });
});
