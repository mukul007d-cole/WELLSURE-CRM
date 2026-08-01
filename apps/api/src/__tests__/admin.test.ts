import { describe, expect, it } from 'vitest';

import { AdminError } from '../admin/errors.js';
import { ids, pagination, permissions, visibility } from '../admin/validation.js';

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
  it('bounds pagination', () => {
    expect(pagination(undefined, undefined)).toEqual({ page: 1, pageSize: 25 });
    expect(() => pagination(0, 101)).toThrow(AdminError);
  });
});
