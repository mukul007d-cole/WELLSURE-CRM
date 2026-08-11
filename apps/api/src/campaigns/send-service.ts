import type { FalconPrismaClient } from '@falcon/database';

import type { CampaignEmailSender } from '../auth/password-reset.js';
import { parseDocument, renderDocument } from './document.js';
import { variablesFor } from './variables.js';

/**
 * Turns pending `campaign_sends` rows into email.
 *
 * Delivery deliberately happens *outside* the mutation transaction that created
 * the rows: an email cannot be rolled back, so a send inside a transaction that
 * later aborts would be unrecallable. Recording is transactional, delivery is
 * not, and the unique constraint on (campaign, lead) makes the retry safe —
 * at-least-once delivery attempts against an at-most-once record.
 */
export class CampaignSendService {
  constructor(
    private readonly prisma: FalconPrismaClient,
    private readonly email: CampaignEmailSender,
  ) {}

  /** Returns how many rows moved out of `pending`. */
  async drainPending(
    organizationId: string,
    limit = 500,
  ): Promise<{ sent: number; failed: number }> {
    const pending = await this.prisma.campaignSend.findMany({
      where: { organizationId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: { campaign: true, lead: true },
    });
    let sent = 0;
    let failed = 0;
    for (const row of pending) {
      const address = row.lead.email?.trim() ?? '';
      if (address === '') {
        // Recorded, not dropped: the reported counts have to add up to the
        // recipient set the filter produced.
        await this.mark(organizationId, row.id, 'skipped_no_email', null);
        continue;
      }
      try {
        const document = parseDocument(row.campaign.bodyDocument);
        const variables = variablesFor({
          name: row.lead.name,
          email: row.lead.email,
          phone: row.lead.phone,
          fieldValues: (row.lead.fieldValues ?? {}) as Record<string, unknown>,
        });
        await this.email.sendEmail({
          to: address,
          subject: row.campaign.subject,
          html: renderDocument(document, variables),
        });
        await this.mark(organizationId, row.id, 'sent', null);
        sent += 1;
      } catch (error) {
        // An unconfigured transport rejects every call, so this is the path a
        // misconfigured deployment takes: recorded as failed with the reason,
        // never reported as sent.
        await this.mark(organizationId, row.id, 'failed', String((error as Error).message));
        failed += 1;
      }
    }
    return { sent, failed };
  }

  private async mark(
    organizationId: string,
    id: string,
    status: 'sent' | 'failed' | 'skipped_no_email',
    error: string | null,
  ) {
    await this.prisma.campaignSend.update({
      where: { organizationId_id: { organizationId, id } },
      data: { status, error, sentAt: status === 'sent' ? new Date() : null },
    });
  }
}
