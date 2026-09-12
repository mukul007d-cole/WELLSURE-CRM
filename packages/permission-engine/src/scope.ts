import type {
  AssignmentSnapshot,
  DataScope,
  PermissionRepository,
  RecordPredicate,
  UserSnapshot,
} from './types.js';

export async function expandScopeUserIds(input: {
  repository: PermissionRepository;
  user: UserSnapshot;
  scope: DataScope;
}): Promise<readonly string[] | 'ALL_ORGANIZATION_USERS'> {
  switch (input.scope) {
    case 'SELF':
      return [input.user.id];
    case 'TEAM':
      return expandTeamUserIds(input.repository, input.user);
    case 'DEPARTMENT':
      if (input.user.departmentId === null) {
        return [input.user.id];
      }
      return input.repository.listDepartmentUserIds({
        organizationId: input.user.organizationId,
        departmentId: input.user.departmentId,
      });
    case 'ORGANIZATION':
      return 'ALL_ORGANIZATION_USERS';
  }
}

export async function expandTeamUserIds(
  repository: PermissionRepository,
  user: UserSnapshot,
): Promise<readonly string[]> {
  // Two different sets, deliberately not one. `visited` is the traversal
  // guard — every id the BFS has already queued, active or not, so a cycle
  // (already rejected at write time, but defended here too) still
  // terminates. `included` is the answer this function actually returns —
  // only active users belong in a scope's member list.
  //
  // Collapsing them into one set (as an earlier version did) meant a
  // deactivated manager's own exclusion from `included` also stopped the
  // BFS from ever visiting *their* reports: `queue.push` only ran for rows
  // that passed the `report.active` check, so the traversal silently
  // stopped at the first inactive link and everyone still active beneath it
  // became unreachable from anyone above. A manager going on leave or being
  // offboarded before their reports are reassigned must not sever the
  // reports' own manager chain — they are still active employees, still
  // reachable through the org chart, and (per ADR-0020) their assignee's
  // manager chain is now what decides whether a lead in a routed Status is
  // visible at all, not only who gets TEAM-scope access.
  const included = new Set<string>([user.id]);
  const visited = new Set<string>([user.id]);
  const queue = [user.id];

  while (queue.length > 0) {
    const managerId = queue.shift();
    if (managerId === undefined) {
      continue;
    }

    const reports = await repository.listReports({
      organizationId: user.organizationId,
      managerId,
    });

    for (const report of reports) {
      if (report.organizationId !== user.organizationId || visited.has(report.id)) {
        continue;
      }
      visited.add(report.id);
      queue.push(report.id);
      if (report.active) {
        included.add(report.id);
      }
    }
  }

  return [...included];
}

export function buildRecordPredicate(input: {
  organizationId: string;
  scope: DataScope;
  allowedUserIds: readonly string[] | 'ALL_ORGANIZATION_USERS';
  assignmentTypes: readonly string[];
  journeyIds: readonly string[];
  userId: string;
  action: string;
  hierarchyUserIds: readonly string[];
}): RecordPredicate {
  return {
    organizationId: input.organizationId,
    scope: input.scope,
    allowedUserIds: input.allowedUserIds,
    assignmentTypes: input.assignmentTypes,
    journeyIds: input.journeyIds,
    includeDirectGrantsForUserId: input.userId,
    directGrantAction: input.action,
    hierarchyUserIds: input.hierarchyUserIds,
  };
}

export function assignmentScopeAllowsLead(input: {
  assignments: readonly AssignmentSnapshot[];
  leadId: string;
  organizationId: string;
  assignmentTypes: readonly string[];
  allowedUserIds: readonly string[] | 'ALL_ORGANIZATION_USERS';
  journeyIds?: readonly string[];
}): boolean {
  const assignmentTypes = new Set(input.assignmentTypes);
  const journeyIds = input.journeyIds === undefined ? null : new Set(input.journeyIds);
  const allowedUsers =
    input.allowedUserIds === 'ALL_ORGANIZATION_USERS' ? null : new Set(input.allowedUserIds);

  if (allowedUsers === null) {
    return true;
  }

  return input.assignments.some((assignment) => {
    if (!assignment.isCurrent || assignment.leadId !== input.leadId) {
      return false;
    }
    if (assignment.organizationId !== input.organizationId) {
      return false;
    }
    if (journeyIds !== null && !journeyIds.has(assignment.journeyId)) {
      return false;
    }
    if (!assignmentTypes.has(assignment.assignmentType)) {
      return false;
    }
    return allowedUsers.has(assignment.userId);
  });
}
