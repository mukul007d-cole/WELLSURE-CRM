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
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from './fixtures/synthetic-admin.js';

/**
 * Regression coverage for finding #1: `listSellers` silently caps
 * `pageSize` at 100 regardless of what a caller requests
 * (`prisma-lead-repository.ts`), but `buildSellerExport` used to decide
 * when to stop paging by comparing `page * (its own requested pageSize of
 * 500)` against the true total — a page-size mismatch that under-counted
 * everywhere the true total exceeded 100. Boundaries below 100 (a single
 * page) hid the bug entirely; 101 lost exactly one row, and 500 lost 80%
 * of them. See the investigation notes on finding #1 for the full
 * derivation and the pre-fix numbers this reproduced.
 */
describe.runIf(shouldRunAdminPostgres)('export pagination: boundary counts', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  const adminRole = randomUUID();
  const adminUser = randomUUID();
  const department = randomUUID();
  const journey = randomUUID();
  const defaultStatus = randomUUID();
  const assignmentType = 'synthetic_owner';

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
            userId: adminUser,
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
            id: adminUser,
            organizationId: org,
            roleId: adminRole,
            active: true,
            departmentId: department,
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

  const call = async (url: string) => {
    const server = serverFor();
    try {
      return await server.inject({
        method: 'GET',
        url,
        headers: { cookie: 'falcon_session=synthetic' },
      });
    } finally {
      await server.close();
    }
  };

  /** Bulk-seed N leads, each with one active process instance owned by adminUser. */
  const seedLeads = async (n: number, tag: string) => {
    const leadIds = Array.from({ length: n }, () => randomUUID());
    await prisma.lead.createMany({
      data: leadIds.map((id, i) => ({
        id,
        organizationId: org,
        name: `${tag} Lead ${i}`,
        phone: null,
        email: null,
        fieldValues: {},
      })),
    });
    const processIds = leadIds.map(() => randomUUID());
    await prisma.processInstance.createMany({
      data: leadIds.map((leadId, i) => ({
        id: processIds[i]!,
        organizationId: org,
        leadId,
        journeyId: journey,
        currentStatusId: defaultStatus,
        isPrimary: true,
      })),
    });
    await prisma.assignment.createMany({
      data: processIds.map((processInstanceId) => ({
        organizationId: org,
        processInstanceId,
        assignmentType,
        userId: adminUser,
      })),
    });
    return leadIds;
  };

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    await applyMigrations(db.sql);

    await prisma.organization.create({ data: { id: org, name: 'Export pagination org' } });
    await prisma.role.create({
      data: { id: adminRole, organizationId: org, key: 'export_admin', name: 'Export admin' },
    });
    await prisma.department.create({
      data: { id: department, organizationId: org, key: 'export_unit', name: 'Export unit' },
    });
    await prisma.user.create({
      data: {
        id: adminUser,
        organizationId: org,
        name: 'Export admin user',
        email: 'export-admin@example.test',
        roleId: adminRole,
        departmentId: department,
      },
    });
    await prisma.rolePermission.createMany({
      data: ['view', 'export'].map((action) => ({
        organizationId: org,
        roleId: adminRole,
        module: 'leads',
        action,
        scope: 'ORGANIZATION' as const,
      })),
    });
    await prisma.journey.create({
      data: { id: journey, organizationId: org, key: 'export_journey', name: 'Export journey' },
    });
    await prisma.roleJourneyAccess.create({
      data: { organizationId: org, roleId: adminRole, journeyId: journey },
    });
    await prisma.status.create({
      data: {
        id: defaultStatus,
        organizationId: org,
        journeyId: journey,
        key: 'export_default',
        name: 'Export default',
        outcomeType: 'open',
        behaviorType: 'default',
        isDefaultOnCreate: true,
        sortOrder: 0,
      },
    });
  }, 240_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  it.each([100, 101, 250, 500, 501])(
    'exports all %i eligible leads with truncated=false',
    async (n) => {
      const tag = `n${n}`;
      await seedLeads(n, tag);

      const response = await call(
        `/api/v1/leads/export?assignmentTypes=${assignmentType}&search=${tag}`,
      );
      expect(response.statusCode).toBe(200);
      const rowCount = Number(response.headers['x-export-row-count']);
      const truncated = response.headers['x-export-truncated'];

      expect({ exported: rowCount, truncated: truncated ?? 'false' }).toEqual({
        exported: n,
        truncated: 'false',
      });
    },
    60_000,
  );
});
