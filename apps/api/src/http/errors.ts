import type { FastifyReply } from 'fastify';

export interface RouteResult {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export function sendRouteResult(reply: FastifyReply, result: RouteResult): FastifyReply {
  for (const [name, value] of Object.entries(result.headers ?? {})) reply.header(name, value);
  return reply.status(result.status).send(result.status === 204 ? undefined : result.body);
}
