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
   * Phase 19 — may this Role see a lead currently sitting in this Status?
   *
   * A Status with zero `status_visibility` rows is unrestricted (this must
   * return `true` for every Role); once a Status has any row at all, this
   * returns `true` only for a Role a row names. See
   * docs/planning/phase-19-status-scoped-role-visibility.md — this is the
   * one consequential default-state decision the whole feature turns on, and
   * every implementation of this method must encode it identically.
   */
  hasStatusVisibility(input: {
    roleId: string;
    organizationId: string;
    statusId: string;
  }): Promise<boolean>;
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
   * checked via `hasStatusVisibility` only when present. Bulk/list-style
   * callers with no single Status in view leave this unset and rely on
   * `RecordPredicate.roleId` instead (see there).
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
   * Phase 19 — the caller's own Role id, so a many-row query (the Seller
   * List, export, bulk import matching) can apply the same
   * `hasStatusVisibility` rule `AuthorizationRequest.statusId` applies to a
   * single record, per process instance, in SQL: unrestricted unless the
   * instance's current Status has any `status_visibility` row, in which case
   * only a row naming this Role passes.
   */
  roleId: string;
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
