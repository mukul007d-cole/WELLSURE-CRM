import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  createField,
  createJourney,
  createService,
  createStatus,
  deactivateField,
  deactivateService,
  deactivateStatus,
  mapJourneyService,
  unmapJourneyService,
  upsertFieldVisibility,
  readConfiguration,
} from '../../routes/configuration.js';
import { sendRouteResult, type RouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

type Json = Record<string, unknown>;
type Handler = (request: FastifyRequest, body: Json, params: Json) => Promise<RouteResult>;

export function registerConfigurationRoutes(
  server: FastifyInstance,
  deps: ServerDependencies,
): void {
  const base = (request: FastifyRequest) => ({
    auth: request.auth,
    permissionRepository: deps.permissionRepository,
    configurationRepository: deps.configurationRepository,
  });
  const bind = (method: 'POST' | 'PUT' | 'DELETE', path: string, handler: Handler) => {
    server.route({
      method,
      url: path,
      preHandler: authenticate(deps),
      schema: { tags: ['configuration'] },
      handler: async (request, reply) =>
        sendRouteResult(
          reply,
          await handler(request, (request.body ?? {}) as Json, request.params as Json),
        ),
    });
  };
  const read = (path: string, kind: 'journeys' | 'services' | 'fields') =>
    server.get(
      path,
      { preHandler: authenticate(deps), schema: { tags: ['configuration'] } },
      async (request, reply) => {
        const p = request.params as Json;
        const q = request.query as Json;
        const id = p.journeyId ?? p.serviceId ?? p.fieldId;
        return sendRouteResult(
          reply,
          await readConfiguration({
            ...base(request),
            kind,
            ...(typeof id === 'string' ? { id } : {}),
            page: Number(q.page ?? 1),
            pageSize: Number(q.pageSize ?? 25),
            active: q.active === undefined ? true : q.active === true || q.active === 'true',
          }),
        );
      },
    );
  read('/api/v1/journeys', 'journeys');
  read('/api/v1/journeys/:journeyId', 'journeys');
  read('/api/v1/services', 'services');
  read('/api/v1/services/:serviceId', 'services');
  read('/api/v1/fields', 'fields');
  read('/api/v1/fields/:fieldId', 'fields');
  bind('POST', '/api/v1/journeys', (r, b) =>
    createJourney({ ...base(r), key: String(b.key), name: String(b.name) }),
  );
  bind('POST', '/api/v1/journeys/:journeyId/statuses', (r, b, p) =>
    createStatus({
      ...base(r),
      journeyId: String(p.journeyId),
      key: String(b.key),
      name: String(b.name),
      outcomeType: String(b.outcomeType),
      behaviorType: String(b.behaviorType),
      sortOrder: Number(b.sortOrder),
    }),
  );
  bind('DELETE', '/api/v1/statuses/:statusId', (r, b, p) =>
    deactivateStatus({
      ...base(r),
      journeyId: String(b.journeyId),
      statusId: String(p.statusId),
      ...(typeof b.replacementStatusId === 'string'
        ? { replacementStatusId: b.replacementStatusId }
        : {}),
    }),
  );
  bind('POST', '/api/v1/services', (r, b) =>
    createService({
      ...base(r),
      key: String(b.key),
      name: String(b.name),
      ...(b.description === null || typeof b.description === 'string'
        ? { description: b.description }
        : {}),
    }),
  );
  bind('DELETE', '/api/v1/services/:serviceId', (r, _b, p) =>
    deactivateService({ ...base(r), serviceId: String(p.serviceId) }),
  );
  bind('POST', '/api/v1/fields', (r, b) =>
    createField({
      ...base(r),
      key: String(b.key),
      name: String(b.name),
      fieldType: String(b.fieldType),
      editMode: String(b.editMode),
      source: String(b.source),
      ...(b.validationRule !== undefined ? { validationRule: b.validationRule } : {}),
      ...(b.section === null || typeof b.section === 'string' ? { section: b.section } : {}),
    }),
  );
  bind('DELETE', '/api/v1/fields/:fieldId', (r, _b, p) =>
    deactivateField({ ...base(r), fieldId: String(p.fieldId) }),
  );
  bind('PUT', '/api/v1/journeys/:journeyId/services', (r, b, p) => {
    const input = { ...base(r), journeyId: String(p.journeyId), serviceId: String(b.serviceId) };
    return b.action === 'unmap' ? unmapJourneyService(input) : mapJourneyService(input);
  });
  bind('PUT', '/api/v1/roles/:roleId/field-visibility/:fieldId', (r, b, p) =>
    upsertFieldVisibility({
      ...base(r),
      roleId: String(p.roleId),
      fieldId: String(p.fieldId),
      accessLevel: String(b.accessLevel),
    }),
  );
}
