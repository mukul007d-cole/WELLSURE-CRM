/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from 'vitest';
import type { PermissionRepository } from '@falcon/permission-engine';

import { getGuide } from '../routes/guides.js';
import type { AuthenticatedContext } from '../auth/middleware.js';

const org = 'org-a';

function auth(): AuthenticatedContext {
  return {
    user: {
      id: 'user-a',
      organizationId: org,
      roleId: 'role-a',
      active: true,
      departmentId: null,
      managerId: null,
    },
    session: {} as AuthenticatedContext['session'],
  };
}

/** A full, minimal `PermissionRepository` — `resolveAuthorization` touches
 * several methods even for a request naming no record (see `decision.ts`),
 * so every one of them needs an answer, not just `getRolePermission`. */
function repository(holdsRolesPermissionsView: boolean): PermissionRepository {
  return {
    async getUser(userId, organizationId) {
      return userId === 'user-a' && organizationId === org
        ? {
            id: userId,
            organizationId,
            roleId: 'role-a',
            active: true,
            departmentId: null,
            managerId: null,
          }
        : null;
    },
    async getRole(roleId, organizationId) {
      return roleId === 'role-a' && organizationId === org
        ? { id: roleId, organizationId, active: true, version: 1 }
        : null;
    },
    async getRolePermission(request) {
      return request.module === 'roles_permissions' &&
        request.action === 'view' &&
        holdsRolesPermissionsView
        ? { module: request.module, action: request.action, scope: 'ORGANIZATION' }
        : null;
    },
    async hasJourneyAccess() {
      return true;
    },
    async hasActiveRoutingRule() {
      return false;
    },
    async hasStatusVisibilityBypass() {
      return false;
    },
    async listAccessibleJourneyIds() {
      return [];
    },
    async getFieldVisibility() {
      return [];
    },
    async getLeadScope() {
      return null;
    },
    async listActiveUserIds() {
      return ['user-a'];
    },
    async listDepartmentUserIds() {
      return ['user-a'];
    },
    async listReports() {
      return [];
    },
    async listCurrentAssignments() {
      return [];
    },
    async getActiveDirectGrant() {
      return null;
    },
  };
}

describe('getGuide', () => {
  it('serves the User Guide to any authenticated account, regardless of permissions', async () => {
    const result = await getGuide({
      auth: auth(),
      permissionRepository: repository(false),
      guide: 'user',
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) throw new Error('unreachable');
    expect(result.body.fileName).toBe('user-guide.md');
    expect(result.body.content.startsWith('# User Guide')).toBe(true);
  });

  it('refuses the Admin Guide to an account without roles_permissions:view', async () => {
    const result = await getGuide({
      auth: auth(),
      permissionRepository: repository(false),
      guide: 'admin',
    });
    expect(result).toEqual({ status: 403, body: { error: 'forbidden' } });
  });

  it('serves the Admin Guide to an account holding roles_permissions:view', async () => {
    const result = await getGuide({
      auth: auth(),
      permissionRepository: repository(true),
      guide: 'admin',
    });
    expect(result.status).toBe(200);
    if (result.status !== 200) throw new Error('unreachable');
    expect(result.body.fileName).toBe('admin-guide.md');
    expect(result.body.content.startsWith('# Admin Guide')).toBe(true);
  });

  it('404s an unknown guide id rather than exposing an arbitrary path', async () => {
    const result = await getGuide({
      auth: auth(),
      permissionRepository: repository(true),
      guide: '../../../etc/passwd',
    });
    expect(result).toEqual({ status: 404, body: { error: 'not_found' } });
  });
});
