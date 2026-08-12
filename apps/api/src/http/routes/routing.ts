import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  deactivateRouting,
  getRouting,
  getRoutingGrants,
  getRoutingState,
  putRouting,
  putRoutingGrants,
  routingAssign,
  type RoutingRouteDeps,
} from '../../routes/routing.js';
import { RoutingRuleService } from '../../routing/rule-service.js';
import { StatusRoutingService } from '../../routing/service.js';
import { sendRouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

type Json = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string'
      ? value.split(',').filter(Boolean)
      : [];

export function registerRoutingRoutes(server: FastifyInstance, deps: ServerDependencies): void {
  // Routing needs a real Prisma client; a deployment wired without one has no
  // routing routes rather than half-working ones — same rule campaigns follow.
  if (deps.prisma === undefined) return;
  const preHandler = authenticate(deps);
  const base = (request: FastifyRequest): RoutingRouteDeps => ({
    auth: request.auth,
    permissionRepository: deps.permissionRepository,
    ruleService: new RoutingRuleService(deps.prisma!),
    routingService: new StatusRoutingService(deps.prisma!),
  });
  const statusId = (request: FastifyRequest) => String((request.params as Json).statusId);
  const tags = { schema: { tags: ['routing'] } };

  server.get('/api/v1/statuses/:statusId/routing', { preHandler, ...tags }, async (r, reply) =>
    sendRouteResult(reply, await getRouting({ ...base(r), statusId: statusId(r) })),
  );
  server.get(
    '/api/v1/statuses/:statusId/routing/state',
    { preHandler, ...tags },
    async (r, reply) =>
      sendRouteResult(reply, await getRoutingState({ ...base(r), statusId: statusId(r) })),
  );
  server.put('/api/v1/statuses/:statusId/routing', { preHandler, ...tags }, async (r, reply) =>
    sendRouteResult(
      reply,
      await putRouting({
        ...base(r),
        statusId: statusId(r),
        body: (r.body ?? {}) as Json,
      }),
    ),
  );
  server.post(
    '/api/v1/statuses/:statusId/routing/deactivate',
    { preHandler, ...tags },
    async (r, reply) =>
      sendRouteResult(reply, await deactivateRouting({ ...base(r), statusId: statusId(r) })),
  );
  server.get(
    '/api/v1/statuses/:statusId/routing/permissions',
    { preHandler, ...tags },
    async (r, reply) =>
      sendRouteResult(reply, await getRoutingGrants({ ...base(r), statusId: statusId(r) })),
  );
  server.put(
    '/api/v1/statuses/:statusId/routing/permissions',
    { preHandler, ...tags },
    async (r, reply) =>
      sendRouteResult(
        reply,
        await putRoutingGrants({
          ...base(r),
          statusId: statusId(r),
          body: (r.body ?? {}) as Json,
        }),
      ),
  );
  server.post('/api/v1/leads/:id/routing-assign', { preHandler, ...tags }, async (r, reply) => {
    const body = (r.body ?? {}) as Json;
    return sendRouteResult(
      reply,
      await routingAssign({
        ...base(r),
        leadId: String((r.params as Json).id),
        processInstanceId: str(body.processInstanceId),
        statusId: str(body.statusId),
        assignmentTypes: strings(body.assignmentTypes),
        ...(typeof body.userId === 'string' ? { userId: body.userId } : {}),
      }),
    );
  });
}
