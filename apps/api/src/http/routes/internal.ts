import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { CampaignSendService } from '../../campaigns/send-service.js';
import type { ServerDependencies } from '../types.js';

/**
 * System-to-system routes with no human session behind them — `apps/worker`
 * is the one caller. Gated on a shared secret (`FALCON_INTERNAL_WORKER_TOKEN`)
 * rather than a cookie session, the same "optional configuration, explicit
 * 503 when absent" shape ADR-0012 established for object storage: a
 * deployment that hasn't set one up yet is simply missing scheduled
 * campaign delivery, not missing a server.
 *
 * This is finding #4's fix: `drainPending` was previously called from
 * exactly one production code path (`POST /campaigns/:id/send`), so a
 * triggered campaign's pending rows sat forever unless an unrelated manual
 * send happened to run in the same organization. `apps/worker` now polls
 * `POST /internal/campaigns/drain` on an interval, which drains every
 * organization that currently has pending work.
 */
export function registerInternalRoutes(server: FastifyInstance, deps: ServerDependencies): void {
  const token = deps.internalWorkerToken;
  const prisma = deps.prisma;

  if (!token || !prisma) {
    server.post('/api/v1/internal/campaigns/drain', async (_request, reply) =>
      reply.status(503).send({ error: 'internal_worker_not_configured' }),
    );
    return;
  }

  const authorized = (request: FastifyRequest): boolean => {
    const header = request.headers.authorization ?? '';
    const prefix = 'Bearer ';
    if (!header.startsWith(prefix)) return false;
    const presented = Buffer.from(header.slice(prefix.length));
    const expected = Buffer.from(token);
    // Constant-time comparison: this route has no session, no rate limit
    // tied to a user, and no lockout — a timing side-channel is the whole
    // exposure, so it is closed outright rather than accepted as unlikely.
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  };

  server.post('/api/v1/internal/campaigns/drain', async (request, reply) => {
    if (!authorized(request)) return reply.status(401).send({ error: 'unauthorized' });
    const campaignSendService = new CampaignSendService(prisma, deps.emailSender);
    const result = await campaignSendService.drainAllPending();
    return reply.send(result);
  });
}
