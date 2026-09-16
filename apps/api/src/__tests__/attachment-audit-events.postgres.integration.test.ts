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
 * Regression coverage for finding #7: attachment upload and deletion
 * modified rows without writing any append-only activity event, and the
 * deletion mutation never received the deleting actor at all. Both writes
 * now happen inside `PrismaAttachmentRepository`'s own `$transaction`,
 * alongside the row change itself.
 */
describe.runIf(shouldRunAdminPostgres)('attachments: audit events', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;
  const storage = new InMemoryAttachmentStorage();

  const org = randomUUID();
  const role = randomUUID();
  const uploader = randomUUID();
  const deleter = randomUUID();
  const journey = randomUUID();
  const status = randomUUID();
  const lead = randomUUID();
  const assignmentType = 'audit_owner';

  const serverFor = (userId: string) => {
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
            userId,
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
            id: userId,
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

  const upload = async (userId: string) => {
    const server = serverFor(userId);
    try {
      const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('a small pdf body')]);
      const { payload, headers } = uploadBody({
        fileName: 'invoice.pdf',
        contentType: 'application/pdf',
        bytes: pdfBytes,
      });
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/leads/${lead}/attachments?assignmentTypes=${assignmentType}`,
        headers: { cookie: 'falcon_session=synthetic', ...headers },
        payload,
      });
      return JSON.parse(response.body) as { id: string };
    } finally {
      await server.close();
    }
  };

  const remove = async (userId: string, attachmentId: string) => {
    const server = serverFor(userId);
    try {
      return await server.inject({
        method: 'DELETE',
        url: `/api/v1/attachments/${attachmentId}?assignmentTypes=${assignmentType}`,
        headers: { cookie: 'falcon_session=synthetic' },
      });
    } finally {
      await server.close();
    }
  };

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    await applyMigrations(db.sql);

    await prisma.organization.create({ data: { id: org, name: 'Audit org' } });
    await prisma.role.create({
      data: { id: role, organizationId: org, key: 'audit_role', name: 'Audit role' },
    });
    await prisma.user.createMany({
      data: [
        {
          id: uploader,
          organizationId: org,
          name: 'Uploader',
          email: 'uploader@example.test',
          roleId: role,
        },
        {
          id: deleter,
          organizationId: org,
          name: 'Deleter',
          email: 'deleter@example.test',
          roleId: role,
        },
      ],
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
      data: { id: journey, organizationId: org, key: 'audit_journey', name: 'Audit journey' },
    });
    await prisma.roleJourneyAccess.create({
      data: { organizationId: org, roleId: role, journeyId: journey },
    });
    await prisma.status.create({
      data: {
        id: status,
        organizationId: org,
        journeyId: journey,
        key: 'audit_status',
        name: 'Audit status',
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
        name: 'Audit lead',
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
    // No assignment needed: the role's ORGANIZATION scope on `attachments`
    // already covers every lead in the org, and this Status carries no
    // routing rule, so Status Visibility imposes no further restriction —
    // both uploader and deleter are authorized without being "the" assignee.
  }, 120_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  it('records the uploading actor, lead, attachment and metadata on upload', async () => {
    const record = await upload(uploader);

    const activity = await prisma.activityLog.findFirst({
      where: { organizationId: org, leadId: lead, actionType: 'attachment_uploaded' },
      orderBy: { timestamp: 'desc' },
    });
    expect(activity?.actorUserId).toBe(uploader);
    expect(activity?.processInstanceId).toBeNull();
    const newValue = activity?.newValue as {
      attachmentId: string;
      fileName: string;
      mimeType: string;
    };
    expect(newValue.attachmentId).toBe(record.id);
    expect(newValue.fileName).toBe('invoice.pdf');
    expect(newValue.mimeType).toBe('application/pdf');
  });

  it('records the DELETING actor on removal — not the original uploader', async () => {
    const record = await upload(uploader);

    const response = await remove(deleter, record.id);
    expect(response.statusCode).toBe(204);

    const activity = await prisma.activityLog.findFirst({
      where: { organizationId: org, leadId: lead, actionType: 'attachment_deleted' },
      orderBy: { timestamp: 'desc' },
    });
    // The finding: this actor must be the deleter, never the uploader —
    // before the fix, `deactivate` had no parameter to carry it at all.
    expect(activity?.actorUserId).toBe(deleter);
    expect(activity?.actorUserId).not.toBe(uploader);
    const oldValue = activity?.newValue as { active: boolean };
    expect(oldValue.active).toBe(false);
  });

  it('rolls back the attachment row if the activity write in the same transaction fails', async () => {
    const beforeCount = await prisma.attachment.count({
      where: { organizationId: org, leadId: lead },
    });

    // Force the activity write to fail with a real Postgres error, inside
    // the same transaction the attachment row is created in.
    await db.sql`ALTER TABLE activity_logs DROP COLUMN action_type`;
    try {
      const repository = new PrismaAttachmentRepository(prisma);
      await expect(
        repository.create({
          organizationId: org,
          leadId: lead,
          s3Key: 'org/x/leads/x/x/should-not-persist.pdf',
          fileName: 'should-not-persist.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10,
          uploadedById: uploader,
        }),
      ).rejects.toThrow();
    } finally {
      await db.sql`ALTER TABLE activity_logs ADD COLUMN action_type text NOT NULL DEFAULT 'unknown'`;
    }

    const afterCount = await prisma.attachment.count({
      where: { organizationId: org, leadId: lead },
    });
    expect(afterCount).toBe(beforeCount);
    const orphan = await prisma.attachment.findFirst({
      where: { organizationId: org, leadId: lead, fileName: 'should-not-persist.pdf' },
    });
    expect(orphan).toBeNull();
  });
});
