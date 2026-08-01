import type { FalconPrismaClient } from '@falcon/database';

import { AdminError } from './errors.js';
import type { AdminRepository } from './repository.js';
import type {
  FieldVisibilityInput,
  Page,
  PageRequest,
  PermissionInput,
  UserWriteInput,
} from './types.js';

type Tx = FalconPrismaClient;
const orderBy = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];
const pageArgs = ({ page, pageSize }: PageRequest) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly prisma: FalconPrismaClient) {}

  async listUsers(
    org: string,
    page: PageRequest,
    filters: { roleId?: string; departmentId?: string; active?: boolean },
  ): Promise<Page<unknown>> {
    const where = { organizationId: org, ...filters };
    const [total, items] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, ...pageArgs(page), orderBy, select: userSelect }),
    ]);
    return { ...page, total, items };
  }
  async getUser(org: string, id: string): Promise<unknown> {
    return this.prisma.user.findFirst({ where: { organizationId: org, id }, select: userSelect });
  }

  createUser(
    org: string,
    actor: string,
    input: UserWriteInput,
    reset: { tokenHash: string; expiresAt: Date },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await validateUserRefs(tx as Tx, org, null, input);
      const user = await tx.user.create({
        data: { organizationId: org, ...input, passwordHash: null },
        select: userSelect,
      });
      const token = await tx.passwordResetToken.create({
        data: {
          organizationId: org,
          userId: user.id,
          tokenHash: reset.tokenHash,
          expiresAt: reset.expiresAt,
        },
      });
      await audit(tx as Tx, org, actor, 'user', user.id, 'create', null, {
        ...user,
        initialPasswordTokenId: token.id,
      });
      return { user, resetTokenId: token.id };
    });
  }
  updateUser(org: string, actor: string, id: string, input: UserWriteInput) {
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.user.findFirst({
        where: { organizationId: org, id },
        select: userSelect,
      });
      if (!old) throw new AdminError('not_found', 'user not found');
      await validateUserRefs(tx as Tx, org, id, input);
      const row = await tx.user.update({
        where: { organizationId_id: { organizationId: org, id } },
        data: input,
        select: userSelect,
      });
      await audit(tx as Tx, org, actor, 'user', id, 'edit', old, row);
      return row;
    });
  }
  deactivateUser(org: string, actor: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.user.findFirst({
        where: { organizationId: org, id },
        select: userSelect,
      });
      if (!old) throw new AdminError('not_found', 'user not found');
      if (!old.active) return old;
      const manages = await tx.rolePermission.findFirst({
        where: {
          organizationId: org,
          roleId: old.roleId,
          module: 'roles_permissions',
          action: 'edit',
        },
      });
      if (manages) {
        const remaining = await tx.user.count({
          where: {
            organizationId: org,
            active: true,
            id: { not: id },
            role: { permissions: { some: { module: 'roles_permissions', action: 'edit' } } },
          },
        });
        if (remaining === 0)
          throw new AdminError('conflict', 'cannot deactivate the last permission administrator');
      }
      const row = await tx.user.update({
        where: { organizationId_id: { organizationId: org, id } },
        data: { active: false },
        select: userSelect,
      });
      const revoked = await tx.session.updateMany({
        where: { organizationId: org, userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await audit(tx as Tx, org, actor, 'user', id, 'deactivate', old, {
        ...row,
        revokedSessions: revoked.count,
      });
      return row;
    });
  }

  async listRoles(org: string, page: PageRequest, active?: boolean): Promise<Page<unknown>> {
    const where = { organizationId: org, ...(active === undefined ? {} : { active }) };
    const [total, items] = await Promise.all([
      this.prisma.role.count({ where }),
      this.prisma.role.findMany({ where, ...pageArgs(page), orderBy }),
    ]);
    return { ...page, total, items };
  }
  async getRole(org: string, id: string): Promise<unknown> {
    return this.prisma.role.findFirst({
      where: { organizationId: org, id },
      include: {
        permissions: { orderBy: [{ module: 'asc' }, { action: 'asc' }] },
        journeyAccess: { orderBy: { journeyId: 'asc' } },
        fieldVisibility: { orderBy: { fieldId: 'asc' } },
      },
    });
  }
  createRole(org: string, actor: string, key: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.role.create({
        data: { organizationId: org, key, name, createdById: actor, updatedById: actor },
      });
      await audit(tx as Tx, org, actor, 'role', row.id, 'create', null, row);
      return row;
    });
  }
  updateRole(org: string, actor: string, id: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const old = await role(tx as Tx, org, id);
      const row = await tx.role.update({
        where: { organizationId_id: { organizationId: org, id } },
        data: { name, updatedById: actor, version: { increment: 1 } },
      });
      await audit(tx as Tx, org, actor, 'role', id, 'edit', old, row);
      return row;
    });
  }
  deactivateRole(org: string, actor: string, id: string, replacementRoleId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const old = await role(tx as Tx, org, id);
      const count = await tx.user.count({
        where: { organizationId: org, roleId: id, active: true },
      });
      if (count > 0 && !replacementRoleId)
        throw new AdminError('conflict', 'role has active users', { activeUsers: count });
      if (replacementRoleId) {
        const replacement = await role(tx as Tx, org, replacementRoleId);
        if (!replacement.active || replacement.id === id)
          throw new AdminError(
            'validation_error',
            'replacement role must be a different active role',
          );
        const [oldManages, replacementManages, otherAdministrators] = await Promise.all([
          tx.rolePermission.findFirst({
            where: { organizationId: org, roleId: id, module: 'roles_permissions', action: 'edit' },
          }),
          tx.rolePermission.findFirst({
            where: {
              organizationId: org,
              roleId: replacementRoleId,
              module: 'roles_permissions',
              action: 'edit',
            },
          }),
          tx.user.count({
            where: {
              organizationId: org,
              active: true,
              roleId: { notIn: [id, replacementRoleId] },
              role: { permissions: { some: { module: 'roles_permissions', action: 'edit' } } },
            },
          }),
        ]);
        if (oldManages && !replacementManages && otherAdministrators === 0)
          throw new AdminError(
            'conflict',
            'role reassignment would leave no active permission administrator',
          );
        await tx.user.updateMany({
          where: { organizationId: org, roleId: id, active: true },
          data: { roleId: replacementRoleId },
        });
      }
      const row = await tx.role.update({
        where: { organizationId_id: { organizationId: org, id } },
        data: { active: false, updatedById: actor, version: { increment: 1 } },
      });
      await audit(tx as Tx, org, actor, 'role', id, 'deactivate', old, {
        ...row,
        reassignedUsers: count,
        replacementRoleId,
      });
      return row;
    });
  }
  replacePermissions(org: string, actor: string, roleId: string, rows: PermissionInput[]) {
    return this.prisma.$transaction(async (tx) => {
      const targetRole = await lockRole(tx as Tx, org, roleId);
      if (!targetRole.active) throw new AdminError('conflict', 'cannot edit an inactive role');
      const old = await tx.rolePermission.findMany({
        where: { organizationId: org, roleId },
        select: permissionSelect,
        orderBy: [{ module: 'asc' }, { action: 'asc' }],
      });
      const retainsEdit = rows.some((r) => r.module === 'roles_permissions' && r.action === 'edit');
      const [targetUsers, otherAdministrators] = await Promise.all([
        tx.user.count({
          where: { organizationId: org, active: true, roleId, role: { active: true } },
        }),
        tx.user.count({
          where: {
            organizationId: org,
            active: true,
            roleId: { not: roleId },
            role: {
              active: true,
              permissions: { some: { module: 'roles_permissions', action: 'edit' } },
            },
          },
        }),
      ]);
      if (otherAdministrators + (retainsEdit ? targetUsers : 0) === 0)
        throw new AdminError(
          'conflict',
          'replacement would leave no active permission administrator',
        );
      await tx.rolePermission.deleteMany({ where: { organizationId: org, roleId } });
      if (rows.length)
        await tx.rolePermission.createMany({
          data: rows.map((r) => ({ organizationId: org, roleId, ...r })),
        });
      await bump(tx as Tx, org, roleId, actor);
      await audit(tx as Tx, org, actor, 'role_permission', roleId, 'replace', old, rows);
      return rows;
    });
  }
  replaceJourneyAccess(org: string, actor: string, roleId: string, journeyIds: string[]) {
    return this.prisma.$transaction(async (tx) => {
      await lockRole(tx as Tx, org, roleId);
      const count = await tx.journey.count({
        where: { organizationId: org, id: { in: journeyIds } },
      });
      if (count !== journeyIds.length)
        throw new AdminError(
          'validation_error',
          'one or more journeys are outside the organization',
        );
      const old = (
        await tx.roleJourneyAccess.findMany({
          where: { organizationId: org, roleId },
          select: { journeyId: true },
          orderBy: { journeyId: 'asc' },
        })
      ).map((x) => x.journeyId);
      await tx.roleJourneyAccess.deleteMany({ where: { organizationId: org, roleId } });
      if (journeyIds.length)
        await tx.roleJourneyAccess.createMany({
          data: journeyIds.map((journeyId) => ({ organizationId: org, roleId, journeyId })),
        });
      await bump(tx as Tx, org, roleId, actor);
      await audit(tx as Tx, org, actor, 'role_journey_access', roleId, 'replace', old, journeyIds);
      return journeyIds;
    });
  }
  replaceFieldVisibility(org: string, actor: string, roleId: string, rows: FieldVisibilityInput[]) {
    return this.prisma.$transaction(async (tx) => {
      await lockRole(tx as Tx, org, roleId);
      const count = await tx.field.count({
        where: { organizationId: org, id: { in: rows.map((x) => x.fieldId) } },
      });
      if (count !== rows.length)
        throw new AdminError('validation_error', 'one or more fields are outside the organization');
      const old = await tx.fieldVisibility.findMany({
        where: { organizationId: org, roleId },
        select: { fieldId: true, accessLevel: true },
        orderBy: { fieldId: 'asc' },
      });
      await tx.fieldVisibility.deleteMany({ where: { organizationId: org, roleId } });
      if (rows.length)
        await tx.fieldVisibility.createMany({
          data: rows.map((x) => ({ organizationId: org, roleId, ...x })),
        });
      await bump(tx as Tx, org, roleId, actor);
      await audit(tx as Tx, org, actor, 'field_visibility', roleId, 'replace', old, rows);
      return rows;
    });
  }

  async listDepartments(org: string, page: PageRequest, active?: boolean): Promise<Page<unknown>> {
    const where = { organizationId: org, ...(active === undefined ? {} : { active }) };
    const [total, items] = await Promise.all([
      this.prisma.department.count({ where }),
      this.prisma.department.findMany({ where, ...pageArgs(page), orderBy }),
    ]);
    return { ...page, total, items };
  }
  async getDepartment(org: string, id: string): Promise<unknown> {
    return this.prisma.department.findFirst({ where: { organizationId: org, id } });
  }
  createDepartment(org: string, actor: string, key: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.department.create({
        data: { organizationId: org, key, name, createdById: actor, updatedById: actor },
      });
      await audit(tx as Tx, org, actor, 'department', row.id, 'create', null, row);
      return row;
    });
  }
  updateDepartment(org: string, actor: string, id: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.department.findFirst({ where: { organizationId: org, id } });
      if (!old) throw new AdminError('not_found', 'department not found');
      const row = await tx.department.update({
        where: { organizationId_id: { organizationId: org, id } },
        data: { name, updatedById: actor, version: { increment: 1 } },
      });
      await audit(tx as Tx, org, actor, 'department', id, 'edit', old, row);
      return row;
    });
  }
}

const userSelect = {
  id: true,
  organizationId: true,
  name: true,
  email: true,
  roleId: true,
  departmentId: true,
  managerId: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;
const permissionSelect = { module: true, action: true, scope: true } as const;
async function audit(
  tx: Tx,
  organizationId: string,
  actorUserId: string | null,
  entityType: string,
  entityId: string,
  action: string,
  oldValue: unknown,
  newValue: unknown,
) {
  await tx.systemAuditLog.create({
    data: {
      organizationId,
      actorUserId,
      entityType,
      entityId,
      action,
      oldValue: oldValue as never,
      newValue: newValue as never,
    },
  });
}
async function role(tx: Tx, org: string, id: string) {
  const row = await tx.role.findFirst({ where: { organizationId: org, id } });
  if (!row) throw new AdminError('not_found', 'role not found');
  return row;
}
async function lockRole(tx: Tx, org: string, id: string) {
  await tx.$queryRawUnsafe(
    'SELECT id FROM roles WHERE organization_id = $1::uuid AND id = $2::uuid FOR UPDATE',
    org,
    id,
  );
  return role(tx, org, id);
}
async function bump(tx: Tx, org: string, id: string, actor: string) {
  await tx.role.update({
    where: { organizationId_id: { organizationId: org, id } },
    data: { version: { increment: 1 }, updatedById: actor },
  });
}
async function validateUserRefs(tx: Tx, org: string, userId: string | null, input: UserWriteInput) {
  const roleRow = await tx.role.findFirst({
    where: { organizationId: org, id: input.roleId, active: true },
  });
  if (!roleRow)
    throw new AdminError('validation_error', 'role must be active and in the organization');
  if (
    input.departmentId &&
    !(await tx.department.findFirst({
      where: { organizationId: org, id: input.departmentId, active: true },
    }))
  )
    throw new AdminError('validation_error', 'department must be active and in the organization');
  if (input.managerId) {
    if (input.managerId === userId)
      throw new AdminError('validation_error', 'a user cannot manage themselves');
    let cursor: string | null = input.managerId;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor) || cursor === userId)
        throw new AdminError('validation_error', 'reporting hierarchy cycle');
      seen.add(cursor);
      const manager: { managerId: string | null } | null = await tx.user.findFirst({
        where: { organizationId: org, id: cursor, active: true },
        select: { managerId: true },
      });
      if (!manager)
        throw new AdminError('validation_error', 'manager must be active and in the organization');
      cursor = manager.managerId;
    }
  }
}
