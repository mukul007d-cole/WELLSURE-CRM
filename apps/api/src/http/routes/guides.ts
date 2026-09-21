import type { FastifyInstance } from 'fastify';

import { getGuide } from '../../routes/guides.js';
import { sendRouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

export function registerGuideRoutes(server: FastifyInstance, deps: ServerDependencies): void {
  server.get(
    '/api/v1/guides/:guide',
    { preHandler: authenticate(deps), schema: { tags: ['guides'] } },
    async (request, reply) => {
      const { guide } = request.params as { guide: string };
      return sendRouteResult(
        reply,
        await getGuide({
          auth: request.auth,
          permissionRepository: deps.permissionRepository,
          guide,
        }),
      );
    },
  );
}
