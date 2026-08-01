import { describe, expect, it } from 'vitest';

import { defaultAuthConfig } from '../../auth/config.js';
import { buildServer } from '../../http/build-server.js';
import type { ServerDependencies } from '../../http/types.js';

const deps = {
  authRepository: { findSessionByTokenHash: () => Promise.resolve(null) },
  authConfig: { ...defaultAuthConfig, secureCookies: false },
  corsOrigins: ['http://localhost:5173'],
  logLevel: 'silent',
} as unknown as ServerDependencies;

describe('Fastify HTTP transport', () => {
  it('serves health, correlation IDs, CORS, and blocks an unauthenticated bound route', async () => {
    const server = buildServer(deps);
    const health = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'contract-1' },
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    expect(health.headers['x-request-id']).toBe('contract-1');

    const preflight = await server.inject({
      method: 'OPTIONS',
      url: '/api/v1/leads',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const unauthenticatedProfile = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });
    expect(unauthenticatedProfile.statusCode).toBe(401);
    expect(unauthenticatedProfile.json()).toEqual({ error: 'unauthenticated' });
    const unauthenticatedCapabilities = await server.inject({ method: 'GET', url: '/api/v1/auth/capabilities' });
    expect(unauthenticatedCapabilities.statusCode).toBe(401);

    const denied = await server.inject({ method: 'GET', url: '/api/v1/leads' });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toEqual({ error: 'unauthenticated' });
    await server.close();
  });
});
