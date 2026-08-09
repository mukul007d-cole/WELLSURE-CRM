import type { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveAuthorization } from '@falcon/permission-engine';

import {
  createLead,
  editLead,
  getLeadActivity,
  getSeller360,
  listSellers,
} from '../../routes/leads.js';
import { sendRouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

type Json = Record<string, unknown>;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string'
      ? value.split(',').filter(Boolean)
      : [];
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
            ...(['mine', 'shared_with_me', 'all'].includes(String(query.accessMode))
              ? { accessMode: query.accessMode as 'mine' | 'shared_with_me' | 'all' }
              : {}),
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
  server.get(
    '/api/v1/leads/:id/activity',
    { preHandler, schema: { tags: ['leads'] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, unknown>;
      return sendRouteResult(
        reply,
        await getLeadActivity({
          auth: request.auth,
          leadId: id,
          sellerRepository: deps.leadRepository,
          permissionRepository: deps.permissionRepository,
          requestedFieldIds: strings(query.requestedFieldIds),
          assignmentTypes: strings(query.assignmentTypes),
          ...(query.page ? { page: Number(query.page) } : {}),
          ...(query.pageSize ? { pageSize: Number(query.pageSize) } : {}),
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
  if (deps.leadSharingService) {
    const sharing = deps.leadSharingService;
    const allowed = async (request: FastifyRequest, leadId: string, action: string, body: Json) =>
      (
        await resolveAuthorization({
          repository: deps.permissionRepository,
          request: {
            organizationId: request.auth.user.organizationId,
            userId: request.auth.user.id,
            module: 'leads',
            action,
            leadId,
            journeyId: requiredString(body.journeyId),
            assignmentTypes: strings(body.assignmentTypes),
          },
        })
      ).allowed;
    server.get('/api/v1/leads/:id/shares', { preHandler }, async (request, reply) => {
      const id = (request.params as { id: string }).id,
        q = request.query as Json;
      if (!(await allowed(request, id, 'edit', q)))
        return reply.code(403).send({ error: 'forbidden' });
      return sharing.list(request.auth.user.organizationId, id);
    });
    server.post('/api/v1/leads/:id/shares', { preHandler }, async (request, reply) => {
      const id = (request.params as { id: string }).id,
        b = request.body as Json;
      if (!(await allowed(request, id, 'edit', b)))
        return reply.code(403).send({ error: 'forbidden' });
      try {
        return reply.code(201).send(
          await sharing.create({
            organizationId: request.auth.user.organizationId,
            leadId: id,
            userId: requiredString(b.userId),
            actorUserId: request.auth.user.id,
            capabilities: strings(b.capabilities),
          }),
        );
      } catch (e) {
        return reply
          .code(e instanceof Error && e.message === 'not_found' ? 404 : 400)
          .send({ error: e instanceof Error ? e.message : 'validation_error' });
      }
    });
    server.put('/api/v1/leads/:id/shares/:shareId', { preHandler }, async (request, reply) => {
      const p = request.params as { id: string; shareId: string },
        b = request.body as Json;
      if (!(await allowed(request, p.id, 'edit', b)))
        return reply.code(403).send({ error: 'forbidden' });
      try {
        return await sharing.update({
          organizationId: request.auth.user.organizationId,
          leadId: p.id,
          shareId: p.shareId,
          actorUserId: request.auth.user.id,
          capabilities: strings(b.capabilities),
        });
      } catch {
        return reply.code(400).send({ error: 'validation_error' });
      }
    });
    server.delete('/api/v1/leads/:id/shares/:shareId', { preHandler }, async (request, reply) => {
      const p = request.params as { id: string; shareId: string },
        q = request.query as Json;
      if (!(await allowed(request, p.id, 'edit', q)))
        return reply.code(403).send({ error: 'forbidden' });
      try {
        await sharing.revoke({
          organizationId: request.auth.user.organizationId,
          leadId: p.id,
          shareId: p.shareId,
          actorUserId: request.auth.user.id,
        });
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
    });
    server.post('/api/v1/leads/:id/comments', { preHandler }, async (request, reply) => {
      const id = (request.params as { id: string }).id,
        b = request.body as Json;
      if (!(await allowed(request, id, 'comment', b)))
        return reply.code(403).send({ error: 'forbidden' });
      try {
        return reply.code(201).send(
          await sharing.comment({
            organizationId: request.auth.user.organizationId,
            leadId: id,
            actorUserId: request.auth.user.id,
            text: requiredString(b.text),
            ...(optionalString(b.processInstanceId)
              ? { processInstanceId: String(b.processInstanceId) }
              : {}),
          }),
        );
      } catch {
        return reply.code(400).send({ error: 'validation_error' });
      }
    });
    server.patch('/api/v1/leads/:id/reassign', { preHandler }, async (request, reply) => {
      const id = (request.params as { id: string }).id,
        b = request.body as Json;
      if (!(await allowed(request, id, 'edit', b)))
        return reply.code(403).send({ error: 'forbidden' });
      try {
        return await sharing.reassign({
          organizationId: request.auth.user.organizationId,
          leadId: id,
          actorUserId: request.auth.user.id,
          processInstanceId: requiredString(b.processInstanceId),
          assignmentType: requiredString(b.assignmentType),
          userId: requiredString(b.userId),
        });
      } catch {
        return reply.code(400).send({ error: 'validation_error' });
      }
    });
    server.post('/api/v1/leads/:id/deactivate', { preHandler }, async (request, reply) => {
      const id = (request.params as { id: string }).id,
        b = request.body as Json;
      if (!(await allowed(request, id, 'delete', b)))
        return reply.code(403).send({ error: 'forbidden' });
      try {
        return await sharing.deactivate({
          organizationId: request.auth.user.organizationId,
          leadId: id,
          actorUserId: request.auth.user.id,
        });
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
    });
  }
}
