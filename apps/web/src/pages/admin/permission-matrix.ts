import type { CapabilitySet, DataScope } from '../../types/domain';

export type PermissionRows = CapabilitySet['permissions'];
export interface CatalogModule {
  module: string;
  label: string;
  actions: string[];
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

export type ModuleSelection = 'none' | 'some' | 'all';

export function moduleSelection(rows: PermissionRows, module: CatalogModule): ModuleSelection {
  const granted = module.actions.filter((action) =>
    hasPermission(rows, module.module, action),
  ).length;
  if (granted === 0) return 'none';
  return granted === module.actions.length ? 'all' : 'some';
}
