export type RoutingAlgorithm = 'round_robin' | 'least_loaded';
export const routingAlgorithms: readonly RoutingAlgorithm[] = ['round_robin', 'least_loaded'];

export interface Candidate {
  userId: string;
  /** Current open assignments of this rule's assignment type. */
  openCount: number;
}

/**
 * Both algorithms sort candidates by user id first.
 *
 * Not cosmetic: it is what makes either one deterministic. Round robin's cursor
 * is a position in this order, and least loaded's tie-break is the first id in
 * it. Without a fixed order both would depend on whatever order Postgres
 * happened to return, and the concurrency tests would be asserting noise.
 */
function sorted(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => a.userId.localeCompare(b.userId));
}

/**
 * The next candidate after `cursorUserId` in id order, wrapping to the first.
 *
 * The cursor is the user who was assigned *last*, not an index. An index means
 * a different person the moment someone joins or leaves the pool — routine for
 * a Team pool, since 14a ends memberships on a department change or a
 * deactivation. Storing the id means a departed cursor holder simply no longer
 * matches, and the search falls through to the next id above them.
 */
export function pickRoundRobin(
  candidates: readonly Candidate[],
  cursorUserId: string | null,
): string | null {
  const pool = sorted(candidates);
  if (pool.length === 0) return null;
  if (cursorUserId === null) return pool[0]!.userId;
  const next = pool.find((candidate) => candidate.userId.localeCompare(cursorUserId) > 0);
  return (next ?? pool[0]!).userId;
}

/**
 * The candidate holding the fewest open assignments, ties broken by id order.
 *
 * "Open" is decided by the caller's query, not here — see `RoutingService`.
 */
export function pickLeastLoaded(candidates: readonly Candidate[]): string | null {
  const pool = sorted(candidates);
  if (pool.length === 0) return null;
  return pool.reduce((best, candidate) => (candidate.openCount < best.openCount ? candidate : best))
    .userId;
}

export function pick(
  algorithm: RoutingAlgorithm,
  candidates: readonly Candidate[],
  cursorUserId: string | null,
): string | null {
  return algorithm === 'round_robin'
    ? pickRoundRobin(candidates, cursorUserId)
    : pickLeastLoaded(candidates);
}

export function isRoutingAlgorithm(value: string): value is RoutingAlgorithm {
  return (routingAlgorithms as readonly string[]).includes(value);
}
