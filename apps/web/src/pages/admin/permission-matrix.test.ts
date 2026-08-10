import { describe, expect, it } from 'vitest';
import type { CapabilitySet } from '../../types/domain';
import {
  hasPermission,
  moduleSelection,
  setAll,
  setModule,
  setPermission,
  setScopeForAll,
  type CatalogModule,
} from './permission-matrix';

const leads: CatalogModule = {
  module: 'synthetic_module_a',
  label: 'Synthetic module A',
  actions: ['view', 'edit', 'delete'],
};
const users: CatalogModule = {
  module: 'synthetic_module_b',
  label: 'Synthetic module B',
  actions: ['view', 'create'],
};
const modules = [leads, users];

const rows = (...pairs: [string, string, string?][]): CapabilitySet['permissions'] =>
  pairs.map(([module, action, scope]) => ({
    module,
    action,
    scope: (scope ?? 'SELF') as CapabilitySet['permissions'][number]['scope'],
  }));

describe('permission matrix bulk edits', () => {
  it('grants every action across every module in one step', () => {
    const next = setAll([], modules, true);

    expect(next).toHaveLength(5);
    expect(hasPermission(next, 'synthetic_module_a', 'delete')).toBe(true);
    expect(hasPermission(next, 'synthetic_module_b', 'create')).toBe(true);
  });

  it('clears everything', () => {
    expect(setAll(setAll([], modules, true), modules, false)).toEqual([]);
  });

  it('keeps a scope a user already chose when bulk-granting', () => {
    // Otherwise "grant all" would quietly downgrade a deliberate ORGANIZATION
    // grant back to SELF.
    const existing = rows(['synthetic_module_a', 'view', 'ORGANIZATION']);
    const next = setAll(existing, modules, true);

    expect(next.find((r) => r.module === 'synthetic_module_a' && r.action === 'view')?.scope).toBe(
      'ORGANIZATION',
    );
    expect(next.find((r) => r.module === 'synthetic_module_a' && r.action === 'edit')?.scope).toBe(
      'SELF',
    );
  });

  it('selects and clears a single module without touching the others', () => {
    const granted = setModule(setAll([], modules, true), leads, false);

    expect(granted.some((r) => r.module === 'synthetic_module_a')).toBe(false);
    expect(granted.filter((r) => r.module === 'synthetic_module_b')).toHaveLength(2);
  });

  it('reports partial selection so the module control can reflect it', () => {
    expect(moduleSelection([], leads)).toBe('none');
    expect(moduleSelection(rows(['synthetic_module_a', 'view']), leads)).toBe('some');
    expect(moduleSelection(setModule([], leads, true), leads)).toBe('all');
  });

  it('re-scopes every granted action without granting anything new', () => {
    const before = rows(['synthetic_module_a', 'view'], ['synthetic_module_b', 'create']);
    const after = setScopeForAll(before, 'DEPARTMENT');

    expect(after).toHaveLength(before.length);
    expect(after.every((row) => row.scope === 'DEPARTMENT')).toBe(true);
  });

  it('toggles one action without duplicating it', () => {
    const once = setPermission([], 'synthetic_module_a', 'view', true);
    const twice = setPermission(once, 'synthetic_module_a', 'view', true);

    expect(twice).toHaveLength(1);
    expect(setPermission(twice, 'synthetic_module_a', 'view', false)).toEqual([]);
  });
});
