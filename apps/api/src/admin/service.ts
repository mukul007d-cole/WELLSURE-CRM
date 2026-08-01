import type { AuthConfig } from '../auth/config.js';
import { preparePasswordReset, type EmailSender } from '../auth/password-reset.js';
import type { AdminRepository } from './repository.js';
import type { AdminContext, UserWriteInput } from './types.js';
import { configKey, ids, pagination, permissions, text, visibility } from './validation.js';

export class AdminService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly email: EmailSender,
    private readonly authConfig: AuthConfig,
  ) {}
  listUsers(ctx: AdminContext, query: Record<string, unknown>) {
    return this.repository.listUsers(ctx.organizationId, pagination(query.page, query.pageSize), {
      ...(typeof query.roleId === 'string' ? { roleId: query.roleId } : {}),
      ...(typeof query.departmentId === 'string' ? { departmentId: query.departmentId } : {}),
      ...(typeof query.active === 'boolean' ? { active: query.active } : {}),
    });
  }
  getUser(ctx: AdminContext, id: string) {
    return this.repository.getUser(ctx.organizationId, id);
  }
  async createUser(ctx: AdminContext, input: UserWriteInput) {
    const { token, tokenHash, expiresAt } = preparePasswordReset(this.authConfig);
    const result = await this.repository.createUser(
      ctx.organizationId,
      ctx.actorUserId,
      normalizeUser(input),
      { tokenHash, expiresAt },
    );
    // Token persistence and the user commit together. Delivery is retry-safe through the normal reset request flow.
    await this.email.sendPasswordReset({ to: input.email.toLowerCase(), token, expiresAt });
    return result.user;
  }
  updateUser(ctx: AdminContext, id: string, input: UserWriteInput) {
    return this.repository.updateUser(
      ctx.organizationId,
      ctx.actorUserId,
      id,
      normalizeUser(input),
    );
  }
  deactivateUser(ctx: AdminContext, id: string) {
    return this.repository.deactivateUser(ctx.organizationId, ctx.actorUserId, id);
  }
  listRoles(ctx: AdminContext, q: Record<string, unknown>) {
    return this.repository.listRoles(
      ctx.organizationId,
      pagination(q.page, q.pageSize),
      typeof q.active === 'boolean' ? q.active : undefined,
    );
  }
  getRole(ctx: AdminContext, id: string) {
    return this.repository.getRole(ctx.organizationId, id);
  }
  createRole(ctx: AdminContext, key: unknown, name: unknown) {
    return this.repository.createRole(
      ctx.organizationId,
      ctx.actorUserId,
      configKey(key),
      text(name, 'name'),
    );
  }
  updateRole(ctx: AdminContext, id: string, name: unknown) {
    return this.repository.updateRole(ctx.organizationId, ctx.actorUserId, id, text(name, 'name'));
  }
  deactivateRole(ctx: AdminContext, id: string, replacement?: string) {
    return this.repository.deactivateRole(ctx.organizationId, ctx.actorUserId, id, replacement);
  }
  replacePermissions(ctx: AdminContext, id: string, value: unknown) {
    return this.repository.replacePermissions(
      ctx.organizationId,
      ctx.actorUserId,
      id,
      permissions(value),
    );
  }
  replaceJourneyAccess(ctx: AdminContext, id: string, value: unknown) {
    return this.repository.replaceJourneyAccess(
      ctx.organizationId,
      ctx.actorUserId,
      id,
      ids(value, 'journeyIds'),
    );
  }
  replaceFieldVisibility(ctx: AdminContext, id: string, value: unknown) {
    return this.repository.replaceFieldVisibility(
      ctx.organizationId,
      ctx.actorUserId,
      id,
      visibility(value),
    );
  }
  listDepartments(ctx: AdminContext, q: Record<string, unknown>) {
    return this.repository.listDepartments(
      ctx.organizationId,
      pagination(q.page, q.pageSize),
      typeof q.active === 'boolean' ? q.active : undefined,
    );
  }
  getDepartment(ctx: AdminContext, id: string) {
    return this.repository.getDepartment(ctx.organizationId, id);
  }
  createDepartment(ctx: AdminContext, key: unknown, name: unknown) {
    return this.repository.createDepartment(
      ctx.organizationId,
      ctx.actorUserId,
      configKey(key),
      text(name, 'name'),
    );
  }
  updateDepartment(ctx: AdminContext, id: string, name: unknown) {
    return this.repository.updateDepartment(
      ctx.organizationId,
      ctx.actorUserId,
      id,
      text(name, 'name'),
    );
  }
}
function normalizeUser(input: UserWriteInput): UserWriteInput {
  return {
    ...input,
    name: text(input.name, 'name'),
    email: text(input.email, 'email').toLowerCase(),
  };
}
