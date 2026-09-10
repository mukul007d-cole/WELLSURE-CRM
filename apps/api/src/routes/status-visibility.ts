import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import { isStatusVisibilityError } from '../statuses/errors.js';
import type { StatusVisibilityService } from '../statuses/status-visibility-service.js';
import { parseRoleIds } from '../statuses/validation.js';

export type StatusVisibilityRouteResult =
  | { status: 200; body: unknown }
  | { status: 400 | 403 | 404 | 409; body: { error: string; details?: Record<string, unknown> } };

export interface StatusVisibilityRouteDeps {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  service: StatusVisibilityService;
}

const forbidden: StatusVisibilityRouteResult = { status: 403, body: { error: 'forbidden' } };
const notFound: StatusVisibilityRouteResult = { status: 404, body: { error: 'not_found' } };

/**
 * Editing who may *see* a lead at a Status is a permissions act, not a
 * Journey/Status configuration act — gated on `roles_permissions`, never on
 * `journeys_statuses`, matching 13a's and 14b's identical self-escalation
 * rule: an admin who can configure Statuses but not edit permissions must
 * not be able to grant visibility rights, including to their own Role.
 */
async function mayEditPermissions(input: StatusVisibilityRouteDeps, action: 'view' | 'edit') {
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: 'roles_permissions',
      action,
    },
  });
  return decision.allowed;
}

async function run(work: () => Promise<unknown>): Promise<StatusVisibilityRouteResult> {
  try {
    const value = await work();
    if (value === null) return notFound;
    return { status: 200, body: value };
  } catch (error) {
    if (!isStatusVisibilityError(error)) throw error;
    return {
      status: error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400,
      body: {
        error: error.code,
        ...(Object.keys(error.details).length ? { details: error.details } : {}),
      },
    };
  }
}

export async function getStatusVisibility(
  input: StatusVisibilityRouteDeps & { statusId: string },
): Promise<StatusVisibilityRouteResult> {
  if (!(await mayEditPermissions(input, 'view'))) return forbidden;
  return run(() => input.service.listGrants(input.auth.user.organizationId, input.statusId));
}

export async function putStatusVisibility(
  input: StatusVisibilityRouteDeps & { statusId: string; body: Record<string, unknown> },
): Promise<StatusVisibilityRouteResult> {
  if (!(await mayEditPermissions(input, 'edit'))) return forbidden;
  return run(() =>
    input.service.replaceGrants(
      input.auth.user.organizationId,
      input.auth.user.id,
      input.statusId,
      parseRoleIds(input.body.roleIds),
    ),
  );
}
