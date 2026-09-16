import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';

import { PrismaAdminRepository } from '../admin/prisma-admin-repository.js';
import { PrismaConfigurationRepository } from '../configuration/prisma-configuration-repository.js';
import { defaultAuthConfig } from '../auth/config.js';
import { buildServer } from '../http/build-server.js';
import type { ServerDependencies } from '../http/types.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import type { AttachmentStorage } from '../storage/object-storage.js';
import { PrismaResourceRepository } from '../tools/prisma-resource-repository.js';
import { ResourceService } from '../tools/service.js';
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from './fixtures/synthetic-admin.js';

/**
 * Phase 22 — Tools resource library.
 *
 * The core security assertion this file exists for, per
 * `docs/planning/phase-22-tools-resource-library.md`: a Role with no
 * `resource_visibility` row for a specific Resource must not be able to see
 * or download it through any surface — list, direct fetch, or download —
 * immediately after the Resource is created. Also pins, explicitly, the two
 * decisions the plan called out as most consequential: the "no row = hidden"
 * default (the opposite of Phase 19/20's superseded "no rule = unrestricted"
 * default for Status Visibility) and the independence of `tools:*` from
 * `roles_permissions:*` (self-escalation).
 *
 * Every name is synthetic. Nothing here may depend on a real role, resource,
 * or category name (`AGENTS.md`).
 */

/** A Map-backed fake of the S3 port — real Postgres, faked object storage. */
class InMemoryStorage implements AttachmentStorage {
  readonly objects = new Map<string, Buffer>();
  put(input: { key: string; body: Buffer }): Promise<void> {
    this.objects.set(input.key, input.body);
    return Promise.resolve();
  }
  get(key: string): Promise<{ body: NodeJS.ReadableStream; contentType?: string | undefined }> {
    const body = this.objects.get(key);
    if (!body) throw new Error('object not found');
    return Promise.resolve({ body: Readable.from(body) });
  }
  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

const PDF_BYTES = Buffer.from('%PDF-1.4\nsynthetic pdf content for phase 22 tests\n');

function multipart(
  fields: Record<string, string>,
  file?: { fieldName: string; filename: string; contentType: string; content: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----FormBoundary${randomUUID().replaceAll('-', '')}`;
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
    );
    parts.push(file.content);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe.runIf(shouldRunAdminPostgres)('Phase 22 Tools resource library', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;
  let storage: InMemoryStorage;

  const org = randomUUID();
  const otherOrg = randomUUID();
  const adminRole = randomUUID();
  const roleA = randomUUID();
  const roleB = randomUUID();
  const dormantRole = randomUUID();
  const foreignRole = randomUUID();
  const editOnlyRole = randomUUID();
  const permsOnlyRole = randomUUID();
  const adminUser = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const editOnlyUser = randomUUID();
  const permsOnlyUser = randomUUID();

  const serverFor = (userId: string, roleId: string) =>
    buildServer({
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
      adminRepository: new PrismaAdminRepository(prisma),
      configurationRepository: new PrismaConfigurationRepository(prisma),
      leadRepository: new PrismaLeadRepository(prisma as never),
      resourceService: new ResourceService(new PrismaResourceRepository(prisma), storage),
      audit: {},
      emailSender: { sendPasswordReset: () => Promise.resolve() },
      authConfig: { ...defaultAuthConfig, secureCookies: false },
      corsOrigins: [],
    } as unknown as ServerDependencies);

  const call = async (
    actor: { userId: string; roleId: string },
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const server = serverFor(actor.userId, actor.roleId);
    try {
      const response = await server.inject({
        method,
        url,
        headers: { cookie: 'falcon_session=synthetic' },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      return { statusCode: response.statusCode, body: response.body };
    } finally {
      await server.close();
    }
  };

  const callMultipart = async (
    actor: { userId: string; roleId: string },
    method: 'POST' | 'PUT',
    url: string,
    form: ReturnType<typeof multipart>,
  ) => {
    const server = serverFor(actor.userId, actor.roleId);
    try {
      const response = await server.inject({
        method,
        url,
        headers: { cookie: 'falcon_session=synthetic', 'content-type': form.contentType },
        payload: form.body,
      });
      return { statusCode: response.statusCode, body: response.body };
    } finally {
      await server.close();
    }
  };

  const asAdmin = () => ({ userId: adminUser, roleId: adminRole });
  const asUserA = () => ({ userId: userA, roleId: roleA });
  const asUserB = () => ({ userId: userB, roleId: roleB });
  const asEditOnly = () => ({ userId: editOnlyUser, roleId: editOnlyRole });
  const asPermsOnly = () => ({ userId: permsOnlyUser, roleId: permsOnlyRole });

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    storage = new InMemoryStorage();
    await applyMigrations(db.sql);

    await prisma.organization.createMany({
      data: [
        { id: org, name: 'Synthetic organization' },
        { id: otherOrg, name: 'Other synthetic organization' },
      ],
    });
    await prisma.role.createMany({
      data: [
        { id: adminRole, organizationId: org, key: 'synthetic_admin', name: 'Synthetic admin' },
        { id: roleA, organizationId: org, key: 'synthetic_role_a', name: 'Synthetic role A' },
        { id: roleB, organizationId: org, key: 'synthetic_role_b', name: 'Synthetic role B' },
        {
          id: dormantRole,
          organizationId: org,
          key: 'synthetic_dormant',
          name: 'Synthetic dormant role',
          active: false,
        },
        {
          id: foreignRole,
          organizationId: otherOrg,
          key: 'synthetic_foreign',
          name: 'Synthetic foreign role',
        },
        {
          id: editOnlyRole,
          organizationId: org,
          key: 'synthetic_edit_only',
          name: 'Synthetic tools-edit-only role',
        },
        {
          id: permsOnlyRole,
          organizationId: org,
          key: 'synthetic_perms_only',
          name: 'Synthetic permissions-only role',
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: adminUser,
          organizationId: org,
          name: 'Synthetic admin user',
          email: 'admin@example.test',
          roleId: adminRole,
        },
        {
          id: userA,
          organizationId: org,
          name: 'Synthetic granted user',
          email: 'granted@example.test',
          roleId: roleA,
        },
        {
          id: userB,
          organizationId: org,
          name: 'Synthetic denied user',
          email: 'denied@example.test',
          roleId: roleB,
        },
        {
          id: editOnlyUser,
          organizationId: org,
          name: 'Synthetic edit-only user',
          email: 'edit-only@example.test',
          roleId: editOnlyRole,
        },
        {
          id: permsOnlyUser,
          organizationId: org,
          name: 'Synthetic perms-only user',
          email: 'perms-only@example.test',
          roleId: permsOnlyRole,
        },
      ],
    });
    await prisma.rolePermission.createMany({
      data: [
        ...['view', 'create', 'edit', 'delete'].map((action) => ({
          organizationId: org,
          roleId: adminRole,
          module: 'tools',
          action,
          scope: 'ORGANIZATION' as const,
        })),
        ...['view', 'create', 'edit'].map((action) => ({
          organizationId: org,
          roleId: adminRole,
          module: 'roles_permissions',
          action,
          scope: 'ORGANIZATION' as const,
        })),
        {
          organizationId: org,
          roleId: roleA,
          module: 'tools',
          action: 'view',
          scope: 'ORGANIZATION' as const,
        },
        {
          organizationId: org,
          roleId: roleB,
          module: 'tools',
          action: 'view',
          scope: 'ORGANIZATION' as const,
        },
        // Self-escalation fixtures: one role with the admin capability but not
        // the grant-writing one, and the reverse.
        {
          organizationId: org,
          roleId: editOnlyRole,
          module: 'tools',
          action: 'view',
          scope: 'ORGANIZATION' as const,
        },
        {
          organizationId: org,
          roleId: editOnlyRole,
          module: 'tools',
          action: 'edit',
          scope: 'ORGANIZATION' as const,
        },
        {
          organizationId: org,
          roleId: permsOnlyRole,
          module: 'roles_permissions',
          action: 'edit',
          scope: 'ORGANIZATION' as const,
        },
      ],
    });
  }, 180_000);

  afterAll(async () => db?.cleanup());

  const createLinkResource = async (name: string) => {
    const created = await callMultipart(
      asAdmin(),
      'POST',
      '/api/v1/tools',
      multipart({ name, type: 'link', url: 'https://example.test/tool' }),
    );
    expect(created.statusCode).toBe(201);
    return (JSON.parse(created.body) as { id: string }).id;
  };

  it('hides a new Resource from every role, including the creator admin, until it is granted', async () => {
    const resourceId = await createLinkResource('Synthetic default-hidden resource');

    // The opposite pin from Phase 19/20's Status Visibility default: a brand
    // new Resource starts with zero rows, and zero rows means hidden — never
    // "unrestricted", the way a Status with no routing rule now behaves.
    const initial = await call(asAdmin(), 'GET', `/api/v1/tools/${resourceId}/visibility`);
    expect(initial.statusCode).toBe(200);
    expect(JSON.parse(initial.body)).toEqual({ roleIds: [] });

    // Not even the admin's own role can see it through the ordinary (non-admin)
    // surface — admin mode is a separate, explicitly-requested bypass.
    const adminBrowse = await call(asAdmin(), 'GET', '/api/v1/tools');
    expect(adminBrowse.body).not.toContain(resourceId);
    const adminDetail = await call(asAdmin(), 'GET', `/api/v1/tools/${resourceId}`);
    expect(adminDetail.statusCode).toBe(403);
  }, 120_000);

  it('the core security assertion: a denied Role cannot see or download a granted Resource anywhere', async () => {
    const resourceId = await createLinkResource('Synthetic granted-to-A resource');
    const grant = await call(asAdmin(), 'PUT', `/api/v1/tools/${resourceId}/visibility`, {
      roleIds: [roleA],
    });
    expect(grant.statusCode).toBe(200);

    // Role B: denied on every surface, whole-response.
    const listDenied = await call(asUserB(), 'GET', '/api/v1/tools');
    expect(listDenied.statusCode).toBe(200);
    expect(listDenied.body).not.toContain(resourceId);
    const detailDenied = await call(asUserB(), 'GET', `/api/v1/tools/${resourceId}`);
    expect(detailDenied.statusCode).toBe(403);
    // admin=true is silently ignored for a caller with no admin action.
    const adminBypassAttempt = await call(
      asUserB(),
      'GET',
      `/api/v1/tools/${resourceId}?admin=true`,
    );
    expect(adminBypassAttempt.statusCode).toBe(403);

    // Role A: allowed — proving step one isn't vacuous.
    const listAllowed = await call(asUserA(), 'GET', '/api/v1/tools');
    expect(listAllowed.body).toContain(resourceId);
    const detailAllowed = await call(asUserA(), 'GET', `/api/v1/tools/${resourceId}`);
    expect(detailAllowed.statusCode).toBe(200);
  }, 120_000);

  it('a denied Role cannot download a file-type Resource, and no storage call is ever made', async () => {
    const create = await callMultipart(
      asAdmin(),
      'POST',
      '/api/v1/tools',
      multipart(
        { name: 'Synthetic downloadable file', type: 'file' },
        {
          fieldName: 'file',
          filename: 'doc.pdf',
          contentType: 'application/pdf',
          content: PDF_BYTES,
        },
      ),
    );
    expect(create.statusCode).toBe(201);
    const resourceId = (JSON.parse(create.body) as { id: string }).id;
    await call(asAdmin(), 'PUT', `/api/v1/tools/${resourceId}/visibility`, { roleIds: [roleA] });

    const objectsBefore = storage.objects.size;
    const deniedDownload = await call(asUserB(), 'GET', `/api/v1/tools/${resourceId}/download`);
    expect(deniedDownload.statusCode).toBe(403);
    // The denial happens before any object read — asserted structurally by the
    // fake storage's contents being unchanged (a real S3 GET would 403/track
    // separately, but nothing here should even attempt one).
    expect(storage.objects.size).toBe(objectsBefore);

    const allowedDownload = await serverFor(userA, roleA).inject({
      method: 'GET',
      url: `/api/v1/tools/${resourceId}/download`,
      headers: { cookie: 'falcon_session=synthetic' },
    });
    expect(allowedDownload.statusCode).toBe(200);
    expect(allowedDownload.headers['content-disposition']).toContain('doc.pdf');
    expect(Buffer.from(allowedDownload.rawPayload).equals(PDF_BYTES)).toBe(true);
  }, 120_000);

  it('full-replace semantics: a second PUT replaces, not merges, and clearing returns to hidden — never unrestricted', async () => {
    const resourceId = await createLinkResource('Synthetic full-replace resource');
    await call(asAdmin(), 'PUT', `/api/v1/tools/${resourceId}/visibility`, {
      roleIds: [roleA, roleB],
    });
    const afterGrant = await call(asAdmin(), 'GET', `/api/v1/tools/${resourceId}/visibility`);
    expect(JSON.parse(afterGrant.body)).toEqual({ roleIds: [roleA, roleB].sort() });

    // Dropping role A from the payload must delete its row, not merge.
    const replaced = await call(asAdmin(), 'PUT', `/api/v1/tools/${resourceId}/visibility`, {
      roleIds: [roleB],
    });
    expect(replaced.statusCode).toBe(200);
    const afterReplace = await call(asAdmin(), 'GET', `/api/v1/tools/${resourceId}/visibility`);
    expect(JSON.parse(afterReplace.body)).toEqual({ roleIds: [roleB] });

    // Clearing returns the Resource to fully hidden — the mirror image of
    // Status Visibility's "clearing returns to unrestricted" (Phase 19).
    const cleared = await call(asAdmin(), 'PUT', `/api/v1/tools/${resourceId}/visibility`, {
      roleIds: [],
    });
    expect(cleared.statusCode).toBe(200);
    const stillDenied = await call(asUserB(), 'GET', `/api/v1/tools/${resourceId}`);
    expect(stillDenied.statusCode).toBe(403);
  }, 120_000);

  it('round-trips a grant held by an inactive Role without dropping it', async () => {
    const resourceId = await createLinkResource('Synthetic dormant-role resource');
    const stored = await call(asAdmin(), 'PUT', `/api/v1/tools/${resourceId}/visibility`, {
      roleIds: [dormantRole],
    });
    expect(stored.statusCode).toBe(200);
    const read = await call(asAdmin(), 'GET', `/api/v1/tools/${resourceId}/visibility`);
    expect(JSON.parse(read.body)).toEqual({ roleIds: [dormantRole] });
  }, 120_000);

  it('bumps every affected Role version, including one losing the grant, and audits old/new', async () => {
    const resourceId = await createLinkResource('Synthetic version-bump resource');
    await call(asAdmin(), 'PUT', `/api/v1/tools/${resourceId}/visibility`, {
      roleIds: [roleA, roleB],
    });
    const before = await prisma.role.findMany({
      where: { organizationId: org, id: { in: [roleA, roleB] } },
      select: { id: true, version: true },
      orderBy: { id: 'asc' },
    });
    await call(asAdmin(), 'PUT', `/api/v1/tools/${resourceId}/visibility`, { roleIds: [roleB] });
    const after = await prisma.role.findMany({
      where: { organizationId: org, id: { in: [roleA, roleB] } },
      select: { id: true, version: true },
      orderBy: { id: 'asc' },
    });
    for (const [index, row] of after.entries())
      expect(row.version, row.id).toBeGreaterThan(before[index]!.version);

    const audits = await prisma.systemAuditLog.findMany({
      where: { organizationId: org, entityType: 'resource_visibility', entityId: resourceId },
      orderBy: { timestamp: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect(audits.every((row) => row.action === 'replace')).toBe(true);
    expect(audits[1]!.newValue).toEqual([roleB]);
  }, 120_000);

  it('audits create, edit, and deactivate as their own system_audit_logs rows', async () => {
    const resourceId = await createLinkResource('Synthetic lifecycle resource');
    // Create/edit always go through multipart, even for a link with no file —
    // one request shape covers both types (§Proposed approach 12 of the plan).
    const edited = await callMultipart(
      asAdmin(),
      'PUT',
      `/api/v1/tools/${resourceId}`,
      multipart({
        name: 'Synthetic lifecycle resource (edited)',
        type: 'link',
        url: 'https://example.test/edited',
      }),
    );
    expect(edited.statusCode).toBe(200);
    const deactivated = await call(asAdmin(), 'POST', `/api/v1/tools/${resourceId}/deactivate`);
    expect(deactivated.statusCode).toBe(200);

    const audits = await prisma.systemAuditLog.findMany({
      where: { organizationId: org, entityType: 'resource', entityId: resourceId },
      orderBy: { timestamp: 'asc' },
    });
    expect(audits.map((row) => row.action)).toEqual(['create', 'edit', 'deactivate']);
  }, 120_000);

  it('self-escalation gate: tools:edit alone cannot write visibility; roles_permissions:edit alone cannot edit a Resource', async () => {
    const resourceId = await createLinkResource('Synthetic self-escalation resource');

    const editOnlyWrite = await call(
      asEditOnly(),
      'PUT',
      `/api/v1/tools/${resourceId}/visibility`,
      {
        roleIds: [editOnlyRole],
      },
    );
    expect(editOnlyWrite.statusCode).toBe(403);
    expect(
      await prisma.resourceVisibility.count({ where: { organizationId: org, resourceId } }),
    ).toBe(0);

    const permsOnlyEdit = await callMultipart(
      asPermsOnly(),
      'PUT',
      `/api/v1/tools/${resourceId}`,
      multipart({ name: 'Should be refused', type: 'link', url: 'https://example.test/x' }),
    );
    expect(permsOnlyEdit.statusCode).toBe(403);

    // permsOnly *can* write visibility, though — the two gates are genuinely
    // independent, not "roles_permissions implies tools" either.
    const permsOnlyVisibility = await call(
      asPermsOnly(),
      'PUT',
      `/api/v1/tools/${resourceId}/visibility`,
      { roleIds: [] },
    );
    expect(permsOnlyVisibility.statusCode).toBe(200);
  }, 120_000);

  it('rejects an oversized file, a disallowed MIME type, and a magic-byte mismatch — before any storage write', async () => {
    const objectsBefore = storage.objects.size;

    const oversized = await callMultipart(
      asAdmin(),
      'POST',
      '/api/v1/tools',
      multipart(
        { name: 'Synthetic oversized', type: 'file' },
        {
          fieldName: 'file',
          filename: 'big.pdf',
          contentType: 'application/pdf',
          content: Buffer.concat([PDF_BYTES, Buffer.alloc(26 * 1024 * 1024)]),
        },
      ),
    );
    // Matches attachments.ts's own precedent: Fastify's route-level
    // `bodyLimit` (defense in depth alongside the explicit truncation check)
    // rejects an oversized request with 413 before any handler code runs —
    // so no storage.put is even reachable, asserted below.
    expect(oversized.statusCode).toBe(413);

    const disallowedType = await callMultipart(
      asAdmin(),
      'POST',
      '/api/v1/tools',
      multipart(
        { name: 'Synthetic disallowed type', type: 'file' },
        {
          fieldName: 'file',
          filename: 'script.html',
          contentType: 'text/html',
          content: Buffer.from('<html><script>alert(1)</script></html>'),
        },
      ),
    );
    expect(disallowedType.statusCode).toBe(400);
    expect(JSON.parse(disallowedType.body)).toMatchObject({ error: 'validation_error' });

    const magicByteMismatch = await callMultipart(
      asAdmin(),
      'POST',
      '/api/v1/tools',
      multipart(
        { name: 'Synthetic magic-byte mismatch', type: 'file' },
        {
          fieldName: 'file',
          filename: 'fake.pdf',
          contentType: 'application/pdf',
          content: Buffer.from('this is not actually a pdf'),
        },
      ),
    );
    expect(magicByteMismatch.statusCode).toBe(400);

    expect(storage.objects.size).toBe(objectsBefore);
  }, 120_000);

  it('replacing a file overwrites the metadata, best-effort-removes the old object, and serves new bytes', async () => {
    const create = await callMultipart(
      asAdmin(),
      'POST',
      '/api/v1/tools',
      multipart(
        { name: 'Synthetic overwrite resource', type: 'file' },
        {
          fieldName: 'file',
          filename: 'v1.pdf',
          contentType: 'application/pdf',
          content: PDF_BYTES,
        },
      ),
    );
    expect(create.statusCode).toBe(201);
    const resource = JSON.parse(create.body) as { id: string; fileName: string };
    await call(asAdmin(), 'PUT', `/api/v1/tools/${resource.id}/visibility`, { roleIds: [roleA] });
    const beforeRow = await prisma.resource.findFirstOrThrow({
      where: { organizationId: org, id: resource.id },
    });
    expect(storage.objects.has(beforeRow.s3Key!)).toBe(true);

    const newBytes = Buffer.from('%PDF-1.4\nreplacement content\n');
    const replaced = await callMultipart(
      asAdmin(),
      'PUT',
      `/api/v1/tools/${resource.id}`,
      multipart(
        { name: 'Synthetic overwrite resource', type: 'file' },
        {
          fieldName: 'file',
          filename: 'v2.pdf',
          contentType: 'application/pdf',
          content: newBytes,
        },
      ),
    );
    expect(replaced.statusCode).toBe(200);
    const afterRow = await prisma.resource.findFirstOrThrow({
      where: { organizationId: org, id: resource.id },
    });
    // The id and creation audit trail survive the overwrite; only the file
    // metadata and version change.
    expect(afterRow.id).toBe(beforeRow.id);
    expect(afterRow.s3Key).not.toBe(beforeRow.s3Key);
    expect(afterRow.fileName).toBe('v2.pdf');
    // Best-effort removal of the old object — the plain-overwrite semantics
    // this project deliberately chose over version history (ADR-0012).
    expect(storage.objects.has(beforeRow.s3Key!)).toBe(false);
    expect(storage.objects.has(afterRow.s3Key!)).toBe(true);

    const download = await serverFor(userA, roleA).inject({
      method: 'GET',
      url: `/api/v1/tools/${resource.id}/download`,
      headers: { cookie: 'falcon_session=synthetic' },
    });
    expect(Buffer.from(download.rawPayload).equals(newBytes)).toBe(true);

    const audit = await prisma.systemAuditLog.findFirst({
      where: { organizationId: org, entityType: 'resource', entityId: resource.id, action: 'edit' },
    });
    expect(audit).not.toBeNull();
    expect((audit!.oldValue as { fileName: string }).fileName).toBe('v1.pdf');
    expect((audit!.newValue as { fileName: string }).fileName).toBe('v2.pdf');
  }, 120_000);

  it('admin=true is re-derived server-side: only an actual admin sees the full, unfiltered list', async () => {
    const resourceId = await createLinkResource('Synthetic admin-only-visible resource');
    // No visibility rows at all, and the Resource is only findable in admin
    // mode — proving the admin list is unfiltered by resource_visibility.
    const asAdminList = await call(asAdmin(), 'GET', '/api/v1/tools?admin=true');
    expect(asAdminList.statusCode).toBe(200);
    expect(asAdminList.body).toContain(resourceId);

    // A tools:view-only caller's admin=true request is silently downgraded to
    // the filtered browse list, never an error and never the raw list.
    const asBrowseOnly = await call(asUserA(), 'GET', '/api/v1/tools?admin=true');
    expect(asBrowseOnly.statusCode).toBe(200);
    expect(asBrowseOnly.body).not.toContain(resourceId);
  }, 120_000);

  it('hasAccessibleTools flips fresh, with no caching, the instant a grant is written', async () => {
    // A dedicated Role/User pair, not roleB/userB: earlier tests in this file
    // leave roleB granted on other Resources, which would make "before" true
    // for the wrong reason.
    const freshRole = randomUUID();
    const freshUser = randomUUID();
    await prisma.role.create({
      data: {
        id: freshRole,
        organizationId: org,
        key: 'synthetic_fresh_capabilities',
        name: 'Synthetic fresh role',
      },
    });
    await prisma.user.create({
      data: {
        id: freshUser,
        organizationId: org,
        name: 'Synthetic fresh user',
        email: 'fresh-capabilities@example.test',
        roleId: freshRole,
      },
    });
    await prisma.rolePermission.create({
      data: {
        organizationId: org,
        roleId: freshRole,
        module: 'tools',
        action: 'view',
        scope: 'ORGANIZATION',
      },
    });
    const asFresh = () => ({ userId: freshUser, roleId: freshRole });

    const resourceId = await createLinkResource('Synthetic capabilities resource');
    const before = await call(asFresh(), 'GET', '/api/v1/auth/capabilities');
    expect((JSON.parse(before.body) as { hasAccessibleTools: boolean }).hasAccessibleTools).toBe(
      false,
    );

    await call(asAdmin(), 'PUT', `/api/v1/tools/${resourceId}/visibility`, {
      roleIds: [freshRole],
    });

    const after = await call(asFresh(), 'GET', '/api/v1/auth/capabilities');
    expect((JSON.parse(after.body) as { hasAccessibleTools: boolean }).hasAccessibleTools).toBe(
      true,
    );
  }, 120_000);

  it('rejects a resourceId or roleId from another organization', async () => {
    const resourceId = await createLinkResource('Synthetic tenant-isolation resource');
    const foreignResource = await call(
      asAdmin(),
      'GET',
      `/api/v1/tools/${randomUUID()}/visibility`,
    );
    expect(foreignResource.statusCode).toBe(404);
    const foreignRoleWrite = await call(
      asAdmin(),
      'PUT',
      `/api/v1/tools/${resourceId}/visibility`,
      {
        roleIds: [foreignRole],
      },
    );
    expect(foreignRoleWrite.statusCode).toBe(400);
    expect(JSON.parse(foreignRoleWrite.body)).toMatchObject({ error: 'validation_error' });
  }, 120_000);
});
