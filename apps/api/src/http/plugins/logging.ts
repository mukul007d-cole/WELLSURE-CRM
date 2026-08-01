import { randomUUID } from 'node:crypto';
import type { FastifyServerOptions } from 'fastify';

export function loggingOptions(level: string): Pick<FastifyServerOptions, 'logger' | 'genReqId'> {
  return {
    logger: {
      level,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        'req.body.password',
        'req.body.newPassword',
        'req.body.token',
        'req.body.email',
        'req.body.phone',
        'req.body.fieldValues',
        'req.body.fieldValues.*',
      ],
    },
    genReqId(request) {
      const inbound = request.headers['x-request-id'] ?? request.headers['x-correlation-id'];
      return typeof inbound === 'string' && inbound.length <= 200 ? inbound : randomUUID();
    },
  };
}
