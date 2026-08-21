import type { FalconPrismaClient } from '@falcon/database';

/**
 * What every purgeable configuration entity depends on, in one table.
 *
 * ADR-0017 splits referencing rows into two classes, and the split is decided
 * per relationship rather than by counting rows:
 *
 * - **`blockers`** — rows with independent identity, or belonging to *another*
 *   entity's configuration. Any one of them refuses the purge with
 *   `dependency_conflict`. A purge never deletes one.
 * - **`cascades`** — pure relationship and grant rows describing only this
 *   entity's participation, which nothing references by id. Deleted with the
 *   entity, snapshotted into the audit row first.
 *
 * That is the line `docs/data-model/prisma-translation-notes.md` already draws
 * between versioned configuration entities and current-state mappings; this
 * applies it to a new operation rather than inventing it. What keeps purge safe
 * survives intact: nothing can be orphaned, because nothing references a
 * mapping row's id, and nothing is lost, because every cascaded row is in
 * `old_value`.
 *
 * **Four of the blockers are not foreign keys.** `leads.field_values` is a JSONB
 * object keyed by field id; `campaigns.filter` and `import_jobs.mapping_json`
 * carry field and journey ids inside JSON. No constraint would ever fire for
 * them, which is why this table exists instead of "attempt the delete and see".
 *
 * **Standing obligation:** a future feature that stores a configuration id in a
 * new JSONB column will not be caught by the foreign keys and will not be
 * caught here either. Add it below. Nothing else will notice.
 */

type Tx = FalconPrismaClient;

export type PurgeEntity =
  'journey' | 'status' | 'field' | 'service' | 'team' | 'role' | 'notification_rule';

/** The columns every purgeable entity shares, plus whatever else it carries. */
export interface PurgeTarget {
  id: string;
  key: string;
  name: string;
  active: boolean;
  [column: string]: unknown;
}

interface Blocker {
  /** Reported in the `dependency_conflict` details, so it names a relationship. */
  name: string;
  /** Physical table, so coverage can be checked against the real foreign keys. */
  table: string;
  count(tx: Tx, organizationId: string, id: string): Promise<number>;
}

interface Cascade {
  name: string;
  table: string;
  list(tx: Tx, organizationId: string, id: string): Promise<unknown[]>;
  remove(tx: Tx, organizationId: string, id: string): Promise<void>;
}

export interface PurgeDescriptor {
  /** The module whose `purge` action gates this entity. */
  module: 'journeys_statuses' | 'fields' | 'services' | 'users' | 'roles_permissions';
  /** `system_audit_logs.entity_type` — identical to what deactivation writes. */
  auditEntityType: string;
  /** Physical table, for the `FOR UPDATE` row lock. */
  table: string;
  /** Human label used in the refusal message. */
  label: string;
  load(tx: Tx, organizationId: string, id: string): Promise<PurgeTarget | null>;
  /** A refusal beyond dependents. Returns a machine-readable reason, or null. */
  guard?(tx: Tx, organizationId: string, target: PurgeTarget): Promise<string | null>;
  blockers: readonly Blocker[];
  cascades: readonly Cascade[];
  remove(tx: Tx, organizationId: string, id: string): Promise<void>;
}

/* -------------------------------------------------------------- raw probes */

async function rawCount(tx: Tx, sql: string, ...params: unknown[]): Promise<number> {
  const rows = await tx.$queryRawUnsafe<{ count: number }[]>(sql, ...params);
  return rows[0]?.count ?? 0;
}

/**
 * Rows whose JSONB column mentions `id` at `path`, at any depth.
 *
 * `$.**` is a recursive descent, so this keeps working if the stored shape of a
 * filter or an import mapping changes — which it has once already, and which a
 * hand-written path expression would silently stop matching.
 */
function jsonPathCount(table: string, column: string, path: string): Blocker['count'] {
  return (tx, organizationId, id) =>
    rawCount(
      tx,
      `SELECT count(*)::int AS count FROM ${table}
        WHERE organization_id = $1::uuid
          AND jsonb_path_exists(${column}, '${path}', jsonb_build_object('v', $2::text))`,
      organizationId,
      id,
    );
}

/* ------------------------------------------------------------- descriptors */

const journeyServices: Cascade = {
  name: 'journeyServices',
  table: 'journey_services',
  list: (tx, organizationId, journeyId) =>
    tx.journeyService.findMany({ where: { organizationId, journeyId } }),
  remove: async (tx, organizationId, journeyId) => {
    await tx.journeyService.deleteMany({ where: { organizationId, journeyId } });
  },
};

export const purgeDescriptors: Record<PurgeEntity, PurgeDescriptor> = {
  journey: {
    module: 'journeys_statuses',
    auditEntityType: 'journey',
    table: 'journeys',
    label: 'Journey',
    load: (tx, organizationId, id) => tx.journey.findFirst({ where: { organizationId, id } }),
    blockers: [
      {
        // Statuses are entities, not mappings: they have their own key, audit
        // history and purge route. A Journey's Statuses are purged first.
        name: 'statuses',
        table: 'statuses',
        count: (tx, organizationId, journeyId) =>
          tx.status.count({ where: { organizationId, journeyId } }),
      },
      {
        name: 'processInstances',
        table: 'process_instances',
        count: (tx, organizationId, journeyId) =>
          tx.processInstance.count({ where: { organizationId, journeyId } }),
      },
      {
        name: 'campaigns',
        table: 'campaigns',
        count: (tx, organizationId, journeyId) =>
          tx.campaign.count({ where: { organizationId, journeyId } }),
      },
      {
        name: 'importJobs',
        table: 'import_jobs',
        count: jsonPathCount('import_jobs', 'mapping_json', '$.journeyId ? (@ == $v)'),
      },
    ],
    cascades: [
      {
        name: 'roleJourneyAccess',
        table: 'role_journey_access',
        list: (tx, organizationId, journeyId) =>
          tx.roleJourneyAccess.findMany({ where: { organizationId, journeyId } }),
        remove: async (tx, organizationId, journeyId) => {
          await tx.roleJourneyAccess.deleteMany({ where: { organizationId, journeyId } });
        },
      },
      journeyServices,
      {
        name: 'fieldJourneySettings',
        table: 'field_journey_settings',
        list: (tx, organizationId, journeyId) =>
          tx.fieldJourneySetting.findMany({ where: { organizationId, journeyId } }),
        remove: async (tx, organizationId, journeyId) => {
          await tx.fieldJourneySetting.deleteMany({ where: { organizationId, journeyId } });
        },
      },
    ],
    remove: async (tx, organizationId, id) => {
      await tx.journey.delete({ where: { organizationId_id: { organizationId, id } } });
    },
  },

  status: {
    module: 'journeys_statuses',
    auditEntityType: 'status',
    table: 'statuses',
    label: 'Status',
    load: (tx, organizationId, id) => tx.status.findFirst({ where: { organizationId, id } }),
    blockers: [
      {
        name: 'processInstances',
        table: 'process_instances',
        count: (tx, organizationId, statusId) =>
          tx.processInstance.count({ where: { organizationId, currentStatusId: statusId } }),
      },
      {
        name: 'tasks',
        table: 'tasks',
        count: (tx, organizationId, statusId) =>
          tx.task.count({ where: { organizationId, createdFromStatusId: statusId } }),
      },
      {
        name: 'campaigns',
        table: 'campaigns',
        count: (tx, organizationId, statusId) =>
          tx.campaign.count({ where: { organizationId, statusId } }),
      },
      {
        // A configured rule with its own version and audit trail, not a mapping.
        name: 'statusRoutingRules',
        table: 'status_routing_rules',
        count: (tx, organizationId, statusId) =>
          tx.statusRoutingRule.count({ where: { organizationId, statusId } }),
      },
      {
        // Another entity's configuration: a Field requires this Status.
        name: 'fieldJourneySettings',
        table: 'field_journey_settings',
        count: (tx, organizationId, statusId) =>
          tx.fieldJourneySetting.count({
            where: { organizationId, requiredFromStatusId: statusId },
          }),
      },
    ],
    cascades: [
      {
        name: 'statusRoutingPermissions',
        table: 'status_routing_permissions',
        list: (tx, organizationId, statusId) =>
          tx.statusRoutingPermission.findMany({ where: { organizationId, statusId } }),
        remove: async (tx, organizationId, statusId) => {
          await tx.statusRoutingPermission.deleteMany({ where: { organizationId, statusId } });
        },
      },
    ],
    remove: async (tx, organizationId, id) => {
      await tx.status.delete({ where: { organizationId_id: { organizationId, id } } });
    },
  },

  field: {
    module: 'fields',
    auditEntityType: 'field',
    table: 'fields',
    label: 'Field',
    load: (tx, organizationId, id) => tx.field.findFirst({ where: { organizationId, id } }),
    blockers: [
      {
        // No foreign key exists for this: `field_values` is a JSONB object
        // keyed by field id. `jsonb_exists` is the `?` operator's function
        // form, spelled out because `?` is ambiguous through a raw-query layer.
        name: 'leads',
        table: 'leads',
        count: (tx, organizationId, fieldId) =>
          rawCount(
            tx,
            `SELECT count(*)::int AS count FROM leads
              WHERE organization_id = $1::uuid AND jsonb_exists(field_values, $2)`,
            organizationId,
            fieldId,
          ),
      },
      {
        name: 'attachments',
        table: 'attachments',
        count: (tx, organizationId, fieldId) =>
          tx.attachment.count({ where: { organizationId, fieldId } }),
      },
      {
        name: 'campaigns',
        table: 'campaigns',
        count: jsonPathCount('campaigns', 'filter', '$.**.fieldId ? (@ == $v)'),
      },
      {
        name: 'importJobs',
        table: 'import_jobs',
        count: jsonPathCount('import_jobs', 'mapping_json', '$.**.fieldId ? (@ == $v)'),
      },
    ],
    cascades: [
      {
        name: 'fieldJourneySettings',
        table: 'field_journey_settings',
        list: (tx, organizationId, fieldId) =>
          tx.fieldJourneySetting.findMany({ where: { organizationId, fieldId } }),
        remove: async (tx, organizationId, fieldId) => {
          await tx.fieldJourneySetting.deleteMany({ where: { organizationId, fieldId } });
        },
      },
      {
        name: 'fieldVisibility',
        table: 'field_visibility',
        list: (tx, organizationId, fieldId) =>
          tx.fieldVisibility.findMany({ where: { organizationId, fieldId } }),
        remove: async (tx, organizationId, fieldId) => {
          await tx.fieldVisibility.deleteMany({ where: { organizationId, fieldId } });
        },
      },
    ],
    remove: async (tx, organizationId, id) => {
      await tx.field.delete({ where: { organizationId_id: { organizationId, id } } });
    },
  },

  service: {
    module: 'services',
    auditEntityType: 'service',
    table: 'services',
    label: 'Service',
    load: (tx, organizationId, id) => tx.service.findFirst({ where: { organizationId, id } }),
    blockers: [
      {
        name: 'leadServices',
        table: 'lead_services',
        count: (tx, organizationId, serviceId) =>
          tx.leadService.count({ where: { organizationId, serviceId } }),
      },
    ],
    cascades: [
      {
        name: 'journeyServices',
        table: 'journey_services',
        list: (tx, organizationId, serviceId) =>
          tx.journeyService.findMany({ where: { organizationId, serviceId } }),
        remove: async (tx, organizationId, serviceId) => {
          await tx.journeyService.deleteMany({ where: { organizationId, serviceId } });
        },
      },
    ],
    remove: async (tx, organizationId, id) => {
      await tx.service.delete({ where: { organizationId_id: { organizationId, id } } });
    },
  },

  team: {
    // `users:purge` governs Teams **only**. Users and Departments are never
    // hard-deleted. ADR-0017 accepts the naming rather than hiding it.
    module: 'users',
    auditEntityType: 'team',
    table: 'teams',
    label: 'Team',
    load: (tx, organizationId, id) => tx.team.findFirst({ where: { organizationId, id } }),
    blockers: [
      {
        name: 'statusRoutingRules',
        table: 'status_routing_rules',
        count: (tx, organizationId, teamId) =>
          tx.statusRoutingRule.count({ where: { organizationId, teamId } }),
      },
    ],
    cascades: [
      {
        // Never empty for a Team that exists — an active Team must have at
        // least one leader — so treating membership as a blocker would make
        // every Team unpurgeable. It is the Team's own membership list and
        // nothing references its row ids.
        name: 'teamMembers',
        table: 'team_members',
        list: (tx, organizationId, teamId) =>
          tx.teamMember.findMany({ where: { organizationId, teamId } }),
        remove: async (tx, organizationId, teamId) => {
          await tx.teamMember.deleteMany({ where: { organizationId, teamId } });
        },
      },
    ],
    remove: async (tx, organizationId, id) => {
      await tx.team.delete({ where: { organizationId_id: { organizationId, id } } });
    },
  },

  role: {
    module: 'roles_permissions',
    auditEntityType: 'role',
    table: 'roles',
    label: 'Role',
    load: (tx, organizationId, id) => tx.role.findFirst({ where: { organizationId, id } }),
    guard: async (tx, organizationId, target) => {
      if (target.isSystemDefault === true) return 'system_default_role';
      /*
       * Defence in depth. Zero `users` is already a blocker and a role with no
       * users contributes no active administrator, so this cannot fire today —
       * it is here so that a future change to what counts as a blocker cannot
       * quietly make the last permission administrator purgeable.
       */
      const administrators = await tx.user.count({
        where: {
          organizationId,
          active: true,
          roleId: { not: target.id },
          role: {
            active: true,
            permissions: { some: { module: 'roles_permissions', action: 'edit' } },
          },
        },
      });
      return administrators === 0 ? 'last_permission_administrator' : null;
    },
    blockers: [
      {
        name: 'users',
        table: 'users',
        count: (tx, organizationId, roleId) => tx.user.count({ where: { organizationId, roleId } }),
      },
    ],
    cascades: [
      {
        name: 'rolePermissions',
        table: 'role_permissions',
        list: (tx, organizationId, roleId) =>
          tx.rolePermission.findMany({ where: { organizationId, roleId } }),
        remove: async (tx, organizationId, roleId) => {
          await tx.rolePermission.deleteMany({ where: { organizationId, roleId } });
        },
      },
      {
        name: 'roleJourneyAccess',
        table: 'role_journey_access',
        list: (tx, organizationId, roleId) =>
          tx.roleJourneyAccess.findMany({ where: { organizationId, roleId } }),
        remove: async (tx, organizationId, roleId) => {
          await tx.roleJourneyAccess.deleteMany({ where: { organizationId, roleId } });
        },
      },
      {
        name: 'fieldVisibility',
        table: 'field_visibility',
        list: (tx, organizationId, roleId) =>
          tx.fieldVisibility.findMany({ where: { organizationId, roleId } }),
        remove: async (tx, organizationId, roleId) => {
          await tx.fieldVisibility.deleteMany({ where: { organizationId, roleId } });
        },
      },
      {
        name: 'statusRoutingPermissions',
        table: 'status_routing_permissions',
        list: (tx, organizationId, roleId) =>
          tx.statusRoutingPermission.findMany({ where: { organizationId, roleId } }),
        remove: async (tx, organizationId, roleId) => {
          await tx.statusRoutingPermission.deleteMany({ where: { organizationId, roleId } });
        },
      },
    ],
    remove: async (tx, organizationId, id) => {
      await tx.role.delete({ where: { organizationId_id: { organizationId, id } } });
    },
  },

  notification_rule: {
    module: 'roles_permissions',
    auditEntityType: 'notification_rule',
    table: 'notification_rules',
    label: 'Notification Rule',
    load: (tx, organizationId, id) =>
      tx.notificationRule.findFirst({
        where: { organizationId, id },
      }),
    blockers: [
      {
        // A rule that has ever fired has delivered notifications referencing it.
        name: 'notifications',
        table: 'notifications',
        count: (tx, organizationId, notificationRuleId) =>
          tx.notification.count({ where: { organizationId, notificationRuleId } }),
      },
    ],
    cascades: [
      {
        // The schema's only `onDelete: Cascade`. Removed explicitly anyway, so
        // the rows are snapshotted rather than vanishing inside the database.
        name: 'notificationRuleRecipients',
        table: 'notification_rule_recipients',
        list: (tx, organizationId, ruleId) =>
          tx.notificationRuleRecipient.findMany({ where: { organizationId, ruleId } }),
        remove: async (tx, organizationId, ruleId) => {
          await tx.notificationRuleRecipient.deleteMany({ where: { organizationId, ruleId } });
        },
      },
    ],
    remove: async (tx, organizationId, id) => {
      await tx.notificationRule.delete({ where: { organizationId_id: { organizationId, id } } });
    },
  },
};

export const purgeEntities = Object.keys(purgeDescriptors) as PurgeEntity[];
