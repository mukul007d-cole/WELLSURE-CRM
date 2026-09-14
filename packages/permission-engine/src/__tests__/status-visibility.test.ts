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
  statusOpen,
  statusRestricted,
} from './fixtures.js';

/**
 * Phase 20 — Status Visibility is no longer a Role allow-list; routing
 * decides it. A Status with no active routing rule is unrestricted
 * (Phase 19's original default, re-keyed); one with an active rule
 * restricts visibility to the lead's current assignee and that assignee's
 * reporting-hierarchy ancestors — no Role plays any part in the check.
 * `leadA` is fixture-assigned to `user-child`, whose manager is `user-root`
 * (`user-root`'s own manager is null — the top of this fixture's tree).
 */
describe('status visibility', () => {
  it('is unrestricted when the caller names no Status at all', async () => {
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

  it('is unrestricted when a Status is named but no specific lead is (create-style checks)', async () => {
    const decision = await resolveAuthorization({
      repository: createRepository(),
      request: {
        organizationId: orgA,
        userId: 'user-sibling',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
        statusId: statusRestricted,
      },
    });
    expect(decision.deniedReasons).not.toContain('STATUS_VISIBILITY_DENIED');
  });

  const cases = [
    // No active routing rule at all — unrestricted regardless of who asks.
    { userId: 'user-child', statusId: statusOpen, allowed: true },
    { userId: 'user-sibling', statusId: statusOpen, allowed: true },
    // `statusRestricted` has an active rule; `leadA` is assigned to
    // `user-child`.
    { userId: 'user-child', statusId: statusRestricted, allowed: true }, // the assignee
    { userId: 'user-root', statusId: statusRestricted, allowed: true }, // the assignee's manager
    { userId: 'user-grandchild', statusId: statusRestricted, allowed: false }, // the assignee's own report, not an ancestor
    { userId: 'user-sibling', statusId: statusRestricted, allowed: false }, // unrelated
    { userId: 'user-other-dept', statusId: statusRestricted, allowed: false }, // unrelated, different department
    { userId: 'user-no-dept', statusId: statusRestricted, allowed: false }, // unrelated
  ] as const;

  it.each(cases)(
    '$userId on $statusId is allowed=$allowed',
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
          leadId: leadA,
          assignmentTypes: [assignmentPrimary],
        },
      });
      expect(decision.deniedReasons.includes('STATUS_VISIBILITY_DENIED')).toBe(!allowed);
    },
  );

  it('adds STATUS_VISIBILITY_DENIED alongside other denials rather than in place of them — AND, never OR', async () => {
    // No Role is granted `action.synthetic.missing`, and `user-no-dept` is
    // also outside `leadA`'s assignee-plus-hierarchy set on `statusRestricted`.
    // Neither denial substitutes for the other.
    const decision = await resolveAuthorization({
      repository: createRepository(),
      request: {
        organizationId: orgA,
        userId: 'user-no-dept',
        module: moduleLeads,
        action: 'action.synthetic.missing',
        journeyId: journeyA,
        statusId: statusRestricted,
        leadId: leadA,
        assignmentTypes: [assignmentPrimary],
      },
    });
    expect(decision.deniedReasons).toEqual(
      expect.arrayContaining(['FEATURE_ACTION_DENIED', 'STATUS_VISIBILITY_DENIED']),
    );
  });

  it('carries the caller’s reporting-hierarchy user ids on the record predicate, for the list/SQL form of this same rule', async () => {
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
    expect(decision.recordPredicate?.hierarchyUserIds).toEqual(
      expect.arrayContaining(['user-root', 'user-child', 'user-grandchild']),
    );
  });

  it('deactivating the routing rule returns the Status to unrestricted, not to denied-for-everyone', async () => {
    const state = createFixtureState();
    state.activeRoutingRuleStatusIds = []; // no active rule anywhere, including for statusRestricted
    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: {
        organizationId: orgA,
        userId: 'user-sibling',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
        statusId: statusRestricted,
        leadId: leadA,
        assignmentTypes: [assignmentPrimary],
      },
    });
    expect(decision.deniedReasons).not.toContain('STATUS_VISIBILITY_DENIED');
  });
});

/**
 * ADR-0021 — `leads:bypass_status_visibility`, the narrow backstop for
 * admin/oversight Roles that Status Visibility would otherwise lock out of
 * a lead the instant a Status they'd normally reach turns on routing.
 */
describe('status visibility bypass (ADR-0021)', () => {
  it('is off by default for every Role, including one with ORGANIZATION scope', async () => {
    const decision = await resolveAuthorization({
      repository: createRepository(),
      request: {
        organizationId: orgA,
        userId: 'user-oversight',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
        statusId: statusRestricted,
        leadId: leadA,
        assignmentTypes: [assignmentPrimary],
      },
    });
    // ORGANIZATION scope alone does not exempt anyone from Status
    // Visibility — this is the exact gap ADR-0021 exists to let an admin
    // deliberately close, not something scope already closes.
    expect(decision.deniedReasons).toContain('STATUS_VISIBILITY_DENIED');
    expect(decision.recordPredicate?.bypassesStatusVisibility).toBe(false);
  });

  it('lets an org-wide oversight Role, once granted, reach a lead outside the assignee’s hierarchy', async () => {
    const state = createFixtureState();
    state.statusVisibilityBypassRoleIds.push('role-organization');
    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: {
        organizationId: orgA,
        userId: 'user-oversight',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
        statusId: statusRestricted,
        leadId: leadA,
        assignmentTypes: [assignmentPrimary],
      },
    });
    expect(decision.deniedReasons).not.toContain('STATUS_VISIBILITY_DENIED');
    expect(decision.allowed).toBe(true);
  });

  it('grants no reach beyond the caller’s own DataScope — SELF scope still isn’t someone else’s lead', async () => {
    const state = createFixtureState();
    state.statusVisibilityBypassRoleIds.push('role-self'); // user-sibling's role
    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: {
        organizationId: orgA,
        userId: 'user-sibling',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
        statusId: statusRestricted,
        leadId: leadA,
        assignmentTypes: [assignmentPrimary],
      },
    });
    // The routing-based narrowing is gone...
    expect(decision.deniedReasons).not.toContain('STATUS_VISIBILITY_DENIED');
    // ...but `leadA` was never `user-sibling`'s own to begin with, so SELF
    // scope still refuses it — the bypass removes an extra restriction, it
    // does not add reach beyond what the caller's scope already grants.
    expect(decision.deniedReasons).toContain('RECORD_SCOPE_DENIED');
    expect(decision.allowed).toBe(false);
  });

  it('carries onto the record predicate, for the list/SQL form of this same rule', async () => {
    const state = createFixtureState();
    state.statusVisibilityBypassRoleIds.push('role-organization');
    const decision = await resolveAuthorization({
      repository: createRepository(state),
      request: {
        organizationId: orgA,
        userId: 'user-oversight',
        module: moduleLeads,
        action: 'action.synthetic.view',
        journeyId: journeyA,
      },
    });
    expect(decision.recordPredicate?.bypassesStatusVisibility).toBe(true);
  });
});
