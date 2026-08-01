import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

export async function registerRateLimit(
  server: FastifyInstance,
  options: { max: number; timeWindow: number },
): Promise<void> {
  await server.register(rateLimit, {
    global: false,
    max: options.max,
    timeWindow: options.timeWindow,
    keyGenerator(request) {
      const body = request.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '-';
      return `${request.ip}:${email}`;
    },
  });
}
