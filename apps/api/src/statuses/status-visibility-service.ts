import type { FalconPrismaClient } from '@falcon/database';

import { StatusVisibilityError } from './errors.js';

type Tx = FalconPrismaClient;

/**
 * Configuration surface for Status Visibility (Phase 19): which Roles may
 * see a lead while it sits in a given Status.
 *
 * Deliberately its own service, not a method group on `RoutingRuleService`,
 * even though `replaceGrants` below is its direct template — the two are
 * surface-similar (`status_routing_permissions` also being a per-(status,
 * role) allow-list) but answer different questions: routing gates who may
 * *operate* a Status's assignment; this gates who may *see* a lead in it.
 * Keeping them in separate files keeps that distinction visible in the
 * codebase layout, not just in a comment.
 */
export class StatusVisibilityService {
  constructor(private readonly prisma: FalconPrismaClient) {}

  async listGrants(organizationId: string, statusId: string) {
    const status = await this.prisma.status.findFirst({
      where: { organizationId, id: statusId },
      select: { id: true },
    });
    if (!status) return null;
    // Allow-list semantics: a role with no row is absent, not returned as a
    // third state. Zero rows for the whole Status means unrestricted — the
    // caller (and the UI) must not read an empty array as "visible to no
    // Role"; there is deliberately no way to configure that state.
    return this.prisma.statusVisibility.findMany({
      where: { organizationId, statusId },
      select: { roleId: true },
      orderBy: { roleId: 'asc' },
    });
  }

  /**
   * Replace one Status's complete Role allow-list.
   *
   * Gated by the caller on `roles_permissions:edit`, never on
   * `journeys_statuses:*` — an admin who can configure Statuses but not edit
   * permissions must not be able to grant visibility rights, including to
   * their own Role. Same self-escalation rule `field_visibility` and
   * `status_routing_permissions` already follow.
   */
  replaceGrants(organizationId: string, actorUserId: string, statusId: string, roleIds: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const status = await tx.status.findFirst({ where: { organizationId, id: statusId } });
      if (!status) throw new StatusVisibilityError('not_found', 'status not found');
      const known = await tx.role.count({ where: { organizationId, id: { in: roleIds } } });
      if (known !== roleIds.length)
        throw new StatusVisibilityError(
          'validation_error',
          'one or more roles are outside the organization',
        );

      const old = await tx.statusVisibility.findMany({
        where: { organizationId, statusId },
        select: { roleId: true },
        orderBy: { roleId: 'asc' },
      });
      await tx.statusVisibility.deleteMany({ where: { organizationId, statusId } });
      if (roleIds.length > 0)
        await tx.statusVisibility.createMany({
          data: roleIds.map((roleId) => ({ organizationId, statusId, roleId })),
        });
      /*
       * Every affected role's version is bumped — roles *losing* visibility
       * included, or their cached authorization decisions would look
       * unchanged. Roles are bumped in sorted id order so two concurrent
       * replaces touching an overlapping role set queue instead of
       * deadlocking. Both points are `replaceRoleVisibilityForField`'s and
       * `RoutingRuleService.replaceGrants`'s reasoning, applied verbatim.
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
        'status_visibility',
        statusId,
        'replace',
        old,
        roleIds.map((roleId) => ({ roleId })),
      );
      return roleIds.map((roleId) => ({ roleId }));
    });
  }
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
