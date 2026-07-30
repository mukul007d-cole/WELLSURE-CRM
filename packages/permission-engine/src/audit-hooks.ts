export type PermissionAuditEntityType =
  | 'role'
  | 'role_permission'
  | 'role_journey_access'
  | 'field_visibility'
  | 'user'
  | 'user_access_grant';

export type PermissionAuditAction = 'create' | 'edit' | 'deactivate' | 'revoke' | 'expire';

export interface PermissionAuditHookPayload {
  organizationId: string;
  actorUserId: string;
  entityType: PermissionAuditEntityType;
  entityId: string;
  action: PermissionAuditAction;
  oldValue: unknown;
  newValue: unknown;
}

export function createPermissionAuditPayload(
  input: PermissionAuditHookPayload,
): PermissionAuditHookPayload {
  return input;
}
