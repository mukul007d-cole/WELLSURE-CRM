import { describe, expect, it } from 'vitest';
import type { AdminUser } from '../../types/domain';
import { buildHierarchy, type OrgNode } from './org-hierarchy';

function user(id: string, name: string, managerId: string | null): AdminUser {
  return {
    id,
    name,
    email: `${id}@example.test`,
    roleId: 'role-a',
    departmentId: null,
    managerId,
    active: true,
  };
}

/** Every node in the built forest, so we can assert nobody is lost or cloned. */
function flatten(nodes: readonly OrgNode[]): string[] {
  return nodes.flatMap((node) => [node.user.id, ...flatten(node.children)]);
}

describe('buildHierarchy', () => {
  it('nests reports under their manager, sorted by name', () => {
    const { roots, warnings } = buildHierarchy([
      user('u1', 'Root One', null),
      user('u3', 'Zoe Report', 'u1'),
      user('u2', 'Adam Report', 'u1'),
    ]);

    expect(warnings).toEqual([]);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.children.map((child) => child.user.name)).toEqual([
      'Adam Report',
      'Zoe Report',
    ]);
  });

  it('supports several people with no manager', () => {
    const { roots } = buildHierarchy([
      user('u1', 'Root A', null),
      user('u2', 'Root B', null),
      user('u3', 'Report', 'u1'),
    ]);

    expect(roots.map((node) => node.user.id)).toEqual(['u1', 'u2']);
    expect(roots.every((node) => node.rootReason === 'no_manager')).toBe(true);
  });

  it('keeps a user whose manager is outside the returned set, and warns', () => {
    const { roots, warnings } = buildHierarchy([user('u1', 'Orphan', 'missing-manager')]);

    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({
      rootReason: 'manager_missing',
      danglingManagerId: 'missing-manager',
    });
    expect(warnings).toEqual([{ kind: 'dangling', names: ['Orphan'] }]);
  });

  it('breaks a two-node cycle instead of hanging', () => {
    const { roots, warnings } = buildHierarchy([user('a', 'Ada', 'b'), user('b', 'Ben', 'a')]);

    expect(roots.map((node) => node.user.id).sort()).toEqual(['a', 'b']);
    expect(roots.every((node) => node.rootReason === 'cycle')).toBe(true);
    expect([...(roots[0]!.cycleWith ?? [])].sort()).toEqual(['a', 'b']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.kind).toBe('cycle');
    expect([...warnings[0]!.names].sort()).toEqual(['Ada', 'Ben']);
  });

  it('flattens a three-node cycle but keeps clean reports hanging off it', () => {
    const input = [
      user('a', 'Ada', 'c'),
      user('b', 'Ben', 'a'),
      user('c', 'Cai', 'b'),
      user('d', 'Dee', 'a'), // reports into the ring but isn't part of it
      user('e', 'Eli', 'd'),
    ];
    const { roots } = buildHierarchy(input);

    const ringRoots = roots.filter((node) => node.rootReason === 'cycle');
    expect(ringRoots.map((node) => node.user.id).sort()).toEqual(['a', 'b', 'c']);

    // Dee still hangs off Ada, and Eli off Dee — nobody is orphaned by the loop.
    const ada = roots.find((node) => node.user.id === 'a')!;
    expect(ada.children.map((child) => child.user.id)).toEqual(['d']);
    expect(ada.children[0]!.children.map((child) => child.user.id)).toEqual(['e']);

    // The strongest invariant: every input appears exactly once in the output.
    const flat = flatten(roots);
    expect(flat).toHaveLength(input.length);
    expect(new Set(flat).size).toBe(input.length);
  });

  it('treats a self-manager as a one-person loop', () => {
    const { roots, warnings } = buildHierarchy([user('a', 'Ada', 'a')]);

    expect(roots).toHaveLength(1);
    expect(roots[0]!.rootReason).toBe('cycle');
    expect(warnings).toEqual([{ kind: 'cycle', names: ['Ada'] }]);
  });

  it('returns every user exactly once even with mixed defects', () => {
    const input = [
      user('a', 'Ada', 'b'),
      user('b', 'Ben', 'a'),
      user('c', 'Cai', null),
      user('d', 'Dee', 'c'),
      user('e', 'Eli', 'ghost'),
      user('f', 'Fay', 'f'),
    ];
    const flat = flatten(buildHierarchy(input).roots);

    expect(flat).toHaveLength(input.length);
    expect(new Set(flat)).toEqual(new Set(input.map((entry) => entry.id)));
  });
});
