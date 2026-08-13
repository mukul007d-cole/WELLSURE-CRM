import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';

import { PrismaAdminRepository } from '../admin/prisma-admin-repository.js';
import { PrismaConfigurationRepository } from '../configuration/prisma-configuration-repository.js';
import { PrismaExportRepository } from '../export/prisma-export-repository.js';
import { PrismaImportRepository, visibleLeadIds } from '../import/prisma-import-repository.js';
import { ImportService } from '../import/service.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { LeadSharingService } from '../leads/sharing.js';
import { NotificationService } from '../notifications/service.js';
import { CampaignTriggerService } from '../campaigns/trigger-service.js';
import { StatusRoutingService } from '../routing/service.js';
import { defaultAuthConfig } from '../auth/config.js';
import { buildServer } from '../http/build-server.js';
import type { ServerDependencies } from '../http/types.js';
import { createAdminPostgres, shouldRunAdminPostgres } from './fixtures/synthetic-admin.js';

/**
 * Phase 15 — bulk import and export, against real Postgres.
 *
 * Two assertions this file exists for, both checked for vacuity by mutation
 * before the PR (see the phase plan's Gates section):
 *
 * 1. **A preview predicts a commit exactly.** Not approximately, and not for
 *    the easy rows: the same bytes are run twice and the per-row outcome lists
 *    must be deeply equal, including the pair of rows that duplicate *each
 *    other*, which only agrees because the run is one transaction with a
 *    savepoint per row rather than a transaction per row.
 *
 * 2. **An export returns exactly the rows and fields its caller could already
 *    see in the list.** Asserted as an equality against `GET /leads`, not as a
 *    subset, and on the whole file body so a leak in a data cell fails too.
 *
 * Every name is synthetic. Nothing depends on a real journey, status, role,
 * department, field or person name (`AGENTS.md`), and no real Cronberry sample
 * is used — it is not in the repository and must not be.
 */

describe.runIf(shouldRunAdminPostgres)('Phase 15 bulk import and export', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  const otherOrg = randomUUID();

  const adminRole = randomUUID();
  /** SELF scope, sees one Field. The role the export equality is proven on. */
  const repRole = randomUUID();
  /** ORGANIZATION on `export`, SELF on `view` — the §D6 case. */
  const wideExportRole = randomUUID();
  /** Everything except `leads:import`. */
  const noImportRole = randomUUID();
  const foreignRole = randomUUID();

  const adminUser = randomUUID();
  const repUser = randomUUID();
  const wideExportUser = randomUUID();
  const noImportUser = randomUUID();
  const foreignUser = randomUUID();

  const department = randomUUID();
  const journey = randomUUID();
  const otherJourney = randomUUID();
  const defaultStatus = randomUUID();
  const namedStatus = randomUUID();

  /** Visible to both roles. */
  const companyField = randomUUID();
  /** Visible to the admin only — the Field an export must not leak. */
  const secretField = randomUUID();
  /** A number Field, for coercion and for a Field-valued match key. */
  const sizeField = randomUUID();

  const assignmentType = 'synthetic_owner';

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
            organizationId: roleId === foreignRole ? otherOrg : org,
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
            organizationId: roleId === foreignRole ? otherOrg : org,
            roleId,
            active: true,
            departmentId: roleId === foreignRole ? null : department,
            managerId: null,
          }),
      },
      permissionRepository: new PrismaPermissionRepository(prisma as never),
      adminRepository: new PrismaAdminRepository(prisma),
      configurationRepository: new PrismaConfigurationRepository(prisma),
      leadRepository,
      importService: new ImportService(
        prisma,
        new PrismaImportRepository(prisma),
        leadRepository,
        visibleLeadIds,
      ),
      exportRepository: new PrismaExportRepository(prisma),
      leadSharingService: new LeadSharingService(prisma, new NotificationService(prisma)),
      prisma,
      audit: {},
      emailSender: { sendPasswordReset: () => Promise.resolve() },
      authConfig: { ...defaultAuthConfig, secureCookies: false },
      corsOrigins: [],
    } as unknown as ServerDependencies);
  };

  const call = async (
    actor: { userId: string; roleId: string },
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    options: { payload?: unknown; headers?: Record<string, string> } = {},
  ) => {
    const server = serverFor(actor.userId, actor.roleId);
    try {
      const response = await server.inject({
        method,
        url,
        headers: { cookie: 'falcon_session=synthetic', ...options.headers },
        ...(options.payload === undefined ? {} : { payload: options.payload as never }),
      });
      return {
        statusCode: response.statusCode,
        body: response.body,
        headers: response.headers,
      };
    } finally {
      await server.close();
    }
  };

  /** A multipart body, built by hand so the real upload path is exercised. */
  const upload = (content: string, fields: Record<string, string> = {}) => {
    const boundary = `----falcon${randomUUID().replaceAll('-', '')}`;
    const parts = Object.entries(fields).map(
      ([name, value]) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="leads.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n${content}\r\n`,
      `--${boundary}--\r\n`,
    );
    return {
      payload: parts.join(''),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  };

  const asAdmin = () => ({ userId: adminUser, roleId: adminRole });
  const asRep = () => ({ userId: repUser, roleId: repRole });

  interface RunResult {
    mode: string;
    committed: boolean;
    jobId: string | null;
    contentHash: string;
    rowCount: number;
    createdCount: number;
    skippedCount: number;
    rejectedCount: number;
    rows: {
      rowNumber: number;
      outcome: string;
      leadId?: string;
      matchedLeadId?: string | null;
      matchedLeadName?: string | null;
      code?: string;
      reason?: string;
    }[];
  }

  const runImport = async (
    mode: 'preview' | 'commit',
    content: string,
    mapping: Record<string, unknown>,
    extra: Record<string, string> = {},
    actor = asAdmin(),
  ) => {
    const response = await call(
      actor,
      'POST',
      `/api/v1/leads/import/${mode}`,
      upload(content, { mapping: JSON.stringify(mapping), ...extra }),
    );
    return {
      statusCode: response.statusCode,
      result: response.statusCode === 200 ? (JSON.parse(response.body) as RunResult) : null,
      body: response.body,
    };
  };

  /** The mapping every simple test uses: name, phone, email, one Field. */
  const baseMapping = (overrides: Record<string, unknown> = {}) => ({
    journeyId: journey,
    assignments: [{ assignmentType, userId: adminUser }],
    columns: {
      name: { kind: 'core', column: 'name' },
      phone: { kind: 'core', column: 'phone' },
      email: { kind: 'core', column: 'email' },
      company: { kind: 'field', fieldId: companyField },
      junk: { kind: 'skip' },
    },
    matchKeys: [],
    ...overrides,
  });

  const header = 'name,phone,email,company,junk';

  /** Row counts across every table an import can touch. */
  const snapshot = async () => ({
    leads: await prisma.lead.count({ where: { organizationId: org } }),
    processInstances: await prisma.processInstance.count({ where: { organizationId: org } }),
    assignments: await prisma.assignment.count({ where: { organizationId: org } }),
    activities: await prisma.activityLog.count({ where: { organizationId: org } }),
    notifications: await prisma.notification.count({ where: { organizationId: org } }),
    campaignSends: await prisma.campaignSend.count({ where: { organizationId: org } }),
    importJobs: await prisma.importJob.count({ where: { organizationId: org } }),
    importJobRows: await prisma.importJobRow.count({ where: { organizationId: org } }),
    systemAudits: await prisma.systemAuditLog.count({ where: { organizationId: org } }),
  });

  /** Outcomes, stripped of the ids that legitimately differ between two runs. */
  const shape = (result: RunResult) =>
    result.rows.map((row) => ({
      rowNumber: row.rowNumber,
      outcome: row.outcome,
      ...(row.code === undefined ? {} : { code: row.code, reason: row.reason }),
    }));

  const seedLead = async (input: {
    name: string;
    phone?: string;
    email?: string;
    fieldValues?: Record<string, unknown>;
    ownerId?: string;
  }) => {
    const leadId = randomUUID();
    const processInstanceId = randomUUID();
    await prisma.lead.create({
      data: {
        id: leadId,
        organizationId: org,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        fieldValues: (input.fieldValues ?? {}) as never,
      },
    });
    await prisma.processInstance.create({
      data: {
        id: processInstanceId,
        organizationId: org,
        leadId,
        journeyId: journey,
        currentStatusId: defaultStatus,
        isPrimary: true,
      },
    });
    await prisma.assignment.create({
      data: {
        organizationId: org,
        processInstanceId,
        assignmentType,
        userId: input.ownerId ?? adminUser,
      },
    });
    return { leadId, processInstanceId };
  };

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    for (const file of [
      '00000000000000_initial',
      '00000000000001_custom_session_auth',
      '00000000000002_lead_sharing_notifications',
      '00000000000003_attachment_metadata',
      '00000000000004_campaigns',
      '00000000000005_teams',
      '00000000000006_status_routing',
      '00000000000007_bulk_import',
    ])
      await db.sql.unsafe(
        await readFile(
          new URL(
            `../../../../packages/database/prisma/migrations/${file}/migration.sql`,
            import.meta.url,
          ),
          'utf8',
        ),
      );

    await prisma.organization.createMany({
      data: [
        { id: org, name: 'Synthetic organization' },
        { id: otherOrg, name: 'Other synthetic organization' },
      ],
    });
    await prisma.role.createMany({
      data: [
        { id: adminRole, organizationId: org, key: 'synthetic_admin', name: 'Synthetic admin' },
        { id: repRole, organizationId: org, key: 'synthetic_rep', name: 'Synthetic rep' },
        {
          id: wideExportRole,
          organizationId: org,
          key: 'synthetic_wide_export',
          name: 'Synthetic wide export',
        },
        {
          id: noImportRole,
          organizationId: org,
          key: 'synthetic_no_import',
          name: 'Synthetic no import',
        },
        {
          id: foreignRole,
          organizationId: otherOrg,
          key: 'synthetic_foreign',
          name: 'Synthetic foreign',
        },
      ],
    });
    await prisma.department.create({
      data: { id: department, organizationId: org, key: 'synthetic_unit', name: 'Synthetic unit' },
    });
    await prisma.user.createMany({
      data: [
        [adminUser, adminRole, 'admin'],
        [repUser, repRole, 'rep'],
        [wideExportUser, wideExportRole, 'wide'],
        [noImportUser, noImportRole, 'noimport'],
      ].map(([id, roleId, tag]) => ({
        id: id!,
        organizationId: org,
        name: `Synthetic ${tag!} user`,
        email: `${tag!}@example.test`,
        roleId: roleId!,
        departmentId: department,
      })),
    });
    await prisma.user.create({
      data: {
        id: foreignUser,
        organizationId: otherOrg,
        name: 'Synthetic foreign user',
        email: 'foreign@example.test',
        roleId: foreignRole,
      },
    });
    await prisma.rolePermission.createMany({
      data: [
        ...['view', 'create', 'edit', 'delete', 'export', 'import'].map((action) => ({
          organizationId: org,
          roleId: adminRole,
          module: 'leads',
          action,
          scope: 'ORGANIZATION' as const,
        })),
        // SELF everywhere, including export. The baseline the equality is proven on.
        ...['view', 'create', 'export', 'import'].map((action) => ({
          organizationId: org,
          roleId: repRole,
          module: 'leads',
          action,
          scope: 'SELF' as const,
        })),
        // The §D6 case: a wide `export` scope over a narrow `view` scope.
        {
          organizationId: org,
          roleId: wideExportRole,
          module: 'leads',
          action: 'view',
          scope: 'SELF' as const,
        },
        {
          organizationId: org,
          roleId: wideExportRole,
          module: 'leads',
          action: 'export',
          scope: 'ORGANIZATION' as const,
        },
        // Everything a creator needs, and no `import`.
        ...['view', 'create', 'edit'].map((action) => ({
          organizationId: org,
          roleId: noImportRole,
          module: 'leads',
          action,
          scope: 'ORGANIZATION' as const,
        })),
      ],
    });
    await prisma.journey.createMany({
      data: [
        { id: journey, organizationId: org, key: 'synthetic_journey', name: 'Synthetic journey' },
        {
          id: otherJourney,
          organizationId: org,
          key: 'synthetic_other_journey',
          name: 'Synthetic other journey',
        },
      ],
    });
    await prisma.roleJourneyAccess.createMany({
      data: [adminRole, repRole, wideExportRole, noImportRole].map((roleId) => ({
        organizationId: org,
        roleId,
        journeyId: journey,
      })),
    });
    await prisma.status.createMany({
      data: [
        [defaultStatus, 'synthetic_default', true],
        [namedStatus, 'synthetic_named', false],
      ].map(([id, key, isDefault]) => ({
        id: id as string,
        organizationId: org,
        journeyId: journey,
        key: key as string,
        name: `Status ${key as string}`,
        outcomeType: 'open' as const,
        behaviorType: 'default' as const,
        isDefaultOnCreate: isDefault as boolean,
        sortOrder: isDefault ? 0 : 1,
      })),
    });
    await prisma.field.createMany({
      data: [
        [companyField, 'synthetic_company', 'Synthetic company', 'text'],
        [secretField, 'synthetic_secret', 'Synthetic secret', 'text'],
        [sizeField, 'synthetic_size', 'Synthetic size', 'number'],
      ].map(([id, key, name, fieldType]) => ({
        id: id!,
        organizationId: org,
        key: key!,
        name: name!,
        fieldType: fieldType!,
        editMode: 'manual',
        source: 'custom',
      })),
    });
    await prisma.fieldJourneySetting.createMany({
      data: [companyField, secretField, sizeField].map((fieldId) => ({
        organizationId: org,
        fieldId,
        journeyId: journey,
        requirement: 'optional',
      })),
    });
    await prisma.fieldVisibility.createMany({
      data: [
        // The admin edits everything.
        ...[companyField, secretField, sizeField].map((fieldId) => ({
          organizationId: org,
          fieldId,
          roleId: adminRole,
          accessLevel: 'EDIT' as const,
        })),
        // The rep sees and edits only `company`. `secret` must never reach them.
        {
          organizationId: org,
          fieldId: companyField,
          roleId: repRole,
          accessLevel: 'EDIT' as const,
        },
        {
          organizationId: org,
          fieldId: companyField,
          roleId: wideExportRole,
          accessLevel: 'VIEW' as const,
        },
        ...[companyField, sizeField].map((fieldId) => ({
          organizationId: org,
          fieldId,
          roleId: noImportRole,
          accessLevel: 'EDIT' as const,
        })),
      ],
    });
  }, 240_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  describe('a preview writes nothing', () => {
    it('leaves every table an import can touch exactly as it found it', async () => {
      const before = await snapshot();
      const { statusCode, result } = await runImport(
        'preview',
        `${header}\nPreview One,111,one@example.test,Acme,x\nPreview Two,,,Beta,y\n,,,,\n`,
        baseMapping(),
      );
      expect(statusCode).toBe(200);
      expect(result?.createdCount).toBe(2);
      // The blank row fails on the real path's own name check, not a copy of it.
      expect(result?.rejectedCount).toBe(1);
      expect(result?.committed).toBe(false);
      expect(result?.jobId).toBeNull();

      // Not just `leads`: the trigger fan-out runs inside the transaction too,
      // and a leak there would be just as real.
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('a preview predicts a commit exactly', () => {
    it('produces an identical row-by-row verdict, including two rows that duplicate each other', async () => {
      const existing = await seedLead({ name: 'Existing One', phone: '900100' });
      const content =
        `${header}\n` +
        `Fresh One,900200,fresh1@example.test,Acme,x\n` + // creates
        `Existing Copy,900100,dup@example.test,Acme,x\n` + // duplicate of the seeded lead
        `Twin,900300,twin@example.test,Acme,x\n` + // creates
        `Twin Again,900300,twin2@example.test,Acme,x\n` + // duplicate of the row above
        `,900400,blank@example.test,Acme,x\n`; // rejected: no name
      const mapping = baseMapping({ matchKeys: [{ kind: 'core', column: 'phone' }] });

      const preview = await runImport('preview', content, mapping);
      const commit = await runImport('commit', content, mapping);

      expect(preview.statusCode).toBe(200);
      expect(commit.statusCode).toBe(200);
      expect(shape(preview.result!)).toEqual(shape(commit.result!));
      expect(shape(commit.result!)).toEqual([
        { rowNumber: 2, outcome: 'created' },
        { rowNumber: 3, outcome: 'skipped_duplicate' },
        { rowNumber: 4, outcome: 'created' },
        // The row this test exists for. It only agrees with the preview because
        // both runs are one transaction — row 5 can see row 4's insert.
        { rowNumber: 5, outcome: 'skipped_duplicate' },
        {
          rowNumber: 6,
          outcome: 'rejected',
          code: 'validation_error',
          reason: 'lead name is required',
        },
      ]);
      expect(preview.result!.contentHash).toBe(commit.result!.contentHash);
      expect(preview.result!.rows.find((row) => row.rowNumber === 3)?.matchedLeadId).toBe(
        existing.leadId,
      );
    });
  });

  describe('a commit uses the ordinary creation path', () => {
    it('leaves the same evidence a single-lead POST leaves', async () => {
      const content = `${header}\nImported Person,910100,imported@example.test,Acme,x\n`;
      const { result } = await runImport('commit', content, baseMapping());
      const importedId = result!.rows[0]!.leadId!;

      const posted = await call(asAdmin(), 'POST', '/api/v1/leads', {
        payload: {
          journeyId: journey,
          name: 'Posted Person',
          phone: '910200',
          email: 'posted@example.test',
          fieldValues: { [companyField]: 'Acme' },
          assignments: [{ assignmentType, userId: adminUser }],
        },
      });
      expect(posted.statusCode).toBe(201);
      const postedId = (JSON.parse(posted.body) as { lead: { id: string } }).lead.id;

      const evidence = async (leadId: string) => {
        const lead = await prisma.lead.findUniqueOrThrow({
          where: { organizationId_id: { organizationId: org, id: leadId } },
          include: {
            processInstances: { include: { assignments: true } },
            activities: true,
          },
        });
        const process = lead.processInstances[0]!;
        return {
          fieldValues: lead.fieldValues,
          journeyId: process.journeyId,
          currentStatusId: process.currentStatusId,
          assignments: process.assignments.map((a) => ({
            assignmentType: a.assignmentType,
            userId: a.userId,
            isCurrent: a.isCurrent,
          })),
          activities: lead.activities.map((a) => ({
            actionType: a.actionType,
            source: a.source,
            actorUserId: a.actorUserId,
          })),
        };
      };
      const imported = await evidence(importedId);
      expect(imported).toEqual(await evidence(postedId));
      // Named explicitly rather than only compared, so a change to both at once
      // still fails here.
      expect(imported.currentStatusId).toBe(defaultStatus);
      expect(imported.activities).toEqual([
        { actionType: 'field_edit', source: 'lead_api', actorUserId: adminUser },
      ]);
    });

    it('records every row in import_job_rows and reconciles the counts', async () => {
      const content =
        `${header}\n` +
        `Traced One,920100,t1@example.test,Acme,x\n` +
        `,920200,t2@example.test,Acme,x\n`;
      const { result } = await runImport('commit', content, baseMapping());
      expect(result!.committed).toBe(true);

      const job = await prisma.importJob.findUniqueOrThrow({
        where: { organizationId_id: { organizationId: org, id: result!.jobId! } },
        include: { rows: { orderBy: { rowNumber: 'asc' } } },
      });
      expect(job.rowCount).toBe(2);
      expect(job.createdCount + job.skippedCount + job.rejectedCount).toBe(job.rowCount);
      expect(job.fileKey).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(job.status).toBe('committed');
      expect(job.createdById).toBe(adminUser);
      expect(job.rows).toHaveLength(2);
      expect(job.rows[0]?.outcome).toBe('created');
      expect(job.rows[0]?.leadId).toBe(result!.rows[0]!.leadId);
      expect(job.rows[1]?.outcome).toBe('rejected');
      expect(job.rows[1]?.reason).toContain('lead name is required');

      const audit = await prisma.systemAuditLog.findFirst({
        where: { organizationId: org, entityType: 'import_job', entityId: job.id },
      });
      expect(audit?.action).toBe('import_commit');
      expect(audit?.actorUserId).toBe(adminUser);
    });
  });

  describe('partial success', () => {
    it('keeps the valid rows and drops nothing silently', async () => {
      const content =
        `${header}\n` +
        `Partial Good,930100,pg@example.test,Acme,x\n` +
        `,930200,pb@example.test,Acme,x\n` +
        `Partial Good Two,930300,pg2@example.test,Acme,x\n`;
      const { result } = await runImport('commit', content, baseMapping());
      expect(result!.createdCount).toBe(2);
      expect(result!.rejectedCount).toBe(1);
      expect(result!.rows).toHaveLength(3);
      expect(
        await prisma.lead.count({
          where: { organizationId: org, phone: { in: ['930100', '930300'] } },
        }),
      ).toBe(2);
      expect(await prisma.lead.count({ where: { organizationId: org, phone: '930200' } })).toBe(0);
    });

    it('stopOnError keeps nothing, and still reports every failure', async () => {
      const before = await snapshot();
      const content =
        `${header}\n` +
        `Stop Good,940100,sg@example.test,Acme,x\n` +
        `,940200,sb@example.test,Acme,x\n` +
        `,940300,sb2@example.test,Acme,x\n`;
      const { result } = await runImport('commit', content, baseMapping(), {
        stopOnError: 'true',
      });
      expect(result!.committed).toBe(false);
      expect(result!.jobId).toBeNull();
      // Every row was still evaluated, so the admin sees all the problems at
      // once rather than fixing them one upload at a time.
      expect(result!.rejectedCount).toBe(2);
      expect(result!.createdCount).toBe(1);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('the committed file is the previewed file', () => {
    it('refuses a commit whose bytes differ from the preview it echoes', async () => {
      const content = `${header}\nHash One,950100,h1@example.test,Acme,x\n`;
      const preview = await runImport('preview', content, baseMapping());
      const before = await snapshot();
      const tampered = `${header}\nHash One,950100,h1@example.test,Acme,x\nSneaky,950200,s@example.test,Acme,x\n`;
      const commit = await runImport('commit', tampered, baseMapping(), {
        contentHash: preview.result!.contentHash,
      });
      expect(commit.statusCode).toBe(409);
      expect(commit.body).toContain('conflict');
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('duplicate detection', () => {
    it('matches email case-insensitively', async () => {
      await seedLead({ name: 'Case Holder', email: 'MixedCase@Example.Test' });
      const { result } = await runImport(
        'preview',
        `${header}\nCase Row,960100,mixedcase@example.test,Acme,x\n`,
        baseMapping({ matchKeys: [{ kind: 'core', column: 'email' }] }),
      );
      expect(result!.skippedCount).toBe(1);
    });

    it('matches on a Field value', async () => {
      await seedLead({ name: 'Field Holder', fieldValues: { [sizeField]: 42 } });
      const mapping = {
        journeyId: journey,
        assignments: [{ assignmentType, userId: adminUser }],
        columns: {
          name: { kind: 'core', column: 'name' },
          size: { kind: 'field', fieldId: sizeField },
        },
        matchKeys: [{ kind: 'field', fieldId: sizeField }],
      };
      const { result } = await runImport(
        'preview',
        'name,size\nSize Row,42\nOther Row,43\n',
        mapping,
      );
      expect(shape(result!)).toEqual([
        { rowNumber: 2, outcome: 'skipped_duplicate' },
        { rowNumber: 3, outcome: 'created' },
      ]);
    });

    it('treats a row with a blank key value as unmatchable rather than matching every blank', async () => {
      // No phone at all — the lead a blank-keyed row would wrongly match.
      await seedLead({ name: 'Blank Holder' });
      const { result } = await runImport(
        'preview',
        `${header}\nNo Phone Row,,np@example.test,Acme,x\n`,
        baseMapping({
          matchKeys: [
            { kind: 'core', column: 'phone' },
            { kind: 'core', column: 'email' },
          ],
        }),
      );
      expect(result!.createdCount).toBe(1);
      expect(result!.skippedCount).toBe(0);
    });

    it('creates everything when no match key is chosen', async () => {
      await seedLead({ name: 'Ignored Holder', phone: '970100' });
      const { result } = await runImport(
        'preview',
        `${header}\nSame Phone,970100,sp@example.test,Acme,x\n`,
        baseMapping(),
      );
      expect(result!.createdCount).toBe(1);
    });

    it('reports a match outside the importer scope without naming the record', async () => {
      // Owned by the admin, so a SELF-scoped rep cannot see it.
      const hidden = await seedLead({
        name: 'Hidden Holder',
        phone: '980100',
        ownerId: adminUser,
      });
      const mapping = baseMapping({ matchKeys: [{ kind: 'core', column: 'phone' }] });
      const content = `${header}\nHidden Row,980100,hidden@example.test,Acme,x\n`;

      const asRepRun = await runImport('preview', content, mapping, {}, asRep());
      const repRow = asRepRun.result!.rows[0]!;
      expect(repRow.outcome).toBe('skipped_duplicate');
      // The duplicate is still reported — suppressing it would create a real
      // duplicate — but the record behind it is not disclosed.
      expect(repRow.matchedLeadId).toBeNull();
      expect(repRow.matchedLeadName).toBeNull();
      expect(asRepRun.body).not.toContain(hidden.leadId);
      expect(asRepRun.body).not.toContain('Hidden Holder');

      const asAdminRun = await runImport('preview', content, mapping);
      expect(asAdminRun.result!.rows[0]!.matchedLeadId).toBe(hidden.leadId);
      expect(asAdminRun.result!.rows[0]!.matchedLeadName).toBe('Hidden Holder');
    });
  });

  describe('per-row status and assignment', () => {
    it('resolves a status by its configured name and rejects a row naming an unknown one', async () => {
      const mapping = {
        journeyId: journey,
        assignments: [{ assignmentType, userId: adminUser }],
        columns: {
          name: { kind: 'core', column: 'name' },
          stage: { kind: 'status' },
        },
        matchKeys: [],
      };
      const { result } = await runImport(
        'commit',
        `name,stage\nNamed Status Row,Status synthetic_named\nKey Status Row,synthetic_named\nBad Status Row,Nonexistent\n`,
        mapping,
      );
      expect(shape(result!)).toEqual([
        { rowNumber: 2, outcome: 'created' },
        { rowNumber: 3, outcome: 'created' },
        {
          rowNumber: 4,
          outcome: 'rejected',
          code: 'validation_error',
          reason: 'no status in this journey matches that value',
        },
      ]);
      const created = await prisma.processInstance.findFirstOrThrow({
        where: { organizationId: org, leadId: result!.rows[0]!.leadId! },
      });
      expect(created.currentStatusId).toBe(namedStatus);
    });

    it('rejects a row whose assignment email matches no user, never defaulting the owner', async () => {
      const mapping = {
        journeyId: journey,
        assignments: [],
        columns: {
          name: { kind: 'core', column: 'name' },
          owner: { kind: 'assignment', assignmentType },
        },
        matchKeys: [],
      };
      const { result } = await runImport(
        'commit',
        `name,owner\nGood Owner Row,rep@example.test\nBad Owner Row,nobody@example.test\nNo Owner Row,\n`,
        mapping,
      );
      expect(shape(result!)).toEqual([
        { rowNumber: 2, outcome: 'created' },
        {
          rowNumber: 3,
          outcome: 'rejected',
          code: 'validation_error',
          reason: 'no user matches that assignment email',
        },
        // Not silently assigned to the importer: with no assignment at all, the
        // real path's own rule rejects it.
        {
          rowNumber: 4,
          outcome: 'rejected',
          code: 'validation_error',
          reason: 'at least one assignment is required',
        },
      ]);
      const assignment = await prisma.assignment.findFirstOrThrow({
        where: {
          organizationId: org,
          processInstance: { leadId: result!.rows[0]!.leadId! },
        },
      });
      expect(assignment.userId).toBe(repUser);
    });
  });

  describe('permissions', () => {
    const content = `${header}\nPermission Row,990100,perm@example.test,Acme,x\n`;

    it('refuses an importer without leads:import', async () => {
      const before = await snapshot();
      const run = await runImport(
        'commit',
        content,
        baseMapping(),
        {},
        {
          userId: noImportUser,
          roleId: noImportRole,
        },
      );
      expect(run.statusCode).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    it('refuses the analyze step too, so column names are not disclosed', async () => {
      const response = await call(
        { userId: noImportUser, roleId: noImportRole },
        'POST',
        '/api/v1/leads/import/analyze',
        upload(content),
      );
      expect(response.statusCode).toBe(403);
      expect(response.body).not.toContain('company');
    });

    it('names the column when a mapped Field is not writable by the importer', async () => {
      const run = await runImport(
        'commit',
        `name,secret\nSecret Row,hush\n`,
        {
          journeyId: journey,
          assignments: [{ assignmentType, userId: repUser }],
          columns: {
            name: { kind: 'core', column: 'name' },
            secret: { kind: 'field', fieldId: secretField },
          },
          matchKeys: [],
        },
        {},
        asRep(),
      );
      expect(run.statusCode).toBe(403);
      const body = JSON.parse(run.body) as { error: string; details: { columns: string[] } };
      expect(body.error).toBe('field_edit_denied');
      expect(body.details.columns).toEqual(['secret']);
    });

    it('refuses a journey the importer cannot access', async () => {
      const run = await runImport('commit', `name\nOther Journey Row\n`, {
        journeyId: otherJourney,
        assignments: [{ assignmentType, userId: adminUser }],
        columns: { name: { kind: 'core', column: 'name' } },
        matchKeys: [],
      });
      expect(run.statusCode).toBe(403);
    });

    it('refuses a journey from another organization', async () => {
      const run = await runImport('commit', `name\nForeign Row\n`, {
        journeyId: randomUUID(),
        assignments: [{ assignmentType, userId: adminUser }],
        columns: { name: { kind: 'core', column: 'name' } },
        matchKeys: [],
      });
      expect(run.statusCode).toBe(403);
    });

    it('refuses an exporter without leads:export', async () => {
      const response = await call(
        { userId: noImportUser, roleId: noImportRole },
        'GET',
        '/api/v1/leads/export',
      );
      expect(response.statusCode).toBe(403);
    });
  });

  describe('mapping validation', () => {
    it.each([
      [
        'a column with no entry',
        { columns: { name: { kind: 'core', column: 'name' } } },
        'every source column needs a mapping',
      ],
      [
        'two columns on one target',
        {
          columns: {
            name: { kind: 'core', column: 'name' },
            phone: { kind: 'core', column: 'name' },
          },
        },
        'two columns are mapped to the same target',
      ],
      [
        'no name column',
        {
          columns: {
            name: { kind: 'skip' },
            phone: { kind: 'core', column: 'phone' },
          },
        },
        'one column must be mapped to the lead name',
      ],
      [
        'a match key nothing writes to',
        {
          columns: {
            name: { kind: 'core', column: 'name' },
            phone: { kind: 'skip' },
          },
          matchKeys: [{ kind: 'core', column: 'phone' }],
        },
        'duplicate-matching key is not mapped',
      ],
    ])('rejects %s', async (_label, overrides, message) => {
      const run = await runImport('preview', 'name,phone\nX,1\n', {
        journeyId: journey,
        assignments: [{ assignmentType, userId: adminUser }],
        matchKeys: [],
        ...overrides,
      });
      expect(run.statusCode).toBe(400);
      expect(run.body).toContain(message);
    });
  });

  describe('export', () => {
    /** Every lead id in a CSV body, read out of the first column. */
    const csvLeadIds = (body: string) =>
      new Set(
        body
          .trim()
          .split('\r\n')
          .slice(1)
          .map((line) => line.split(',')[0]!),
      );

    const listLeadIds = async (actor: { userId: string; roleId: string }) => {
      const ids = new Set<string>();
      for (let page = 1; ; page += 1) {
        const response = await call(
          actor,
          'GET',
          `/api/v1/leads?page=${page}&pageSize=100&assignmentTypes=${assignmentType}`,
        );
        const parsed = JSON.parse(response.body) as { total: number; rows: { id: string }[] };
        for (const row of parsed.rows) ids.add(row.id);
        if (page * 100 >= parsed.total || parsed.rows.length === 0) break;
      }
      return ids;
    };

    beforeAll(async () => {
      await seedLead({
        name: 'Export Admin Owned',
        phone: '800100',
        fieldValues: { [companyField]: 'VisibleCo', [secretField]: 'CLASSIFIED-XYZ' },
        ownerId: adminUser,
      });
      await seedLead({
        name: 'Export Rep Owned',
        phone: '800200',
        fieldValues: { [companyField]: 'RepCo', [secretField]: 'CLASSIFIED-ABC' },
        ownerId: repUser,
      });
      // The wide-export role owns exactly one lead, so the §D6 assertion below
      // compares two *non-empty* sets. Comparing two empty ones would pass even
      // if the export returned nothing at all.
      await seedLead({
        name: 'Export Wide Owned',
        phone: '800300',
        fieldValues: { [companyField]: 'WideCo', [secretField]: 'CLASSIFIED-DEF' },
        ownerId: wideExportUser,
      });
    });

    it('returns exactly the rows the same caller sees in the list, for each scope', async () => {
      for (const actor of [asAdmin(), asRep()]) {
        const response = await call(
          actor,
          'GET',
          `/api/v1/leads/export?assignmentTypes=${assignmentType}`,
        );
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/csv');
        // Equality, not containment: a superset is a leak and a subset is a bug.
        expect(csvLeadIds(response.body)).toEqual(await listLeadIds(actor));
      }
    });

    it('gives a restricted role a restricted header, and leaks no invisible value anywhere', async () => {
      const adminCsv = await call(
        asAdmin(),
        'GET',
        `/api/v1/leads/export?assignmentTypes=${assignmentType}`,
      );
      const repCsv = await call(
        asRep(),
        'GET',
        `/api/v1/leads/export?assignmentTypes=${assignmentType}`,
      );
      const headerOf = (body: string) => body.split('\r\n')[0]!.split(',');

      expect(headerOf(adminCsv.body)).toContain('Synthetic secret');
      expect(headerOf(repCsv.body)).toContain('Synthetic company');
      // The Field's name is absent, so the CSV does not even disclose it exists.
      expect(headerOf(repCsv.body)).not.toContain('Synthetic secret');
      // And the whole body is checked, so a value leaking into a data cell fails.
      expect(repCsv.body).not.toContain('CLASSIFIED');
      expect(adminCsv.body).toContain('CLASSIFIED-XYZ');
    });

    it('takes its row scope from leads:view even when leads:export is wider', async () => {
      const actor = { userId: wideExportUser, roleId: wideExportRole };
      const response = await call(
        actor,
        'GET',
        `/api/v1/leads/export?assignmentTypes=${assignmentType}`,
      );
      expect(response.statusCode).toBe(200);
      const exported = csvLeadIds(response.body);
      const listed = await listLeadIds(actor);
      // Non-empty on both sides, so this cannot pass by exporting nothing.
      expect(listed.size).toBe(1);
      // ORGANIZATION on `export`, SELF on `view`: the SELF set is what comes out.
      expect(exported).toEqual(listed);
      expect(response.body).toContain('Export Wide Owned');
      expect(response.body).not.toContain('Export Admin Owned');
      expect(response.body).not.toContain('Export Rep Owned');
    });

    it('respects the list filters it is given', async () => {
      const filtered = await call(
        asAdmin(),
        'GET',
        `/api/v1/leads/export?assignmentTypes=${assignmentType}&search=Export%20Rep%20Owned`,
      );
      const ids = csvLeadIds(filtered.body);
      expect(ids.size).toBe(1);
      expect(filtered.body).toContain('Export Rep Owned');
      expect(filtered.body).not.toContain('Export Admin Owned');
    });

    it('writes an audit row naming the actor, the filters and the row count', async () => {
      const response = await call(
        asAdmin(),
        'GET',
        `/api/v1/leads/export?assignmentTypes=${assignmentType}&search=Export%20Rep%20Owned`,
      );
      const audit = await prisma.systemAuditLog.findFirst({
        where: { organizationId: org, entityType: 'lead_export' },
        orderBy: { timestamp: 'desc' },
      });
      expect(audit?.actorUserId).toBe(adminUser);
      expect(audit?.action).toBe('export');
      const detail = audit?.newValue as { rowCount: number; filters: { search: string } };
      expect(detail.rowCount).toBe(Number(response.headers['x-export-row-count']));
      expect(detail.filters.search).toBe('Export Rep Owned');
    });

    it('resolves the static export path rather than treating it as a lead id', async () => {
      const response = await call(asAdmin(), 'GET', '/api/v1/leads/export');
      expect(response.statusCode).toBe(200);
    });
  });
});
