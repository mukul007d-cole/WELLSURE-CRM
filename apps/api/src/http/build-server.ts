import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';

import { registerCookies } from './plugins/cookies.js';
import { registerCors } from './plugins/cors.js';
import { loggingOptions } from './plugins/logging.js';
import { registerOpenApi } from './plugins/openapi.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerAttachmentRoutes } from './routes/attachments.js';
import { registerCampaignRoutes } from './routes/campaigns.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerConfigurationRoutes } from './routes/configuration.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImportExportRoutes } from './routes/import.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerPurgeRoutes } from './routes/purge.js';
import { registerRoutingRoutes } from './routes/routing.js';
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
    // Attachment uploads and import uploads are the multipart routes;
    // per-request limits are set there rather than globally.
    await app.register(multipart);
    registerHealthRoutes(app);
    registerAuthRoutes(app, deps);
    if (deps.adminRepository !== undefined)
      registerAdminRoutes(app, { ...deps, adminRepository: deps.adminRepository });
    registerConfigurationRoutes(app, deps);
    // After the configuration routes: `/journeys/:id/purge` and
    // `/journeys/:id/statuses` share a prefix, and Fastify prefers the static
    // segment regardless of order — asserted by test rather than trusted.
    registerPurgeRoutes(app, deps);
    registerLeadRoutes(app, deps);
    // `/leads/export` and `/leads/import/*` sit under the same prefix as
    // `/leads/:id`. Fastify's router prefers a static segment over a parametric
    // one, so this resolves regardless of registration order — asserted by test
    // rather than trusted, since an id-shaped 404 would be a confusing failure.
    registerImportExportRoutes(app, deps);
    registerNotificationRoutes(app, deps);
    registerAttachmentRoutes(app, deps);
    registerCampaignRoutes(app, deps);
    registerRoutingRoutes(app, deps);
  });
  return server;
}
