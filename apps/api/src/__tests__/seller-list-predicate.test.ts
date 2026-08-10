import { describe, expect, it } from 'vitest';
import type { RecordPredicate } from '@falcon/permission-engine';

import { processWhere } from '../leads/prisma-lead-repository.js';

const organizationId = '11111111-1111-1111-1111-111111111111';
const journeyId = '22222222-2222-2222-2222-222222222222';
const userId = '33333333-3333-3333-3333-333333333333';

function predicate(overrides: Partial<RecordPredicate> = {}): RecordPredicate {
  return {
    organizationId,
    scope: 'ORGANIZATION',
    allowedUserIds: 'ALL_ORGANIZATION_USERS',
    assignmentTypes: [],
    journeyIds: [journeyId],
    includeDirectGrantsForUserId: userId,
    directGrantAction: 'view',
    ...overrides,
  };
}

/** The assignment clause the seller list joins on. */
function assignmentClause(recordPredicate: RecordPredicate) {
  return processWhere({
    organizationId,
    recordPredicate,
    requestedFieldIds: [],
    assignmentTypes: [],
  }).assignments.some as Record<string, unknown>;
}

describe('seller list scoping predicate', () => {
  /**
   * `assignment_type IN ()` matches nothing, so a caller that named no types —
   * which is every caller of GET /leads that omits the parameter — got zero
   * rows even as an ORGANIZATION-scoped user, while assignmentScopeAllowsLead
   * answered "allowed" for the very same records.
   */
  it('applies no assignment-type filter when the caller named no types', () => {
    const clause = assignmentClause(predicate({ assignmentTypes: [] }));

    expect(clause).not.toHaveProperty('assignmentType');
    expect(clause).toMatchObject({ organizationId, isCurrent: true });
  });

  it('still filters by type when the caller named some', () => {
    const clause = assignmentClause(predicate({ assignmentTypes: ['synthetic_type'] }));

    expect(clause['assignmentType']).toEqual({ in: ['synthetic_type'] });
  });

  it('keeps enforcing user scope when the scope is narrower than the organization', () => {
    // Dropping the type filter must not widen *who* a scoped user can see.
    const clause = assignmentClause(
      predicate({ scope: 'SELF', allowedUserIds: [userId], assignmentTypes: [] }),
    );

    expect(clause).not.toHaveProperty('assignmentType');
    expect(clause['userId']).toEqual({ in: [userId] });
  });

  it('leaves the user filter off for an organization-wide scope', () => {
    const clause = assignmentClause(predicate());

    expect(clause).not.toHaveProperty('userId');
  });

  it('restricts to the requested journey when one is supplied', () => {
    const where = processWhere({
      organizationId,
      journeyId: 'journey-explicit',
      recordPredicate: predicate(),
      requestedFieldIds: [],
      assignmentTypes: [],
    });

    expect(where.journeyId).toEqual({ in: ['journey-explicit'] });
  });
});
