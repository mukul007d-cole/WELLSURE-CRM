import { describe, expect, it } from 'vitest';

import { pickLeastLoaded, pickRoundRobin, type Candidate } from '../routing/algorithms.js';
import { RoutingError } from '../routing/errors.js';
import { parseGrants, parseRule } from '../routing/validation.js';

/** Ids are chosen so lexicographic order is obvious at a glance. */
const pool = (...ids: string[]): Candidate[] => ids.map((userId) => ({ userId, openCount: 0 }));

describe('round robin', () => {
  it('starts at the lowest id when the rule has never fired', () => {
    expect(pickRoundRobin(pool('user-c', 'user-a', 'user-b'), null)).toBe('user-a');
  });

  it('walks the pool in id order and wraps', () => {
    const candidates = pool('user-a', 'user-b', 'user-c');
    expect(pickRoundRobin(candidates, 'user-a')).toBe('user-b');
    expect(pickRoundRobin(candidates, 'user-b')).toBe('user-c');
    expect(pickRoundRobin(candidates, 'user-c')).toBe('user-a');
  });

  it('is unaffected by the order candidates arrive in', () => {
    expect(pickRoundRobin(pool('user-c', 'user-b', 'user-a'), 'user-a')).toBe('user-b');
    expect(pickRoundRobin(pool('user-b', 'user-a', 'user-c'), 'user-a')).toBe('user-b');
  });

  /**
   * The reason the cursor is an id and not an index. A departed cursor holder
   * simply stops matching, and the search falls through to the next id above
   * them — with an index, everyone after the removed member would shift by one
   * and silently be skipped or repeated.
   */
  it('recovers when the cursor holder has left the pool', () => {
    expect(pickRoundRobin(pool('user-a', 'user-c'), 'user-b')).toBe('user-c');
    // Cursor above every remaining member wraps rather than returning nothing.
    expect(pickRoundRobin(pool('user-a', 'user-b'), 'user-z')).toBe('user-a');
  });

  it('handles a single-candidate pool and an empty one', () => {
    expect(pickRoundRobin(pool('user-a'), 'user-a')).toBe('user-a');
    expect(pickRoundRobin([], 'user-a')).toBeNull();
    expect(pickRoundRobin([], null)).toBeNull();
  });
});

describe('least loaded', () => {
  it('picks the lightest candidate', () => {
    expect(
      pickLeastLoaded([
        { userId: 'user-a', openCount: 4 },
        { userId: 'user-b', openCount: 1 },
        { userId: 'user-c', openCount: 9 },
      ]),
    ).toBe('user-b');
  });

  it('breaks ties by id, so the result never depends on row order', () => {
    const tied = [
      { userId: 'user-c', openCount: 2 },
      { userId: 'user-a', openCount: 2 },
      { userId: 'user-b', openCount: 2 },
    ];
    expect(pickLeastLoaded(tied)).toBe('user-a');
    expect(pickLeastLoaded([...tied].reverse())).toBe('user-a');
  });

  it('treats an unloaded candidate as zero, not as missing', () => {
    expect(
      pickLeastLoaded([
        { userId: 'user-a', openCount: 3 },
        { userId: 'user-b', openCount: 0 },
      ]),
    ).toBe('user-b');
  });

  it('returns nothing for an empty pool', () => {
    expect(pickLeastLoaded([])).toBeNull();
  });
});

describe('rule validation', () => {
  const team = {
    assignmentType: 'synthetic_owner',
    algorithm: 'round_robin',
    poolType: 'team',
    teamId: 'team-1',
  };
  const users = {
    assignmentType: 'synthetic_owner',
    algorithm: 'least_loaded',
    poolType: 'users',
    userIds: ['user-b', 'user-a'],
  };

  it('accepts both pool shapes and sorts the user pool', () => {
    expect(parseRule({ ...team })).toEqual({ ...team, userIds: [] });
    expect(parseRule({ ...users })).toEqual({
      ...users,
      teamId: null,
      userIds: ['user-a', 'user-b'],
    });
  });

  it('refuses a pool that is both a team and a user list', () => {
    expect(() => parseRule({ ...team, userIds: ['user-a'] })).toThrow(RoutingError);
    expect(() => parseRule({ ...users, teamId: 'team-1' })).toThrow(RoutingError);
  });

  it('refuses an unusable rule', () => {
    expect(() => parseRule({ ...team, algorithm: 'invented' })).toThrow(RoutingError);
    expect(() => parseRule({ ...team, poolType: 'invented' })).toThrow(RoutingError);
    expect(() => parseRule({ ...team, assignmentType: '   ' })).toThrow(RoutingError);
    expect(() => parseRule({ ...team, teamId: '' })).toThrow(RoutingError);
    expect(() => parseRule({ ...users, userIds: [] })).toThrow(RoutingError);
    expect(() => parseRule({ ...users, userIds: ['user-a', 'user-a'] })).toThrow(RoutingError);
    expect(() => parseRule({ ...users, userIds: 'user-a' })).toThrow(RoutingError);
  });

  it('keeps assignmentType as free text, since the system never closes that set', () => {
    expect(parseRule({ ...team, assignmentType: '  Anything At All  ' }).assignmentType).toBe(
      'Anything At All',
    );
  });
});

describe('routing grant validation', () => {
  it('normalizes and sorts a complete grant set', () => {
    expect(
      parseGrants([
        { roleId: 'role-b', action: 'operate' },
        { roleId: 'role-a', action: 'view' },
      ]),
    ).toEqual([
      { roleId: 'role-a', action: 'view' },
      { roleId: 'role-b', action: 'operate' },
    ]);
    // Revoking every grant for a Status is an empty replacement, not a missing
    // one — the same shape `field_visibility` uses.
    expect(parseGrants([])).toEqual([]);
  });

  it('refuses unknown actions and duplicate grants', () => {
    expect(() => parseGrants('not-an-array')).toThrow(RoutingError);
    expect(() => parseGrants([{ roleId: 'role-a', action: 'invented' }])).toThrow(RoutingError);
    expect(() => parseGrants([{ roleId: '', action: 'view' }])).toThrow(RoutingError);
    expect(() =>
      parseGrants([
        { roleId: 'role-a', action: 'view' },
        { roleId: 'role-a', action: 'view' },
      ]),
    ).toThrow(RoutingError);
  });

  it('treats the three actions as independent grants on one role', () => {
    expect(
      parseGrants([
        { roleId: 'role-a', action: 'view' },
        { roleId: 'role-a', action: 'operate' },
      ]),
    ).toHaveLength(2);
  });
});
