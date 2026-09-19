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
 * Regression coverage for the attachments permission matrix — untested by
 * either existing attachment test file (`attachment-file-validation` and
 * `attachment-audit-events` cover type-checking and audit rows, not who may
 * act). Live-verified once against a full role/department/team matrix
 * (SELF/TEAM/DEPARTMENT/ORGANIZATION all correctly enforced, a spoofed
 * `assignmentTypes` claim granting nothing); this locks in the two aspects
 * no other automated test touches: SELF scope's per-user boundary, and that
 * `leads:view` never implies any `attachments:*` action.
 */
describe.runIf(shouldRunAdminPostgres)('attachments: permission scope', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;
  const storage = new InMemoryAttachmentStorage();

  const org = randomUUID();
  const roleSelf = randomUUID();
  const roleViewOnly = randomUUID();
  const roleUploadDownloadOnly = randomUUID();
  const owner = randomUUID();
  const otherSelfUser = randomUUID();
  const viewer = randomUUID();
  const uploaderOnly = randomUUID();
  const journey = randomUUID();
  const status = randomUUID();
  const lead = randomUUID();
  const assignmentType = 'scope_owner';

  const serverFor = (userId: string, roleId: string) => {
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
            roleId,
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

  const uploadBody = () => {
    const boundary = `----falcon${randomUUID().replaceAll('-', '')}`;
    const bytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('scope test body')]);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="doc.pdf"\r\n` +
        `Content-Type: application/pdf\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
      payload: Buffer.concat([head, bytes, tail]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  };

  const upload = async (userId: string, roleId: string) => {
    const server = serverFor(userId, roleId);
    try {
      const { payload, headers } = uploadBody();
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

  const list = async (userId: string, roleId: string) => {
    const server = serverFor(userId, roleId);
    try {
      return await server.inject({
        method: 'GET',
        url: `/api/v1/leads/${lead}/attachments?assignmentTypes=${assignmentType}`,
        headers: { cookie: 'falcon_session=synthetic' },
      });
    } finally {
      await server.close();
    }
  };

  const download = async (userId: string, roleId: string, attachmentId: string) => {
    const server = serverFor(userId, roleId);
    try {
      return await server.inject({
        method: 'GET',
        url: `/api/v1/attachments/${attachmentId}?assignmentTypes=${assignmentType}`,
        headers: { cookie: 'falcon_session=synthetic' },
      });
    } finally {
      await server.close();
    }
  };

  const remove = async (userId: string, roleId: string, attachmentId: string) => {
    const server = serverFor(userId, roleId);
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

    await prisma.organization.create({ data: { id: org, name: 'Scope org' } });
    await prisma.role.createMany({
      data: [
        { id: roleSelf, organizationId: org, key: 'scope_self_role', name: 'Self scope role' },
        { id: roleViewOnly, organizationId: org, key: 'scope_view_role', name: 'View only role' },
        {
          id: roleUploadDownloadOnly,
          organizationId: org,
          key: 'scope_upload_download_role',
          name: 'Upload/download only role',
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        { id: owner, organizationId: org, name: 'Owner', email: 'owner@example.test', roleId: roleSelf },
        {
          id: otherSelfUser,
          organizationId: org,
          name: 'Other Self-Scope User',
          email: 'other-self@example.test',
          roleId: roleSelf,
        },
        {
          id: viewer,
          organizationId: org,
          name: 'Viewer',
          email: 'viewer@example.test',
          roleId: roleViewOnly,
        },
        {
          id: uploaderOnly,
          organizationId: org,
          name: 'Uploader Only',
          email: 'uploader-only@example.test',
          roleId: roleUploadDownloadOnly,
        },
      ],
    });
    await prisma.rolePermission.createMany({
      data: [
        ...['upload', 'download', 'delete'].map((action) => ({
          organizationId: org,
          roleId: roleSelf,
          module: 'attachments',
          action,
          scope: 'SELF' as const,
        })),
        { organizationId: org, roleId: roleViewOnly, module: 'leads', action: 'view', scope: 'ORGANIZATION' as const },
        ...['upload', 'download'].map((action) => ({
          organizationId: org,
          roleId: roleUploadDownloadOnly,
          module: 'attachments',
          action,
          scope: 'ORGANIZATION' as const,
        })),
      ],
    });
    await prisma.journey.create({
      data: { id: journey, organizationId: org, key: 'scope_journey', name: 'Scope journey' },
    });
    await prisma.roleJourneyAccess.createMany({
      data: [roleSelf, roleViewOnly, roleUploadDownloadOnly].map((roleId) => ({
        organizationId: org,
        roleId,
        journeyId: journey,
      })),
    });
    await prisma.status.create({
      data: {
        id: status,
        organizationId: org,
        journeyId: journey,
        key: 'scope_status',
        name: 'Scope status',
        outcomeType: 'open',
        behaviorType: 'default',
        isDefaultOnCreate: true,
        sortOrder: 0,
      },
    });
    await prisma.lead.create({
      data: { id: lead, organizationId: org, name: 'Scope lead', phone: null, email: null, fieldValues: {} },
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
    // Only `owner` is assigned. `otherSelfUser` holds the identical role and
    // grant, so the *only* thing that can distinguish them is SELF scope
    // itself matching against this one assignment row.
    await prisma.assignment.create({
      data: { organizationId: org, processInstanceId, assignmentType, userId: owner },
    });
  }, 120_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  it('SELF scope: the assigned user may upload, download and delete their own lead\'s attachment', async () => {
    const uploaded = await upload(owner, roleSelf);
    expect(uploaded.statusCode).toBe(201);
    const attachmentId = (JSON.parse(uploaded.body) as { id: string }).id;

    expect((await download(owner, roleSelf, attachmentId)).statusCode).toBe(200);
    expect((await remove(owner, roleSelf, attachmentId)).statusCode).toBe(204);
  });

  it("SELF scope: a same-role user who is NOT the lead's assignee is denied on every action", async () => {
    const uploaded = await upload(owner, roleSelf);
    expect(uploaded.statusCode).toBe(201);
    const attachmentId = (JSON.parse(uploaded.body) as { id: string }).id;

    expect((await list(otherSelfUser, roleSelf)).statusCode).toBe(403);
    expect((await upload(otherSelfUser, roleSelf)).statusCode).toBe(403);
    expect((await download(otherSelfUser, roleSelf, attachmentId)).statusCode).toBe(403);
    expect((await remove(otherSelfUser, roleSelf, attachmentId)).statusCode).toBe(403);
  });

  it("leads:view never implies any attachments:* action, even for a lead the viewer can otherwise see", async () => {
    const uploaded = await upload(owner, roleSelf);
    expect(uploaded.statusCode).toBe(201);
    const attachmentId = (JSON.parse(uploaded.body) as { id: string }).id;

    expect((await list(viewer, roleViewOnly)).statusCode).toBe(403);
    expect((await upload(viewer, roleViewOnly)).statusCode).toBe(403);
    expect((await download(viewer, roleViewOnly, attachmentId)).statusCode).toBe(403);
  });

  it('each attachments action is gated independently: upload+download without delete cannot delete', async () => {
    const uploaded = await upload(uploaderOnly, roleUploadDownloadOnly);
    expect(uploaded.statusCode).toBe(201);
    const attachmentId = (JSON.parse(uploaded.body) as { id: string }).id;

    expect((await download(uploaderOnly, roleUploadDownloadOnly, attachmentId)).statusCode).toBe(200);
    expect((await remove(uploaderOnly, roleUploadDownloadOnly, attachmentId)).statusCode).toBe(403);
  });
});
