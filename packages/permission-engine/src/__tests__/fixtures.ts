import type {
  AssignmentSnapshot,
  DirectGrantSnapshot,
  FieldVisibilitySnapshot,
  JourneyAccessSnapshot,
  PermissionRepository,
  RolePermissionSnapshot,
  RoleSnapshot,
  UserSnapshot,
} from '../types.js';

export interface FixtureState {
  users: UserSnapshot[];
  roles: RoleSnapshot[];
  permissions: Array<RolePermissionSnapshot & { roleId: string; organizationId: string }>;
  journeys: Array<JourneyAccessSnapshot & { roleId: string; organizationId: string }>;
  fields: Array<FieldVisibilitySnapshot & { roleId: string; organizationId: string }>;
  assignments: AssignmentSnapshot[];
  grants: DirectGrantSnapshot[];
  /**
   * Phase 20. Deliberately empty by default: a Status with no active
   * routing rule is unrestricted, so every existing test that never touches
   * this axis stays correct without adding rows for it — that emptiness
   * *is* the fixture for "unrouted", not an omission to fill in.
   */
  activeRoutingRuleStatusIds: Array<{ statusId: string; organizationId: string }>;
  /**
   * ADR-0021. Deliberately empty by default, for the same reason: no Role
   * bypasses Status Visibility unless a test explicitly grants it, so every
   * existing test that never touches this axis stays correct unmodified.
   */
  statusVisibilityBypassRoleIds: string[];
}

export const orgA = 'org-synthetic-a';
export const orgB = 'org-synthetic-b';
export const moduleLeads = 'module.synthetic.leads';
export const actionView = 'action.synthetic.view';
export const actionEdit = 'action.synthetic.edit';
export const journeyA = 'journey-synthetic-a';
export const leadA = 'lead-synthetic-a';
export const assignmentPrimary = 'assignment.synthetic.primary';
/** A Status with no active routing rule — unrestricted. */
export const statusOpen = 'status-synthetic-open';
/**
 * A Status with an active routing rule — restricted to `leadA`'s current
 * assignee (`user-child`) and that assignee's reporting-hierarchy ancestors
 * (`user-root`).
 */
export const statusRestricted = 'status-synthetic-restricted';

export function createFixtureState(): FixtureState {
  return {
    users: [
      user('user-root', 'role-team', 'dept-alpha', null),
      user('user-child', 'role-self', 'dept-alpha', 'user-root'),
      user('user-grandchild', 'role-self', 'dept-alpha', 'user-child'),
      user('user-sibling', 'role-self', 'dept-alpha', null),
      user('user-other-dept', 'role-self', 'dept-beta', null),
      user('user-no-dept', 'role-department', null, null),
      { ...user('user-inactive', 'role-self', 'dept-alpha', 'user-root'), active: false },
      // Still an active employee reporting, transitively, to `user-root` —
      // through `user-inactive`, a deactivated manager. Proves the
      // hierarchy walk (`expandTeamUserIds`) continues past a deactivated
      // link rather than treating it as a dead end: `user-root` must still
      // reach this user, even though `user-inactive` itself is excluded.
      user('user-orphaned-report', 'role-self', 'dept-alpha', 'user-inactive'),
      // No department, no manager, no report of anyone in `leadA`'s
      // hierarchy — an admin/oversight account deliberately outside the
      // sales reporting line, `role-organization`'s ORGANIZATION scope
      // notwithstanding. For ADR-0021's bypass tests: this scope alone
      // already reaches `leadA` everywhere *except* `statusRestricted`.
      user('user-oversight', 'role-organization', null, null),
      { ...user('user-other-org', 'role-other-org', 'dept-alpha', null), organizationId: orgB },
    ],
    roles: [
      role('role-self'),
      role('role-team'),
      role('role-department'),
      role('role-organization'),
      { ...role('role-inactive'), active: false },
      { ...role('role-other-org'), organizationId: orgB },
    ],
    permissions: [
      permission('role-self', 'SELF'),
      permission('role-team', 'TEAM'),
      permission('role-department', 'DEPARTMENT'),
      permission('role-organization', 'ORGANIZATION'),
      { ...permission('role-other-org', 'ORGANIZATION'), organizationId: orgB },
    ],
    journeys: [
      journey('role-self'),
      journey('role-team'),
      journey('role-department'),
      journey('role-organization'),
      { ...journey('role-other-org'), organizationId: orgB },
    ],
    fields: [
      field('role-self', 'field-visible', 'VIEW'),
      field('role-self', 'field-editable', 'EDIT'),
      field('role-team', 'field-visible', 'VIEW'),
      field('role-team', 'field-editable', 'EDIT'),
      field('role-department', 'field-visible', 'VIEW'),
      field('role-department', 'field-editable', 'EDIT'),
      field('role-organization', 'field-visible', 'VIEW'),
      field('role-organization', 'field-editable', 'EDIT'),
    ],
    assignments: [
      assignment(leadA, 'user-child'),
      assignment('lead-synthetic-grandchild', 'user-grandchild'),
      assignment('lead-synthetic-sibling', 'user-sibling'),
      assignment('lead-synthetic-other-dept', 'user-other-dept'),
      { ...assignment('lead-synthetic-other-org', 'user-other-org'), organizationId: orgB },
    ],
    grants: [],
    // `statusOpen` intentionally has no rule — see
    // `FixtureState.activeRoutingRuleStatusIds`. `statusRestricted` has an
    // active rule, so visibility narrows to `leadA`'s assignee and their
    // manager chain.
    activeRoutingRuleStatusIds: [{ statusId: statusRestricted, organizationId: orgA }],
    statusVisibilityBypassRoleIds: [],
  };
}

export function createRepository(state = createFixtureState()): PermissionRepository {
  return {
    getUser(userId, organizationId) {
      return Promise.resolve(
        state.users.find((row) => row.id === userId && row.organizationId === organizationId) ??
          null,
      );
    },
    getRole(roleId, organizationId) {
      return Promise.resolve(
        state.roles.find((row) => row.id === roleId && row.organizationId === organizationId) ??
          null,
      );
    },
    getRolePermission(input) {
      return Promise.resolve(
        state.permissions.find(
          (row) =>
            row.roleId === input.roleId &&
            row.organizationId === input.organizationId &&
            row.module === input.module &&
            row.action === input.action,
        ) ?? null,
      );
    },
    hasJourneyAccess(input) {
      return Promise.resolve(
        state.journeys.some(
          (row) =>
            row.roleId === input.roleId &&
            row.organizationId === input.organizationId &&
            row.journeyId === input.journeyId &&
            row.active,
        ),
      );
    },
    hasActiveRoutingRule(input) {
      return Promise.resolve(
        state.activeRoutingRuleStatusIds.some(
          (row) => row.organizationId === input.organizationId && row.statusId === input.statusId,
        ),
      );
    },
    hasStatusVisibilityBypass(input) {
      return Promise.resolve(state.statusVisibilityBypassRoleIds.includes(input.roleId));
    },
    listAccessibleJourneyIds(input) {
      return Promise.resolve(
        state.journeys
          .filter(
            (row) =>
              row.roleId === input.roleId &&
              row.organizationId === input.organizationId &&
              row.active,
          )
          .map((row) => row.journeyId),
      );
    },
    getFieldVisibility(input) {
      const requested = new Set(input.fieldIds);
      return Promise.resolve(
        state.fields.filter(
          (row) =>
            row.roleId === input.roleId &&
            row.organizationId === input.organizationId &&
            requested.has(row.fieldId),
        ),
      );
    },
    getLeadScope(input) {
      const assignmentRow = state.assignments.find(
        (row) => row.leadId === input.leadId && row.organizationId === input.organizationId,
      );
      if (assignmentRow === undefined) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        leadId: input.leadId,
        organizationId: input.organizationId,
        journeyId: journeyA,
        assignedUserIds: state.assignments
          .filter(
            (row) => row.leadId === input.leadId && row.organizationId === input.organizationId,
          )
          .map((row) => row.userId),
      });
    },
    listActiveUserIds(input) {
      return Promise.resolve(
        state.users
          .filter((row) => row.organizationId === input.organizationId && row.active)
          .map((row) => row.id),
      );
    },
    listDepartmentUserIds(input) {
      return Promise.resolve(
        state.users
          .filter(
            (row) =>
              row.organizationId === input.organizationId &&
              row.active &&
              row.departmentId === input.departmentId,
          )
          .map((row) => row.id),
      );
    },
    listReports(input) {
      return Promise.resolve(
        state.users.filter(
          (row) => row.organizationId === input.organizationId && row.managerId === input.managerId,
        ),
      );
    },
    listCurrentAssignments(input) {
      const types = new Set(input.assignmentTypes);
      const journeyIds = input.journeyIds === undefined ? null : new Set(input.journeyIds);
      return Promise.resolve(
        state.assignments.filter(
          (row) =>
            row.organizationId === input.organizationId &&
            row.isCurrent &&
            types.has(row.assignmentType) &&
            (journeyIds === null || journeyIds.has(row.journeyId)),
        ),
      );
    },
    getActiveDirectGrant(input) {
      return Promise.resolve(
        state.grants.find(
          (row) =>
            row.organizationId === input.organizationId &&
            row.userId === input.userId &&
            row.leadId === input.leadId &&
            row.revokedAt === null &&
            row.actions.includes(input.action) &&
            (row.expiresAt === null || row.expiresAt > input.now),
        ) ?? null,
      );
    },
  };
}

function user(
  id: string,
  roleId: string,
  departmentId: string | null,
  managerId: string | null,
): UserSnapshot {
  return { id, organizationId: orgA, roleId, active: true, departmentId, managerId };
}

function role(id: string): RoleSnapshot {
  return { id, organizationId: orgA, active: true, version: 1 };
}

function permission(roleId: string, scope: RolePermissionSnapshot['scope']) {
  return { roleId, organizationId: orgA, module: moduleLeads, action: actionView, scope };
}

function journey(roleId: string) {
  return { roleId, organizationId: orgA, journeyId: journeyA, active: true };
}

function field(
  roleId: string,
  fieldId: string,
  accessLevel: FieldVisibilitySnapshot['accessLevel'],
) {
  return { roleId, organizationId: orgA, fieldId, accessLevel };
}

function assignment(leadId: string, userId: string): AssignmentSnapshot {
  return {
    leadId,
    processInstanceId: `process-${leadId}`,
    assignmentType: assignmentPrimary,
    userId,
    organizationId: orgA,
    isCurrent: true,
    journeyId: journeyA,
  };
}
