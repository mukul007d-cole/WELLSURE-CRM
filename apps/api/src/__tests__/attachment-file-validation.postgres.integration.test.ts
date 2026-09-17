import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';

import { AttachmentService } from '../attachments/service.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import { PrismaAttachmentRepository } from '../attachments/prisma-attachment-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { NotificationService } from '../notifications/service.js';
import { CampaignTriggerService } from '../campaigns/trigger-service.js';
import { StatusRoutingService } from '../routing/service.js';
import { defaultAuthConfig } from '../auth/config.js';
import { buildServer } from '../http/build-server.js';
import type { ServerDependencies } from '../http/types.js';
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from './fixtures/synthetic-admin.js';

class InMemoryAttachmentStorage implements AttachmentStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string | undefined }>();
  put(input: { key: string; body: Buffer; contentType: string | undefined }): Promise<void> {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType });
    return Promise.resolve();
  }
  get(key: string): Promise<{ body: NodeJS.ReadableStream; contentType?: string | undefined }> {
    const object = this.objects.get(key);
    if (!object) throw new Error('object not found');
    return Promise.resolve({ body: Readable.from(object.body), contentType: object.contentType });
  }
  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

/**
 * Regression coverage for finding #8: uploaded MIME types were accepted
 * with no content-type policy — size was checked, type never was, despite
 * `docs/operations/runbook.md`'s security baseline naming both (confirmed
 * independently here, and already documented as a known gap for this
 * feature by ADR-0024 while it closed the identical gap for the sibling
 * Tools resource library). `POST /leads/:id/attachments` now runs the same
 * `checkFileType` gate Tools already used, before anything reaches object
 * storage.
 */
describe.runIf(shouldRunAdminPostgres)('attachments: file-type validation on upload', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;
  const storage = new InMemoryAttachmentStorage();

  const org = randomUUID();
  const role = randomUUID();
  const user = randomUUID();
  const journey = randomUUID();
  const status = randomUUID();
  const lead = randomUUID();
  const assignmentType = 'attachment_owner';

  const serverFor = () => {
    const leadRepository = new PrismaLeadRepository(
      prisma as never,
      new NotificationService(prisma),
      new CampaignTriggerService(prisma),
      new StatusRoutingService(prisma),
    );
    return buildServer({
      authRepository: {
        findSessionByTokenHash: () =>
          Promise.resolve({
            id: randomUUID(),
            tokenHash: 'ignored',
            userId: user,
            organizationId: org,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            lastSeenAt: new Date(),
            ipAddress: null,
            userAgent: null,
          }),
        touchSession: () => Promise.resolve(),
        getUserSnapshot: () =>
          Promise.resolve({
            id: user,
            organizationId: org,
            roleId: role,
            active: true,
            departmentId: null,
            managerId: null,
          }),
      },
      permissionRepository: new PrismaPermissionRepository(prisma as never),
      leadRepository,
      attachmentService: new AttachmentService(new PrismaAttachmentRepository(prisma), storage),
      prisma,
      audit: {},
      emailSender: { sendPasswordReset: () => Promise.resolve() },
      authConfig: { ...defaultAuthConfig, secureCookies: false },
      corsOrigins: [],
    } as unknown as ServerDependencies);
  };

  /** A hand-built multipart body carrying one file part, mirroring the real upload path. */
  const uploadBody = (input: { fileName: string; contentType: string; bytes: Buffer }) => {
    const boundary = `----falcon${randomUUID().replaceAll('-', '')}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${input.fileName}"\r\n` +
        `Content-Type: ${input.contentType}\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
      payload: Buffer.concat([head, input.bytes, tail]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  };

  const post = async (input: { fileName: string; contentType: string; bytes: Buffer }) => {
    const server = serverFor();
    try {
      const { payload, headers } = uploadBody(input);
      return await server.inject({
        method: 'POST',
        url: `/api/v1/leads/${lead}/attachments?assignmentTypes=${assignmentType}`,
        headers: { cookie: 'falcon_session=synthetic', ...headers },
        payload,
      });
    } finally {
      await server.close();
    }
  };

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    await applyMigrations(db.sql);

    await prisma.organization.create({ data: { id: org, name: 'Attachment validation org' } });
    await prisma.role.create({
      data: { id: role, organizationId: org, key: 'attachment_role', name: 'Attachment role' },
    });
    await prisma.user.create({
      data: {
        id: user,
        organizationId: org,
        name: 'Attachment user',
        email: 'attachment-user@example.test',
        roleId: role,
      },
    });
    await prisma.rolePermission.createMany({
      data: ['upload', 'download', 'delete'].map((action) => ({
        organizationId: org,
        roleId: role,
        module: 'attachments',
        action,
        scope: 'ORGANIZATION' as const,
      })),
    });
    await prisma.journey.create({
      data: {
        id: journey,
        organizationId: org,
        key: 'attachment_journey',
        name: 'Attachment journey',
      },
    });
    await prisma.roleJourneyAccess.create({
      data: { organizationId: org, roleId: role, journeyId: journey },
    });
    await prisma.status.create({
      data: {
        id: status,
        organizationId: org,
        journeyId: journey,
        key: 'attachment_status',
        name: 'Attachment status',
        outcomeType: 'open',
        behaviorType: 'default',
        isDefaultOnCreate: true,
        sortOrder: 0,
      },
    });
    await prisma.lead.create({
      data: {
        id: lead,
        organizationId: org,
        name: 'Attachment lead',
        phone: null,
        email: null,
        fieldValues: {},
      },
    });
    const processInstanceId = randomUUID();
    await prisma.processInstance.create({
      data: {
        id: processInstanceId,
        organizationId: org,
        leadId: lead,
        journeyId: journey,
        currentStatusId: status,
        isPrimary: true,
      },
    });
    await prisma.assignment.create({
      data: { organizationId: org, processInstanceId, assignmentType, userId: user },
    });
  }, 120_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  it('accepts a well-formed PDF', async () => {
    const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('a small pdf body')]);
    const response = await post({
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
      bytes: pdfBytes,
    });
    expect(response.statusCode).toBe(201);
    const record = JSON.parse(response.body) as { s3Key: string };
    expect(storage.objects.has(record.s3Key)).toBe(true);
  });

  it('rejects a Windows executable declared and named as a PNG, and stores nothing', async () => {
    // The real Windows PE signature ('MZ'…).
    const peBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const before = storage.objects.size;
    const response = await post({
      fileName: 'invoice.png',
      contentType: 'image/png',
      bytes: peBytes,
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'validation_error',
      details: { reason: 'signature_mismatch' },
    });
    expect(storage.objects.size).toBe(before);
  });

  it('rejects an HTML/script payload — not on the allow-list at all', async () => {
    const before = storage.objects.size;
    const response = await post({
      fileName: 'notes.html',
      contentType: 'text/html',
      bytes: Buffer.from('<script>alert(document.cookie)</script>'),
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'validation_error',
      details: { reason: 'type_not_permitted' },
    });
    expect(storage.objects.size).toBe(before);
  });

  it('rejects a declared type whose extension does not match', async () => {
    const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('a small pdf body')]);
    const response = await post({
      fileName: 'invoice.exe',
      contentType: 'application/pdf',
      bytes: pdfBytes,
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'validation_error',
      details: { reason: 'extension_mismatch' },
    });
  });

  it('leaves every rejected attachment absent from the database, not just from storage', async () => {
    const before = await prisma.attachment.count({ where: { organizationId: org, leadId: lead } });
    await post({
      fileName: 'malware.png',
      contentType: 'image/png',
      bytes: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
    });
    const after = await prisma.attachment.count({ where: { organizationId: org, leadId: lead } });
    expect(after).toBe(before);
  });
});
