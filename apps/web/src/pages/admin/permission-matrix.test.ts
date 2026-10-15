import { describe, expect, it } from 'vitest';
import type { CapabilitySet } from '../../types/domain';
import {
  actionLabel,
  hasPermission,
  journeyLimit,
  moduleSelection,
  normalizeScopes,
  scopeLabel,
  setAll,
  setJourneyLimit,
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

describe('journey-limited grants (ADR-0026)', () => {
  it('limits one action to some journeys and clears back to every journey', () => {
    const base = rows(['synthetic_module_a', 'view'], ['synthetic_module_a', 'edit']);
    const limited = setJourneyLimit(base, 'synthetic_module_a', 'view', ['journey-x']);

    expect(journeyLimit(limited, 'synthetic_module_a', 'view')).toEqual(['journey-x']);
    expect(journeyLimit(limited, 'synthetic_module_a', 'edit')).toEqual([]);

    const cleared = setJourneyLimit(limited, 'synthetic_module_a', 'view', []);
    expect(journeyLimit(cleared, 'synthetic_module_a', 'view')).toEqual([]);
  });

  it('leaves a never-limited row untouched when cleared, so it does not read as an edit', () => {
    const base = rows(['synthetic_module_a', 'view']);
    expect(setJourneyLimit(base, 'synthetic_module_a', 'view', [])).toEqual(base);
  });

  it('keeps a journey limit through bulk grants, re-scoping and save normalization', () => {
    // A bulk edit that rebuilt rows from module/action/scope alone would
    // silently widen a limited grant back to every journey on the next save.
    const limited = setJourneyLimit(
      rows(['synthetic_module_a', 'view', 'ORGANIZATION']),
      'synthetic_module_a',
      'view',
      ['journey-x'],
    );

    for (const next of [
      setAll(limited, modules, true),
      setModule(limited, leads, true),
      setScopeForAll(limited, 'DEPARTMENT'),
      normalizeScopes(limited, modules),
    ]) {
      expect(journeyLimit(next, 'synthetic_module_a', 'view')).toEqual(['journey-x']);
    }
  });
});

describe('labels', () => {
  it('names the reporting-roles scope and the status-rules bypass for people', () => {
    expect(scopeLabel('REPORTING_ROLES')).toBe('Reporting roles');
    expect(scopeLabel('TEAM')).toBe('Team (reporting line)');
    expect(scopeLabel('SELF')).toBe('SELF');
    expect(actionLabel('bypass_status_rules')).toBe('Bypass status rules');
    // Anything without a curated label keeps the derived one.
    expect(actionLabel('synthetic_action_name')).toBe('synthetic action name');
  });
});
