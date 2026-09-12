import type { CapabilitySet, DataScope } from '../../types/domain';

export type PermissionRows = CapabilitySet['permissions'];
export interface CatalogModule {
  module: string;
  label: string;
  actions: string[];
  /** ADR-0022 — see `isActionScoped`. */
  scopedActions?: string[];
}

/**
 * ADR-0022 — does this action's granted DataScope actually decide
 * anything, or would every one of SELF/TEAM/DEPARTMENT/ORGANIZATION behave
 * identically? Most of the catalog is the latter: an action the server
 * never checks against a specific record (every configuration/admin
 * module, a Campaign, routing configuration itself) has no "whose record
 * is this" question for a scope to answer. Backs the Role editor's
 * decision to show a real selector only where the choice is real.
 */
export function isActionScoped(module: CatalogModule, action: string): boolean {
  return (module.scopedActions ?? []).includes(action);
}

/**
 * The scope a Role's permission rows for an unscoped action should be
 * saved with — not because it's enforced (it isn't, by definition), but so
 * the stored data reads as the true, unconditional-everywhere behavior
 * rather than an arbitrary leftover from whichever value happened to be
 * selected (or defaulted) before this action was recognized as unscoped.
 */
const unscopedStorageValue: DataScope = 'ORGANIZATION';

/**
 * Normalizes every unscoped action's stored scope to
 * `unscopedStorageValue`, leaving genuinely scoped actions untouched.
 *
 * Applied once, at the boundary where the editor's local state becomes the
 * request body (`RoleDetailPage`'s save mutation) — not on every keystroke
 * or bulk edit — so a role loaded with a stale scope from before this
 * distinction existed (or from "Set all scopes…", which does not know
 * which rows are unscoped) is corrected the next time it's saved, without
 * needing a separate data migration to rewrite rows that were never
 * behaviorally wrong, only cosmetically misleading.
 */
export function normalizeScopes(
  rows: PermissionRows,
  modules: readonly CatalogModule[],
): PermissionRows {
  const byModule = new Map(modules.map((module) => [module.module, module]));
  return rows.map((row) => {
    const module = byModule.get(row.module);
    if (module === undefined || isActionScoped(module, row.action)) return row;
    return { ...row, scope: unscopedStorageValue };
  });
}

/**
 * Pure helpers behind the permission matrix's bulk controls.
 *
 * Granting a role every action across a dozen modules was one checkbox at a
 * time, which is both tedious and easy to get wrong. These operate on the
 * complete desired-state array the API already expects, so a bulk edit is
 * still exactly one PUT — no new endpoint, and no partially-applied state.
 */
export function hasPermission(rows: PermissionRows, module: string, action: string): boolean {
  return rows.some((row) => row.module === module && row.action === action);
}

export function setPermission(
  rows: PermissionRows,
  module: string,
  action: string,
  granted: boolean,
  scope: DataScope = 'SELF',
): PermissionRows {
  const without = rows.filter((row) => row.module !== module || row.action !== action);
  return granted ? [...without, { module, action, scope }] : without;
}

/** Grant or revoke every action on one module in a single step. */
export function setModule(
  rows: PermissionRows,
  module: CatalogModule,
  granted: boolean,
  scope: DataScope = 'SELF',
): PermissionRows {
  const without = rows.filter((row) => row.module !== module.module);
  if (!granted) return without;
  // Preserve the scope already chosen for an action rather than flattening it.
  return [
    ...without,
    ...module.actions.map((action) => ({
      module: module.module,
      action,
      scope:
        rows.find((row) => row.module === module.module && row.action === action)?.scope ?? scope,
    })),
  ];
}

/** Grant or revoke everything the catalog offers. */
export function setAll(
  rows: PermissionRows,
  modules: readonly CatalogModule[],
  granted: boolean,
  scope: DataScope = 'SELF',
): PermissionRows {
  if (!granted) return [];
  return modules.flatMap((module) =>
    module.actions.map((action) => ({
      module: module.module,
      action,
      scope:
        rows.find((row) => row.module === module.module && row.action === action)?.scope ?? scope,
    })),
  );
}

/** Re-scope every currently granted action — the common "make this role org-wide" move. */
export function setScopeForAll(rows: PermissionRows, scope: DataScope): PermissionRows {
  return rows.map((row) => ({ ...row, scope }));
}

/**
 * How a data scope is named in the UI.
 *
 * `TEAM` is qualified deliberately. Phase 14a added Teams as an entity under
 * Departments, and this scope has nothing to do with them — it resolves through
 * the reporting hierarchy (ADR-0006, ADR-0014). The bare token "TEAM" beside a
 * product that also has Teams reads as though the two are connected, and this
 * label plus `scopeHint` is the whole mitigation for that collision.
 */
export function scopeLabel(scope: DataScope): string {
  return scope === 'TEAM' ? 'Team (reporting line)' : scope;
}

export const scopeHint =
  'Team (reporting line) means everyone reporting to this user through the org chart, at any depth. It is not related to Teams configured under Departments.';

export const unscopedHint =
  "This action isn't checked against any specific record, so a narrower scope would have no effect — granting it reaches the whole organization.";

export type ModuleSelection = 'none' | 'some' | 'all';

export function moduleSelection(rows: PermissionRows, module: CatalogModule): ModuleSelection {
  const granted = module.actions.filter((action) =>
    hasPermission(rows, module.module, action),
  ).length;
  if (granted === 0) return 'none';
  return granted === module.actions.length ? 'all' : 'some';
}
