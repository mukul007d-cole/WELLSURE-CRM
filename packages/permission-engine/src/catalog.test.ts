import { describe, expect, it } from 'vitest';

import {
  bootstrapGrantedPairs,
  dataScopes,
  isDataScope,
  isGrantedOnBootstrap,
  isPermissionPair,
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
    for (const module of ['leads', 'campaigns', 'attachments', 'lead_routing', 'reports'])
      expect(isPermissionPair(module, 'purge')).toBe(false);
  });
});
