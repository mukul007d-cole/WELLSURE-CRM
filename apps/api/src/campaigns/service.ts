import { Prisma, type FalconPrismaClient } from '@falcon/database';

import { parseDocument, type CampaignDocument } from './document.js';
import { unauthorizedTokens } from './variables.js';

export class CampaignError extends Error {
  constructor(
    readonly code: 'validation_error' | 'not_found' | 'conflict' | 'forbidden',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export function isCampaignError(error: unknown): error is CampaignError {
  return error instanceof CampaignError;
}

export const campaignTypes = ['manual', 'triggered'] as const;
export type CampaignType = (typeof campaignTypes)[number];

export interface CampaignWriteInput {
  key?: string;
  name: string;
  subject: string;
  bodyDocument: unknown;
  type: string;
  filter?: unknown;
  journeyId?: string | null;
  statusId?: string | null;
  active?: boolean;
}

const keyPattern = /^[a-z][a-z0-9_]{1,62}$/;

export class CampaignService {
  constructor(private readonly prisma: FalconPrismaClient) {}

  async list(organizationId: string, page = 1, pageSize = 25) {
    const where = { organizationId };
    const [total, items] = await Promise.all([
      this.prisma.campaign.count({ where }),
      this.prisma.campaign.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (Math.max(1, page) - 1) * Math.min(100, pageSize),
        take: Math.min(100, pageSize),
      }),
    ]);
    // Send stats come from campaign_sends, which is the only place a send is
    // recorded — the list never counts from anything else.
    const stats = await this.prisma.campaignSend.groupBy({
      by: ['campaignId', 'status'],
      where: { organizationId },
      _count: { _all: true },
    });
    return {
      total,
      items: items.map((campaign) => ({ ...campaign, stats: statsFor(stats, campaign.id) })),
    };
  }

  async get(organizationId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({ where: { organizationId, id } });
    if (!campaign) return null;
    const stats = await this.prisma.campaignSend.groupBy({
      by: ['campaignId', 'status'],
      where: { organizationId, campaignId: id },
      _count: { _all: true },
    });
    return { ...campaign, stats: statsFor(stats, id) };
  }

  async create(input: {
    organizationId: string;
    actorUserId: string;
    visibleFieldIds: ReadonlySet<string>;
    campaign: CampaignWriteInput;
  }) {
    const data = await this.validate(input.organizationId, input.campaign, input.visibleFieldIds);
    const key = input.campaign.key ?? '';
    if (!keyPattern.test(key))
      throw new CampaignError('validation_error', 'key must be a stable lowercase identifier');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.campaign.create({
        data: {
          organizationId: input.organizationId,
          key,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
          ...data,
        },
      });
      await audit(tx, input, 'create', null, row);
      return row;
    });
  }

  async update(input: {
    organizationId: string;
    actorUserId: string;
    id: string;
    visibleFieldIds: ReadonlySet<string>;
    campaign: CampaignWriteInput;
  }) {
    const data = await this.validate(input.organizationId, input.campaign, input.visibleFieldIds);
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.campaign.findFirst({
        where: { organizationId: input.organizationId, id: input.id },
      });
      if (!old) return null;
      const row = await tx.campaign.update({
        where: { organizationId_id: { organizationId: input.organizationId, id: input.id } },
        data: {
          ...data,
          active: input.campaign.active ?? old.active,
          updatedById: input.actorUserId,
          version: { increment: 1 },
        },
      });
      await audit(tx, input, 'edit', old, row);
      return row;
    });
  }

  /**
   * Activation is its own operation rather than a field on the edit form: a
   * triggered campaign only fires while active, so switching it is the control
   * that stops sends, and it deserves its own audit row.
   */
  async setActive(input: {
    organizationId: string;
    actorUserId: string;
    id: string;
    active: boolean;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.campaign.findFirst({
        where: { organizationId: input.organizationId, id: input.id },
      });
      if (!old) return null;
      const row = await tx.campaign.update({
        where: { organizationId_id: { organizationId: input.organizationId, id: input.id } },
        data: {
          active: input.active,
          updatedById: input.actorUserId,
          version: { increment: 1 },
        },
      });
      await audit(tx, input, input.active ? 'activate' : 'deactivate', old, row);
      return row;
    });
  }

  /**
   * Records one pending row per recipient, in one transaction. Delivery is a
   * separate step: an email cannot be rolled back, so nothing is sent until
   * this has committed.
   */
  async queueManualSend(input: {
    organizationId: string;
    campaignId: string;
    leadIds: readonly string[];
  }): Promise<number> {
    if (input.leadIds.length === 0) return 0;
    const result = await this.prisma.campaignSend.createMany({
      data: input.leadIds.map((leadId) => ({
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        leadId,
        status: 'pending',
      })),
      // A lead already sent this campaign is skipped rather than queued twice —
      // the same at-most-once guarantee the triggered path relies on.
      skipDuplicates: true,
    });
    return result.count;
  }

  private async validate(
    organizationId: string,
    campaign: CampaignWriteInput,
    visibleFieldIds: ReadonlySet<string>,
  ) {
    const name = campaign.name?.trim() ?? '';
    const subject = campaign.subject?.trim() ?? '';
    if (name === '') throw new CampaignError('validation_error', 'name is required');
    if (subject === '') throw new CampaignError('validation_error', 'subject is required');
    if (!(campaignTypes as readonly string[]).includes(campaign.type))
      throw new CampaignError('validation_error', 'type must be manual or triggered');

    let document: CampaignDocument;
    try {
      document = parseDocument(campaign.bodyDocument);
    } catch (error) {
      throw new CampaignError('validation_error', (error as Error).message);
    }
    const denied = unauthorizedTokens(document, visibleFieldIds);
    if (denied.length > 0)
      // Availability is the author's own visibility, checked here rather than
      // per recipient at send time.
      throw new CampaignError('forbidden', 'variable references a field you cannot view');

    if (campaign.type === 'triggered') {
      const journeyId = campaign.journeyId ?? '';
      const statusId = campaign.statusId ?? '';
      if (!journeyId || !statusId)
        throw new CampaignError(
          'validation_error',
          'a triggered campaign needs a journey and a status',
        );
      const status = await this.prisma.status.findFirst({
        where: { organizationId, id: statusId, journeyId },
      });
      if (!status)
        throw new CampaignError('validation_error', 'status must belong to the chosen journey');
      return {
        name,
        subject,
        bodyDocument: document as never,
        type: campaign.type,
        // Prisma separates JSON null from column null; a triggered campaign has
        // no filter column value at all.
        filter: Prisma.DbNull,
        journeyId,
        statusId,
      };
    }
    return {
      name,
      subject,
      bodyDocument: document as never,
      type: campaign.type,
      filter: (campaign.filter ?? { conditions: [] }) as never,
      journeyId: null,
      statusId: null,
    };
  }
}

export interface CampaignStats {
  sent: number;
  failed: number;
  pending: number;
  skippedNoEmail: number;
}

function statsFor(
  rows: Array<{ campaignId: string; status: string; _count: { _all: number } }>,
  campaignId: string,
): CampaignStats {
  const of = (status: string) =>
    rows.find((row) => row.campaignId === campaignId && row.status === status)?._count._all ?? 0;
  return {
    sent: of('sent'),
    failed: of('failed'),
    pending: of('pending'),
    skippedNoEmail: of('skipped_no_email'),
  };
}

/** Narrowed to what it uses, so a transaction client satisfies it. */
type AuditWriter = Pick<FalconPrismaClient, 'systemAuditLog'>;

async function audit(
  tx: AuditWriter,
  input: { organizationId: string; actorUserId: string },
  action: string,
  oldValue: unknown,
  newValue: unknown,
) {
  await tx.systemAuditLog.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      entityType: 'campaign',
      entityId: (newValue as { id: string }).id,
      action,
      oldValue: oldValue as never,
      newValue: newValue as never,
    },
  });
}
