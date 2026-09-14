export type DataScope = 'SELF' | 'TEAM' | 'DEPARTMENT' | 'ORGANIZATION';
export type FieldAccessLevel = 'VIEW' | 'EDIT';
export type WorkflowCheck = { status: 'not_enforced' };

export type PermissionDeniedReason =
  | 'USER_INACTIVE'
  | 'ROLE_INACTIVE'
  | 'FEATURE_ACTION_DENIED'
  | 'JOURNEY_DENIED'
  | 'RECORD_SCOPE_DENIED'
  | 'STATUS_VISIBILITY_DENIED'
  | 'FIELD_VIEW_DENIED'
  | 'FIELD_EDIT_DENIED'
  | 'WORKFLOW_NOT_ENFORCED';

export interface UserSnapshot {
  id: string;
  organizationId: string;
  roleId: string;
  active: boolean;
  departmentId: string | null;
  managerId: string | null;
}

export interface RoleSnapshot {
  id: string;
  organizationId: string;
  active: boolean;
  version: number;
}

export interface RolePermissionSnapshot {
  module: string;
  action: string;
  scope: DataScope;
}

export interface JourneyAccessSnapshot {
  journeyId: string;
  active: boolean;
}

export interface FieldVisibilitySnapshot {
  fieldId: string;
  accessLevel: FieldAccessLevel;
}

export interface DirectGrantSnapshot {
  id: string;
  leadId: string;
  userId: string;
  organizationId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  actions: readonly string[];
}

export interface AssignmentSnapshot {
  leadId: string;
  processInstanceId: string;
  assignmentType: string;
  userId: string;
  organizationId: string;
  isCurrent: boolean;
  journeyId: string;
}

export interface LeadScopeSnapshot {
  leadId: string;
  organizationId: string;
  journeyId: string;
  assignedUserIds: readonly string[];
}

export interface PermissionRepository {
  getUser(userId: string, organizationId: string): Promise<UserSnapshot | null>;
  getRole(roleId: string, organizationId: string): Promise<RoleSnapshot | null>;
  getRolePermission(input: {
    roleId: string;
    organizationId: string;
    module: string;
    action: string;
  }): Promise<RolePermissionSnapshot | null>;
  hasJourneyAccess(input: {
    roleId: string;
    organizationId: string;
    journeyId: string;
  }): Promise<boolean>;
  /**
   * Phase 20 — does this Status have an active routing rule?
   *
   * Status Visibility (originally Phase 19, reworked in Phase 20) no longer
   * reads a separate allow-list: a Status with no active routing rule is
   * unrestricted (ordinary DataScope/Journey rules apply, exactly Phase 19's
   * "absence means unrestricted" default, now keyed off routing instead of a
   * table of rows); one with an active rule restricts visibility to the
   * lead's current assignee and that assignee's reporting-hierarchy
   * ancestors — computed in `decision.ts` from `listCurrentAssignments` and
   * `expandScopeUserIds(..., 'TEAM')`, not from this repository method. See
   * docs/planning/phase-20-reconcile-status-routing-and-visibility.md.
   */
  hasActiveRoutingRule(input: { organizationId: string; statusId: string }): Promise<boolean>;
  /**
   * ADR-0021 — does this Role hold `leads:bypass_status_visibility`?
   *
   * A narrow, explicit backstop: when true, Status Visibility's routing-based
   * narrowing (ADR-0020) is skipped entirely for this Role, on every request,
   * regardless of which module's action triggered the check — the Role sees
   * and edits leads exactly as its ordinary DataScope already allows, as if
   * no Status here ever had an active routing rule. It grants no reach a
   * Role's configured scope does not already have; it only turns off the
   * *narrowing* routing would otherwise add on top of that scope. Meant for
   * a small, deliberately-designated set of admin/oversight Roles — not a
   * general escape hatch, and not implied by `ORGANIZATION` scope or any
   * other permission.
   */
  hasStatusVisibilityBypass(input: { roleId: string; organizationId: string }): Promise<boolean>;
  listAccessibleJourneyIds(input: {
    roleId: string;
    organizationId: string;
  }): Promise<readonly string[]>;
  getFieldVisibility(input: {
    roleId: string;
    organizationId: string;
    fieldIds: readonly string[];
    journeyId?: string;
  }): Promise<readonly FieldVisibilitySnapshot[]>;
  getLeadScope(input: {
    leadId: string;
    organizationId: string;
  }): Promise<LeadScopeSnapshot | null>;
  listActiveUserIds(input: { organizationId: string }): Promise<readonly string[]>;
  listDepartmentUserIds(input: {
    organizationId: string;
    departmentId: string;
  }): Promise<readonly string[]>;
  listReports(input: {
    organizationId: string;
    managerId: string;
  }): Promise<readonly UserSnapshot[]>;
  listCurrentAssignments(input: {
    organizationId: string;
    assignmentTypes: readonly string[];
    journeyIds?: readonly string[];
  }): Promise<readonly AssignmentSnapshot[]>;
  getActiveDirectGrant(input: {
    organizationId: string;
    userId: string;
    leadId: string;
    now: Date;
    action: string;
  }): Promise<DirectGrantSnapshot | null>;
}

export interface AuthorizationRequest {
  organizationId: string;
  userId: string;
  module: string;
  action: string;
  journeyId?: string;
  leadId?: string;
  /**
   * The Status a specific record currently sits in — parallel to `journeyId`,
   * checked only when present. Bulk/list-style callers with no single Status
   * in view leave this unset and rely on `RecordPredicate.hierarchyUserIds`
   * instead (see there).
   */
  statusId?: string;
  requestedFieldIds?: readonly string[];
  requestedEditFieldIds?: readonly string[];
  assignmentTypes?: readonly string[];
  now?: Date;
}

export interface FieldDecision {
  visibleFieldIds: readonly string[];
  editableFieldIds: readonly string[];
  strippedFieldIds: readonly string[];
  rejectedEditFieldIds: readonly string[];
}

export interface RecordPredicate {
  organizationId: string;
  scope: DataScope;
  allowedUserIds: readonly string[] | 'ALL_ORGANIZATION_USERS';
  assignmentTypes: readonly string[];
  journeyIds: readonly string[];
  includeDirectGrantsForUserId: string;
  directGrantAction: string;
  /**
   * Phase 20 — the caller's own id plus every active user reachable
   * downward through `users.manager_id` (i.e. `expandScopeUserIds(...,
   * 'TEAM')`, computed unconditionally regardless of the caller's own
   * granted scope for this action), so a many-row query (the Seller List,
   * export, bulk import matching) can apply the same Status Visibility rule
   * `AuthorizationRequest.statusId` applies to a single record, per process
   * instance, in SQL: unrestricted unless the instance's current Status has
   * an active routing rule, in which case only a process instance with a
   * current assignment to someone in this set passes.
   */
  hierarchyUserIds: readonly string[];
  /**
   * ADR-0021 — this caller's Role holds `leads:bypass_status_visibility`.
   *
   * When true, the SQL/Prisma form of the Status Visibility clause
   * (`filter-sql.ts`'s `statusVisibilityClause`, `prisma-lead-repository.ts`'s
   * `statusVisibleOr`) is skipped entirely for every row this predicate
   * scopes, the many-row mirror of `decision.ts` short-circuiting
   * `statusVisible` to `true` for a single record. `hierarchyUserIds` is
   * still populated when this is true (cheaper to leave it than to thread a
   * conditional through every caller), but no longer consulted.
   */
  bypassesStatusVisibility: boolean;
}

export interface AuthorizationDecision {
  allowed: boolean;
  deniedReasons: readonly PermissionDeniedReason[];
  userId: string;
  organizationId: string;
  roleId: string | null;
  roleVersion: number | null;
  module: string;
  action: string;
  journeyId?: string;
  effectiveScope: DataScope | null;
  journeyAllowed: boolean;
  recordAllowed: boolean;
  directGrantId: string | null;
  fields: FieldDecision;
  recordPredicate: RecordPredicate | null;
  workflowCheck: WorkflowCheck;
}
