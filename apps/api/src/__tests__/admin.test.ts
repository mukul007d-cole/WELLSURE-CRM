import { describe, expect, it } from 'vitest';

import { AdminError } from '../admin/errors.js';
import {
  ids,
  pagination,
  permissions,
  roleVisibility,
  teamMembers,
  visibility,
} from '../admin/validation.js';

describe('administration validation', () => {
  it('normalizes complete permission replacement sets', () => {
    expect(
      permissions([
        { module: 'users', action: 'edit', scope: 'TEAM' },
        { module: 'leads', action: 'view', scope: 'SELF' },
      ]),
    ).toEqual([
      { module: 'leads', action: 'view', scope: 'SELF' },
      { module: 'users', action: 'edit', scope: 'TEAM' },
    ]);
  });
  it('rejects unknown and duplicate grants', () => {
    expect(() => permissions([{ module: 'users', action: 'invented', scope: 'SELF' }])).toThrow(
      AdminError,
    );
    expect(() =>
      permissions([
        { module: 'users', action: 'view', scope: 'SELF' },
        { module: 'users', action: 'view', scope: 'TEAM' },
      ]),
    ).toThrow(AdminError);
    expect(() => ids(['a', 'a'], 'journeyIds')).toThrow(AdminError);
    expect(() => visibility([{ fieldId: 'a', accessLevel: 'HIDDEN' }])).toThrow(AdminError);
  });
  it('normalizes one Field’s complete role-visibility set', () => {
    expect(
      roleVisibility([
        { roleId: 'role-b', accessLevel: 'EDIT' },
        { roleId: 'role-a', accessLevel: 'VIEW' },
      ]),
    ).toEqual([
      { roleId: 'role-a', accessLevel: 'VIEW' },
      { roleId: 'role-b', accessLevel: 'EDIT' },
    ]);
    // Revoking a Field everywhere is an empty replacement, not a missing one.
    expect(roleVisibility([])).toEqual([]);
  });
  it('rejects malformed role-visibility sets', () => {
    expect(() => roleVisibility('not-an-array')).toThrow(AdminError);
    expect(() => roleVisibility([{ roleId: '  ', accessLevel: 'VIEW' }])).toThrow(AdminError);
    expect(() => roleVisibility([{ roleId: 'role-a', accessLevel: 'HIDDEN' }])).toThrow(AdminError);
    expect(() =>
      roleVisibility([
        { roleId: 'role-a', accessLevel: 'VIEW' },
        { roleId: 'role-a', accessLevel: 'EDIT' },
      ]),
    ).toThrow(AdminError);
  });
  it('normalizes a Team’s complete member set', () => {
    expect(
      teamMembers([
        { userId: 'user-b', isLeader: false },
        { userId: 'user-a', isLeader: true },
      ]),
    ).toEqual([
      { userId: 'user-a', isLeader: true },
      { userId: 'user-b', isLeader: false },
    ]);
    // An omitted flag is an ordinary member, never a leader by accident.
    expect(teamMembers([{ userId: 'user-a', isLeader: true }, { userId: 'user-b' }])).toEqual([
      { userId: 'user-a', isLeader: true },
      { userId: 'user-b', isLeader: false },
    ]);
  });
  it('rejects malformed and leaderless Team member sets', () => {
    expect(() => teamMembers('not-an-array')).toThrow(AdminError);
    expect(() => teamMembers([{ userId: '  ', isLeader: true }])).toThrow(AdminError);
    expect(() => teamMembers([{ userId: 'user-a', isLeader: 'yes' }])).toThrow(AdminError);
    expect(() =>
      teamMembers([
        { userId: 'user-a', isLeader: true },
        { userId: 'user-a', isLeader: false },
      ]),
    ).toThrow(AdminError);
    // Unlike a field-visibility replacement, an empty set is not a valid state:
    // an active Team always has someone accountable for it.
    expect(() => teamMembers([])).toThrow(AdminError);
    expect(() => teamMembers([{ userId: 'user-a', isLeader: false }])).toThrow(AdminError);
  });
  it('bounds pagination', () => {
    expect(pagination(undefined, undefined)).toEqual({ page: 1, pageSize: 25 });
    expect(() => pagination(0, 101)).toThrow(AdminError);
  });
});
