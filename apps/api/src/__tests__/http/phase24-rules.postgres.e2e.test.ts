import { permissionCatalog } from '@falcon/permission-engine';
import { afterAll, describe, expect, it } from 'vitest';

import { PrismaAdminRepository } from '../../admin/prisma-admin-repository.js';
import { defaultAuthConfig } from '../../auth/config.js';
import { PrismaAuthRepository } from '../../auth/prisma-auth-repository.js';
import { issueSession } from '../../auth/session.js';
import { PrismaConfigurationRepository } from '../../configuration/prisma-configuration-repository.js';
import { buildServer } from '../../http/build-server.js';
import { PrismaLeadRepository } from '../../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../../permissions/prisma-permission-repository.js';
import { PrismaResourceRepository } from '../../tools/prisma-resource-repository.js';
import { ResourceService } from '../../tools/service.js';
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from '../fixtures/synthetic-admin.js';

let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => cleanup?.());

/**
 * Phase 24 (ADR-0025, ADR-0026) end to end over HTTP against real Postgres:
 * status rules, follow-ups, journey members and role reporting lines, each
 * through the same routes the web app calls.
 */
describe.runIf(shouldRunAdminPostgres)('phase 24 engine rules over HTTP', () => {
  it('enforces status rules, schedules follow-ups, and honours members and reporting lines', async () => {
    const db = await createAdminPostgres();
    cleanup = db.cleanup;
    await applyMigrations(db.sql);
    const organizationId = (
      await db.prisma.organization.create({ data: { name: 'Synthetic Phase 24 Organization' } })
    ).id;
    const role = (key: string) =>
      db.prisma.role.create({ data: { organizationId, key, name: `Synthetic ${key}` } });
    const adminRole = await role('synthetic_admin');
    const execRole = await role('synthetic_executive');
    const leadRole = await role('synthetic_leader');
    const user = (roleId: string, name: string) =>
      db.prisma.user.create({
        data: { organizationId, roleId, name, email: `${name}@example.test` },
      });
    const admin = await user(adminRole.id, 'admin');
    const exec = await user(execRole.id, 'executive');
    const leader = await user(leadRole.id, 'leader');

    // The admin holds the whole catalog — including leads:bypass_status_rules.
    await db.prisma.rolePermission.createMany({
      data: permissionCatalog.flatMap((module) =>
        module.actions.map((action) => ({
          organizationId,
          roleId: adminRole.id,
          module: module.module,
          action,
          scope: 'ORGANIZATION' as const,
        })),
      ),
    });
    await db.prisma.rolePermission.createMany({
      data: [
        ...['view', 'edit'].map((action) => ({
          organizationId,
          roleId: execRole.id,
          module: 'leads',
          action,
          scope: 'SELF' as const,
        })),
        {
          organizationId,
          roleId: leadRole.id,
          module: 'leads',
          action: 'view',
          scope: 'REPORTING_ROLES' as const,
        },
      ],
    });

    const journey = await db.prisma.journey.create({
      data: { organizationId, key: 'synthetic_flow', name: 'Synthetic Flow' },
    });
    await db.prisma.roleJourneyAccess.createMany({
      data: [adminRole.id, execRole.id, leadRole.id].map((roleId) => ({
        organizationId,
        roleId,
        journeyId: journey.id,
      })),
    });
    const status = (key: string, sortOrder: number) =>
      db.prisma.status.create({
        data: {
          organizationId,
          journeyId: journey.id,
          key,
          name: `Synthetic ${key}`,
          outcomeType: 'open',
          behaviorType: 'default',
          sortOrder,
          isDefaultOnCreate: sortOrder === 1,
        },
      });
    const open = await status('synthetic_open', 1);
    const interested = await status('synthetic_interested', 2);
    const field = await db.prisma.field.create({
      data: {
        organizationId,
        key: 'synthetic_detail',
        name: 'Synthetic Detail',
        fieldType: 'text',
        editMode: 'manual',
        source: 'manual',
        sortOrder: 0,
      },
    });
    await db.prisma.fieldJourneySetting.create({
      data: { organizationId, fieldId: field.id, journeyId: journey.id, requirement: 'optional' },
    });
    await db.prisma.fieldVisibility.createMany({
      data: [adminRole.id, execRole.id].map((roleId) => ({
        organizationId,
        roleId,
        fieldId: field.id,
        accessLevel: 'EDIT' as const,
      })),
    });
    const lead = await db.prisma.lead.create({
      data: { organizationId, name: 'Synthetic Seller', fieldValues: {} },
    });
    const process = await db.prisma.processInstance.create({
      data: {
        organizationId,
        leadId: lead.id,
        journeyId: journey.id,
        currentStatusId: open.id,
        isPrimary: true,
      },
    });
    await db.prisma.assignment.create({
      data: {
        organizationId,
        processInstanceId: process.id,
        assignmentType: 'synthetic_owner',
        userId: exec.id,
        isCurrent: true,
      },
    });

    const authConfig = { ...defaultAuthConfig, secureCookies: false };
    const authRepository = new PrismaAuthRepository(db.prisma);
    const server = buildServer({
      authRepository,
      audit: authRepository,
      emailSender: {
        sendPasswordReset: () => Promise.resolve(),
        sendEmail: () => Promise.resolve(),
      },
      prisma: db.prisma,
      permissionRepository: new PrismaPermissionRepository(db.prisma as never),
      leadRepository: new PrismaLeadRepository(db.prisma as never),
      configurationRepository: new PrismaConfigurationRepository(db.prisma),
      adminRepository: new PrismaAdminRepository(db.prisma),
      resourceService: new ResourceService(new PrismaResourceRepository(db.prisma), undefined),
      authConfig,
      corsOrigins: [],
    });
    const session = async (userId: string) =>
      (
        await issueSession({
          repository: authRepository,
          config: authConfig,
          userId,
          organizationId,
        })
      ).token;
    const headers = (token: string) => ({ cookie: `${authConfig.sessionCookieName}=${token}` });
    const adminToken = await session(admin.id);
    const execToken = await session(exec.id);
    const leaderToken = await session(leader.id);
    const call = (token: string, method: 'GET' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
      server.inject({
        method,
        url,
        headers: headers(token),
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      });
    const patchLead = (token: string, body: Record<string, unknown>) =>
      call(token, 'PATCH', `/api/v1/leads/${lead.id}`, {
        processInstanceId: process.id,
        journeyId: journey.id,
        ...body,
      });

    // --- Status rules -------------------------------------------------------
    const color = await call(adminToken, 'PATCH', `/api/v1/statuses/${interested.id}`, {
      journeyId: journey.id,
      name: interested.name,
      outcomeType: 'open',
      behaviorType: 'default',
      sortOrder: 2,
      color: 'green',
      reasonOptions: ['Synthetic reason'],
    });
    expect(color.statusCode).toBe(200);
    const rules = await call(adminToken, 'PUT', `/api/v1/statuses/${interested.id}/rules`, {
      allowedRoleIds: [adminRole.id],
      requiredFieldIds: [field.id],
    });
    expect(rules.json()).toEqual({
      statusId: interested.id,
      allowedRoleIds: [adminRole.id],
      requiredFieldIds: [field.id],
    });
    const journeyDetail = await call(adminToken, 'GET', `/api/v1/journeys/${journey.id}`);
    const detail = journeyDetail.json<{ statuses: Array<Record<string, unknown>> }>();
    expect(detail.statuses.find((row) => row.id === interested.id)).toMatchObject({
      color: 'green',
      reasonOptions: ['Synthetic reason'],
      allowedRoles: [{ roleId: adminRole.id }],
      requiredFields: [{ fieldId: field.id }],
    });

    expect((await patchLead(execToken, { statusId: interested.id })).statusCode).toBe(403);
    await call(adminToken, 'PUT', `/api/v1/statuses/${interested.id}/rules`, {
      allowedRoleIds: [execRole.id],
      requiredFieldIds: [field.id],
    });
    const missing = await patchLead(execToken, { statusId: interested.id });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ details: { fieldIds: [field.id] } });
    const moved = await patchLead(execToken, {
      statusId: interested.id,
      statusReason: 'Synthetic reason',
      fieldValues: { [field.id]: 'filled in' },
      followUp: { dueAt: '2099-01-05T09:00:00.000Z', note: 'Synthetic call back' },
    });
    expect(moved.statusCode).toBe(200);
    const stored = await db.prisma.processInstance.findFirstOrThrow({ where: { id: process.id } });
    expect(stored).toMatchObject({
      currentStatusId: interested.id,
      statusReason: 'Synthetic reason',
    });

    // --- Follow-ups ---------------------------------------------------------
    const upcoming = await call(execToken, 'GET', '/api/v1/tasks?view=upcoming');
    expect(upcoming.json()).toMatchObject({
      total: 1,
      items: [{ leadId: lead.id, leadName: 'Synthetic Seller', note: 'Synthetic call back' }],
    });
    const taskId = upcoming.json<{ items: Array<{ id: string }> }>().items[0]!.id;
    expect((await call(execToken, 'GET', '/api/v1/tasks/summary')).json()).toEqual({
      overdue: 0,
      today: 0,
      upcoming: 1,
    });
    expect((await call(adminToken, 'GET', `/api/v1/leads/${lead.id}/tasks`)).json()).toMatchObject({
      items: [{ id: taskId, status: 'open' }],
    });
    // The leader cannot complete someone else's follow-up: no leads:edit.
    expect(
      (await call(leaderToken, 'PATCH', `/api/v1/tasks/${taskId}`, { action: 'complete' }))
        .statusCode,
    ).toBe(403);
    const done = await call(execToken, 'PATCH', `/api/v1/tasks/${taskId}`, {
      action: 'complete',
      note: 'Spoke to seller',
    });
    expect(done.json()).toMatchObject({ status: 'done', completedByName: 'executive' });
    expect(
      await db.prisma.activityLog.count({ where: { leadId: lead.id, actionType: 'follow_up' } }),
    ).toBe(2);

    // --- Reporting lines (ADR-0025) ----------------------------------------
    const readAs = (token: string) =>
      call(token, 'GET', `/api/v1/leads/${lead.id}?assignmentTypes=synthetic_owner`);
    expect((await readAs(leaderToken)).statusCode).toBe(403);
    const lines = await call(adminToken, 'PUT', `/api/v1/roles/${execRole.id}/reporting-lines`, {
      reportsToRoleIds: [leadRole.id],
    });
    expect(lines.statusCode).toBe(200);
    expect((await readAs(leaderToken)).statusCode).toBe(200);
    const cycle = await call(adminToken, 'PUT', `/api/v1/roles/${leadRole.id}/reporting-lines`, {
      reportsToRoleIds: [execRole.id],
    });
    expect(cycle.statusCode).toBe(400);

    // --- Journey members (ADR-0026) ----------------------------------------
    const restrict = await call(adminToken, 'PUT', `/api/v1/journeys/${journey.id}/members`, {
      restrictToMembers: true,
      userIds: [admin.id, leader.id],
    });
    expect(restrict.statusCode).toBe(200);
    expect((await readAs(execToken)).statusCode).toBe(403);
    expect((await readAs(leaderToken)).statusCode).toBe(200);
    await call(adminToken, 'PUT', `/api/v1/journeys/${journey.id}/members`, {
      restrictToMembers: true,
      userIds: [admin.id, leader.id, exec.id],
    });
    expect((await readAs(execToken)).statusCode).toBe(200);

    await server.close();
  });
});
