import { resolveAuthorization } from '@falcon/permission-engine';
import type { FastifyInstance } from 'fastify';

import { resolveLeadAccess } from '../../routes/leads.js';
import {
  followUpActions,
  followUpViews,
  TaskError,
  TaskService,
  type FollowUpAction,
  type FollowUpView,
} from '../../tasks/service.js';
import { sendRouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

type Json = Record<string, unknown>;

/**
 * Follow-ups (ADR-0026). Registered only with a real database client, like
 * campaigns: the list joins through the Seller List's compiled predicate.
 *
 * - `GET /tasks` — the caller's own follow-ups for a view, on leads the caller
 *   can still see.
 * - `GET /tasks/summary` — open counts per view.
 * - `GET /leads/:id/tasks` — a lead's follow-ups, on the process instances the
 *   caller may view (the same per-journey loop as the timeline).
 * - `PATCH /tasks/:id` — complete / reopen / cancel / reschedule. The assignee
 *   needs `leads:view` on the lead; anyone else needs `leads:edit`.
 */
export function registerTaskRoutes(server: FastifyInstance, deps: ServerDependencies): void {
  if (deps.prisma === undefined) return;
  const service = new TaskService(deps.prisma);
  const preHandler = authenticate(deps);
  const schema = { tags: ['tasks'] };

  const listPredicate = async (organizationId: string, userId: string) => {
    const decision = await resolveAuthorization({
      repository: deps.permissionRepository,
      request: { organizationId, userId, module: 'leads', action: 'view', assignmentTypes: [] },
    });
    return decision.recordPredicate;
  };

  server.get('/api/v1/tasks', { preHandler, schema }, async (request, reply) => {
    const q = request.query as Json;
    const view = typeof q.view === 'string' ? q.view : 'today';
    if (!(followUpViews as readonly string[]).includes(view))
      return reply.code(400).send({ error: 'validation_error', details: { field: 'view' } });
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.pageSize ?? 25);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      return reply.code(400).send({ error: 'validation_error', details: { field: 'page' } });
    const predicate = await listPredicate(request.auth.user.organizationId, request.auth.user.id);
    if (predicate === null) return reply.code(403).send({ error: 'forbidden' });
    return service.listMine({
      organizationId: request.auth.user.organizationId,
      userId: request.auth.user.id,
      view: view as FollowUpView,
      page,
      pageSize,
      now: new Date(),
      tzOffsetMinutes: tzOffset(q.tzOffset),
      predicate,
    });
  });

  server.get('/api/v1/tasks/summary', { preHandler, schema }, async (request, reply) => {
    const q = request.query as Json;
    const predicate = await listPredicate(request.auth.user.organizationId, request.auth.user.id);
    if (predicate === null) return reply.code(403).send({ error: 'forbidden' });
    return service.countMine({
      organizationId: request.auth.user.organizationId,
      userId: request.auth.user.id,
      now: new Date(),
      tzOffsetMinutes: tzOffset(q.tzOffset),
      predicate,
    });
  });

  server.get('/api/v1/leads/:id/tasks', { preHandler, schema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await resolveLeadAccess({
      auth: request.auth,
      leadId: id,
      sellerRepository: deps.leadRepository,
      permissionRepository: deps.permissionRepository,
      requestedFieldIds: [],
      assignmentTypes: [],
    });
    if (access.status !== 200) return sendRouteResult(reply, access.result);
    return {
      items: await service.listForProcesses(
        request.auth.user.organizationId,
        id,
        access.visibleProcesses.map((process) => process.id),
      ),
    };
  });

  server.patch('/api/v1/tasks/:id', { preHandler, schema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Json;
    const action = String(body.action);
    if (!(followUpActions as readonly string[]).includes(action))
      return reply.code(400).send({ error: 'validation_error', details: { field: 'action' } });
    const organizationId = request.auth.user.organizationId;
    const task = await service.find(organizationId, id);
    if (task === null) return reply.code(404).send({ error: 'not_found' });

    // Authorized against the lead itself, through the same per-process loop
    // as the record page — never against a client-claimed journey.
    const process =
      task.processInstanceId === null
        ? null
        : await deps.leadRepository.findProcessInstance(organizationId, task.processInstanceId);
    if (process === null || !process.active) return reply.code(404).send({ error: 'not_found' });
    const own = task.assignedToUserId === request.auth.user.id;
    const decision = await resolveAuthorization({
      repository: deps.permissionRepository,
      request: {
        organizationId,
        userId: request.auth.user.id,
        module: 'leads',
        action: own ? 'view' : 'edit',
        journeyId: process.journeyId,
        leadId: task.leadId,
        statusId: process.currentStatusId,
        assignmentTypes: (process.assignments ?? []).map((row) => row.assignmentType),
      },
    });
    if (!decision.allowed) return reply.code(403).send({ error: 'forbidden' });

    try {
      return await service.apply({
        organizationId,
        actorUserId: request.auth.user.id,
        taskId: id,
        action: action as FollowUpAction,
        ...(typeof body.dueAt === 'string' ? { dueAt: new Date(body.dueAt) } : {}),
        ...(typeof body.note === 'string' || body.note === null ? { note: body.note } : {}),
      });
    } catch (error) {
      if (!(error instanceof TaskError)) throw error;
      return reply
        .code(error.code === 'not_found' ? 404 : 400)
        .send({ error: error.code, reason: error.message });
    }
  });
}

/** `Date#getTimezoneOffset()` from the browser; bounded to real offsets. */
function tzOffset(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && Math.abs(parsed) <= 14 * 60 ? parsed : 0;
}
