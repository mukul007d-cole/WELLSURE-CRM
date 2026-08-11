import type { FalconPrismaClient } from '@falcon/database';

import { enteredStatusId, type TriggerEvent } from '../leads/trigger-dispatch.js';

/**
 * Records a triggered campaign's send for the one Lead whose transition fired
 * it.
 *
 * Runs inside the mutation transaction, like Phase 9's notification evaluation,
 * and writes a `pending` row rather than sending: the email itself happens after
 * commit (see `CampaignSendService`).
 *
 * Status matching is exact, per ADR-0001 — the activity's new status id must
 * equal the campaign's configured status. `statuses.sort_order` is display
 * ordering and is never consulted here.
 */
export class CampaignTriggerService {
  constructor(private readonly prisma: FalconPrismaClient) {}

  async evaluate(event: TriggerEvent): Promise<void> {
    if (event.triggerType !== 'status_changed') return;
    const statusId = enteredStatusId(event.newValue);
    if (statusId === null || !event.processInstanceId) return;

    const process = await this.prisma.processInstance.findFirst({
      where: { organizationId: event.organizationId, id: event.processInstanceId },
      select: { journeyId: true },
    });
    if (!process) return;

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        organizationId: event.organizationId,
        type: 'triggered',
        // Deactivating a campaign is how an admin stops it firing; an inactive
        // one is skipped here rather than sent and discarded later.
        active: true,
        journeyId: process.journeyId,
        statusId,
      },
      select: { id: true },
    });

    for (const campaign of campaigns) {
      /*
       * At most one send per (campaign, lead), ever. The unique constraint is
       * the guarantee; this upsert is how it is honoured without racing. A lead
       * re-entering the same status finds its row already present and does
       * nothing, which is the approved default.
       */
      await this.prisma.campaignSend.upsert({
        where: {
          organizationId_campaignId_leadId: {
            organizationId: event.organizationId,
            campaignId: campaign.id,
            leadId: event.leadId,
          },
        },
        update: {},
        create: {
          organizationId: event.organizationId,
          campaignId: campaign.id,
          leadId: event.leadId,
          status: 'pending',
        },
      });
    }
  }
}
