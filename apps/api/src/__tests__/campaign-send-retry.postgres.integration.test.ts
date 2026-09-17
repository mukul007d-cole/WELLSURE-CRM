import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';

import { CampaignSendService, maxCampaignSendAttempts } from '../campaigns/send-service.js';
import { CampaignService } from '../campaigns/service.js';
import { CampaignTriggerService } from '../campaigns/trigger-service.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { NotificationService } from '../notifications/service.js';
import { StatusRoutingService } from '../routing/service.js';
import { retryCampaign } from '../routes/campaigns.js';
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from './fixtures/synthetic-admin.js';

/**
 * Regression coverage for finding #6: there was previously no way to
 * revive a `failed` campaign_sends row — `queueManualSend`'s
 * `skipDuplicates` matches the (organization, campaign, lead) unique
 * constraint regardless of status, so re-offering a failed lead was
 * always a silent no-op and the row stayed `failed` forever.
 * `CampaignSendService.retryFailed` + `POST /campaigns/:id/retry` now
 * requeue `failed` rows explicitly, bounded by `maxCampaignSendAttempts`.
 */
describe.runIf(shouldRunAdminPostgres)('campaign send: retrying failed deliveries', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  const role = randomUUID();
  const sender = randomUUID();
  const lead = randomUUID();
  const exhaustedLead = randomUUID();
  const campaign = randomUUID();

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    await applyMigrations(db.sql);

    await prisma.organization.create({ data: { id: org, name: 'Retry org' } });
    await prisma.role.create({
      data: { id: role, organizationId: org, key: 'retry_role', name: 'Retry role' },
    });
    await prisma.user.create({
      data: {
        id: sender,
        organizationId: org,
        name: 'Retry sender',
        email: 'sender@example.test',
        roleId: role,
      },
    });
    await prisma.rolePermission.createMany({
      data: ['view', 'create', 'edit', 'send'].map((action) => ({
        organizationId: org,
        roleId: role,
        module: 'campaigns',
        action,
        scope: 'ORGANIZATION' as const,
      })),
    });
    await prisma.lead.create({
      data: {
        id: lead,
        organizationId: org,
        name: 'Retry lead',
        phone: null,
        email: 'lead@example.test',
        fieldValues: {},
      },
    });
    await prisma.lead.create({
      data: {
        id: exhaustedLead,
        organizationId: org,
        name: 'Exhausted lead',
        phone: null,
        email: 'exhausted@example.test',
        fieldValues: {},
      },
    });
    await prisma.campaign.create({
      data: {
        id: campaign,
        organizationId: org,
        key: 'retry_campaign',
        name: 'Retry campaign',
        subject: 'Subject',
        bodyDocument: { blocks: [{ type: 'paragraph', spans: [{ text: 'hello' }] }] },
        type: 'manual',
        filter: { conditions: [] },
        active: true,
        createdById: sender,
        updatedById: sender,
      },
    });
  }, 120_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  it('requeues a failed row, and a subsequent drain can succeed', async () => {
    await prisma.campaignSend.create({
      data: {
        organizationId: org,
        campaignId: campaign,
        leadId: lead,
        status: 'failed',
        error: 'simulated transient provider error',
        attempts: 1,
      },
    });

    let shouldFail = false;
    const transport = {
      sendPasswordReset: () => Promise.resolve(),
      sendEmail: () => (shouldFail ? Promise.reject(new Error('still down')) : Promise.resolve()),
    };
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

    // First retry: the provider is still down, so it fails again — attempts
    // increments, and it is still eligible for another retry.
    shouldFail = true;
    const firstRetry = await retryCampaign({ ...deps, id: campaign });
    if (firstRetry.status !== 200) throw new Error(`expected 200, got ${firstRetry.status}`);
    expect(firstRetry.body).toEqual({
      requeued: 1,
      permanentlyFailed: 0,
      sent: 0,
      failed: 1,
      skippedNoEmail: 0,
    });
    let row = await prisma.campaignSend.findFirst({
      where: { organizationId: org, campaignId: campaign, leadId: lead },
    });
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(2);

    // Second retry: the provider recovers, so this attempt succeeds.
    shouldFail = false;
    const secondRetry = await retryCampaign({ ...deps, id: campaign });
    if (secondRetry.status !== 200) throw new Error(`expected 200, got ${secondRetry.status}`);
    expect(secondRetry.body).toEqual({
      requeued: 1,
      permanentlyFailed: 0,
      sent: 1,
      failed: 0,
      skippedNoEmail: 0,
    });
    row = await prisma.campaignSend.findFirst({
      where: { organizationId: org, campaignId: campaign, leadId: lead },
    });
    expect(row?.status).toBe('sent');
    expect(row?.attempts).toBe(3);

    // The unique constraint still means at most one row ever exists for
    // this (campaign, lead) — retrying resent through the SAME row, never
    // created a second one.
    const allRows = await prisma.campaignSend.findMany({
      where: { organizationId: org, campaignId: campaign, leadId: lead },
    });
    expect(allRows).toHaveLength(1);
  });

  it('stops retrying once a row reaches maxCampaignSendAttempts, and reports it as permanently failed', async () => {
    await prisma.campaignSend.create({
      data: {
        organizationId: org,
        campaignId: campaign,
        leadId: exhaustedLead,
        status: 'failed',
        error: 'permanently broken address',
        attempts: maxCampaignSendAttempts,
      },
    });

    const transport = {
      sendPasswordReset: () => Promise.resolve(),
      sendEmail: () => Promise.reject(new Error('should never be called for an exhausted row')),
    };
    const service = new CampaignSendService(prisma, transport);
    const result = await service.retryFailed(org, campaign);

    expect(result).toEqual({ requeued: 0, permanentlyFailed: 1 });
    const row = await prisma.campaignSend.findFirst({
      where: { organizationId: org, campaignId: campaign, leadId: exhaustedLead },
    });
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(maxCampaignSendAttempts);
  });
});
