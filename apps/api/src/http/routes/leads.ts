import type { FastifyInstance } from 'fastify';

import { createLead, editLead, getSeller360, listSellers } from '../../routes/leads.js';
import { sendRouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

type Json = Record<string, unknown>;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
const requiredString = (value: unknown): string => (typeof value === 'string' ? value : '');

export function registerLeadRoutes(server: FastifyInstance, deps: ServerDependencies): void {
  const preHandler = authenticate(deps);
  server.get(
    '/api/v1/leads',
    { preHandler, schema: { tags: ['leads'] } },
    async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const sortBy = ['createdAt', 'updatedAt', 'name'].includes(String(query.sortBy))
        ? (query.sortBy as 'createdAt' | 'updatedAt' | 'name')
        : undefined;
      const sortDirection = ['asc', 'desc'].includes(String(query.sortDirection))
        ? (query.sortDirection as 'asc' | 'desc')
        : undefined;
      return sendRouteResult(
        reply,
        await listSellers({
          auth: request.auth,
          sellerRepository: deps.leadRepository,
          permissionRepository: deps.permissionRepository,
          list: {
            ...(optionalString(query.search) ? { search: String(query.search) } : {}),
            ...(optionalString(query.journeyId) ? { journeyId: String(query.journeyId) } : {}),
            ...(optionalString(query.statusId) ? { statusId: String(query.statusId) } : {}),
            ...(optionalString(query.ownerUserId)
              ? { ownerUserId: String(query.ownerUserId) }
              : {}),
            ...(sortBy ? { sortBy } : {}),
            ...(sortDirection ? { sortDirection } : {}),
            ...(query.page ? { page: Number(query.page) } : {}),
            ...(query.pageSize ? { pageSize: Number(query.pageSize) } : {}),
            requestedFieldIds: strings(query.requestedFieldIds),
            assignmentTypes: strings(query.assignmentTypes),
          },
        }),
      );
    },
  );
  server.post(
    '/api/v1/leads',
    { preHandler, schema: { tags: ['leads'] } },
    async (request, reply) => {
      const body = request.body as Json;
      return sendRouteResult(
        reply,
        await createLead({
          auth: request.auth,
          leadRepository: deps.leadRepository,
          permissionRepository: deps.permissionRepository,
          journeyId: String(body.journeyId),
          name: requiredString(body.name),
          ...(optionalString(body.statusId) ? { statusId: String(body.statusId) } : {}),
          ...(optionalString(body.existingLeadId)
            ? { existingLeadId: String(body.existingLeadId) }
            : {}),
          ...(body.phone !== undefined ? { phone: body.phone as string | null } : {}),
          ...(body.email !== undefined ? { email: body.email as string | null } : {}),
          fieldValues: (body.fieldValues ?? {}) as Json,
          assignments: Array.isArray(body.assignments)
            ? (body.assignments as { assignmentType: string; userId: string }[])
            : [],
        }),
      );
    },
  );
  server.get(
    '/api/v1/leads/:id',
    { preHandler, schema: { tags: ['leads'] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, unknown>;
      return sendRouteResult(
        reply,
        await getSeller360({
          auth: request.auth,
          leadId: id,
          sellerRepository: deps.leadRepository,
          permissionRepository: deps.permissionRepository,
          requestedFieldIds: strings(query.requestedFieldIds),
          assignmentTypes: strings(query.assignmentTypes),
        }),
      );
    },
  );
  server.patch(
    '/api/v1/leads/:id',
    { preHandler, schema: { tags: ['leads'] } },
    async (request, reply) => {
      const body = request.body as Json;
      const { id } = request.params as { id: string };
      return sendRouteResult(
        reply,
        await editLead({
          auth: request.auth,
          leadRepository: deps.leadRepository,
          permissionRepository: deps.permissionRepository,
          leadId: id,
          processInstanceId: String(body.processInstanceId),
          journeyId: String(body.journeyId),
          assignmentTypes: strings(body.assignmentTypes),
          ...(body.name !== undefined ? { name: requiredString(body.name) } : {}),
          ...(body.phone !== undefined ? { phone: body.phone as string | null } : {}),
          ...(body.email !== undefined ? { email: body.email as string | null } : {}),
          ...(body.fieldValues !== undefined ? { fieldValues: body.fieldValues as Json } : {}),
          ...(optionalString(body.statusId) ? { statusId: String(body.statusId) } : {}),
        }),
      );
    },
  );
}
