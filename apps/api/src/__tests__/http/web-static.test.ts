import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultAuthConfig } from '../../auth/config.js';
import { buildServer } from '../../http/build-server.js';
import type { ServerDependencies } from '../../http/types.js';

/**
 * The SPA fallback is the risky part of serving the bundle from the API: a
 * catch-all that answered every unmatched path with `index.html` would turn a
 * mistyped API route into `200 text/html`, which surfaces as a JSON parse error
 * in the client and as a successful request in the logs.
 */
describe('serving the web bundle same-origin', () => {
  let root: string;
  let server: ReturnType<typeof buildServer>;

  const deps = () =>
    ({
      emailSender: { sendPasswordReset: () => Promise.resolve() },
      authConfig: { ...defaultAuthConfig, secureCookies: false },
      corsOrigins: ['http://localhost:5173'],
      logLevel: 'silent',
    }) as unknown as ServerDependencies;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'falcon-web-'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Falcon</title>');
    await writeFile(join(root, 'app.js'), 'export const built = true;');
    server = buildServer({ ...deps(), webRoot: root });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('serves a real asset from the bundle', async () => {
    const response = await server.inject({ method: 'GET', url: '/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('export const built = true;');
  });

  it('serves the shell at the root', async () => {
    const response = await server.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>Falcon</title>');
  });

  it('serves the shell for a client-side route that exists only in the browser', async () => {
    const response = await server.inject({ method: 'GET', url: '/sellers/some-uuid/edit' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>Falcon</title>');
  });

  it('still 404s an unknown API route instead of returning the shell', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/v1/not-a-route' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'Not Found' });
  });

  it('still 404s a non-GET to an unknown path', async () => {
    // A POST that fell through matched no route; answering it with the shell
    // would report success for a mutation that never happened.
    const response = await server.inject({ method: 'POST', url: '/sellers' });
    expect(response.statusCode).toBe(404);
  });

  it('does not shadow the health check', async () => {
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('leaves the API alone when no bundle is configured', async () => {
    // Local development: Vite serves the app, so the API must own nothing but
    // its own routes and must still 404 an unmatched GET.
    const apiOnly = buildServer(deps());
    await apiOnly.ready();
    try {
      expect((await apiOnly.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      expect((await apiOnly.inject({ method: 'GET', url: '/sellers' })).statusCode).toBe(404);
    } finally {
      await apiOnly.close();
    }
  });
});
