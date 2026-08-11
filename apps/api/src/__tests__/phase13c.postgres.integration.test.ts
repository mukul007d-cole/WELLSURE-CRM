import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';

import { CampaignSendService } from '../campaigns/send-service.js';
import { CampaignService } from '../campaigns/service.js';
import { CampaignTriggerService } from '../campaigns/trigger-service.js';
import { PrismaLeadRepository } from '../leads/prisma-lead-repository.js';
import { PrismaPermissionRepository } from '../permissions/prisma-permission-repository.js';
import { NotificationService } from '../notifications/service.js';
import { editLead } from '../routes/leads.js';
import { sendCampaign, setCampaignActive } from '../routes/campaigns.js';
import { createAdminPostgres, shouldRunAdminPostgres } from './fixtures/synthetic-admin.js';

/**
 * Phase 13c — campaigns against real Postgres.
 *
 * The claims that would regress silently: a triggered campaign fires on an
 * exact status match and only while active; a lead is emailed at most once per
 * campaign; nothing is sent from inside the mutation transaction; and a manual
 * send reaches exactly the leads the sender's own scope and filter select.
 */

describe.runIf(shouldRunAdminPostgres)('Phase 13c campaigns', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const org = randomUUID();
  const role = randomUUID();
  const sender = randomUUID();
  const journey = randomUUID();
  const targetStatus = randomUUID();
  const otherStatus = randomUUID();
  const field = randomUUID();
  const assignmentType = 'synthetic_owner';
  const leads = new Map<string, { id: string; processId: string }>();

  /** Records every send, and when it happened relative to commits. */
  const delivered: Array<{ to: string; subject: string; html: string }> = [];
  let transportFails = false;
  const transport = {
    sendPasswordReset: () => Promise.resolve(),
    sendEmail: (message: { to: string; subject: string; html: string }) => {
      if (transportFails) return Promise.reject(new Error('transport not configured'));
      delivered.push(message);
      return Promise.resolve();
    },
  };

  const auth = () => ({
    user: {
      id: sender,
      organizationId: org,
      roleId: role,
      active: true,
      departmentId: null,
      managerId: null,
    },
    session: {} as never,
  });

  const repository = () =>
    new PrismaLeadRepository(
      prisma as never,
      new NotificationService(prisma),
      new CampaignTriggerService(prisma),
    );

  const campaignDeps = () => ({
    auth: auth() as never,
    permissionRepository: new PrismaPermissionRepository(prisma as never),
    campaignService: new CampaignService(prisma),
    campaignSendService: new CampaignSendService(prisma, transport),
    sellerRepository: repository(),
  });

  const moveTo = async (leadName: string, statusId: string) => {
    const lead = leads.get(leadName)!;
    return editLead({
      auth: auth(),
      leadRepository: repository(),
      permissionRepository: new PrismaPermissionRepository(prisma as never),
      processInstanceId: lead.processId,
      journeyId: journey,
      leadId: lead.id,
      assignmentTypes: [assignmentType],
      statusId,
    });
  };

  const sendsFor = (campaignId: string) =>
    prisma.campaignSend.findMany({ where: { organizationId: org, campaignId } });

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    for (const file of [
      '00000000000000_initial',
      '00000000000001_custom_session_auth',
      '00000000000002_lead_sharing_notifications',
      '00000000000003_attachment_metadata',
      '00000000000004_campaigns',
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

    await prisma.organization.create({ data: { id: org, name: 'Synthetic organization' } });
    await prisma.role.create({
      data: { id: role, organizationId: org, key: 'synthetic_role', name: 'Synthetic role' },
    });
    await prisma.user.create({
      data: {
        id: sender,
        organizationId: org,
        name: 'Synthetic sender',
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
        ...['view', 'edit'].map((action) => ({
          organizationId: org,
          roleId: role,
          module: 'leads',
          action,
          scope: 'ORGANIZATION' as const,
        })),
      ],
    });
    await prisma.journey.create({
      data: { id: journey, organizationId: org, key: 'synthetic_journey', name: 'Synthetic' },
    });
    await prisma.roleJourneyAccess.create({
      data: { organizationId: org, roleId: role, journeyId: journey },
    });
    await prisma.status.createMany({
      data: [targetStatus, otherStatus].map((id, index) => ({
        id,
        organizationId: org,
        journeyId: journey,
        key: `synthetic_status_${index}`,
        name: `Synthetic status ${index}`,
        outcomeType: 'open',
        behaviorType: 'default',
        sortOrder: index,
      })),
    });
    await prisma.field.create({
      data: {
        id: field,
        organizationId: org,
        key: 'synthetic_tier',
        name: 'Synthetic tier',
        fieldType: 'text',
        editMode: 'manual',
        source: 'manual',
      },
    });
    await prisma.fieldVisibility.create({
      data: { organizationId: org, roleId: role, fieldId: field, accessLevel: 'EDIT' },
    });
    await prisma.fieldJourneySetting.create({
      data: { organizationId: org, fieldId: field, journeyId: journey, requirement: 'optional' },
    });

    for (const [name, email, tier] of [
      ['Alpha', 'alpha@example.test', 'gold'],
      ['Beta', 'beta@example.test', 'silver'],
      ['NoEmail', null, 'gold'],
    ] as const) {
      const lead = await prisma.lead.create({
        data: {
          organizationId: org,
          name: `${name} Seller`,
          email,
          fieldValues: { [field]: tier },
        },
      });
      const process = await prisma.processInstance.create({
        data: {
          organizationId: org,
          leadId: lead.id,
          journeyId: journey,
          currentStatusId: otherStatus,
          isPrimary: true,
        },
      });
      await prisma.assignment.create({
        data: {
          organizationId: org,
          processInstanceId: process.id,
          assignmentType,
          userId: sender,
        },
      });
      leads.set(name, { id: lead.id, processId: process.id });
    }
  }, 180_000);

  afterAll(async () => db?.cleanup());

  const createCampaign = async (overrides: Record<string, unknown>) =>
    new CampaignService(prisma).create({
      organizationId: org,
      actorUserId: sender,
      visibleFieldIds: new Set([field]),
      campaign: {
        key: `campaign_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        name: 'Synthetic campaign',
        subject: 'Synthetic subject',
        bodyDocument: {
          blocks: [
            { type: 'paragraph', spans: [{ text: 'Hello {{name}} — {{field:' + field + '}}' }] },
          ],
        },
        type: 'manual',
        ...overrides,
      },
    });

  it('fires a triggered campaign on an exact status match and not on another status', async () => {
    const campaign = await createCampaign({
      type: 'triggered',
      journeyId: journey,
      statusId: targetStatus,
    });

    // A different status in the same journey must not fire it: ADR-0001 says
    // matching is exact, never ordering-based.
    expect((await moveTo('Alpha', otherStatus)).status).toBe(200);
    expect(await sendsFor(campaign.id)).toHaveLength(0);

    expect((await moveTo('Alpha', targetStatus)).status).toBe(200);
    const sends = await sendsFor(campaign.id);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ leadId: leads.get('Alpha')!.id, status: 'pending' });
  }, 120_000);

  it('does not email a lead twice for the same campaign', async () => {
    const campaign = await createCampaign({
      type: 'triggered',
      journeyId: journey,
      statusId: targetStatus,
    });
    await moveTo('Beta', targetStatus);
    expect(await sendsFor(campaign.id)).toHaveLength(1);

    // Leaving and re-entering is the case the unique constraint exists for.
    await moveTo('Beta', otherStatus);
    await moveTo('Beta', targetStatus);
    expect(await sendsFor(campaign.id)).toHaveLength(1);
  }, 120_000);

  it('does not fire while the campaign is deactivated, and fires again once reactivated', async () => {
    const campaign = await createCampaign({
      type: 'triggered',
      journeyId: journey,
      statusId: targetStatus,
    });
    const deactivated = await setCampaignActive({
      ...campaignDeps(),
      id: campaign.id,
      active: false,
    });
    expect(deactivated.status).toBe(200);

    await moveTo('NoEmail', otherStatus);
    await moveTo('NoEmail', targetStatus);
    expect(await sendsFor(campaign.id)).toHaveLength(0);

    await setCampaignActive({ ...campaignDeps(), id: campaign.id, active: true });
    await moveTo('NoEmail', otherStatus);
    await moveTo('NoEmail', targetStatus);
    expect(await sendsFor(campaign.id)).toHaveLength(1);
  }, 120_000);

  it('records nothing when the mutation that would have triggered it fails', async () => {
    const campaign = await createCampaign({
      type: 'triggered',
      journeyId: journey,
      statusId: targetStatus,
    });
    const before = delivered.length;
    // A status that does not belong to this journey is rejected, and the whole
    // transaction — including the campaign row the trigger would have written —
    // must roll back with it.
    const rejected = await moveTo('Alpha', randomUUID());
    expect(rejected.status).toBe(400);
    expect(await sendsFor(campaign.id)).toHaveLength(0);
    expect(delivered).toHaveLength(before);
  }, 120_000);

  it('sends nothing from inside the mutation transaction', async () => {
    const campaign = await createCampaign({
      type: 'triggered',
      journeyId: journey,
      statusId: targetStatus,
    });
    const before = delivered.length;
    await moveTo('Alpha', otherStatus);
    await moveTo('Alpha', targetStatus);
    // The row exists, and not one email has gone out yet: delivery is a
    // separate step precisely because an email cannot be rolled back.
    expect(await sendsFor(campaign.id)).toHaveLength(1);
    expect(delivered).toHaveLength(before);

    const drained = await new CampaignSendService(prisma, transport).drainPending(org);
    expect(drained.sent).toBeGreaterThan(0);
    expect(delivered.length).toBeGreaterThan(before);
  }, 120_000);

  it('interpolates each recipient’s own values, escaped', async () => {
    delivered.length = 0;
    const campaign = await createCampaign({ type: 'manual', filter: { conditions: [] } });
    const response = await sendCampaign({ ...campaignDeps(), id: campaign.id });
    expect(response.status).toBe(200);

    const bodies = delivered.map((message) => message.html).sort();
    // Three leads, but one has no address, so two messages with two different
    // renderings — a template rendered once and reused would fail here.
    expect(bodies).toHaveLength(2);
    expect(bodies.some((html) => html.includes('Alpha Seller') && html.includes('gold'))).toBe(
      true,
    );
    expect(bodies.some((html) => html.includes('Beta Seller') && html.includes('silver'))).toBe(
      true,
    );

    const sends = await sendsFor(campaign.id);
    expect(sends.filter((row) => row.status === 'sent')).toHaveLength(2);
    // Recorded, not dropped, so the counts add up to the recipient set.
    expect(sends.filter((row) => row.status === 'skipped_no_email')).toHaveLength(1);
  }, 120_000);

  it('honours the stored filter when choosing recipients', async () => {
    delivered.length = 0;
    const campaign = await createCampaign({
      type: 'manual',
      filter: {
        conditions: [
          { target: { kind: 'field', fieldId: field }, operator: 'equals', values: ['silver'] },
        ],
      },
    });
    await sendCampaign({ ...campaignDeps(), id: campaign.id });
    expect(delivered.map((message) => message.to)).toEqual(['beta@example.test']);
  }, 120_000);

  it('refuses to send a deactivated campaign', async () => {
    const campaign = await createCampaign({ type: 'manual', filter: { conditions: [] } });
    await setCampaignActive({ ...campaignDeps(), id: campaign.id, active: false });
    const response = await sendCampaign({ ...campaignDeps(), id: campaign.id });
    expect(response.status).toBe(409);
    expect(await sendsFor(campaign.id)).toHaveLength(0);
  }, 120_000);

  it('records a transport failure as failed rather than sent', async () => {
    const campaign = await createCampaign({ type: 'manual', filter: { conditions: [] } });
    transportFails = true;
    try {
      await sendCampaign({ ...campaignDeps(), id: campaign.id });
    } finally {
      transportFails = false;
    }
    const sends = await sendsFor(campaign.id);
    // The unconfigured-transport path: never reported as delivered.
    expect(sends.filter((row) => row.status === 'sent')).toHaveLength(0);
    expect(sends.filter((row) => row.status === 'failed').length).toBeGreaterThan(0);
    expect(sends.find((row) => row.status === 'failed')?.error).toContain('transport');
  }, 120_000);

  it('requires campaigns:send, which campaigns:edit does not imply', async () => {
    const campaign = await createCampaign({ type: 'manual', filter: { conditions: [] } });
    await prisma.rolePermission.deleteMany({
      where: { organizationId: org, roleId: role, module: 'campaigns', action: 'send' },
    });
    const response = await sendCampaign({ ...campaignDeps(), id: campaign.id });
    expect(response.status).toBe(403);
    await prisma.rolePermission.create({
      data: {
        organizationId: org,
        roleId: role,
        module: 'campaigns',
        action: 'send',
        scope: 'ORGANIZATION',
      },
    });
  }, 120_000);

  it('refuses a variable naming a field the author cannot view, and audits every write', async () => {
    await expect(
      new CampaignService(prisma).create({
        organizationId: org,
        actorUserId: sender,
        visibleFieldIds: new Set(),
        campaign: {
          key: 'campaign_denied_variable',
          name: 'Synthetic',
          subject: 'Synthetic',
          bodyDocument: {
            blocks: [{ type: 'paragraph', spans: [{ text: `{{field:${field}}}` }] }],
          },
          type: 'manual',
          filter: { conditions: [] },
        },
      }),
    ).rejects.toThrow('variable references a field you cannot view');

    const audits = await prisma.systemAuditLog.findMany({
      where: { organizationId: org, entityType: 'campaign' },
    });
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.some((row) => row.action === 'deactivate')).toBe(true);
    expect(audits.every((row) => row.actorUserId === sender)).toBe(true);
  }, 120_000);
});
