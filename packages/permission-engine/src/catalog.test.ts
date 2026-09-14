import { describe, expect, it } from 'vitest';

import {
  bootstrapGrantedPairs,
  dataScopes,
  isDataScope,
  isGrantedOnBootstrap,
  isPermissionPair,
  isScopedAction,
  permissionCatalog,
} from './catalog.js';

describe('permission catalog', () => {
  it('contains unique module/action pairs', () => {
    const pairs = permissionCatalog.flatMap(({ module, actions }) =>
      actions.map((action) => `${module}:${action}`),
    );
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(isPermissionPair('roles_permissions', 'view')).toBe(true);
    expect(isPermissionPair('roles_permissions', 'unknown')).toBe(false);
  });

  it('publishes only the permission engine scopes', () => {
    expect(dataScopes).toEqual(['SELF', 'TEAM', 'DEPARTMENT', 'ORGANIZATION']);
    expect(isDataScope('ORGANIZATION')).toBe(true);
    expect(isDataScope('GLOBAL')).toBe(false);
  });

  it('withholds only real actions of its own module from bootstrap', () => {
    for (const entry of permissionCatalog) {
      if (!('withheldFromBootstrap' in entry)) continue;
      for (const action of entry.withheldFromBootstrap)
        expect(entry.actions as readonly string[]).toContain(action);
    }
  });

  /**
   * `purge` is the only action bootstrap does not grant (ADR-0017). Asserted as
   * an equality against the whole catalog rather than as a spot check, so
   * adding an action without deciding whether bootstrap grants it fails here.
   */
  it('grants every catalog pair on bootstrap except purge', () => {
    const granted = new Set(
      bootstrapGrantedPairs().map(({ module, action }) => `${module}:${action}`),
    );
    const all = permissionCatalog.flatMap(({ module, actions }) =>
      actions.map((action) => `${module}:${action}`),
    );
    expect(all.filter((pair) => !granted.has(pair)).sort()).toEqual([
      'fields:purge',
      'journeys_statuses:purge',
      'roles_permissions:purge',
      'services:purge',
      'users:purge',
    ]);
    expect(isGrantedOnBootstrap('fields', 'delete')).toBe(true);
    expect(isGrantedOnBootstrap('fields', 'purge')).toBe(false);
    expect(isGrantedOnBootstrap('fields', 'unknown')).toBe(false);
  });

  /** Every purge pair is a real pair, so a route can gate on one. */
  it('defines purge on exactly the five modules that own purgeable entities', () => {
    for (const module of ['journeys_statuses', 'fields', 'services', 'users', 'roles_permissions'])
      expect(isPermissionPair(module, 'purge')).toBe(true);
    for (const module of ['leads', 'campaigns', 'attachments', 'lead_routing'])
      expect(isPermissionPair(module, 'purge')).toBe(false);
  });

  /**
   * ADR-0021: unlike `purge`, this backstop is granted by bootstrap, on
   * purpose — withholding it would leave the very first administrator open
   * to the exact lockout it exists to prevent. The equality assertion above
   * already pins this (the pair isn't in the withheld list), but the intent
   * deserves its own name rather than riding silently on that list staying
   * unchanged.
   */
  it('grants leads:bypass_status_visibility on bootstrap, unlike purge', () => {
    expect(isPermissionPair('leads', 'bypass_status_visibility')).toBe(true);
    expect(isGrantedOnBootstrap('leads', 'bypass_status_visibility')).toBe(true);
  });

  /**
   * ADR-0022: these were grantable — bootstrap even granted them, since
   * none were `withheldFromBootstrap` — but honoured by no route. Retired
   * outright rather than left as permissions an admin could check with no
   * effect. `reports` is gone as a module entirely, not just missing these
   * three actions.
   */
  it('no longer defines the reports module or the two unimplemented leads bulk actions', () => {
    // Cast to `string`: TypeScript narrows `entry.module` to the catalog's
    // real module literals, so comparing against a retired one is now a
    // compile error in application code — exactly the point, but this test
    // needs to check the *runtime* absence deliberately.
    const modules: string[] = permissionCatalog.map((entry) => entry.module);
    expect(modules).not.toContain('reports');
    for (const action of ['view_standard', 'view_financial', 'build_custom'])
      expect(isPermissionPair('reports', action)).toBe(false);
    for (const action of ['bulk_reassign', 'bulk_status_change'])
      expect(isPermissionPair('leads', action)).toBe(false);
  });
});

/**
 * ADR-0022 — `isScopedAction`: whether a granted `DataScope` actually
 * decides anything for a `module:action` pair, versus being stored but
 * never consulted by any route. Backs the Role editor's decision to show
 * a real scope selector only where the choice is real.
 */
describe('isScopedAction', () => {
  it('is true only for the leads actions checked against a real, existing lead', () => {
    for (const action of ['view', 'edit', 'comment', 'delete'])
      expect(isScopedAction('leads', action)).toBe(true);
    // `create` has no existing lead to scope against yet; `export`/`import`
    // and `bypass_status_visibility` each have a documented reason of
    // their own (ADR-0016, ADR-0021) for never consulting their own scope.
    for (const action of ['create', 'export', 'import', 'bypass_status_visibility'])
      expect(isScopedAction('leads', action)).toBe(false);
  });

  it('is true for every attachments action — each checks the lead the attachment belongs to', () => {
    for (const action of ['upload', 'download', 'delete'])
      expect(isScopedAction('attachments', action)).toBe(true);
  });

  it('is false for every action of a module with no per-record concept at all', () => {
    const unscopedModules: Array<[string, readonly string[]]> = [
      ['fields', ['view', 'create', 'edit', 'delete', 'purge']],
      ['journeys_statuses', ['view', 'create', 'edit', 'delete', 'purge']],
      ['services', ['view', 'create', 'edit', 'purge']],
      ['users', ['view', 'create', 'edit', 'deactivate', 'purge']],
      ['roles_permissions', ['view', 'create', 'edit', 'purge']],
      ['campaigns', ['view', 'create', 'edit', 'send']],
      ['lead_routing', ['view', 'configure', 'operate']],
      ['integrations', ['configure']],
    ];
    for (const [module, actions] of unscopedModules)
      for (const action of actions) expect(isScopedAction(module, action)).toBe(false);
  });

  it('is false for an unknown module or action rather than throwing', () => {
    expect(isScopedAction('unknown_module', 'view')).toBe(false);
    expect(isScopedAction('leads', 'unknown_action')).toBe(false);
  });
});
