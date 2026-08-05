import type { AdminUser } from '../../types/domain';

export type RootReason = 'no_manager' | 'manager_missing' | 'cycle';

export interface OrgNode {
  user: AdminUser;
  children: OrgNode[];
  /** Only set on roots, explaining why this node has no parent. */
  rootReason?: RootReason;
  /** For `manager_missing`: the managerId that wasn't in the returned set. */
  danglingManagerId?: string;
  /** For `cycle`: every user id in the reporting loop, including this one. */
  cycleWith?: string[];
}

export type OrgWarning = { kind: 'cycle'; names: string[] } | { kind: 'dangling'; names: string[] };

export interface OrgHierarchy {
  roots: OrgNode[];
  warnings: OrgWarning[];
}

/**
 * Builds the reporting tree from `managerId` alone.
 *
 * The data can be adversarial in three ways, all of which occur in practice:
 * several people with no manager, a manager who isn't in the returned page set
 * (deactivated, or filtered out by the viewer's scope), and outright reporting
 * loops. A loop must not hang the UI, so the graph is coloured *iteratively* —
 * a recursive walk would exhaust the stack before any depth guard could fire.
 */
export function buildHierarchy(users: readonly AdminUser[]): OrgHierarchy {
  const byId = new Map(users.map((user) => [user.id, user]));
  const state = new Map<string, 'safe' | 'cyclic'>();
  const visiting = new Set<string>();
  const rings: string[][] = [];

  for (const user of users) {
    if (state.has(user.id)) continue;

    // Walk up the manager chain, recording the path, until we reach a root, a
    // dangling manager, a node we've already classified, or ourselves again.
    const path: string[] = [];
    visiting.clear();
    let current: AdminUser | undefined = user;

    while (current && !state.has(current.id) && !visiting.has(current.id)) {
      visiting.add(current.id);
      path.push(current.id);
      current = current.managerId ? byId.get(current.managerId) : undefined;
    }

    if (current && visiting.has(current.id)) {
      // Closed a loop: everything from the re-entry point onward is the ring,
      // everything before it merely leads into the ring and is safe.
      const entry = path.indexOf(current.id);
      const ring = path.slice(entry);
      ring.forEach((id) => state.set(id, 'cyclic'));
      path.slice(0, entry).forEach((id) => state.set(id, 'safe'));
      rings.push(ring);
    } else {
      path.forEach((id) => state.set(id, 'safe'));
    }
  }

  const ringOf = new Map<string, string[]>();
  for (const ring of rings) {
    for (const id of ring) ringOf.set(id, ring);
  }

  const nodes = new Map<string, OrgNode>(
    users.map((user) => [user.id, { user, children: [] }] as const),
  );
  const roots: OrgNode[] = [];
  const dangling: string[] = [];

  for (const user of users) {
    const node = nodes.get(user.id)!;

    if (state.get(user.id) === 'cyclic') {
      // Rendered flat at the top level. Its own non-cyclic reports still attach
      // beneath it below, so nobody vanishes from the tree.
      node.rootReason = 'cycle';
      node.cycleWith = ringOf.get(user.id) ?? [user.id];
      roots.push(node);
      continue;
    }

    if (user.managerId === null) {
      node.rootReason = 'no_manager';
      roots.push(node);
      continue;
    }

    const manager = nodes.get(user.managerId);
    if (!manager) {
      node.rootReason = 'manager_missing';
      node.danglingManagerId = user.managerId;
      dangling.push(user.id);
      roots.push(node);
      continue;
    }

    manager.children.push(node);
  }

  const byName = (left: OrgNode, right: OrgNode) => left.user.name.localeCompare(right.user.name);
  roots.sort(byName);
  for (const node of nodes.values()) node.children.sort(byName);

  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const warnings: OrgWarning[] = [
    ...rings.map((ring) => ({ kind: 'cycle' as const, names: ring.map(nameOf) })),
    ...(dangling.length ? [{ kind: 'dangling' as const, names: dangling.map(nameOf) }] : []),
  ];

  return { roots, warnings };
}

/** Ids of every node matching the query, plus all their ancestors. */
export function searchHierarchy(
  roots: readonly OrgNode[],
  matches: (node: OrgNode) => boolean,
): { matchIds: Set<string>; visibleIds: Set<string>; ancestorIds: Set<string> } {
  const matchIds = new Set<string>();
  const visibleIds = new Set<string>();
  const ancestorIds = new Set<string>();

  const walk = (node: OrgNode, trail: string[]): boolean => {
    const selfMatch = matches(node);
    if (selfMatch) matchIds.add(node.user.id);

    let descendantMatch = false;
    for (const child of node.children) {
      if (walk(child, [...trail, node.user.id])) descendantMatch = true;
    }

    if (selfMatch || descendantMatch) {
      visibleIds.add(node.user.id);
      for (const id of trail) {
        visibleIds.add(id);
        ancestorIds.add(id);
      }
      if (descendantMatch) ancestorIds.add(node.user.id);
    }
    return selfMatch || descendantMatch;
  };

  for (const root of roots) walk(root, []);
  return { matchIds, visibleIds, ancestorIds };
}
