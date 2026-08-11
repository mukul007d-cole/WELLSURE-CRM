import type { DataScope, FieldAccessLevel } from '@falcon/permission-engine';

export interface PageRequest {
  page: number;
  pageSize: number;
}
export interface Page<T> extends PageRequest {
  total: number;
  items: T[];
}
export interface PermissionInput {
  module: string;
  action: string;
  scope: DataScope;
}
export interface FieldVisibilityInput {
  fieldId: string;
  accessLevel: FieldAccessLevel;
}
/**
 * The same `field_visibility` row seen from the Field side: one field's access
 * for one role. `FieldVisibilityInput` is the role-side projection of the same
 * table.
 */
export interface RoleVisibilityInput {
  roleId: string;
  accessLevel: FieldAccessLevel;
}
export interface UserWriteInput {
  name: string;
  email: string;
  roleId: string;
  departmentId: string | null;
  managerId: string | null;
}
export interface AdminContext {
  organizationId: string;
  actorUserId: string;
}
