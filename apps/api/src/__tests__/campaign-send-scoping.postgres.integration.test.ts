import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';

import { CampaignSendService } from '../campaigns/send-service.js';
import { CampaignService } from '../campaigns/service.js';
import { CampaignTriggerService } from '../campaigns/trigger-service.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { NotificationService } from '../notifications/service.js';
import { StatusRoutingService } from '../routing/service.js';
import { sendCampaign } from '../routes/campaigns.js';
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from './fixtures/synthetic-admin.js';

/**
 * Regression coverage for finding #5: `sendCampaign` used to drain the
 * whole organization's pending rows (`drainPending(organizationId)`), so
 * sending campaign A also delivered campaign B's unrelated backlog and
 * folded its counts into campaign A's response. `drainPending` now takes
 * an optional `campaignId` scope, and the manual-send route always passes
 * its own campaign's id.
 */
describe.runIf(shouldRunAdminPostgres)(
  'campaign send: manual send is scoped to its own campaign',
  () => {
    let db: Awaited<ReturnType<typeof createAdminPostgres>>;
    let prisma: FalconPrismaClient;

    const org = randomUUID();
    const role = randomUUID();
    const sender = randomUUID();
    const leadA = randomUUID();
    const leadB1 = randomUUID();
    const leadB2 = randomUUID();
    const campaignA = randomUUID();
    const campaignB = randomUUID();
    const journey = randomUUID();
    const status = randomUUID();
    const assignmentType = 'scoping_owner';

    const delivered: Array<{ to: string }> = [];
    const transport = {
      sendPasswordReset: () => Promise.resolve(),
      sendEmail: (message: { to: string }) => {
        delivered.push({ to: message.to });
        return Promise.resolve();
      },
    };

    beforeAll(async () => {
      db = await createAdminPostgres();
      prisma = db.prisma;
      await applyMigrations(db.sql);

      await prisma.organization.create({ data: { id: org, name: 'Scoping org' } });
      await prisma.role.create({
        data: { id: role, organizationId: org, key: 'scoping_role', name: 'Scoping role' },
      });
      await prisma.user.create({
        data: {
          id: sender,
          organizationId: org,
          name: 'Scoping sender',
          email: 'sender@example.test',
          roleId: role,
        },
      });
      await prisma.rolePermission.createMany({
        data: [
          ...['view', 'create', 'edit', 'send'].map((action) => ({
            organizationId: org,
            roleId: role,
            module: 'campaigns',
            action,
            scope: 'ORGANIZATION' as const,
          })),
          ...['view'].map((action) => ({
            organizationId: org,
            roleId: role,
            module: 'leads',
            action,
            scope: 'ORGANIZATION' as const,
          })),
        ],
      });
      await prisma.journey.create({
        data: { id: journey, organizationId: org, key: 'scoping_journey', name: 'Scoping journey' },
      });
      await prisma.roleJourneyAccess.create({
        data: { organizationId: org, roleId: role, journeyId: journey },
      });
      await prisma.status.create({
        data: {
          id: status,
          organizationId: org,
          journeyId: journey,
          key: 'scoping_status',
          name: 'Scoping status',
          outcomeType: 'open',
          behaviorType: 'default',
          isDefaultOnCreate: true,
          sortOrder: 0,
        },
      });
      for (const [id, email] of [
        [leadA, 'lead-a@example.test'],
        [leadB1, 'lead-b1@example.test'],
        [leadB2, 'lead-b2@example.test'],
      ] as const) {
        await prisma.lead.create({
          data: {
            id,
            organizationId: org,
            name: `Lead ${email}`,
            phone: null,
            email,
            fieldValues: {},
          },
        });
      }
      // Only leadA sits in the sender's visible scope. leadB1/leadB2's
      // campaign_sends rows below arrive the way a triggered campaign really
      // creates them — a pending row nobody has drained yet (finding #4) —
      // not through this sender's own send action.
      const processInstanceId = randomUUID();
      await prisma.processInstance.create({
        data: {
          id: processInstanceId,
          organizationId: org,
          leadId: leadA,
          journeyId: journey,
          currentStatusId: status,
          isPrimary: true,
        },
      });
      await prisma.assignment.create({
        data: { organizationId: org, processInstanceId, assignmentType, userId: sender },
      });
      for (const [id, key, name] of [
        [campaignA, 'scoping_campaign_a', 'Campaign A'],
        [campaignB, 'scoping_campaign_b', 'Campaign B'],
      ] as const) {
        await prisma.campaign.create({
          data: {
            id,
            organizationId: org,
            key,
            name,
            subject: `${name} subject`,
            bodyDocument: { blocks: [{ type: 'paragraph', spans: [{ text: name }] }] },
            type: 'manual',
            filter: { conditions: [] },
            active: true,
            createdById: sender,
            updatedById: sender,
          },
        });
      }

      // Campaign B's own backlog, pre-existing and undrained.
      await prisma.campaignSend.createMany({
        data: [
          { organizationId: org, campaignId: campaignB, leadId: leadB1, status: 'pending' },
          { organizationId: org, campaignId: campaignB, leadId: leadB2, status: 'pending' },
        ],
      });
    }, 120_000);

    afterAll(async () => {
      await db?.cleanup();
    });

    it('sending campaign A never touches campaign B, and the response reflects only A', async () => {
      const deps = {
        auth: {
          user: {
            id: sender,
            organizationId: org,
            roleId: role,
            active: true,
            departmentId: null,
            managerId: null,
          },
          session: {} as never,
        } as never,
        permissionRepository: new PrismaPermissionRepository(prisma as never),
        campaignService: new CampaignService(prisma),
        campaignSendService: new CampaignSendService(prisma, transport),
        sellerRepository: new PrismaLeadRepository(
          prisma as never,
          new NotificationService(prisma),
          new CampaignTriggerService(prisma),
          new StatusRoutingService(prisma),
        ),
      };

      const result = await sendCampaign({ ...deps, id: campaignA });
      if (result.status !== 200) throw new Error(`expected 200, got ${result.status}`);
      const body = result.body as {
        queued: number;
        sent: number;
        failed: number;
        skippedNoEmail: number;
      };

      const bRows = await prisma.campaignSend.findMany({
        where: { organizationId: org, campaignId: campaignB },
      });

      // Only leadA was queued and sent for campaign A — campaign B's backlog
      // is untouched, both in what was delivered and in what the response
      // reports.
      expect(body).toEqual({ queued: 1, sent: 1, failed: 0, skippedNoEmail: 0 });
      expect(delivered.map((d) => d.to)).toEqual(['lead-a@example.test']);
      expect(bRows.every((r) => r.status === 'pending')).toBe(true);
    });
  },
);
