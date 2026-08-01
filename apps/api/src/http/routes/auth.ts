import type { FastifyInstance } from 'fastify';

import {
  completePasswordResetRoute,
  loginRoute,
  logoutRoute,
  requestPasswordResetRoute,
} from '../../routes/auth.js';
import { sendRouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import { errorSchema } from '../plugins/openapi.js';
import { clientAddress, type ServerDependencies } from '../types.js';

const objectBody = { type: 'object', additionalProperties: false } as const;

export function registerAuthRoutes(server: FastifyInstance, deps: ServerDependencies): void {
  server.post(
    '/api/v1/auth/login',
    {
      config: { rateLimit: deps.authRateLimit ?? { max: 20, timeWindow: 60_000 } },
      schema: {
        tags: ['auth'],
        body: {
          ...objectBody,
          required: ['organizationId', 'email', 'password'],
          properties: {
            organizationId: { type: 'string' },
            email: { type: 'string' },
            password: { type: 'string' },
          },
        },
        response: { 401: errorSchema, 423: errorSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as { organizationId: string; email: string; password: string };
      return sendRouteResult(
        reply,
        await loginRoute({
          repository: deps.authRepository,
          audit: deps.audit,
          config: deps.authConfig,
          body,
          ...clientAddress(request),
        }),
      );
    },
  );
  server.get(
    '/api/v1/auth/me',
    {
      preHandler: authenticate(deps),
      schema: {
        tags: ['auth'],
        response: {
          200: {
            type: 'object',
            required: ['id', 'organizationId', 'roleId', 'active', 'departmentId', 'managerId'],
            properties: {
              id: { type: 'string' },
              organizationId: { type: 'string' },
              roleId: { type: 'string' },
              active: { type: 'boolean' },
              departmentId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              managerId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              name: { type: 'string' },
              email: { type: 'string' },
              roleName: { type: 'string' },
            },
          },
          401: errorSchema,
        },
      },
    },
    (request) => request.auth.user,
  );
  server.post(
    '/api/v1/auth/password-reset/request',
    {
      config: { rateLimit: deps.authRateLimit ?? { max: 20, timeWindow: 60_000 } },
      schema: {
        tags: ['auth'],
        body: {
          ...objectBody,
          required: ['organizationId', 'email'],
          properties: {
            organizationId: { type: 'string' },
            email: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) =>
      sendRouteResult(
        reply,
        await requestPasswordResetRoute({
          repository: deps.authRepository,
          audit: deps.audit,
          emailSender: deps.emailSender,
          config: deps.authConfig,
          body: request.body as { organizationId: string; email: string },
          ...clientAddress(request),
        }),
      ),
  );
  server.post(
    '/api/v1/auth/password-reset/complete',
    {
      config: { rateLimit: deps.authRateLimit ?? { max: 20, timeWindow: 60_000 } },
      schema: {
        tags: ['auth'],
        body: {
          ...objectBody,
          required: ['token', 'newPassword'],
          properties: {
            token: { type: 'string' },
            newPassword: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) =>
      sendRouteResult(
        reply,
        await completePasswordResetRoute({
          repository: deps.authRepository,
          audit: deps.audit,
          body: request.body as { token: string; newPassword: string },
        }),
      ),
  );
  server.post(
    '/api/v1/auth/logout',
    { preHandler: authenticate(deps), schema: { tags: ['auth'] } },
    async (request, reply) =>
      sendRouteResult(
        reply,
        await logoutRoute({
          repository: deps.authRepository,
          audit: deps.audit,
          config: deps.authConfig,
          sessionId: request.auth.session.id,
          organizationId: request.auth.user.organizationId,
          actorUserId: request.auth.user.id,
        }),
      ),
  );
}
