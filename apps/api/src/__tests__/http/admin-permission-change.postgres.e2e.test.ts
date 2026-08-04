import { readFile } from 'node:fs/promises';

import { afterAll, describe, expect, it } from 'vitest';

import { PrismaAdminRepository } from '../../admin/prisma-admin-repository.js';
import { defaultAuthConfig } from '../../auth/config.js';
import { PrismaAuthRepository } from '../../auth/prisma-auth-repository.js';
import { issueSession } from '../../auth/session.js';
import { PrismaConfigurationRepository } from '../../configuration/prisma-configuration-repository.js';
import { buildServer } from '../../http/build-server.js';
import { PrismaLeadRepository } from '../../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../../permissions/prisma-permission-repository.js';
import { createAdminPostgres, shouldRunAdminPostgres } from '../fixtures/synthetic-admin.js';

let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => cleanup?.());

describe.runIf(shouldRunAdminPostgres)(
  'admin permission replacement changes real HTTP enforcement immediately',
  () => {
    it('denies, grants, and revokes leads:view through the same role_permissions rows', async () => {
      const db = await createAdminPostgres();
      cleanup = db.cleanup;
      for (const file of [
        new URL(
          '../../../../../packages/database/prisma/migrations/00000000000000_initial/migration.sql',
          import.meta.url,
        ),
        new URL(
          '../../../../../packages/database/prisma/migrations/00000000000001_custom_session_auth/migration.sql',
          import.meta.url,
        ),
        new URL(
          '../../../../../packages/database/prisma/migrations/00000000000002_lead_sharing_notifications/migration.sql',
          import.meta.url,
        ),
      ]) {
        await db.sql.unsafe(await readFile(file, 'utf8'));
      }

      const organization = await db.prisma.organization.create({
        data: { name: 'Synthetic Enforcement Organization' },
      });
      const adminRole = await db.prisma.role.create({
        data: {
          organizationId: organization.id,
          key: 'permission_operator',
          name: 'Permission Operator',
        },
      });
      const subjectRole = await db.prisma.role.create({
        data: { organizationId: organization.id, key: 'record_reader', name: 'Record Reader' },
      });
      const admin = await db.prisma.user.create({
        data: {
          organizationId: organization.id,
          roleId: adminRole.id,
          name: 'Synthetic Operator',
          email: 'operator@example.test',
        },
      });
      const subject = await db.prisma.user.create({
        data: {
          organizationId: organization.id,
          roleId: subjectRole.id,
          name: 'Synthetic Subject',
          email: 'subject@example.test',
        },
      });
      const journey = await db.prisma.journey.create({
        data: {
          organizationId: organization.id,
          key: 'synthetic_flow',
          name: 'Synthetic Flow',
          createdById: admin.id,
          updatedById: admin.id,
        },
      });
      const status = await db.prisma.status.create({
        data: {
          organizationId: organization.id,
          journeyId: journey.id,
          key: 'synthetic_open',
          name: 'Synthetic Open',
          outcomeType: 'open',
          behaviorType: 'default',
          sortOrder: 1,
          createdById: admin.id,
          updatedById: admin.id,
        },
      });
      await db.prisma.rolePermission.create({
        data: {
          organizationId: organization.id,
          roleId: adminRole.id,
          module: 'roles_permissions',
          action: 'edit',
          scope: 'ORGANIZATION',
        },
      });
      await db.prisma.roleJourneyAccess.createMany({
        data: [adminRole.id, subjectRole.id].map((roleId) => ({
          organizationId: organization.id,
          roleId,
          journeyId: journey.id,
        })),
      });
      const lead = await db.prisma.lead.create({
        data: { organizationId: organization.id, name: 'Synthetic Seller', fieldValues: {} },
      });
      const process = await db.prisma.processInstance.create({
        data: {
          organizationId: organization.id,
          leadId: lead.id,
          journeyId: journey.id,
          currentStatusId: status.id,
          isPrimary: true,
        },
      });
      await db.prisma.assignment.create({
        data: {
          organizationId: organization.id,
          processInstanceId: process.id,
          assignmentType: 'synthetic_owner',
          userId: subject.id,
          isCurrent: true,
        },
      });

      const authConfig = { ...defaultAuthConfig, secureCookies: false };
      const authRepository = new PrismaAuthRepository(db.prisma);
      const permissionRepository = new PrismaPermissionRepository(db.prisma as never);
      const server = buildServer({
        authRepository,
        audit: authRepository,
        emailSender: { sendPasswordReset: () => Promise.resolve() },
        permissionRepository,
        leadRepository: new PrismaLeadRepository(db.prisma as never),
        configurationRepository: new PrismaConfigurationRepository(db.prisma),
        adminRepository: new PrismaAdminRepository(db.prisma),
        authConfig,
        corsOrigins: [],
      });
      const adminSession = await issueSession({
        repository: authRepository,
        config: authConfig,
        userId: admin.id,
        organizationId: organization.id,
      });
      const subjectSession = await issueSession({
        repository: authRepository,
        config: authConfig,
        userId: subject.id,
        organizationId: organization.id,
      });
      const cookie = (token: string) => ({ cookie: `${authConfig.sessionCookieName}=${token}` });
      const readLead = () =>
        server.inject({
          method: 'GET',
          url: `/api/v1/leads/${lead.id}?assignmentTypes=synthetic_owner&assignmentTypes=synthetic_owner`,
          headers: cookie(subjectSession.token),
        });
      const replace = (permissions: unknown[]) =>
        server.inject({
          method: 'PUT',
          url: `/api/v1/roles/${subjectRole.id}/permissions`,
          headers: cookie(adminSession.token),
          payload: { permissions },
        });

      expect((await readLead()).statusCode).toBe(403);
      expect((await replace([{ module: 'leads', action: 'view', scope: 'SELF' }])).statusCode).toBe(
        200,
      );
      const allowed = await readLead();
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toEqual(
        expect.objectContaining({ id: lead.id, name: 'Synthetic Seller' }),
      );
      expect((await replace([])).statusCode).toBe(200);
      expect((await readLead()).statusCode).toBe(403);
      const lastAdminRemoval = await server.inject({
        method: 'PUT',
        url: `/api/v1/roles/${adminRole.id}/permissions`,
        headers: cookie(adminSession.token),
        payload: { permissions: [] },
      });
      expect(lastAdminRemoval.statusCode).toBe(409);
      expect(lastAdminRemoval.json()).toEqual({ error: 'conflict' });

      const audits = await db.prisma.systemAuditLog.findMany({
        where: {
          organizationId: organization.id,
          entityType: 'role_permission',
          entityId: subjectRole.id,
          action: 'replace',
        },
        orderBy: { timestamp: 'asc' },
      });
      expect(audits).toHaveLength(2);
      expect(audits.map(({ oldValue, newValue }) => ({ oldValue, newValue }))).toEqual([
        { oldValue: [], newValue: [{ module: 'leads', action: 'view', scope: 'SELF' }] },
        { oldValue: [{ module: 'leads', action: 'view', scope: 'SELF' }], newValue: [] },
      ]);
      await server.close();
    }, 120_000);
  },
);
