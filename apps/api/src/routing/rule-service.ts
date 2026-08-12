import type { FalconPrismaClient } from '@falcon/database';

import { RoutingError } from './errors.js';
import type { RoutingAction, RoutingGrantInput, RuleInput } from './validation.js';

type Tx = FalconPrismaClient;

const ruleInclude = { members: { select: { userId: true }, orderBy: { userId: 'asc' as const } } };

/**
 * Configuration and read surface for per-Status routing rules.
 *
 * Separate from `StatusRoutingService`, which is the trigger consumer that
 * actually assigns leads: administering a rule and firing one are different
 * operations under different permissions, and keeping them in one class would
 * make it easy to reach the fire path from a configuration route by accident.
 */
export class RoutingRuleService {
  constructor(private readonly prisma: FalconPrismaClient) {}

  async get(organizationId: string, statusId: string) {
    const status = await this.prisma.status.findFirst({
      where: { organizationId, id: statusId },
      select: { id: true },
    });
    if (!status) return null;
    // Null rule is a legitimate answer — an unrouted Status — so the envelope
    // distinguishes "no such status" (404) from "no rule yet" (200 with null).
    const rule = await this.prisma.statusRoutingRule.findFirst({
      where: { organizationId, statusId },
      include: ruleInclude,
    });
    return { statusId, rule };
  }

  /** Whole-rule replace, including its member set. */
  replace(organizationId: string, actorUserId: string, statusId: string, input: RuleInput) {
    return this.prisma.$transaction(async (tx) => {
      const status = await tx.status.findFirst({ where: { organizationId, id: statusId } });
      if (!status) throw new RoutingError('not_found', 'status not found');
      if (!status.active)
        throw new RoutingError('conflict', 'cannot configure routing on an inactive Status');
      await validatePool(tx as Tx, organizationId, input);

      const old = await tx.statusRoutingRule.findFirst({
        where: { organizationId, statusId },
        include: ruleInclude,
      });

      const rule = old
        ? await lockAndUpdate(tx as Tx, organizationId, old.id, actorUserId, input)
        : await tx.statusRoutingRule.create({
            data: {
              organizationId,
              journeyId: status.journeyId,
              statusId,
              assignmentType: input.assignmentType,
              algorithm: input.algorithm,
              poolType: input.poolType,
              teamId: input.teamId,
              createdById: actorUserId,
              updatedById: actorUserId,
            },
          });

      await tx.statusRoutingRuleMember.deleteMany({ where: { organizationId, ruleId: rule.id } });
      if (input.userIds.length > 0)
        await tx.statusRoutingRuleMember.createMany({
          data: input.userIds.map((userId) => ({ organizationId, ruleId: rule.id, userId })),
        });

      await audit(
        tx as Tx,
        organizationId,
        actorUserId,
        'status_routing_rule',
        statusId,
        'replace',
        old,
        {
          ...rule,
          userIds: input.userIds,
        },
      );
      return (await tx.statusRoutingRule.findFirst({
        where: { organizationId, id: rule.id },
        include: ruleInclude,
      }))!;
    });
  }

  /** Clearing a rule deactivates it, so its cursor and history survive. */
  deactivate(organizationId: string, actorUserId: string, statusId: string) {
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.statusRoutingRule.findFirst({ where: { organizationId, statusId } });
      if (!old) throw new RoutingError('not_found', 'routing rule not found');
      if (!old.active) return old;
      const rule = await tx.statusRoutingRule.update({
        where: { organizationId_id: { organizationId, id: old.id } },
        data: { active: false, updatedById: actorUserId, version: { increment: 1 } },
      });
      await audit(
        tx as Tx,
        organizationId,
        actorUserId,
        'status_routing_rule',
        statusId,
        'deactivate',
        old,
        rule,
      );
      return rule;
    });
  }

  /**
   * The live picture the operate UI needs: who the cursor points at, and what
   * each candidate is currently carrying.
   */
  async state(organizationId: string, statusId: string) {
    const found = await this.get(organizationId, statusId);
    if (found === null) return null;
    if (found.rule === null || !found.rule.active) return { statusId, rule: null, candidates: [] };
    const rule = found.rule;

    const poolUserIds =
      rule.poolType === 'team'
        ? (
            await this.prisma.teamMember.findMany({
              where: { organizationId, teamId: rule.teamId ?? '' },
              select: { userId: true },
            })
          ).map((row) => row.userId)
        : rule.members.map((row) => row.userId);

    const users = await this.prisma.user.findMany({
      where: { organizationId, id: { in: poolUserIds }, active: true },
      select: { id: true, name: true, email: true },
      orderBy: { id: 'asc' },
    });
    const counts = await this.prisma.assignment.groupBy({
      by: ['userId'],
      where: {
        organizationId,
        isCurrent: true,
        assignmentType: rule.assignmentType,
        userId: { in: users.map((user) => user.id) },
        processInstance: { active: true, currentStatus: { outcomeType: 'open' } },
      },
      _count: { _all: true },
    });
    const byUser = new Map(counts.map((row) => [row.userId, row._count._all]));
    return {
      statusId,
      rule,
      candidates: users.map((user) => ({
        userId: user.id,
        name: user.name,
        email: user.email,
        openCount: byUser.get(user.id) ?? 0,
        isNext: rule.cursorUserId === user.id,
      })),
    };
  }

  /* ------------------------------------------------- per-Status role grants */

  async listGrants(organizationId: string, statusId: string) {
    const status = await this.prisma.status.findFirst({
      where: { organizationId, id: statusId },
      select: { id: true },
    });
    if (!status) return null;
    // Allow-list semantics: a role with no row is absent, not returned as a
    // third state. The caller joins against GET /roles.
    return this.prisma.statusRoutingPermission.findMany({
      where: { organizationId, statusId },
      select: { roleId: true, action: true },
      orderBy: [{ roleId: 'asc' }, { action: 'asc' }],
    });
  }

  /**
   * Replace one Status's complete grant set.
   *
   * Gated by the caller on `roles_permissions:edit`, never on
   * `lead_routing:configure` — a routing administrator who cannot edit
   * permissions must not be able to grant routing rights, including to their own
   * role. Same rule `field_visibility` already follows.
   */
  replaceGrants(
    organizationId: string,
    actorUserId: string,
    statusId: string,
    rows: RoutingGrantInput[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const status = await tx.status.findFirst({ where: { organizationId, id: statusId } });
      if (!status) throw new RoutingError('not_found', 'status not found');
      const roleIds = [...new Set(rows.map((row) => row.roleId))];
      const known = await tx.role.count({ where: { organizationId, id: { in: roleIds } } });
      if (known !== roleIds.length)
        throw new RoutingError(
          'validation_error',
          'one or more roles are outside the organization',
        );

      const old = await tx.statusRoutingPermission.findMany({
        where: { organizationId, statusId },
        select: { roleId: true, action: true },
        orderBy: [{ roleId: 'asc' }, { action: 'asc' }],
      });
      await tx.statusRoutingPermission.deleteMany({ where: { organizationId, statusId } });
      if (rows.length > 0)
        await tx.statusRoutingPermission.createMany({
          data: rows.map((row) => ({ organizationId, statusId, ...row })),
        });
      /*
       * Every affected role's version is bumped — roles *losing* a grant
       * included, or their cached authorization decisions would look unchanged.
       * Roles are bumped in sorted id order so two concurrent replaces touching
       * an overlapping role set queue instead of deadlocking. Both points are
       * `replaceRoleVisibilityForField`'s reasoning, and they apply verbatim.
       */
      const affected = [...new Set([...roleIds, ...old.map((row) => row.roleId)])].sort();
      for (const roleId of affected)
        await tx.role.update({
          where: { organizationId_id: { organizationId, id: roleId } },
          data: { version: { increment: 1 }, updatedById: actorUserId },
        });
      await audit(
        tx as Tx,
        organizationId,
        actorUserId,
        'status_routing_permission',
        statusId,
        'replace',
        old,
        rows,
      );
      return rows;
    });
  }

  /**
   * Does this role hold `action` on this Status?
   *
   * The per-Status half of the decision. The caller must have already resolved
   * the `lead_routing:<action>` module decision — both are required, exactly as
   * `leads:view` plus a `field_visibility` row are both required for a Field.
   */
  async roleHasGrant(input: {
    organizationId: string;
    statusId: string;
    roleId: string;
    action: RoutingAction;
  }): Promise<boolean> {
    return (
      (await this.prisma.statusRoutingPermission.findFirst({
        where: {
          organizationId: input.organizationId,
          statusId: input.statusId,
          roleId: input.roleId,
          action: input.action,
        },
        select: { id: true },
      })) !== null
    );
  }
}

async function lockAndUpdate(
  tx: Tx,
  organizationId: string,
  id: string,
  actorUserId: string,
  input: RuleInput,
) {
  await tx.$queryRawUnsafe(
    'SELECT id FROM status_routing_rules WHERE organization_id = $1::uuid AND id = $2::uuid FOR UPDATE',
    organizationId,
    id,
  );
  return tx.statusRoutingRule.update({
    where: { organizationId_id: { organizationId, id } },
    data: {
      assignmentType: input.assignmentType,
      algorithm: input.algorithm,
      poolType: input.poolType,
      teamId: input.teamId,
      active: true,
      updatedById: actorUserId,
      version: { increment: 1 },
      // A pool change invalidates the cursor: it named a position in the old
      // membership. Resetting restarts the rotation rather than resuming from a
      // user who may no longer be in it.
      ...(input.poolType === 'team' ? { cursorUserId: null } : {}),
    },
  });
}

async function validatePool(tx: Tx, organizationId: string, input: RuleInput) {
  if (input.poolType === 'team') {
    const team = await tx.team.findFirst({
      where: { organizationId, id: input.teamId ?? '', active: true },
      select: { id: true },
    });
    if (!team)
      throw new RoutingError('validation_error', 'team must be active and in the organization');
    return;
  }
  const users = await tx.user.findMany({
    where: { organizationId, id: { in: input.userIds }, active: true },
    select: { id: true },
  });
  const found = new Set(users.map((user) => user.id));
  const invalid = input.userIds.filter((id) => !found.has(id));
  if (invalid.length > 0)
    throw new RoutingError('validation_error', 'every pool member must be an active user', {
      userIds: invalid,
    });
}

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
