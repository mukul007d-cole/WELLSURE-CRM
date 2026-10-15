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
  /** ADR-0026 — journeys this action is limited to; empty = every accessible journey. */
  journeyIds: string[];
}

export interface JourneyMembersInput {
  restrictToMembers: boolean;
  userIds: string[];
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
/**
 * One member of a Team. A leader is a member with `isLeader`, never a separate
 * row or a column on the team, so "a leader is in their own team" is structural.
 */
export interface TeamMemberInput {
  userId: string;
  isLeader: boolean;
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
