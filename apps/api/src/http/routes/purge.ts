import type { FastifyInstance } from 'fastify';

import { purgeEntity } from '../../routes/purge.js';
import type { PurgeEntity } from '../../configuration/purge.js';
import { sendRouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

/**
 * `POST /<entity>/:id/purge`, matching how every other non-idempotent state
 * change is spelled here (`POST /users/:id/deactivate`,
 * `POST /teams/:id/deactivate`). `DELETE` is already taken by deactivation.
 *
 * Registered only when the deployment has a real database client, exactly as
 * campaigns and import are: the purge transaction needs `SET LOCAL` and raw
 * JSONB probes, so a deployment wired without one has no purge routes rather
 * than half-working ones.
 */
export function registerPurgeRoutes(server: FastifyInstance, deps: ServerDependencies): void {
  if (!deps.purgeService) return;
  const purgeService = deps.purgeService;
  const auth = authenticate(deps);

  const bind = (path: string, parameter: string, entity: PurgeEntity) =>
    server.post(
      path,
      { preHandler: auth, schema: { tags: ['configuration'] } },
      async (request, reply) =>
        sendRouteResult(
          reply,
          await purgeEntity({
            auth: request.auth,
            permissionRepository: deps.permissionRepository,
            purgeService,
            entity,
            id: String((request.params as Record<string, unknown>)[parameter]),
          }),
        ),
    );

  bind('/api/v1/journeys/:journeyId/purge', 'journeyId', 'journey');
  bind('/api/v1/statuses/:statusId/purge', 'statusId', 'status');
  bind('/api/v1/fields/:fieldId/purge', 'fieldId', 'field');
  bind('/api/v1/services/:serviceId/purge', 'serviceId', 'service');
  bind('/api/v1/teams/:teamId/purge', 'teamId', 'team');
  bind('/api/v1/roles/:roleId/purge', 'roleId', 'role');
  bind('/api/v1/notification-rules/:ruleId/purge', 'ruleId', 'notification_rule');
}
