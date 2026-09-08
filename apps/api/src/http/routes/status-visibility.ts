import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  getStatusVisibility,
  putStatusVisibility,
  type StatusVisibilityRouteDeps,
} from '../../routes/status-visibility.js';
import { StatusVisibilityService } from '../../statuses/status-visibility-service.js';
import { sendRouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

type Json = Record<string, unknown>;

export function registerStatusVisibilityRoutes(
  server: FastifyInstance,
  deps: ServerDependencies,
): void {
  // Needs a real Prisma client, same rule routing and campaigns follow: a
  // deployment wired without one has no Status Visibility routes rather than
  // half-working ones.
  if (deps.prisma === undefined) return;
  const preHandler = authenticate(deps);
  const base = (request: FastifyRequest): StatusVisibilityRouteDeps => ({
    auth: request.auth,
    permissionRepository: deps.permissionRepository,
    service: new StatusVisibilityService(deps.prisma!),
  });
  const statusId = (request: FastifyRequest) => String((request.params as Json).statusId);
  const tags = { schema: { tags: ['status-visibility'] } };

  server.get('/api/v1/statuses/:statusId/visibility', { preHandler, ...tags }, async (r, reply) =>
    sendRouteResult(reply, await getStatusVisibility({ ...base(r), statusId: statusId(r) })),
  );
  server.put('/api/v1/statuses/:statusId/visibility', { preHandler, ...tags }, async (r, reply) =>
    sendRouteResult(
      reply,
      await putStatusVisibility({
        ...base(r),
        statusId: statusId(r),
        body: (r.body ?? {}) as Json,
      }),
    ),
  );
}
