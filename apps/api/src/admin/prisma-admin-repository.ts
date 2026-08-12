import type { FalconPrismaClient } from '@falcon/database';

import { AdminError } from './errors.js';
import type { AdminRepository } from './repository.js';
import type {
  FieldVisibilityInput,
  Page,
  PageRequest,
  PermissionInput,
  RoleVisibilityInput,
  TeamMemberInput,
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
    filters: { roleId?: string; departmentId?: string; active?: boolean; search?: string },
  ): Promise<Page<unknown>> {
    const { search, ...exact } = filters;
    const where = {
      organizationId: org,
      ...exact,
      ...(search === undefined
        ? {}
        : {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }),
    };
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
      /*
       * Team membership is confined to the Team's Department, so moving a user
       * out of a Department must end their memberships in it. This runs *before*
       * the update deliberately: the composite foreign key on `team_members`
       * references `users(organization_id, department_id, id)`, so leaving a
       * stale row behind does not corrupt anything — it makes the update fail.
       * Doing it here is what turns that failure into correct behaviour.
       */
      if (input.departmentId !== old.departmentId)
        await endTeamMemberships(tx as Tx, org, actor, id, 'department_changed');
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
      // A deactivated user must not stay in a routing pool: Phase 14b assigns
      // leads to Team members, and an inactive one would keep receiving them.
      await endTeamMemberships(tx as Tx, org, actor, id, 'user_deactivated');
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
  async listRoleVisibilityForField(
    org: string,
    fieldId: string,
  ): Promise<RoleVisibilityInput[] | null> {
    const field = await this.prisma.field.findFirst({
      where: { organizationId: org, id: fieldId },
    });
    if (!field) return null;
    // Allow-list semantics: roles with no row are absent, not returned as a
    // third state. The caller joins against GET /roles.
    return this.prisma.fieldVisibility.findMany({
      where: { organizationId: org, fieldId },
      select: { roleId: true, accessLevel: true },
      orderBy: { roleId: 'asc' },
    });
  }
  /**
   * The Field-side transpose of `replaceFieldVisibility`: replaces one field's
   * complete row set across every role in the organization.
   *
   * Two things differ from the role-side method, both load-bearing:
   * every affected role's version is bumped — roles *losing* access included,
   * or their cached decisions would look unchanged — and the roles are locked
   * in sorted id order, so two concurrent field-side replaces touching an
   * overlapping role set queue instead of deadlocking.
   */
  replaceRoleVisibilityForField(
    org: string,
    actor: string,
    fieldId: string,
    rows: RoleVisibilityInput[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockField(tx as Tx, org, fieldId);
      const count = await tx.role.count({
        where: { organizationId: org, id: { in: rows.map((x) => x.roleId) } },
      });
      if (count !== rows.length)
        throw new AdminError('validation_error', 'one or more roles are outside the organization');
      const old = await tx.fieldVisibility.findMany({
        where: { organizationId: org, fieldId },
        select: { roleId: true, accessLevel: true },
        orderBy: { roleId: 'asc' },
      });
      const affectedRoleIds = [
        ...new Set([...rows.map((x) => x.roleId), ...old.map((x) => x.roleId)]),
      ].sort();
      for (const roleId of affectedRoleIds) await lockRole(tx as Tx, org, roleId);
      await tx.fieldVisibility.deleteMany({ where: { organizationId: org, fieldId } });
      if (rows.length)
        await tx.fieldVisibility.createMany({
          data: rows.map((x) => ({ organizationId: org, fieldId, ...x })),
        });
      for (const roleId of affectedRoleIds) await bump(tx as Tx, org, roleId, actor);
      // A distinct action from the role-side 'replace': both carry
      // entity_type 'field_visibility', but entity_id means a role there and a
      // field here, and an auditor has to be able to tell them apart.
      await audit(
        tx as Tx,
        org,
        actor,
        'field_visibility',
        fieldId,
        'replace_field_roles',
        old,
        rows,
      );
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

  /* ------------------------------------------------------------------ Teams */

  async listTeams(
    org: string,
    departmentId: string,
    page: PageRequest,
    active?: boolean,
  ): Promise<Page<unknown> | null> {
    const department = await this.prisma.department.findFirst({
      where: { organizationId: org, id: departmentId },
      select: { id: true },
    });
    if (!department) return null;
    const where = {
      organizationId: org,
      departmentId,
      ...(active === undefined ? {} : { active }),
    };
    const [total, items] = await Promise.all([
      this.prisma.team.count({ where }),
      this.prisma.team.findMany({ where, ...pageArgs(page), orderBy, include: teamInclude }),
    ]);
    return { ...page, total, items };
  }
  async getTeam(org: string, id: string): Promise<unknown> {
    return this.prisma.team.findFirst({ where: { organizationId: org, id }, include: teamInclude });
  }
  /**
   * A Team is created with its member set, not empty and populated afterwards:
   * the at-least-one-leader rule would otherwise be false for the window in
   * between, which is exactly the state it exists to prevent.
   */
  createTeam(
    org: string,
    actor: string,
    departmentId: string,
    key: string,
    name: string,
    members: TeamMemberInput[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.findFirst({
        where: { organizationId: org, id: departmentId },
      });
      if (!department) throw new AdminError('not_found', 'department not found');
      if (!department.active)
        throw new AdminError('conflict', 'cannot add a Team to an inactive Department');
      await validateTeamMembers(tx as Tx, org, departmentId, members);
      const row = await tx.team.create({
        data: {
          organizationId: org,
          departmentId,
          key,
          name,
          createdById: actor,
          updatedById: actor,
        },
      });
      await tx.teamMember.createMany({
        data: members.map((member) => ({
          organizationId: org,
          teamId: row.id,
          departmentId,
          userId: member.userId,
          isLeader: member.isLeader,
        })),
      });
      await audit(tx as Tx, org, actor, 'team', row.id, 'create', null, { ...row, members });
      return { ...row, members };
    });
  }
  updateTeam(org: string, actor: string, id: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const old = await lockTeam(tx as Tx, org, id);
      if (!old.active) throw new AdminError('conflict', 'cannot edit an inactive Team');
      const row = await tx.team.update({
        where: { organizationId_id: { organizationId: org, id } },
        data: { name, updatedById: actor, version: { increment: 1 } },
      });
      await audit(tx as Tx, org, actor, 'team', id, 'edit', old, row);
      return row;
    });
  }
  /** Soft only — Teams are never hard deleted, per AGENTS.md. */
  deactivateTeam(org: string, actor: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const old = await lockTeam(tx as Tx, org, id);
      if (!old.active) return old;
      const row = await tx.team.update({
        where: { organizationId_id: { organizationId: org, id } },
        data: { active: false, updatedById: actor, version: { increment: 1 } },
      });
      await audit(tx as Tx, org, actor, 'team', id, 'deactivate', old, row);
      return row;
    });
  }
  /**
   * Replaces a Team's complete member set, following the same whole-set
   * semantics as `replaceFieldVisibility` and `replaceJourneyAccess`: idempotent,
   * one audit row carrying both the before and after sets, and no incremental
   * patch ordering to get wrong.
   *
   * The team row is locked first, so two concurrent replaces queue and the
   * winner's set survives intact rather than interleaving.
   */
  replaceTeamMembers(org: string, actor: string, teamId: string, members: TeamMemberInput[]) {
    return this.prisma.$transaction(async (tx) => {
      const team = await lockTeam(tx as Tx, org, teamId);
      if (!team.active) throw new AdminError('conflict', 'cannot edit an inactive Team');
      await validateTeamMembers(tx as Tx, org, team.departmentId, members);
      const old = await tx.teamMember.findMany({
        where: { organizationId: org, teamId },
        select: memberSelect,
        orderBy: { userId: 'asc' },
      });
      await tx.teamMember.deleteMany({ where: { organizationId: org, teamId } });
      await tx.teamMember.createMany({
        data: members.map((member) => ({
          organizationId: org,
          teamId,
          departmentId: team.departmentId,
          userId: member.userId,
          isLeader: member.isLeader,
        })),
      });
      await bumpTeam(tx as Tx, org, teamId, actor);
      await audit(tx as Tx, org, actor, 'team_member', teamId, 'replace', old, members);
      return members;
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
const memberSelect = { userId: true, isLeader: true } as const;
const teamInclude = {
  members: {
    select: {
      ...memberSelect,
      user: { select: { name: true, email: true, active: true } },
    },
    // Leaders first, then a stable order, so the UI never has to sort.
    orderBy: [{ isLeader: 'desc' as const }, { userId: 'asc' as const }],
  },
};
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
async function lockField(tx: Tx, org: string, id: string) {
  await tx.$queryRawUnsafe(
    'SELECT id FROM fields WHERE organization_id = $1::uuid AND id = $2::uuid FOR UPDATE',
    org,
    id,
  );
  const row = await tx.field.findFirst({ where: { organizationId: org, id } });
  if (!row) throw new AdminError('not_found', 'field not found');
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
async function lockTeam(tx: Tx, org: string, id: string) {
  await tx.$queryRawUnsafe(
    'SELECT id FROM teams WHERE organization_id = $1::uuid AND id = $2::uuid FOR UPDATE',
    org,
    id,
  );
  const row = await tx.team.findFirst({ where: { organizationId: org, id } });
  if (!row) throw new AdminError('not_found', 'team not found');
  return row;
}
async function bumpTeam(tx: Tx, org: string, id: string, actor: string) {
  await tx.team.update({
    where: { organizationId_id: { organizationId: org, id } },
    data: { version: { increment: 1 }, updatedById: actor },
  });
}
/**
 * Every proposed member must be an active User of *this* Team's Department.
 *
 * The composite foreign key on `team_members` enforces the department half in
 * the database too — this exists so an admin gets a 400 naming the offending
 * user instead of a constraint violation surfacing as a 500, and so the
 * active-user half (which no key can express) is checked at all.
 */
async function validateTeamMembers(
  tx: Tx,
  org: string,
  departmentId: string,
  members: readonly TeamMemberInput[],
) {
  if (members.length === 0) return;
  const eligible = await tx.user.findMany({
    where: {
      organizationId: org,
      departmentId,
      active: true,
      id: { in: members.map((member) => member.userId) },
    },
    select: { id: true },
  });
  const found = new Set(eligible.map((user) => user.id));
  const invalid = members.filter((member) => !found.has(member.userId)).map((m) => m.userId);
  if (invalid.length > 0)
    throw new AdminError(
      'validation_error',
      'every member must be an active user of this Department',
      { userIds: invalid.sort() },
    );
}
/**
 * Removes a user from every Team they belong to, for a reason that is not an
 * admin editing a Team — a Department change or a deactivation.
 *
 * Where this differs from a member replace: the at-least-one-leader rule binds
 * *configuration*, and this is not configuration. Refusing to deactivate a
 * departing employee because they lead a Team would put a routing-config
 * invariant ahead of a personnel action, which is the wrong trade. So the
 * membership goes, and if that leaves an active Team with no leader the Team is
 * deactivated in the same transaction instead. "An **active** Team has at least
 * one leader" therefore stays true at every commit, without any HR operation
 * ever being blocked. Reactivating it is an ordinary edit once a leader exists.
 *
 * Teams are locked in sorted id order so two of these running at once — two
 * users leaving overlapping Teams — queue instead of deadlocking.
 */
async function endTeamMemberships(
  tx: Tx,
  org: string,
  actor: string,
  userId: string,
  reason: 'department_changed' | 'user_deactivated',
) {
  const memberships = await tx.teamMember.findMany({
    where: { organizationId: org, userId },
    select: { teamId: true, isLeader: true },
  });
  if (memberships.length === 0) return;
  const affected = [...memberships].sort((a, b) => a.teamId.localeCompare(b.teamId));
  for (const membership of affected) await lockTeam(tx, org, membership.teamId);
  await tx.teamMember.deleteMany({ where: { organizationId: org, userId } });
  for (const membership of affected) {
    await audit(
      tx,
      org,
      actor,
      'team_member',
      membership.teamId,
      'remove_user',
      { userId, isLeader: membership.isLeader },
      { reason },
    );
    const leaders = await tx.teamMember.count({
      where: { organizationId: org, teamId: membership.teamId, isLeader: true },
    });
    const team = await tx.team.findFirst({
      where: { organizationId: org, id: membership.teamId },
    });
    if (team === null) continue;
    if (leaders === 0 && team.active) {
      const row = await tx.team.update({
        where: { organizationId_id: { organizationId: org, id: membership.teamId } },
        data: { active: false, updatedById: actor, version: { increment: 1 } },
      });
      await audit(tx, org, actor, 'team', membership.teamId, 'deactivate', team, {
        ...row,
        reason: 'last_leader_removed',
      });
    } else {
      await bumpTeam(tx, org, membership.teamId, actor);
    }
  }
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
