import { describe, expect, it } from 'vitest';
import authSource from '../app/AuthContext.tsx?raw';
import routeSource from '../app/PermissionRoute.tsx?raw';

describe('authorization implementation', () => {
  it('does not branch on display role names', () => {
    for (const source of [authSource, routeSource]) {
      expect(source).not.toMatch(/roleName\s*={2,3}/);
      expect(source).not.toMatch(/roleName\.(?:includes|startsWith|endsWith)/);
    }
  });
});
