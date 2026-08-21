import type { DataScope } from './types.js';

export const dataScopes = [
  'SELF',
  'TEAM',
  'DEPARTMENT',
  'ORGANIZATION',
] as const satisfies readonly DataScope[];

export const permissionCatalog = [
  {
    module: 'leads',
    label: 'Leads',
    // `import` is deliberately separate from `create`: creating one lead you are
    // looking at and creating thousands from a file are different levels of
    // trust and different blast radii — the same split as `campaigns:send`
    // against `campaigns:edit` below.
    //
    // It is an *additional* gate, never a replacement. Import requires
    // `leads:create` as well, so holding `import` never lets someone create a
    // lead they could not create singly, in a journey they cannot access, or
    // with a Field they cannot edit. See ADR-0016.
    actions: [
      'view',
      'create',
      'edit',
      'comment',
      'delete',
      'export',
      'import',
      'bulk_reassign',
      'bulk_status_change',
    ],
  },
  {
    module: 'fields',
    label: 'Fields',
    actions: ['view', 'create', 'edit', 'delete', 'purge'],
    withheldFromBootstrap: ['purge'],
  },
  {
    module: 'journeys_statuses',
    label: 'Journeys & Statuses',
    actions: ['view', 'create', 'edit', 'delete', 'purge'],
    withheldFromBootstrap: ['purge'],
  },
  {
    module: 'services',
    label: 'Services',
    // No `delete`: deactivating a Service and unmapping one from a Journey both
    // check `edit`. See `docs/permissions/access-model.md`.
    actions: ['view', 'create', 'edit', 'purge'],
    withheldFromBootstrap: ['purge'],
  },
  {
    module: 'users',
    label: 'Users & Departments',
    // `purge` governs **Teams only**. Users are never hard-deleted and neither
    // are Departments — see ADR-0017, which accepts this naming rather than
    // hiding it, on the same footing as `users:edit` conferring Team
    // restructuring without conferring anything about user records.
    actions: ['view', 'create', 'edit', 'deactivate', 'purge'],
    withheldFromBootstrap: ['purge'],
  },
  {
    module: 'roles_permissions',
    label: 'Roles & Permissions',
    // `purge` governs Roles and Notification Rules, the latter because rule
    // administration rides on this module (ADR-0017 D2b).
    actions: ['view', 'create', 'edit', 'purge'],
    withheldFromBootstrap: ['purge'],
  },
  {
    module: 'reports',
    label: 'Reports',
    actions: ['view_standard', 'view_financial', 'build_custom'],
  },
  { module: 'attachments', label: 'Attachments', actions: ['upload', 'download', 'delete'] },
  {
    module: 'campaigns',
    label: 'Campaigns',
    // `send` is deliberately separate from `edit`: composing an email and
    // actually mailing customers are different levels of trust.
    actions: ['view', 'create', 'edit', 'send'],
  },
  {
    module: 'lead_routing',
    label: 'Lead Routing',
    // `configure` decides who *may* receive leads at a Status; `operate` moves
    // one particular lead. Different levels of trust, so neither implies the
    // other — the same split as `campaigns:send` against `campaigns:edit`.
    // `operate` is an additional gate on top of the normal lead checks, never a
    // replacement for them.
    actions: ['view', 'configure', 'operate'],
  },
  { module: 'integrations', label: 'Integrations', actions: ['configure'] },
] as const;

export type PermissionModule = (typeof permissionCatalog)[number]['module'];
export type PermissionAction<M extends PermissionModule = PermissionModule> = Extract<
  (typeof permissionCatalog)[number],
  { module: M }
>['actions'][number];

const pairs = new Set<string>(
  permissionCatalog.flatMap(({ module, actions }) =>
    actions.map((action) => `${module}:${action}`),
  ),
);

export function isPermissionPair(module: string, action: string): boolean {
  return pairs.has(`${module}:${action}`);
}

function withheld(entry: (typeof permissionCatalog)[number]): readonly string[] {
  return 'withheldFromBootstrap' in entry ? entry.withheldFromBootstrap : [];
}

/**
 * Every pair `bootstrapFirstAdmin` grants: the catalog minus each entry's
 * `withheldFromBootstrap` actions.
 *
 * ADR-0009 made bootstrap provision the complete catalog. ADR-0017 amends that
 * for `purge` alone — the one irreversible action, which an administrator must
 * grant deliberately so that enabling it lands in `system_audit_logs` with an
 * actor and a timestamp.
 *
 * The exclusion is expressed here, beside the actions it refers to, rather than
 * as a list inside the bootstrap command. A second place that decides which
 * pairs exist is exactly the defect that made configuration deactivation
 * undeniable-but-ungrantable for every role; it is not being reintroduced.
 */
export function bootstrapGrantedPairs(): { module: string; action: string }[] {
  return permissionCatalog.flatMap((entry) =>
    entry.actions
      .filter((action) => !withheld(entry).includes(action))
      .map((action) => ({ module: entry.module, action })),
  );
}

/**
 * The pairs bootstrap deliberately withholds, as `module:action` strings.
 *
 * Recorded in the bootstrap audit row and printed by the CLI, so a fresh
 * deployment's first `403` on a purge route is explained rather than mysterious.
 */
export function withheldFromBootstrapPairs(): string[] {
  return permissionCatalog
    .flatMap((entry) => withheld(entry).map((action) => `${entry.module}:${action}`))
    .sort();
}

/** Whether a catalog pair is granted by `bootstrapFirstAdmin`. */
export function isGrantedOnBootstrap(module: string, action: string): boolean {
  const entry = permissionCatalog.find((candidate) => candidate.module === module);
  return (
    entry !== undefined &&
    (entry.actions as readonly string[]).includes(action) &&
    !withheld(entry).includes(action)
  );
}

export function isDataScope(scope: string): scope is DataScope {
  return (dataScopes as readonly string[]).includes(scope);
}
