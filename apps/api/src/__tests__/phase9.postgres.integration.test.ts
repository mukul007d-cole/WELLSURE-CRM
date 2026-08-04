import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type FalconPrismaClient } from '@falcon/database';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { LeadSharingService } from '../leads/sharing.js';
import { NotificationService } from '../notifications/service.js';
import { seedExampleNotificationRules } from '../notifications/seed-example-rules.js';
import { editLead } from '../routes/leads.js';
import { buildServer } from '../http/build-server.js';
import { defaultAuthConfig } from '../auth/config.js';
import type { ServerDependencies } from '../http/types.js';

const url = process.env.FALCON_POSTGRES_URL;
describe.runIf(Boolean(url))('Phase 9 against real Postgres', () => {
  let admin: postgres.Sql, prisma: FalconPrismaClient, schema: string;
  const org = randomUUID(),
    otherOrg = randomUUID(),
    owner = randomUUID(),
    actor = randomUUID(),
    other = randomUUID(),
    revoked = randomUUID(),
    expired = randomUUID(),
    inactive = randomUUID(),
    role = randomUUID(),
    journey = randomUUID(),
    status = randomUUID(),
    lead = randomUUID(),
    process = randomUUID();
  beforeAll(async () => {
    schema = `phase9_${randomUUID().replaceAll('-', '')}`;
    admin = postgres(url!, { max: 1 });
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
    const separator = url!.includes('?') ? '&' : '?';
    const scoped = postgres(
      `${url}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`,
      { max: 1 },
    );
    for (const file of [
      'packages/database/prisma/migrations/00000000000000_initial/migration.sql',
      'packages/database/prisma/migrations/00000000000001_custom_session_auth/migration.sql',
      'packages/database/prisma/migrations/00000000000002_lead_sharing_notifications/migration.sql',
    ])
      await scoped.unsafe(await readFile(new URL(`../../../../${file}`, import.meta.url), 'utf8'));
    await scoped.end();
    prisma = createPrismaClient(url!, { schema });
    await prisma.organization.createMany({
      data: [
        { id: org, name: 'Synthetic organization' },
        { id: otherOrg, name: 'Other organization' },
      ],
    });
    await prisma.role.create({
      data: { id: role, organizationId: org, key: 'synthetic_role', name: 'Synthetic role' },
    });
    await prisma.user.createMany({
      data: [owner, actor, other, revoked, expired]
        .map((id, i) => ({
          id,
          organizationId: org,
          name: `Synthetic ${i}`,
          email: `synthetic-${i}@example.test`,
          roleId: role,
          active: true,
          ...(id === other ? { managerId: revoked } : {}),
        }))
        .concat([
          {
            id: inactive,
            organizationId: org,
            name: 'Inactive synthetic',
            email: 'inactive@example.test',
            roleId: role,
            active: false,
          },
        ]),
    });
    await prisma.rolePermission.createMany({
      data: ['view', 'edit', 'comment', 'delete'].map((action) => ({
        organizationId: org,
        roleId: role,
        module: 'leads',
        action,
        scope: 'SELF' as const,
      })),
    });
    await prisma.journey.create({
      data: {
        id: journey,
        organizationId: org,
        key: 'synthetic_journey',
        name: 'Synthetic journey',
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
        key: 'synthetic_status',
        name: 'Synthetic status',
        outcomeType: 'open',
        behaviorType: 'default',
        sortOrder: 0,
      },
    });
    await prisma.lead.create({ data: { id: lead, organizationId: org, name: 'Synthetic lead' } });
    await prisma.processInstance.create({
      data: {
        id: process,
        organizationId: org,
        leadId: lead,
        journeyId: journey,
        currentStatusId: status,
        isPrimary: true,
      },
    });
    await prisma.assignment.create({
      data: {
        organizationId: org,
        processInstanceId: process,
        assignmentType: 'synthetic_owner',
        userId: owner,
      },
    });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('enforces the share lifecycle, exact capabilities, and shared-list count parity', async () => {
    const service = new LeadSharingService(prisma);
    await expect(
      service.create({
        organizationId: otherOrg,
        leadId: lead,
        userId: actor,
        actorUserId: owner,
        capabilities: ['view'],
      }),
    ).rejects.toThrow('not_found');
    await service.create({
      organizationId: org,
      leadId: lead,
      userId: actor,
      actorUserId: owner,
      capabilities: ['view'],
    });
    const permission = new PrismaPermissionRepository(prisma as never);
    const view = await permission.getActiveDirectGrant({
      organizationId: org,
      userId: actor,
      leadId: lead,
      action: 'view',
      now: new Date(),
    });
    const edit = await permission.getActiveDirectGrant({
      organizationId: org,
      userId: actor,
      leadId: lead,
      action: 'edit',
      now: new Date(),
    });
    expect(view).not.toBeNull();
    expect(edit).toBeNull();
    const session = {
      id: randomUUID(),
      tokenHash: 'ignored',
      userId: actor,
      organizationId: org,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
      revokedAt: null,
      lastSeenAt: new Date(),
      ipAddress: null,
      userAgent: null,
    };
    const authRepository = {
      async findSessionByTokenHash() {
        return session;
      },
      async touchSession() {},
      async getUserSnapshot() {
        return {
          id: actor,
          organizationId: org,
          roleId: role,
          active: true,
          departmentId: null,
          managerId: null,
        };
      },
    };
    const server = buildServer({
      authRepository,
      permissionRepository: permission,
      leadRepository: new PrismaLeadRepository(prisma as never),
      leadSharingService: service,
      configurationRepository: {},
      audit: {},
      emailSender: {},
      authConfig: { ...defaultAuthConfig, secureCookies: false },
      corsOrigins: [],
    } as unknown as ServerDependencies);
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/v1/leads/${lead}`,
      headers: { cookie: 'falcon_session=synthetic' },
      payload: {
        processInstanceId: process,
        journeyId: journey,
        assignmentTypes: ['synthetic_owner'],
        name: 'Forbidden edit',
      },
    });
    expect(response.statusCode).toBe(403);
    await server.close();
    const repository = new PrismaLeadRepository(prisma as never);
    const listed = await repository.listSellers({
      organizationId: org,
      requestedFieldIds: [],
      assignmentTypes: ['synthetic_owner'],
      accessMode: 'shared_with_me',
      recordPredicate: {
        organizationId: org,
        scope: 'SELF',
        allowedUserIds: [actor],
        assignmentTypes: ['synthetic_owner'],
        journeyIds: [journey],
        includeDirectGrantsForUserId: actor,
        directGrantAction: 'view',
      },
    });
    expect(listed.total).toBe(1);
    expect(listed.rows).toHaveLength(1);
    const share = (await service.list(org, lead))[0]!;
    await service.update({
      organizationId: org,
      leadId: lead,
      shareId: share.id,
      actorUserId: owner,
      capabilities: ['view', 'edit'],
    });
    expect(
      await permission.getActiveDirectGrant({
        organizationId: org,
        userId: actor,
        leadId: lead,
        action: 'edit',
        now: new Date(),
      }),
    ).not.toBeNull();
    await service.revoke({
      organizationId: org,
      leadId: lead,
      shareId: share.id,
      actorUserId: owner,
    });
    expect(
      await permission.getActiveDirectGrant({
        organizationId: org,
        userId: actor,
        leadId: lead,
        action: 'view',
        now: new Date(),
      }),
    ).toBeNull();
  });

  it('produces exactly owner and other active share recipients, is idempotent, and rolls back notification failure', async () => {
    const sharing = new LeadSharingService(prisma);
    await sharing.create({
      organizationId: org,
      leadId: lead,
      userId: actor,
      actorUserId: owner,
      capabilities: ['view', 'edit'],
    });
    await sharing.create({
      organizationId: org,
      leadId: lead,
      userId: other,
      actorUserId: owner,
      capabilities: ['view'],
    });
    const revokedShare = await sharing.create({
      organizationId: org,
      leadId: lead,
      userId: revoked,
      actorUserId: owner,
      capabilities: ['view'],
    });
    await sharing.revoke({
      organizationId: org,
      leadId: lead,
      shareId: revokedShare.id,
      actorUserId: owner,
    });
    await prisma.userAccessGrant.createMany({
      data: [
        {
          organizationId: org,
          leadId: lead,
          userId: expired,
          grantedByUserId: owner,
          actions: ['view'],
          createdAt: new Date('1999-01-01'),
          expiresAt: new Date('2000-01-01'),
        },
        {
          organizationId: org,
          leadId: lead,
          userId: inactive,
          grantedByUserId: owner,
          actions: ['view'],
        },
      ],
    });
    const notifications = new NotificationService(prisma);
    const rule = await notifications.createRule({
      organizationId: org,
      actorUserId: owner,
      key: 'shared_edit_rule',
      name: 'Shared edit',
      triggerType: 'shared_lead_modified_by_non_owner',
      recipients: [
        { resolverType: 'active_shared_users_except_actor' },
        { resolverType: 'assignment_holder', parameters: { assignmentType: 'synthetic_owner' } },
      ],
    });
    const repo = new PrismaLeadRepository(prisma as never, notifications);
    const result = await editLead({
      auth: {
        user: {
          id: actor,
          organizationId: org,
          roleId: role,
          active: true,
          departmentId: null,
          managerId: null,
        },
        session: {} as never,
      },
      leadRepository: repo,
      permissionRepository: new PrismaPermissionRepository(prisma as never),
      processInstanceId: process,
      journeyId: journey,
      leadId: lead,
      assignmentTypes: ['synthetic_owner'],
      name: 'Shared edit success',
    });
    expect(result.status).toBe(200);
    const activity = await prisma.activityLog.findFirstOrThrow({
      where: { organizationId: org, leadId: lead, actorUserId: actor, actionType: 'field_edit' },
      orderBy: { timestamp: 'desc' },
    });
    const deliveries = await prisma.notification.findMany({
      where: { organizationId: org, notificationRuleId: rule.id, activityLogId: activity.id },
    });
    expect(deliveries.map((x) => x.userId).sort()).toEqual([other, owner].sort());
    await notifications.evaluate({
      organizationId: org,
      activityLogId: activity.id,
      leadId: lead,
      processInstanceId: process,
      actorUserId: actor,
      triggerType: 'shared_lead_modified_by_non_owner',
    });
    expect(
      await prisma.notification.count({
        where: { organizationId: org, notificationRuleId: rule.id, activityLogId: activity.id },
      }),
    ).toBe(2);
    await admin.unsafe(
      `CREATE FUNCTION "${schema}".reject_notifications() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic notification failure'; END $$; CREATE TRIGGER reject_notifications BEFORE INSERT ON "${schema}".notifications FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_notifications()`,
    );
    const before = (
      await prisma.lead.findUniqueOrThrow({
        where: { organizationId_id: { organizationId: org, id: lead } },
      })
    ).name;
    await expect(
      editLead({
        auth: {
          user: {
            id: actor,
            organizationId: org,
            roleId: role,
            active: true,
            departmentId: null,
            managerId: null,
          },
          session: {} as never,
        },
        leadRepository: repo,
        permissionRepository: new PrismaPermissionRepository(prisma as never),
        processInstanceId: process,
        journeyId: journey,
        leadId: lead,
        assignmentTypes: ['synthetic_owner'],
        name: 'Must roll back',
      }),
    ).rejects.toThrow('synthetic notification failure');
    expect(
      (
        await prisma.lead.findUniqueOrThrow({
          where: { organizationId_id: { organizationId: org, id: lead } },
        })
      ).name,
    ).toBe(before);
    await admin.unsafe(`DROP TRIGGER reject_notifications ON "${schema}".notifications`);
  });

  it('records reassignment old/new holders, deactivates with audit, and supports rule/inbox isolation', async () => {
    const notifications = new NotificationService(prisma),
      sharing = new LeadSharingService(prisma, notifications);
    await expect(
      notifications.createRule({
        organizationId: org,
        actorUserId: owner,
        key: 'invalid_rule',
        name: 'Invalid',
        triggerType: 'unknown',
        recipients: [{ resolverType: 'assignment_holder' }],
      }),
    ).rejects.toThrow('validation_error');
    await sharing.reassign({
      organizationId: org,
      leadId: lead,
      processInstanceId: process,
      assignmentType: 'synthetic_owner',
      userId: other,
      actorUserId: owner,
    });
    const reassignment = await prisma.activityLog.findFirstOrThrow({
      where: { organizationId: org, leadId: lead, actionType: 'reassignment' },
      orderBy: { timestamp: 'desc' },
    });
    expect(reassignment.oldValue).toEqual({ assignmentType: 'synthetic_owner', userId: owner });
    expect(reassignment.newValue).toEqual({ assignmentType: 'synthetic_owner', userId: other });
    const resolverCases = [
      ['assignment_holder', { assignmentType: 'synthetic_owner' }, [other]],
      ['assignment_holder_manager', { assignmentType: 'synthetic_owner' }, [revoked]],
      ['previous_assignment_holder', {}, [owner]],
      ['share_creator', { userId: actor }, [owner]],
      ['active_shared_users_except_actor', {}, [other]],
      [
        'feature_permission_holders',
        { module: 'leads', action: 'view' },
        [owner, actor, other, revoked, expired],
      ],
    ] as const;
    for (const [resolverType, parameters, expected] of resolverCases) {
      const rule = await notifications.createRule({
        organizationId: org,
        actorUserId: owner,
        key: `resolver_${resolverType}`,
        name: `Resolver ${resolverType}`,
        triggerType: 'status_changed',
        recipients: [{ resolverType, parameters }],
      });
      const activity = await prisma.activityLog.create({
        data: {
          organizationId: org,
          leadId: lead,
          processInstanceId: process,
          actorUserId: actor,
          actionType: 'status_change',
          source: 'synthetic_test',
          oldValue: { userId: owner },
          newValue: { statusId: status },
        },
      });
      await notifications.evaluate({
        organizationId: org,
        activityLogId: activity.id,
        leadId: lead,
        processInstanceId: process,
        actorUserId: actor,
        triggerType: 'status_changed',
        oldValue: { userId: owner },
      });
      const actual = (
        await prisma.notification.findMany({
          where: {
            organizationId: org,
            notificationRuleId: rule.id,
            activityLogId: activity.id,
          },
        })
      )
        .map((row) => row.userId)
        .sort();
      expect(actual).toEqual([...expected].sort());
    }
    const created = await notifications.createRule({
      organizationId: org,
      actorUserId: owner,
      key: 'ordered_rule',
      name: 'Ordered rule',
      triggerType: 'lead_deactivated',
      recipients: [
        {
          resolverType: 'feature_permission_holders',
          parameters: { module: 'leads', action: 'delete' },
        },
        {
          resolverType: 'assignment_holder_manager',
          parameters: { assignmentType: 'synthetic_owner' },
        },
      ],
    });
    expect(created.recipients.map((x) => x.sortOrder)).toEqual([0, 1]);
    expect((await notifications.listRules(otherOrg)).total).toBe(0);
    const unreadBefore = await notifications.countUnread(org, owner);
    await prisma.notification.createMany({
      data: [
        { organizationId: org, userId: owner, type: 'synthetic', message: 'Unread' },
        { organizationId: org, userId: other, type: 'synthetic', message: 'Other user' },
      ],
    });
    expect(await notifications.countUnread(org, owner)).toBe(unreadBefore + 1);
    const page = await notifications.list(org, owner, 1, 1);
    expect(page.total).toBeGreaterThanOrEqual(1);
    const marked = await notifications.markRead(org, owner, page.items[0]!.id);
    expect(marked?.readAt).not.toBeNull();
    expect(await notifications.countUnread(org, owner)).toBe(unreadBefore);
    expect(await notifications.markRead(org, other, page.items[0]!.id)).toBeNull();
    await seedExampleNotificationRules({
      prisma,
      organizationId: org,
      actorUserId: owner,
      ownerAssignmentType: 'synthetic_owner',
      adminModule: 'leads',
      adminAction: 'delete',
    });
    await seedExampleNotificationRules({
      prisma,
      organizationId: org,
      actorUserId: owner,
      ownerAssignmentType: 'synthetic_owner',
      adminModule: 'leads',
      adminAction: 'delete',
    });
    expect(
      await prisma.notificationRule.count({
        where: { organizationId: org, key: { endsWith: '_example' } },
      }),
    ).toBe(4);
    await sharing.deactivate({ organizationId: org, leadId: lead, actorUserId: owner });
    const deactivated = await prisma.lead.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: org, id: lead } },
    });
    expect(deactivated.active).toBe(false);
    expect(
      await prisma.activityLog.findFirst({
        where: {
          organizationId: org,
          leadId: lead,
          actionType: 'lead_deactivated',
          oldValue: { equals: { active: true } },
          newValue: { path: ['active'], equals: false },
        },
      }),
    ).not.toBeNull();
  });
});
