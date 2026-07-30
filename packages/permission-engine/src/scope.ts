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
  const seen = new Set<string>([user.id]);
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
      if (!report.active || report.organizationId !== user.organizationId || seen.has(report.id)) {
        continue;
      }
      seen.add(report.id);
      queue.push(report.id);
    }
  }

  return [...seen];
}

export function buildRecordPredicate(input: {
  organizationId: string;
  scope: DataScope;
  allowedUserIds: readonly string[] | 'ALL_ORGANIZATION_USERS';
  assignmentTypes: readonly string[];
  userId: string;
}): RecordPredicate {
  return {
    organizationId: input.organizationId,
    scope: input.scope,
    allowedUserIds: input.allowedUserIds,
    assignmentTypes: input.assignmentTypes,
    includeDirectGrantsForUserId: input.userId,
  };
}

export function assignmentScopeAllowsLead(input: {
  assignments: readonly AssignmentSnapshot[];
  leadId: string;
  organizationId: string;
  assignmentTypes: readonly string[];
  allowedUserIds: readonly string[] | 'ALL_ORGANIZATION_USERS';
}): boolean {
  const assignmentTypes = new Set(input.assignmentTypes);
  const allowedUsers =
    input.allowedUserIds === 'ALL_ORGANIZATION_USERS' ? null : new Set(input.allowedUserIds);

  return input.assignments.some((assignment) => {
    if (!assignment.isCurrent || assignment.leadId !== input.leadId) {
      return false;
    }
    if (assignment.organizationId !== input.organizationId) {
      return false;
    }
    if (!assignmentTypes.has(assignment.assignmentType)) {
      return false;
    }
    return allowedUsers === null || allowedUsers.has(assignment.userId);
  });
}
