import { resolveAuthorization } from '@falcon/permission-engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

export function registerNotificationRoutes(
  server: FastifyInstance,
  deps: ServerDependencies,
): void {
  if (!deps.notificationService) return;
  const auth = authenticate(deps),
    service = deps.notificationService;
  server.get('/api/v1/notifications', { preHandler: auth }, async (request) => {
    const q = request.query as Record<string, unknown>;
    return service.list(
      request.auth.user.organizationId,
      request.auth.user.id,
      Number(q.page ?? 1),
      Number(q.pageSize ?? 25),
    );
  });
  server.get('/api/v1/notifications/unread-count', { preHandler: auth }, async (request) => ({
    count: await service.countUnread(request.auth.user.organizationId, request.auth.user.id),
  }));
  server.patch('/api/v1/notifications/:id/read', { preHandler: auth }, async (request, reply) => {
    const row = await service.markRead(
      request.auth.user.organizationId,
      request.auth.user.id,
      (request.params as { id: string }).id,
    );
    return row ?? reply.code(404).send({ error: 'not_found' });
  });
  server.get('/api/v1/notification-rules', { preHandler: auth }, async (request, reply) => {
    if (!(await adminAllowed(deps, request, 'view')))
      return reply.code(403).send({ error: 'forbidden' });
    const q = request.query as Record<string, unknown>;
    return service.listRules(
      request.auth.user.organizationId,
      Number(q.page ?? 1),
      Number(q.pageSize ?? 25),
    );
  });
  server.post('/api/v1/notification-rules', { preHandler: auth }, async (request, reply) => {
    if (!(await adminAllowed(deps, request, 'create')))
      return reply.code(403).send({ error: 'forbidden' });
    try {
      return reply.code(201).send(
        await service.createRule({
          ...(request.body as Parameters<typeof service.createRule>[0]),
          organizationId: request.auth.user.organizationId,
          actorUserId: request.auth.user.id,
        }),
      );
    } catch {
      return reply.code(400).send({ error: 'validation_error' });
    }
  });
  server.put('/api/v1/notification-rules/:id', { preHandler: auth }, async (request, reply) => {
    if (!(await adminAllowed(deps, request, 'edit')))
      return reply.code(403).send({ error: 'forbidden' });
    try {
      const row = await service.updateRule({
        ...(request.body as Parameters<typeof service.updateRule>[0]),
        id: (request.params as { id: string }).id,
        organizationId: request.auth.user.organizationId,
        actorUserId: request.auth.user.id,
      });
      return row ?? reply.code(404).send({ error: 'not_found' });
    } catch {
      return reply.code(400).send({ error: 'validation_error' });
    }
  });
}

async function adminAllowed(
  deps: ServerDependencies,
  request: FastifyRequest,
  action: 'view' | 'create' | 'edit',
) {
  const d = await resolveAuthorization({
    repository: deps.permissionRepository,
    request: {
      organizationId: request.auth.user.organizationId,
      userId: request.auth.user.id,
      module: 'roles_permissions',
      action,
    },
  });
  return d.allowed;
}
