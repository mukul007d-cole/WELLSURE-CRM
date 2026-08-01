import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';

export async function registerCookies(server: FastifyInstance): Promise<void> {
  await server.register(cookie);
}
