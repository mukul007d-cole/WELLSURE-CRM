import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveAuthorization } from '@falcon/permission-engine';

import { maxImportBytes } from '../../import/service.js';
import type { ImportMapping } from '../../import/types.js';
import { analyzeImportFile, runImport, type ImportRouteResult } from '../../routes/import.js';
import { exportSellers } from '../../routes/export.js';
import { sendRouteResult } from '../errors.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string'
      ? value.split(',').filter(Boolean)
      : [];

interface UploadedFile {
  fileName: string;
  content: string;
  fields: Record<string, string>;
}

/**
 * One multipart part carries the file; the rest carry JSON text.
 *
 * The whole file is read into memory on purpose — the run holds a transaction
 * open over it anyway, so streaming would buy nothing and would make the content
 * hash awkward. `maxImportBytes` is what keeps that honest.
 */
async function readUpload(request: FastifyRequest): Promise<UploadedFile | null> {
  const parts = request.parts({ limits: { fileSize: maxImportBytes, files: 1 } });
  let fileName: string | null = null;
  let content: string | null = null;
  const fields: Record<string, string> = {};
  for await (const part of parts) {
    if (part.type === 'file') {
      fileName = part.filename;
      content = (await part.toBuffer()).toString('utf8');
      continue;
    }
    if (typeof part.value === 'string') fields[part.fieldname] = part.value;
  }
  if (fileName === null || content === null) return null;
  return { fileName, content, fields };
}

function parseMapping(raw: string | undefined): ImportMapping | null {
  if (raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ImportMapping>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof parsed.journeyId !== 'string' || parsed.journeyId === '') return null;
    if (typeof parsed.columns !== 'object' || parsed.columns === null) return null;
    return {
      journeyId: parsed.journeyId,
      ...(typeof parsed.statusId === 'string' && parsed.statusId !== ''
        ? { statusId: parsed.statusId }
        : {}),
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
      columns: parsed.columns,
      matchKeys: Array.isArray(parsed.matchKeys) ? parsed.matchKeys : [],
    };
  } catch {
    return null;
  }
}

export function registerImportExportRoutes(
  server: FastifyInstance,
  deps: ServerDependencies,
): void {
  const preHandler = authenticate(deps);

  /*
   * Export needs no Prisma client of its own — it reads through the same seller
   * repository the list uses — but it does need somewhere to write its audit
   * row, so it is registered only alongside one. A deployment with no Prisma
   * client has no export rather than an unaudited one.
   */
  if (deps.exportRepository !== undefined) {
    const exportRepository = deps.exportRepository;
    server.get(
      '/api/v1/leads/export',
      { preHandler, schema: { tags: ['leads'] } },
      async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const sortBy = ['createdAt', 'updatedAt', 'name'].includes(String(query.sortBy))
          ? (query.sortBy as 'createdAt' | 'updatedAt' | 'name')
          : undefined;
        const sortDirection = ['asc', 'desc'].includes(String(query.sortDirection))
          ? (query.sortDirection as 'asc' | 'desc')
          : undefined;
        return sendRouteResult(
          reply,
          await exportSellers({
            auth: request.auth,
            sellerRepository: deps.leadRepository,
            permissionRepository: deps.permissionRepository,
            fieldRepository: exportRepository,
            audit: exportRepository,
            runId: randomUUID(),
            // Deliberately the same parameter set `GET /leads` accepts, parsed
            // the same way, so "the export respects the current filters" is one
            // shape rather than two that have to agree.
            list: {
              ...(optionalString(query.search) ? { search: String(query.search) } : {}),
              ...(optionalString(query.journeyId) ? { journeyId: String(query.journeyId) } : {}),
              ...(optionalString(query.statusId) ? { statusId: String(query.statusId) } : {}),
              ...(optionalString(query.ownerUserId)
                ? { ownerUserId: String(query.ownerUserId) }
                : {}),
              ...(sortBy ? { sortBy } : {}),
              ...(sortDirection ? { sortDirection } : {}),
              requestedFieldIds: [],
              assignmentTypes: strings(query.assignmentTypes),
              ...(query.filter === undefined ? {} : { filter: query.filter }),
              ...(['mine', 'shared_with_me', 'all'].includes(String(query.accessMode))
                ? { accessMode: query.accessMode as 'mine' | 'shared_with_me' | 'all' }
                : {}),
            },
          }),
        );
      },
    );
  }

  if (deps.importService === undefined) return;
  const importService = deps.importService;
  const badRequest: ImportRouteResult = {
    status: 400,
    body: { error: 'validation_error', details: { reason: 'a CSV file is required' } },
  };

  server.post(
    '/api/v1/leads/import/analyze',
    { preHandler, schema: { tags: ['leads'] } },
    async (request, reply) => {
      const upload = await readUpload(request);
      if (upload === null) return sendRouteResult(reply, badRequest);
      return sendRouteResult(
        reply,
        await analyzeImportFile({
          auth: request.auth,
          permissionRepository: deps.permissionRepository,
          importService,
          fileName: upload.fileName,
          content: upload.content,
        }),
      );
    },
  );

  for (const mode of ['preview', 'commit'] as const) {
    server.post(
      `/api/v1/leads/import/${mode}`,
      { preHandler, schema: { tags: ['leads'] } },
      async (request, reply) => {
        const upload = await readUpload(request);
        if (upload === null) return sendRouteResult(reply, badRequest);
        const mapping = parseMapping(upload.fields.mapping);
        if (mapping === null) {
          return sendRouteResult(reply, {
            status: 400,
            body: {
              error: 'validation_error',
              details: { reason: 'a column mapping is required' },
            },
          });
        }
        return sendRouteResult(
          reply,
          await runImport({
            auth: request.auth,
            permissionRepository: deps.permissionRepository,
            importService,
            mode,
            fileName: upload.fileName,
            content: upload.content,
            mapping,
            stopOnError: upload.fields.stopOnError === 'true',
            // Only a commit checks it: a preview *establishes* the hash.
            ...(mode === 'commit' && optionalString(upload.fields.contentHash)
              ? { expectedContentHash: upload.fields.contentHash }
              : {}),
          }),
        );
      },
    );
  }

  if (deps.prisma === undefined) return;
  const prisma = deps.prisma;
  server.get(
    '/api/v1/leads/import/jobs',
    { preHandler, schema: { tags: ['leads'] } },
    async (request, reply) => {
      const gate = await resolveAuthorization({
        repository: deps.permissionRepository,
        request: {
          organizationId: request.auth.user.organizationId,
          userId: request.auth.user.id,
          module: 'leads',
          action: 'import',
        },
      });
      if (!gate.allowed) return reply.status(403).send({ error: 'forbidden' });
      const jobs = await prisma.importJob.findMany({
        where: { organizationId: request.auth.user.organizationId, status: 'committed' },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          fileName: true,
          status: true,
          rowCount: true,
          createdCount: true,
          skippedCount: true,
          rejectedCount: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true } },
        },
      });
      return reply.send({ items: jobs });
    },
  );
}
