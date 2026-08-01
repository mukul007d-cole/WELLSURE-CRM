import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(server: FastifyInstance): void {
  server.get('/health', { schema: { tags: ['infrastructure'] } }, () => ({ status: 'ok' }));
}
