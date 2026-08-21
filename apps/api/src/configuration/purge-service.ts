import type { FalconPrismaClient } from '@falcon/database';

import { ConfigurationError } from './errors.js';
import { purgeDescriptors, type PurgeEntity, type PurgeTarget } from './purge.js';

export interface PurgeInput {
  organizationId: string;
  actorUserId: string;
  entity: PurgeEntity;
  id: string;
}

export interface PurgeResult {
  entity: PurgeEntity;
  id: string;
  key: string;
  name: string;
  /** Rows removed alongside the entity, by relationship. */
  cascaded: Record<string, number>;
  auditLogId: string;
}

/**
 * Bounded hard-delete for configuration entities. See ADR-0017.
 *
 * The whole operation is one transaction, in a fixed order that each step
 * depends on:
 *
 * 1. **Lock the row.** `FOR UPDATE` is load-bearing rather than ceremony:
 *    inserting a child row takes `FOR KEY SHARE` on its parent, which conflicts
 *    with `FOR UPDATE`, so a concurrent insert of a real dependent serialises
 *    against the purge instead of slipping between the check and the delete.
 * 2. **Refuse an active entity.** Purge is the second half of "deactivate, then
 *    remove", never a shortcut past deactivation's own checks. It also closes
 *    the one race no foreign key covers: an inactive Field cannot acquire a new
 *    `leads.field_values` entry, because lead writes reject values for Fields
 *    not actively mapped to the journey.
 * 3. **Run the entity's guards and blockers**, after the lock, so the answer is
 *    the one that holds at commit.
 * 4. **Snapshot, cascade, delete, audit.** The audit row is written last and
 *    carries the entity's own columns plus every cascaded row, because after
 *    this commits it is the only surviving record of any of it.
 *
 * `SET LOCAL falcon.purge` is what satisfies the `*_no_delete` triggers, which
 * otherwise refuse every delete on `roles`, `journeys`, `statuses`, `fields`
 * and `services`. It is set only here, only after the checks have passed, and
 * dies with the transaction.
 */
export class PurgeService {
  constructor(private readonly prisma: FalconPrismaClient) {}

  async purge(input: PurgeInput): Promise<PurgeResult> {
    const descriptor = purgeDescriptors[input.entity];
    return this.prisma.$transaction(async (transaction) => {
      const tx = transaction as FalconPrismaClient;

      // Tenant-scoped and lock-first. A row in another organization is not
      // found rather than forbidden — the same answer every other route gives.
      await tx.$queryRawUnsafe(
        `SELECT id FROM ${descriptor.table} WHERE organization_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
        input.organizationId,
        input.id,
      );
      const target = await descriptor.load(tx, input.organizationId, input.id);
      if (target === null)
        throw new ConfigurationError('not_found', 'configuration record not found');

      if (target.active)
        throw new ConfigurationError(
          'validation_error',
          `${descriptor.label} must be deactivated before it can be purged`,
          { reason: 'must_be_deactivated_first' },
        );

      const guard = await descriptor.guard?.(tx, input.organizationId, target);
      if (guard !== undefined && guard !== null)
        throw new ConfigurationError('validation_error', `${descriptor.label} cannot be purged`, {
          reason: guard,
        });

      const blocking: Record<string, number> = {};
      for (const blocker of descriptor.blockers) {
        const count = await blocker.count(tx, input.organizationId, input.id);
        if (count > 0) blocking[blocker.name] = count;
      }
      if (Object.keys(blocking).length > 0)
        throw new ConfigurationError(
          'dependency_conflict',
          `${descriptor.label} is still referenced and cannot be purged`,
          blocking,
        );

      // Snapshot before anything is removed: after the commit this is the only
      // record that any of it existed.
      const cascadedRows: Record<string, unknown[]> = {};
      for (const cascade of descriptor.cascades)
        cascadedRows[cascade.name] = await cascade.list(tx, input.organizationId, input.id);

      await tx.$executeRawUnsafe(`SET LOCAL falcon.purge = 'on'`);
      for (const cascade of descriptor.cascades)
        await cascade.remove(tx, input.organizationId, input.id);
      await descriptor.remove(tx, input.organizationId, input.id);

      const audit = await tx.systemAuditLog.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          entityType: descriptor.auditEntityType,
          entityId: input.id,
          action: 'purge',
          // `new_value` is left NULL: the entity has no "after". `old_value`
          // carries the whole of it, which is the only place any of this
          // survives once the transaction commits.
          oldValue: { entity: target, cascaded: cascadedRows } as never,
        },
        select: { id: true },
      });

      return {
        entity: input.entity,
        id: input.id,
        key: target.key,
        name: target.name,
        cascaded: Object.fromEntries(
          Object.entries(cascadedRows).map(([name, rows]) => [name, rows.length]),
        ),
        auditLogId: audit.id,
      };
    });
  }
}

export type { PurgeEntity, PurgeTarget };
