import type { FastifyReply, FastifyRequest } from 'fastify';

import { authenticateCookie } from '../../auth/middleware.js';
import type { ServerDependencies } from '../types.js';

export function authenticate(deps: ServerDependencies) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const auth = await authenticateCookie({
      repository: deps.authRepository,
      config: deps.authConfig,
      cookieHeader: request.headers.cookie,
    });
    if (auth === null) {
      await reply.status(401).send({ error: 'unauthenticated' });
      return;
    }
    request.auth = auth;
  };
}
