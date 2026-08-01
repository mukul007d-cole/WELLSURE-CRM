import { describe, expect, it } from 'vitest';

import { dataScopes, isDataScope, isPermissionPair, permissionCatalog } from './catalog.js';

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
});
