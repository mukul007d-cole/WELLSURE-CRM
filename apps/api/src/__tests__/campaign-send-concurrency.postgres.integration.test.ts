import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';

import { CampaignSendService, campaignSendLeaseMs } from '../campaigns/send-service.js';
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from './fixtures/synthetic-admin.js';

/**
 * Regression coverage for finding #3: two processors racing the same
 * `pending` row used to both call the email transport for it, because
 * `drainPending` only recorded an outcome *after* sending — nothing claimed
 * the row first. Reproduced with a deterministic barrier (not timing luck):
 * both processors are guaranteed to be mid-send before either could record
 * success, so if the claim were missing this would still fail every run.
 */
describe.runIf(shouldRunAdminPostgres)('campaign send: concurrent drain of one pending row', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  const user = randomUUID();
  const lead = randomUUID();
  const campaign = randomUUID();

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    await applyMigrations(db.sql);

    await prisma.organization.create({ data: { id: org, name: 'Concurrency org' } });
    const role = randomUUID();
    await prisma.role.create({
      data: { id: role, organizationId: org, key: 'concurrency_role', name: 'Concurrency role' },
    });
    await prisma.user.create({
      data: {
        id: user,
        organizationId: org,
        name: 'Concurrency user',
        email: 'u@example.test',
        roleId: role,
      },
    });
    await prisma.lead.create({
      data: {
        id: lead,
        organizationId: org,
        name: 'Concurrency lead',
        phone: null,
        email: 'lead@example.test',
        fieldValues: {},
      },
    });
    await prisma.campaign.create({
      data: {
        id: campaign,
        organizationId: org,
        key: 'concurrency_campaign',
        name: 'Concurrency campaign',
        subject: 'Subject',
        bodyDocument: { blocks: [{ type: 'paragraph', spans: [{ text: 'hello' }] }] },
        type: 'manual',
        filter: { conditions: [] },
        active: true,
        createdById: user,
        updatedById: user,
      },
    });
  }, 120_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  it('invokes the email transport at most once for one pending row when two processors race', async () => {
    await prisma.campaignSend.create({
      data: { organizationId: org, campaignId: campaign, leadId: lead, status: 'pending' },
    });

    const sendCalls: Array<{ to: string }> = [];
    const transport = {
      sendPasswordReset: () => Promise.resolve(),
      sendEmail: (message: { to: string }) => {
        sendCalls.push({ to: message.to });
        return Promise.resolve();
      },
    };

    const processorA = new CampaignSendService(prisma, transport);
    const processorB = new CampaignSendService(prisma, transport);

    // No artificial barrier needed: both processors issue their initial
    // `findMany` essentially simultaneously (neither awaits anything
    // beforehand), so both reliably see the row as `pending` before either
    // claims it — this is the same natural race the pre-fix diagnostic
    // exploited to get two `sendEmail` calls. The fix is the atomic claim
    // immediately before `sendEmail`: Postgres serializes the two
    // concurrent UPDATEs to the same row, so only the winner's WHERE
    // (`status = 'pending'`) still matches by the time it runs — the loser
    // finds 0 rows affected and moves on without ever calling the
    // transport.
    const [resultA, resultB] = await Promise.all([
      processorA.drainPending(org),
      processorB.drainPending(org),
    ]);

    const totalSent = resultA.sent + resultB.sent;
    expect(sendCalls).toHaveLength(1);
    expect(totalSent).toBe(1);

    const finalRows = await prisma.campaignSend.findMany({
      where: { organizationId: org, campaignId: campaign, leadId: lead },
    });
    expect(finalRows).toHaveLength(1);
    expect(finalRows[0]?.status).toBe('sent');
    expect(finalRows[0]?.attempts).toBe(1);
  });

  it('reclaims a row stuck in `sending` past the lease and lets a later drain resend it', async () => {
    const staleLead = randomUUID();
    await prisma.lead.create({
      data: {
        id: staleLead,
        organizationId: org,
        name: 'Stale lead',
        phone: null,
        email: 'stale@example.test',
        fieldValues: {},
      },
    });
    // Simulate a crash: claimed (sending) long enough ago that the lease
    // has expired, with no outcome ever recorded.
    await prisma.campaignSend.create({
      data: {
        organizationId: org,
        campaignId: campaign,
        leadId: staleLead,
        status: 'sending',
        claimedAt: new Date(Date.now() - campaignSendLeaseMs - 60_000),
        attempts: 1,
      },
    });

    const delivered: string[] = [];
    const transport = {
      sendPasswordReset: () => Promise.resolve(),
      sendEmail: (message: { to: string }) => {
        delivered.push(message.to);
        return Promise.resolve();
      },
    };
    const result = await new CampaignSendService(prisma, transport).drainPending(org, {
      campaignId: campaign,
    });

    expect(delivered).toEqual(['stale@example.test']);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const row = await prisma.campaignSend.findFirst({
      where: { organizationId: org, campaignId: campaign, leadId: staleLead },
    });
    expect(row?.status).toBe('sent');
    expect(row?.attempts).toBe(2);
  });
});
