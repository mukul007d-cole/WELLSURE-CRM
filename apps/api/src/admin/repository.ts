import type {
  FieldVisibilityInput,
  Page,
  PageRequest,
  PermissionInput,
  RoleVisibilityInput,
  TeamMemberInput,
  UserWriteInput,
} from './types.js';

export interface AdminRepository {
  listUsers(
    org: string,
    page: PageRequest,
    filters: { roleId?: string; departmentId?: string; active?: boolean; search?: string },
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
  /** Null when the field is not in the organization, so the route 404s. */
  listRoleVisibilityForField(org: string, fieldId: string): Promise<RoleVisibilityInput[] | null>;
  replaceRoleVisibilityForField(
    org: string,
    actor: string,
    fieldId: string,
    rows: RoleVisibilityInput[],
  ): Promise<unknown>;
  listDepartments(org: string, page: PageRequest, active?: boolean): Promise<Page<unknown>>;
  getDepartment(org: string, id: string): Promise<unknown>;
  createDepartment(org: string, actor: string, key: string, name: string): Promise<unknown>;
  updateDepartment(org: string, actor: string, id: string, name: string): Promise<unknown>;
  /** Null when the department is not in the organization, so the route 404s. */
  listTeams(
    org: string,
    departmentId: string,
    page: PageRequest,
    active?: boolean,
  ): Promise<Page<unknown> | null>;
  getTeam(org: string, id: string): Promise<unknown>;
  createTeam(
    org: string,
    actor: string,
    departmentId: string,
    key: string,
    name: string,
    members: TeamMemberInput[],
  ): Promise<unknown>;
  updateTeam(org: string, actor: string, id: string, name: string): Promise<unknown>;
  deactivateTeam(org: string, actor: string, id: string): Promise<unknown>;
  replaceTeamMembers(
    org: string,
    actor: string,
    teamId: string,
    members: TeamMemberInput[],
  ): Promise<unknown>;
}
