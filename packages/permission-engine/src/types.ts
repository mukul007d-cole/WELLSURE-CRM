export type DataScope = 'SELF' | 'TEAM' | 'DEPARTMENT' | 'ORGANIZATION';
export type FieldAccessLevel = 'VIEW' | 'EDIT';
export type WorkflowCheck = { status: 'not_enforced' };

export type PermissionDeniedReason =
  | 'USER_INACTIVE'
  | 'ROLE_INACTIVE'
  | 'FEATURE_ACTION_DENIED'
  | 'JOURNEY_DENIED'
  | 'RECORD_SCOPE_DENIED'
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
}

export interface AssignmentSnapshot {
  leadId: string;
  processInstanceId: string;
  assignmentType: string;
  userId: string;
  organizationId: string;
  isCurrent: boolean;
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
  getFieldVisibility(input: {
    roleId: string;
    organizationId: string;
    fieldIds: readonly string[];
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
  }): Promise<readonly AssignmentSnapshot[]>;
  getActiveDirectGrant(input: {
    organizationId: string;
    userId: string;
    leadId: string;
    now: Date;
  }): Promise<DirectGrantSnapshot | null>;
}

export interface AuthorizationRequest {
  organizationId: string;
  userId: string;
  module: string;
  action: string;
  journeyId?: string;
  leadId?: string;
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
  includeDirectGrantsForUserId: string;
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
