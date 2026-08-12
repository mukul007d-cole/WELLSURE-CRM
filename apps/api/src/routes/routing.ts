import { resolveAuthorization, type PermissionRepository } from '@falcon/permission-engine';

import type { AuthenticatedContext } from '../auth/middleware.js';
import { isRoutingError } from '../routing/errors.js';
import type { RoutingRuleService } from '../routing/rule-service.js';
import type { StatusRoutingService } from '../routing/service.js';
import { parseGrants, parseRule, type RoutingAction } from '../routing/validation.js';

export const routingModule = 'lead_routing' as const;

export type RoutingRouteResult =
  | { status: 200 | 201; body: unknown }
  | { status: 400 | 403 | 404 | 409; body: { error: string; details?: Record<string, unknown> } };

export interface RoutingRouteDeps {
  auth: AuthenticatedContext;
  permissionRepository: PermissionRepository;
  ruleService: RoutingRuleService;
  routingService: StatusRoutingService;
}

const forbidden: RoutingRouteResult = { status: 403, body: { error: 'forbidden' } };
const notFound: RoutingRouteResult = { status: 404, body: { error: 'not_found' } };

/**
 * Two gates, both required.
 *
 * The `lead_routing` module action says the role may touch routing at all; the
 * per-Status grant says it may touch *this* Status's routing. Exactly the
 * layering `leads:view` plus a `field_visibility` row already use for Fields,
 * and for the same reason: one journey's statuses are often operated by
 * different groups, which a module-wide action cannot express.
 */
async function authorize(
  input: RoutingRouteDeps,
  action: RoutingAction,
  statusId: string,
): Promise<boolean> {
  const decision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: routingModule,
      action,
    },
  });
  if (!decision.allowed) return false;
  return input.ruleService.roleHasGrant({
    organizationId: input.auth.user.organizationId,
    statusId,
    roleId: input.auth.user.roleId,
    action,
  });
}

/** Editing who may operate routing is a permissions act, not a routing act. */
async function mayEditPermissions(input: RoutingRouteDeps, action: 'view' | 'edit') {
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

async function run(work: () => Promise<unknown>, created = false): Promise<RoutingRouteResult> {
  try {
    const value = await work();
    if (value === null) return notFound;
    return { status: created ? 201 : 200, body: value };
  } catch (error) {
    if (!isRoutingError(error)) throw error;
    return {
      status: error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400,
      body: {
        error: error.code,
        ...(Object.keys(error.details).length ? { details: error.details } : {}),
      },
    };
  }
}

export async function getRouting(
  input: RoutingRouteDeps & { statusId: string },
): Promise<RoutingRouteResult> {
  if (!(await authorize(input, 'view', input.statusId))) return forbidden;
  return run(() => input.ruleService.get(input.auth.user.organizationId, input.statusId));
}

export async function getRoutingState(
  input: RoutingRouteDeps & { statusId: string },
): Promise<RoutingRouteResult> {
  if (!(await authorize(input, 'view', input.statusId))) return forbidden;
  return run(() => input.ruleService.state(input.auth.user.organizationId, input.statusId));
}

export async function putRouting(
  input: RoutingRouteDeps & { statusId: string; body: Record<string, unknown> },
): Promise<RoutingRouteResult> {
  if (!(await authorize(input, 'configure', input.statusId))) return forbidden;
  return run(() =>
    input.ruleService.replace(
      input.auth.user.organizationId,
      input.auth.user.id,
      input.statusId,
      parseRule(input.body),
    ),
  );
}

export async function deactivateRouting(
  input: RoutingRouteDeps & { statusId: string },
): Promise<RoutingRouteResult> {
  if (!(await authorize(input, 'configure', input.statusId))) return forbidden;
  return run(() =>
    input.ruleService.deactivate(
      input.auth.user.organizationId,
      input.auth.user.id,
      input.statusId,
    ),
  );
}

export async function getRoutingGrants(
  input: RoutingRouteDeps & { statusId: string },
): Promise<RoutingRouteResult> {
  if (!(await mayEditPermissions(input, 'view'))) return forbidden;
  return run(() => input.ruleService.listGrants(input.auth.user.organizationId, input.statusId));
}

export async function putRoutingGrants(
  input: RoutingRouteDeps & { statusId: string; body: Record<string, unknown> },
): Promise<RoutingRouteResult> {
  // `roles_permissions:edit`, never `lead_routing:configure`. A routing
  // administrator who cannot edit permissions must not be able to grant routing
  // rights, including to their own role — the rule `field_visibility` follows.
  if (!(await mayEditPermissions(input, 'edit'))) return forbidden;
  return run(() =>
    input.ruleService.replaceGrants(
      input.auth.user.organizationId,
      input.auth.user.id,
      input.statusId,
      parseGrants(input.body.permissions),
    ),
  );
}

/**
 * Manually assign or override one lead's assignment at its current Status.
 *
 * `lead_routing:operate` is an **additional** gate: the caller must also pass
 * the ordinary lead authorization — `leads:edit`, journey access, and their own
 * record scope — exactly as a manual campaign send stays bounded by the
 * sender's Leads scope. Holding `operate` never reaches a lead the caller
 * otherwise cannot see.
 */
export async function routingAssign(
  input: RoutingRouteDeps & {
    leadId: string;
    processInstanceId: string;
    statusId: string;
    assignmentTypes: readonly string[];
    userId?: string;
  },
): Promise<RoutingRouteResult> {
  const leadDecision = await resolveAuthorization({
    repository: input.permissionRepository,
    request: {
      organizationId: input.auth.user.organizationId,
      userId: input.auth.user.id,
      module: 'leads',
      action: 'edit',
      leadId: input.leadId,
      assignmentTypes: input.assignmentTypes,
    },
  });
  if (!leadDecision.allowed) return forbidden;
  if (!(await authorize(input, 'operate', input.statusId))) return forbidden;

  return run(async () => {
    const result = await input.routingService.route({
      organizationId: input.auth.user.organizationId,
      statusId: input.statusId,
      leadId: input.leadId,
      processInstanceId: input.processInstanceId,
      actorUserId: input.auth.user.id,
      source: 'routing_manual',
      ...(input.userId === undefined ? {} : { overrideUserId: input.userId }),
    });
    return 'skipped' in result ? null : result;
  });
}
