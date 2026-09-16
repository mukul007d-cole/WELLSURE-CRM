import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FalconPrismaClient } from '@falcon/database';

import { CampaignSendService } from '../campaigns/send-service.js';
import { buildServer } from '../http/build-server.js';
import type { ServerDependencies } from '../http/types.js';
import { defaultAuthConfig } from '../auth/config.js';
import {
  applyMigrations,
  createAdminPostgres,
  shouldRunAdminPostgres,
} from './fixtures/synthetic-admin.js';

/**
 * Regression coverage for finding #4: `drainPending` had exactly one
 * production caller (the manual-send route), so a triggered campaign's
 * pending rows sat forever unless an unrelated manual send happened to run
 * in the same organization. `POST /internal/campaigns/drain` — the route
 * `apps/worker` polls on an interval — now drains every organization that
 * currently has pending work, gated on a shared secret rather than a user
 * session.
 */
describe.runIf(shouldRunAdminPostgres)('internal campaign drain route', () => {
  let db: Awaited<ReturnType<typeof createAdminPostgres>>;
  let prisma: FalconPrismaClient;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgC = randomUUID(); // has no pending work at all.
  const token = 'a-shared-worker-secret';

  const transport = {
    sendPasswordReset: () => Promise.resolve(),
    sendEmail: () => Promise.resolve(),
  };

  const serverWith = (deps: Partial<ServerDependencies>) =>
    buildServer({
      authRepository: {
        findSessionByTokenHash: () => Promise.resolve(null),
        touchSession: () => Promise.resolve(),
        getUserSnapshot: () => Promise.resolve(null),
      },
      permissionRepository: {} as never,
      leadRepository: {} as never,
      configurationRepository: {} as never,
      resourceService: {} as never,
      audit: {},
      emailSender: transport,
      authConfig: { ...defaultAuthConfig, secureCookies: false },
      corsOrigins: [],
      ...deps,
    } as unknown as ServerDependencies);

  const seedOrgWithLead = async (organizationId: string, name: string) => {
    await prisma.organization.create({ data: { id: organizationId, name } });
    const user = randomUUID();
    const role = randomUUID();
    await prisma.role.create({
      data: { id: role, organizationId, key: 'drain_role', name: 'Drain role' },
    });
    await prisma.user.create({
      data: {
        id: user,
        organizationId,
        name: 'Drain user',
        email: `${organizationId}@example.test`,
        roleId: role,
      },
    });
    const lead = randomUUID();
    await prisma.lead.create({
      data: {
        id: lead,
        organizationId,
        name: 'Drain lead',
        phone: null,
        email: 'lead@example.test',
        fieldValues: {},
      },
    });
    const campaign = randomUUID();
    await prisma.campaign.create({
      data: {
        id: campaign,
        organizationId,
        key: 'drain_campaign',
        name: 'Drain campaign',
        subject: 'Subject',
        bodyDocument: { blocks: [{ type: 'paragraph', spans: [{ text: 'hello' }] }] },
        type: 'manual',
        filter: { conditions: [] },
        active: true,
        createdById: user,
        updatedById: user,
      },
    });
    return { lead, campaign };
  };

  beforeAll(async () => {
    db = await createAdminPostgres();
    prisma = db.prisma;
    await applyMigrations(db.sql);
  }, 120_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  it('answers 503 when no internal worker token is configured', async () => {
    const server = serverWith({ prisma });
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/internal/campaigns/drain',
      });
      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body)).toEqual({ error: 'internal_worker_not_configured' });
    } finally {
      await server.close();
    }
  });

  it('answers 401 without a matching bearer token', async () => {
    const server = serverWith({ prisma, internalWorkerToken: token });
    try {
      const noHeader = await server.inject({
        method: 'POST',
        url: '/api/v1/internal/campaigns/drain',
      });
      expect(noHeader.statusCode).toBe(401);

      const wrongToken = await server.inject({
        method: 'POST',
        url: '/api/v1/internal/campaigns/drain',
        headers: { authorization: 'Bearer wrong-secret' },
      });
      expect(wrongToken.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('drains every organization with pending work, and reports nothing for organizations without any', async () => {
    const { campaign: campaignA, lead: leadA } = await seedOrgWithLead(orgA, 'Org A');
    const { campaign: campaignB, lead: leadB } = await seedOrgWithLead(orgB, 'Org B');
    await seedOrgWithLead(orgC, 'Org C'); // seeded, but left with no pending rows.

    await prisma.campaignSend.createMany({
      data: [
        { organizationId: orgA, campaignId: campaignA, leadId: leadA, status: 'pending' },
        { organizationId: orgB, campaignId: campaignB, leadId: leadB, status: 'pending' },
      ],
    });

    const server = serverWith({ prisma, internalWorkerToken: token });
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/internal/campaigns/drain',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        organizations: 2,
        sent: 2,
        failed: 0,
        skippedNoEmail: 0,
      });
    } finally {
      await server.close();
    }

    const rows = await prisma.campaignSend.findMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    expect(rows.every((row) => row.status === 'sent')).toBe(true);
  });
});

describe.runIf(shouldRunAdminPostgres)(
  'CampaignSendService.organizationsWithPending / drainAllPending',
  () => {
    let db: Awaited<ReturnType<typeof createAdminPostgres>>;
    let prisma: FalconPrismaClient;
    const org = randomUUID();

    beforeAll(async () => {
      db = await createAdminPostgres();
      prisma = db.prisma;
      await applyMigrations(db.sql);
      await prisma.organization.create({ data: { id: org, name: 'Discovery org' } });
    }, 120_000);

    afterAll(async () => {
      await db?.cleanup();
    });

    it('finds only organizations with a pending row, ignoring sent/failed/sending rows', async () => {
      const role = randomUUID();
      const user = randomUUID();
      await prisma.role.create({ data: { id: role, organizationId: org, key: 'r', name: 'R' } });
      await prisma.user.create({
        data: { id: user, organizationId: org, name: 'U', email: 'u2@example.test', roleId: role },
      });
      const campaign = randomUUID();
      await prisma.campaign.create({
        data: {
          id: campaign,
          organizationId: org,
          key: 'discovery_campaign',
          name: 'Discovery',
          subject: 'Subject',
          bodyDocument: { blocks: [] },
          type: 'manual',
          filter: { conditions: [] },
          active: true,
          createdById: user,
          updatedById: user,
        },
      });
      const leadPending = randomUUID();
      const leadSent = randomUUID();
      await prisma.lead.createMany({
        data: [leadPending, leadSent].map((id) => ({
          id,
          organizationId: org,
          name: 'L',
          phone: null,
          email: null,
          fieldValues: {},
        })),
      });
      await prisma.campaignSend.create({
        data: { organizationId: org, campaignId: campaign, leadId: leadSent, status: 'sent' },
      });

      const service = new CampaignSendService(prisma, { sendEmail: () => Promise.resolve() });
      expect(await service.organizationsWithPending()).toEqual([]);

      await prisma.campaignSend.create({
        data: { organizationId: org, campaignId: campaign, leadId: leadPending, status: 'pending' },
      });
      expect(await service.organizationsWithPending()).toEqual([org]);
    });
  },
);
