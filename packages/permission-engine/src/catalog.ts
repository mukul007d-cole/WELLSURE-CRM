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
    // `bypass_status_visibility` is a narrow backstop, not a scope. It grants
    // no reach beyond whatever DataScope this role already holds for the
    // action in question — it only turns off Status Visibility's routing-
    // based narrowing (ADR-0020) on top of that scope. Without it, a role
    // whose Users are outside the assignee's `manager_id` chain — an admin
    // or support role least of all placed inside the sales hierarchy, most
    // of all — loses visibility into any lead sitting in a routed Status the
    // instant routing is turned on there, with no way back in. Granted by
    // bootstrap (unlike `purge`): withholding it by default would leave the
    // very first administrator open to exactly that lockout. See ADR-0021.
    actions: [
      'view',
      'create',
      'edit',
      'comment',
      'delete',
      'export',
      'import',
      'bypass_status_visibility',
    ],
    // Which of this module's actions actually consult the granted DataScope
    // — see `scoped()`'s doc comment below for what that means and why most
    // actions in this catalog aren't listed here at all. `create` is absent
    // deliberately: there is no existing lead yet to check "whose is this"
    // against, so scope cannot mean anything for it. `export`/`import` are
    // absent because each reuses `view`'s own scope instead of its own
    // (ADR-0016) — a deliberate, documented substitution, not an oversight.
    // `bypass_status_visibility` is absent because it is a role-level
    // boolean, never a per-record question. See ADR-0022.
    scopedActions: ['view', 'edit', 'comment', 'delete'],
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
    module: 'attachments',
    label: 'Attachments',
    actions: ['upload', 'download', 'delete'],
    // Every action here is checked against the lead the attachment belongs
    // to (`http/routes/attachments.ts`'s `allowedOnLead`), so all three are
    // genuinely scoped — the same record-ownership question `leads` asks.
    scopedActions: ['upload', 'download', 'delete'],
  },
  {
    module: 'campaigns',
    label: 'Campaigns',
    // `send` is deliberately separate from `edit`: composing an email and
    // actually mailing customers are different levels of trust. Neither
    // action's own scope is consulted, though — a Campaign is a global
    // configuration entity like a Journey, not a per-lead record, and
    // `send`'s recipient set is bounded by the sender's own `leads:view`
    // scope instead (ADR-0016), the same substitution `leads:export` uses.
    actions: ['view', 'create', 'edit', 'send'],
  },
  {
    module: 'lead_routing',
    label: 'Lead Routing',
    // `configure` decides who *may* receive leads at a Status; `operate` moves
    // one particular lead. Different levels of trust, so neither implies the
    // other — the same split as `campaigns:send` against `campaigns:edit`.
    // `operate` is an additional gate on top of the normal lead checks, never a
    // replacement for them — and that normal check (`leads:edit`) is where a
    // record is actually named and its own scope actually applies; none of
    // these three actions' own scope is ever consulted.
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

function scoped(entry: (typeof permissionCatalog)[number]): readonly string[] {
  return 'scopedActions' in entry ? entry.scopedActions : [];
}

/**
 * ADR-0022 — does this Role's granted `DataScope` for `module:action`
 * actually decide anything?
 *
 * `resolveAuthorization` computes and returns a `RecordPredicate` for
 * every granted action, unconditionally, because the engine treats every
 * `(module, action, scope)` triple uniformly — one shape, one validation
 * function, one admin UI. But the *scope* half of that triple only changes
 * observable behaviour for an action some caller actually checks against
 * a specific record (`AuthorizationRequest.leadId`, or the equivalent
 * `RecordPredicate` a list/export/campaign query builds from it). Every
 * other action's real behaviour is identical no matter which of
 * SELF/TEAM/DEPARTMENT/ORGANIZATION is stored — picking `SELF` for, say,
 * `users:deactivate` deactivates every User in the organization exactly
 * as `ORGANIZATION` would, because nothing ever asks "whose User is this."
 *
 * An entry with no `scopedActions` at all means *none* of its actions are
 * scoped — most of the catalog. Listed here so the Role editor can show a
 * real, functioning scope selector only where the choice is real, and a
 * plain "Organization-wide" label everywhere else, rather than offering a
 * control that silently does nothing for roughly three-quarters of the
 * catalog.
 */
export function isScopedAction(module: string, action: string): boolean {
  const entry = permissionCatalog.find((candidate) => candidate.module === module);
  return entry !== undefined && scoped(entry).includes(action);
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
