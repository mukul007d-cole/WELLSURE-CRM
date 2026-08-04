import Fastify, { type FastifyInstance } from 'fastify';

import { registerCookies } from './plugins/cookies.js';
import { registerCors } from './plugins/cors.js';
import { loggingOptions } from './plugins/logging.js';
import { registerOpenApi } from './plugins/openapi.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerConfigurationRoutes } from './routes/configuration.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import type { ServerDependencies } from './types.js';

export function buildServer(deps: ServerDependencies): FastifyInstance {
  const server = Fastify(loggingOptions(deps.logLevel ?? 'silent'));
  server.decorateRequest('auth');
  server.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  void server.register(async (app) => {
    await registerCookies(app);
    await registerCors(app, deps.corsOrigins);
    await registerOpenApi(app);
    await registerRateLimit(app, deps.authRateLimit ?? { max: 20, timeWindow: 60_000 });
    registerHealthRoutes(app);
    registerAuthRoutes(app, deps);
    if (deps.adminRepository !== undefined)
      registerAdminRoutes(app, { ...deps, adminRepository: deps.adminRepository });
    registerConfigurationRoutes(app, deps);
    registerLeadRoutes(app, deps);
    registerNotificationRoutes(app, deps);
  });
  return server;
}
