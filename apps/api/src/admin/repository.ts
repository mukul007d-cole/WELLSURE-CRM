import type {
  FieldVisibilityInput,
  Page,
  PageRequest,
  PermissionInput,
  UserWriteInput,
} from './types.js';

export interface AdminRepository {
  listUsers(
    org: string,
    page: PageRequest,
    filters: { roleId?: string; departmentId?: string; active?: boolean },
  ): Promise<Page<unknown>>;
  getUser(org: string, id: string): Promise<unknown>;
  createUser(
    org: string,
    actor: string,
    input: UserWriteInput,
    reset: { tokenHash: string; expiresAt: Date },
  ): Promise<{ user: unknown; resetTokenId: string }>;
  updateUser(org: string, actor: string, id: string, input: UserWriteInput): Promise<unknown>;
  deactivateUser(org: string, actor: string, id: string): Promise<unknown>;
  listRoles(org: string, page: PageRequest, active?: boolean): Promise<Page<unknown>>;
  getRole(org: string, id: string): Promise<unknown>;
  createRole(org: string, actor: string, key: string, name: string): Promise<unknown>;
  updateRole(org: string, actor: string, id: string, name: string): Promise<unknown>;
  deactivateRole(
    org: string,
    actor: string,
    id: string,
    replacementRoleId?: string,
  ): Promise<unknown>;
  replacePermissions(
    org: string,
    actor: string,
    roleId: string,
    rows: PermissionInput[],
  ): Promise<unknown>;
  replaceJourneyAccess(
    org: string,
    actor: string,
    roleId: string,
    journeyIds: string[],
  ): Promise<unknown>;
  replaceFieldVisibility(
    org: string,
    actor: string,
    roleId: string,
    rows: FieldVisibilityInput[],
  ): Promise<unknown>;
  listDepartments(org: string, page: PageRequest, active?: boolean): Promise<Page<unknown>>;
  getDepartment(org: string, id: string): Promise<unknown>;
  createDepartment(org: string, actor: string, key: string, name: string): Promise<unknown>;
  updateDepartment(org: string, actor: string, id: string, name: string): Promise<unknown>;
}
