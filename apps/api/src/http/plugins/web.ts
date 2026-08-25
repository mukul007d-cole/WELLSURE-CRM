import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Serve the built web bundle from the API process, same origin.
 *
 * `apps/web` calls the API at the relative path `/api/v1`
 * (`apps/web/src/lib/api-client.ts`). In development Vite's proxy forwards that
 * to port 3000; in a deployed environment there is no Vite, so something has to
 * put the bundle and the API on one origin. Doing it here means one container
 * and one process, rather than a reverse proxy the container would have to
 * supervise or a CDN with a path behaviour to keep in step.
 *
 * Registered only when `FALCON_WEB_ROOT` is set, so local development is
 * completely unaffected: `pnpm dev` still serves the app from Vite with its
 * proxy, and the API still owns nothing but `/api/v1` and `/health`.
 */
export async function registerWeb(server: FastifyInstance, root: string): Promise<void> {
  await server.register(fastifyStatic, {
    root,
    // The catch-all is the not-found handler below, which can distinguish a
    // client-side route from a genuinely missing API path. The plugin's own
    // wildcard cannot.
    wildcard: false,
  });

  server.setNotFoundHandler((request, reply) => {
    /*
     * A single-page app owns its own routes: `/sellers/:id` exists in the
     * browser and nowhere on disk, so an unmatched GET has to return the shell
     * and let the router sort it out.
     *
     * Everything under `/api` and `/health` is excluded, because a missing API
     * route answering `200 text/html` would turn a typo into a parse error in
     * the client and a mystery in the logs. Those keep the real 404.
     */
    const isApi = request.url.startsWith('/api') || request.url.startsWith('/health');
    if (isApi || request.method !== 'GET') {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
        statusCode: 404,
      });
    }
    return reply.sendFile('index.html');
  });
}
