import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  authorizeDownloadRoute,
  createResourceRoute,
  deactivateResourceRoute,
  getResourceRoute,
  listResourceVisibilityRoute,
  listResourcesRoute,
  replaceResourceVisibilityRoute,
  updateResourceRoute,
  type ToolRouteDeps,
} from '../../routes/tools.js';
import type { ResourceFileInput, ResourceRow } from '../../tools/types.js';
import { MAX_RESOURCE_FILE_BYTES } from '../../tools/validation.js';
import { sendRouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

type Json = Record<string, unknown>;

/**
 * A multipart request's text fields plus, at most, one file part.
 *
 * Used for both create and edit: a `link` Resource, or a metadata-only edit
 * of an existing `file` Resource, sends fields with no file part at all —
 * `request.file()`'s "exactly one file" assumption (which `attachments.ts`
 * relies on) doesn't fit, so this walks every part explicitly instead.
 */
async function readMultipart(
  request: FastifyRequest,
): Promise<{ fields: Json; file: ResourceFileInput | null }> {
  const fields: Json = {};
  let file: ResourceFileInput | null = null;
  for await (const part of request.parts({ limits: { fileSize: MAX_RESOURCE_FILE_BYTES } })) {
    if (part.type === 'file') {
      const body = await part.toBuffer();
      if (part.file.truncated) {
        throw Object.assign(new Error('payload_too_large'), { code: 'payload_too_large' });
      }
      file = { fileName: part.filename, mimeType: part.mimetype || null, body };
    } else {
      fields[part.fieldname] = part.value;
    }
  }
  return { fields, file };
}

function parseFields(fields: Json): Json {
  // `instructions` arrives as a JSON-encoded string field in a multipart
  // request (multipart has no native nested-object encoding); an absent or
  // blank field means "no instructions", matching the JSON API's `undefined`.
  const rawInstructions = fields.instructions;
  const instructions =
    typeof rawInstructions === 'string' && rawInstructions.trim() !== ''
      ? (JSON.parse(rawInstructions) as unknown)
      : undefined;
  return { ...fields, ...(instructions === undefined ? {} : { instructions }) };
}

/**
 * A Resource may be a `link` (no storage involved at all) or a `file`, so —
 * unlike `registerAttachmentRoutes`, which answers every route with 503 when
 * object storage isn't configured — these routes are always registered.
 * Only the operations that actually touch a file (upload, replace, download)
 * degrade, via `ResourceService`'s own `storage_not_configured` error.
 */
export function registerToolRoutes(server: FastifyInstance, deps: ServerDependencies): void {
  const preHandler = authenticate(deps);
  const base = (request: FastifyRequest): ToolRouteDeps => ({
    auth: request.auth,
    permissionRepository: deps.permissionRepository as ToolRouteDeps['permissionRepository'],
    resourceService: deps.resourceService,
  });
  const queryFlag = (query: Json, key: string) => query[key] === true || query[key] === 'true';

  server.get('/api/v1/tools', { preHandler }, async (request, reply) => {
    const query = request.query as Json;
    return sendRouteResult(
      reply,
      await listResourcesRoute({
        ...base(request),
        admin: queryFlag(query, 'admin'),
        active: query.active === undefined ? undefined : queryFlag(query, 'active'),
        page: Number(query.page ?? 1),
        pageSize: Number(query.pageSize ?? 25),
      }),
    );
  });

  server.get('/api/v1/tools/:resourceId', { preHandler }, async (request, reply) => {
    const { resourceId } = request.params as { resourceId: string };
    const query = request.query as Json;
    return sendRouteResult(
      reply,
      await getResourceRoute({
        ...base(request),
        resourceId,
        admin: queryFlag(query, 'admin'),
      }),
    );
  });

  server.get('/api/v1/tools/:resourceId/download', { preHandler }, async (request, reply) => {
    const { resourceId } = request.params as { resourceId: string };
    const authorized = await authorizeDownloadRoute({
      ...base(request),
      resourceId,
    });
    if (authorized.status !== 200) return sendRouteResult(reply, authorized);
    const resource = authorized.body as ResourceRow;
    const object = await deps.resourceService.download(resource);
    return (
      reply
        .header(
          'content-type',
          object.contentType ?? resource.mimeType ?? 'application/octet-stream',
        )
        // `attachment`, never `inline`: an uploaded file must never render on
        // this app's own origin — see http/routes/attachments.ts.
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(resource.fileName ?? 'download')}`,
        )
        .send(object.body)
    );
  });

  server.post(
    '/api/v1/tools',
    { preHandler, bodyLimit: MAX_RESOURCE_FILE_BYTES },
    async (request, reply) => {
      const { fields, file } = await readMultipart(request);
      return sendRouteResult(
        reply,
        await createResourceRoute({
          ...base(request),
          body: parseFields(fields),
          file,
        }),
      );
    },
  );

  server.put(
    '/api/v1/tools/:resourceId',
    { preHandler, bodyLimit: MAX_RESOURCE_FILE_BYTES },
    async (request, reply) => {
      const { resourceId } = request.params as { resourceId: string };
      const { fields, file } = await readMultipart(request);
      return sendRouteResult(
        reply,
        await updateResourceRoute({
          ...base(request),
          resourceId,
          body: parseFields(fields),
          file,
        }),
      );
    },
  );

  server.post('/api/v1/tools/:resourceId/deactivate', { preHandler }, async (request, reply) => {
    const { resourceId } = request.params as { resourceId: string };
    return sendRouteResult(reply, await deactivateResourceRoute({ ...base(request), resourceId }));
  });

  server.get('/api/v1/tools/:resourceId/visibility', { preHandler }, async (request, reply) => {
    const { resourceId } = request.params as { resourceId: string };
    return sendRouteResult(
      reply,
      await listResourceVisibilityRoute({ ...base(request), resourceId }),
    );
  });

  server.put('/api/v1/tools/:resourceId/visibility', { preHandler }, async (request, reply) => {
    const { resourceId } = request.params as { resourceId: string };
    return sendRouteResult(
      reply,
      await replaceResourceVisibilityRoute({
        ...base(request),
        resourceId,
        body: (request.body ?? {}) as Json,
      }),
    );
  });
}
