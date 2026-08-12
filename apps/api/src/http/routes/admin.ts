/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { adminRoute, permissionCatalogBody } from '../../routes/admin.js';
import { sendRouteResult, type RouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';
import type { AdminRepository } from '../../admin/repository.js';
import type { AdminService } from '../../admin/service.js';

type Json = Record<string, unknown>;
export function registerAdminRoutes(
  server: FastifyInstance,
  deps: ServerDependencies & { adminRepository: AdminRepository },
): void {
  const base = (r: FastifyRequest) => ({
    auth: r.auth,
    permissionRepository: deps.permissionRepository,
    adminRepository: deps.adminRepository,
    emailSender: deps.emailSender,
    authConfig: deps.authConfig,
  });
  const bind = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    module: 'users' | 'roles_permissions',
    action: 'view' | 'create' | 'edit' | 'deactivate',
    handler: (
      s: AdminService,
      c: { organizationId: string; actorUserId: string },
      b: Json,
      p: Json,
      q: Json,
    ) => Promise<unknown>,
    created = false,
  ) =>
    server.route({
      method,
      url,
      preHandler: authenticate(deps),
      schema: { tags: ['administration'] },
      handler: async (r, reply) =>
        sendRouteResult(
          reply,
          (await adminRoute({
            ...base(r),
            module,
            action,
            created,
            work: (s) =>
              handler(
                s,
                { organizationId: r.auth.user.organizationId, actorUserId: r.auth.user.id },
                (r.body ?? {}) as Json,
                r.params as Json,
                r.query as Json,
              ),
          })) as RouteResult,
        ),
    });
  bind('GET', '/api/v1/permissions/catalog', 'roles_permissions', 'view', async () =>
    permissionCatalogBody(),
  );
  bind('GET', '/api/v1/users', 'users', 'view', (s, c, _b, _p, q) => s.listUsers(c, q));
  bind('GET', '/api/v1/users/:userId', 'users', 'view', (s, c, _b, p, q) =>
    s.getUser(c, String(p.userId)),
  );
  bind(
    'POST',
    '/api/v1/users',
    'users',
    'create',
    (s, c, b, _p, q) => s.createUser(c, userInput(b)),
    true,
  );
  bind('PUT', '/api/v1/users/:userId', 'users', 'edit', (s, c, b, p, q) =>
    s.updateUser(c, String(p.userId), userInput(b)),
  );
  bind('POST', '/api/v1/users/:userId/deactivate', 'users', 'deactivate', (s, c, _b, p, q) =>
    s.deactivateUser(c, String(p.userId)),
  );
  bind('GET', '/api/v1/roles', 'roles_permissions', 'view', (s, c, _b, _p, q) => s.listRoles(c, q));
  bind('GET', '/api/v1/roles/:roleId', 'roles_permissions', 'view', (s, c, _b, p, q) =>
    s.getRole(c, String(p.roleId)),
  );
  bind(
    'POST',
    '/api/v1/roles',
    'roles_permissions',
    'create',
    (s, c, b, _p, q) => s.createRole(c, b.key, b.name),
    true,
  );
  bind('PUT', '/api/v1/roles/:roleId', 'roles_permissions', 'edit', (s, c, b, p, q) =>
    s.updateRole(c, String(p.roleId), b.name),
  );
  bind('POST', '/api/v1/roles/:roleId/deactivate', 'roles_permissions', 'edit', (s, c, b, p, q) =>
    s.deactivateRole(
      c,
      String(p.roleId),
      typeof b.replacementRoleId === 'string' ? b.replacementRoleId : undefined,
    ),
  );
  bind(
    'GET',
    '/api/v1/roles/:roleId/permissions',
    'roles_permissions',
    'view',
    async (s, c, _b, p, q) => roleAxis(await s.getRole(c, String(p.roleId)), 'permissions'),
  );
  bind('PUT', '/api/v1/roles/:roleId/permissions', 'roles_permissions', 'edit', (s, c, b, p, q) =>
    s.replacePermissions(c, String(p.roleId), b.permissions),
  );
  bind(
    'GET',
    '/api/v1/roles/:roleId/journey-access',
    'roles_permissions',
    'view',
    async (s, c, _b, p, q) => roleAxis(await s.getRole(c, String(p.roleId)), 'journeyAccess'),
  );
  bind(
    'PUT',
    '/api/v1/roles/:roleId/journey-access',
    'roles_permissions',
    'edit',
    (s, c, b, p, q) => s.replaceJourneyAccess(c, String(p.roleId), b.journeyIds),
  );
  bind(
    'GET',
    '/api/v1/roles/:roleId/field-visibility',
    'roles_permissions',
    'view',
    async (s, c, _b, p, q) => roleAxis(await s.getRole(c, String(p.roleId)), 'fieldVisibility'),
  );
  bind(
    'PUT',
    '/api/v1/roles/:roleId/field-visibility',
    'roles_permissions',
    'edit',
    (s, c, b, p, q) => s.replaceFieldVisibility(c, String(p.roleId), b.fieldVisibility),
  );
  // The Field-side projection of the same field_visibility rows the two routes
  // above expose role-side. It lives in the administration routes, not the
  // configuration ones, because granting a Field to a role is a permission
  // change: gating it on `fields` would let anyone holding fields:edit grant
  // their own role a Field their role is denied.
  bind('GET', '/api/v1/fields/:fieldId/visibility', 'roles_permissions', 'view', (s, c, _b, p, q) =>
    s.listRoleVisibilityForField(c, String(p.fieldId)),
  );
  bind('PUT', '/api/v1/fields/:fieldId/visibility', 'roles_permissions', 'edit', (s, c, b, p, q) =>
    s.replaceRoleVisibilityForField(c, String(p.fieldId), b.visibility),
  );
  bind('GET', '/api/v1/departments', 'users', 'view', (s, c, _b, _p, q) => s.listDepartments(c, q));
  bind('GET', '/api/v1/departments/:departmentId', 'users', 'view', (s, c, _b, p, q) =>
    s.getDepartment(c, String(p.departmentId)),
  );
  bind(
    'POST',
    '/api/v1/departments',
    'users',
    'create',
    (s, c, b, _p, q) => s.createDepartment(c, b.key, b.name),
    true,
  );
  bind('PUT', '/api/v1/departments/:departmentId', 'users', 'edit', (s, c, b, p, q) =>
    s.updateDepartment(c, String(p.departmentId), b.name),
  );
  /*
   * Teams. Nested collection, flat item — the same shape as
   * `POST /journeys/:journeyId/statuses` + `PATCH /statuses/:statusId`.
   *
   * Gated on `users:*` rather than a Team permission module, per ADR-0009:
   * Department administration rides on the User scope, and a Team is
   * administered from inside a Department.
   */
  bind('GET', '/api/v1/departments/:departmentId/teams', 'users', 'view', (s, c, _b, p, q) =>
    s.listTeams(c, String(p.departmentId), q),
  );
  bind(
    'POST',
    '/api/v1/departments/:departmentId/teams',
    'users',
    'create',
    (s, c, b, p, q) => s.createTeam(c, String(p.departmentId), b),
    true,
  );
  bind('GET', '/api/v1/teams/:teamId', 'users', 'view', (s, c, _b, p, q) =>
    s.getTeam(c, String(p.teamId)),
  );
  bind('PUT', '/api/v1/teams/:teamId', 'users', 'edit', (s, c, b, p, q) =>
    s.updateTeam(c, String(p.teamId), b.name),
  );
  bind('POST', '/api/v1/teams/:teamId/deactivate', 'users', 'edit', (s, c, _b, p, q) =>
    s.deactivateTeam(c, String(p.teamId)),
  );
  bind('PUT', '/api/v1/teams/:teamId/members', 'users', 'edit', (s, c, b, p, q) =>
    s.replaceTeamMembers(c, String(p.teamId), b.members),
  );
}
function userInput(b: Json) {
  return {
    name: String(b.name),
    email: String(b.email),
    roleId: String(b.roleId),
    departmentId: typeof b.departmentId === 'string' ? b.departmentId : null,
    managerId: typeof b.managerId === 'string' ? b.managerId : null,
  };
}
function roleAxis(role: unknown, key: string) {
  return role === null ? null : (role as Json)[key];
}
