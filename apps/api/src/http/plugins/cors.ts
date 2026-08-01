import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

export async function registerCors(
  server: FastifyInstance,
  origins: readonly string[],
): Promise<void> {
  await server.register(cors, {
    credentials: true,
    origin(origin, callback) {
      callback(null, origin === undefined || origins.includes(origin));
    },
  });
}
