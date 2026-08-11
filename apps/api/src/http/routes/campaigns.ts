import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  createCampaign,
  getCampaign,
  listCampaigns,
  sendCampaign,
  setCampaignActive,
  updateCampaign,
  type CampaignRouteDeps,
  type CampaignRouteResult,
} from '../../routes/campaigns.js';
import { CampaignService } from '../../campaigns/service.js';
import { CampaignSendService } from '../../campaigns/send-service.js';
import { sendRouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

type Json = Record<string, unknown>;

export function registerCampaignRoutes(server: FastifyInstance, deps: ServerDependencies): void {
  // Campaigns need a real Prisma client; a deployment wired without one simply
  // has no campaign routes rather than half-working ones.
  if (deps.prisma === undefined) return;
  const preHandler = authenticate(deps);
  const base = (request: FastifyRequest): CampaignRouteDeps => ({
    auth: request.auth,
    permissionRepository: deps.permissionRepository,
    campaignService: new CampaignService(deps.prisma!),
    campaignSendService: new CampaignSendService(deps.prisma!, deps.emailSender),
    sellerRepository: deps.leadRepository,
  });
  const send = async (reply: Parameters<typeof sendRouteResult>[0], result: CampaignRouteResult) =>
    sendRouteResult(reply, result);

  server.get(
    '/api/v1/campaigns',
    { preHandler, schema: { tags: ['campaigns'] } },
    async (r, reply) => {
      const query = r.query as Json;
      return send(reply, await listCampaigns({ ...base(r), page: Number(query.page ?? 1) }));
    },
  );
  server.get(
    '/api/v1/campaigns/:id',
    { preHandler, schema: { tags: ['campaigns'] } },
    async (r, reply) =>
      send(reply, await getCampaign({ ...base(r), id: String((r.params as Json).id) })),
  );
  server.post(
    '/api/v1/campaigns',
    { preHandler, schema: { tags: ['campaigns'] } },
    async (r, reply) =>
      send(reply, await createCampaign({ ...base(r), campaign: campaignBody(r.body as Json) })),
  );
  server.put(
    '/api/v1/campaigns/:id',
    { preHandler, schema: { tags: ['campaigns'] } },
    async (r, reply) =>
      send(
        reply,
        await updateCampaign({
          ...base(r),
          id: String((r.params as Json).id),
          campaign: campaignBody(r.body as Json),
        }),
      ),
  );
  server.post(
    '/api/v1/campaigns/:id/activation',
    { preHandler, schema: { tags: ['campaigns'] } },
    async (r, reply) =>
      send(
        reply,
        await setCampaignActive({
          ...base(r),
          id: String((r.params as Json).id),
          active: (r.body as Json).active !== false,
        }),
      ),
  );
  server.post(
    '/api/v1/campaigns/:id/send',
    { preHandler, schema: { tags: ['campaigns'] } },
    async (r, reply) =>
      send(reply, await sendCampaign({ ...base(r), id: String((r.params as Json).id) })),
  );
}

/** Only strings survive; the service rejects blanks with a validation error. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function campaignBody(body: Json) {
  return {
    ...(typeof body.key === 'string' ? { key: body.key } : {}),
    name: text(body.name),
    subject: text(body.subject),
    bodyDocument: body.bodyDocument,
    type: text(body.type),
    ...(body.filter === undefined ? {} : { filter: body.filter }),
    ...(typeof body.journeyId === 'string' ? { journeyId: body.journeyId } : {}),
    ...(typeof body.statusId === 'string' ? { statusId: body.statusId } : {}),
    ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
  };
}
