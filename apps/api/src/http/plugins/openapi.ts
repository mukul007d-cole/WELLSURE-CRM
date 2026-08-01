import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

export const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
  },
} as const;

export async function registerOpenApi(server: FastifyInstance): Promise<void> {
  await server.register(swagger, {
    openapi: { info: { title: 'Falcon CRM API', version: '1.0.0' } },
  });
  await server.register(swaggerUi, { routePrefix: '/documentation' });
}
