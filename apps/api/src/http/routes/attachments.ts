import type { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveAuthorization } from '@falcon/permission-engine';

import { MAX_ATTACHMENT_BYTES } from '../../attachments/service.js';
import { authenticate } from '../plugins/authenticate.js';
import type { ServerDependencies } from '../types.js';

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string'
      ? value.split(',').filter(Boolean)
      : [];

/**
 * A lead's document locker.
 *
 * Registered only when object storage is configured. Without it the routes
 * don't exist, so the client's 404 tells it the same thing a 503 would — see
 * the not-configured probe below, which keeps that answer explicit.
 */
export function registerAttachmentRoutes(server: FastifyInstance, deps: ServerDependencies): void {
  const preHandler = authenticate(deps);
  const attachments = deps.attachmentService;

  if (!attachments) {
    // Storage isn't configured. Answer honestly rather than 404ing, so the UI
    // can distinguish "no documents" from "this deployment can't store any".
    server.get('/api/v1/leads/:id/attachments', { preHandler }, async (_request, reply) =>
      reply.status(503).send({ error: 'storage_not_configured' }),
    );
    server.post('/api/v1/leads/:id/attachments', { preHandler }, async (_request, reply) =>
      reply.status(503).send({ error: 'storage_not_configured' }),
    );
    return;
  }

  /** Can this caller act on this lead, in the journey they claim? */
  const allowedOnLead = async (
    request: FastifyRequest,
    leadId: string,
    module: string,
    action: string,
    context: { journeyId: string; assignmentTypes: string[] },
  ) =>
    (
      await resolveAuthorization({
        repository: deps.permissionRepository,
        request: {
          organizationId: request.auth.user.organizationId,
          userId: request.auth.user.id,
          module,
          action,
          leadId,
          journeyId: context.journeyId,
          assignmentTypes: context.assignmentTypes,
        },
      })
    ).allowed;

  const leadContext = (source: Record<string, unknown>) => ({
    journeyId: typeof source.journeyId === 'string' ? source.journeyId : '',
    assignmentTypes: strings(source.assignmentTypes),
  });

  server.get('/api/v1/leads/:id/attachments', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = leadContext(request.query as Record<string, unknown>);
    // No `attachments:view` action exists in the catalogue, so listing is
    // gated on download — you may enumerate exactly what you may fetch.
    if (!(await allowedOnLead(request, id, 'attachments', 'download', context))) {
      return reply.status(403).send({ error: 'forbidden' });
    }
    return reply.send({ items: await attachments.list(request.auth.user.organizationId, id) });
  });

  server.post(
    '/api/v1/leads/:id/attachments',
    {
      preHandler,
      // Fastify defaults to 1 MiB, which would reject ordinary documents.
      bodyLimit: MAX_ATTACHMENT_BYTES,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const context = leadContext(request.query as Record<string, unknown>);
      if (!(await allowedOnLead(request, id, 'attachments', 'upload', context))) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      const file = await request.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES } });
      if (!file) {
        return reply.status(400).send({ error: 'validation_error', details: { field: 'file' } });
      }
      const body = await file.toBuffer();
      if (file.file.truncated) {
        return reply
          .status(413)
          .send({ error: 'payload_too_large', details: { maxBytes: MAX_ATTACHMENT_BYTES } });
      }
      if (body.byteLength === 0) {
        return reply.status(400).send({ error: 'validation_error', details: { field: 'file' } });
      }

      // The display name comes from a form field when supplied, so a user can
      // file a document under something more useful than its filename.
      const nameField = file.fields['name'];
      const provided =
        nameField && !Array.isArray(nameField) && nameField.type === 'field'
          ? String(nameField.value).trim()
          : '';
      const fileName = provided || file.filename || 'document';

      const record = await attachments.upload({
        organizationId: request.auth.user.organizationId,
        leadId: id,
        uploadedById: request.auth.user.id,
        fileName,
        mimeType: file.mimetype || null,
        body,
      });
      return reply.status(201).send(record);
    },
  );

  server.get('/api/v1/attachments/:attachmentId', { preHandler }, async (request, reply) => {
    const { attachmentId } = request.params as { attachmentId: string };
    const context = leadContext(request.query as Record<string, unknown>);
    const record = await attachments.findById(request.auth.user.organizationId, attachmentId);
    if (!record) return reply.status(404).send({ error: 'not_found' });
    if (!(await allowedOnLead(request, record.leadId, 'attachments', 'download', context))) {
      return reply.status(403).send({ error: 'forbidden' });
    }
    const object = await attachments.download(record);
    return (
      reply
        .header('content-type', object.contentType ?? record.mimeType ?? 'application/octet-stream')
        // `attachment` rather than `inline`: a stored document is never rendered
        // in the app's own origin, so a malicious HTML upload can't run there.
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(record.fileName)}`,
        )
        .send(object.body)
    );
  });

  server.delete('/api/v1/attachments/:attachmentId', { preHandler }, async (request, reply) => {
    const { attachmentId } = request.params as { attachmentId: string };
    const context = leadContext(request.query as Record<string, unknown>);
    const record = await attachments.findById(request.auth.user.organizationId, attachmentId);
    if (!record) return reply.status(404).send({ error: 'not_found' });
    if (!(await allowedOnLead(request, record.leadId, 'attachments', 'delete', context))) {
      return reply.status(403).send({ error: 'forbidden' });
    }
    await attachments.remove(request.auth.user.organizationId, record);
    return reply.status(204).send();
  });
}
