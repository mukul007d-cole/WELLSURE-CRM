import type { FalconPrismaClient } from '@falcon/database';

import type { CampaignEmailSender } from '../auth/password-reset.js';
import { parseDocument, renderDocument } from './document.js';
import { variablesFor } from './variables.js';

/** A claimed-but-unresolved row past this age was orphaned by a crash between claiming and recording an outcome, and is reclaimed to `pending`. */
export const campaignSendLeaseMs = 5 * 60 * 1000;

/** A `failed` row at this many attempts is terminal; `retryFailed` will not requeue it. */
export const maxCampaignSendAttempts = 5;

/**
 * Turns pending `campaign_sends` rows into email.
 *
 * Delivery deliberately happens *outside* the mutation transaction that created
 * the rows: an email cannot be rolled back, so a send inside a transaction that
 * later aborts would be unrecallable. Recording is transactional, delivery is
 * not.
 *
 * The unique constraint on (organization, campaign, lead) guarantees at most
 * one *row* per recipient — it says nothing about how many times the
 * transport is called for that row. Two concurrent drains racing the same
 * `pending` row used to both call the transport before either recorded an
 * outcome. Fixed by an atomic per-row claim (`pending` -> `sending`, a
 * conditional UPDATE checked by affected row count) *before* calling the
 * transport: only one concurrent caller can ever win a given row, so at most
 * one delivery attempt is ever in flight for it at a time. A row stuck in
 * `sending` past `campaignSendLeaseMs` (a crash between claiming and
 * recording the outcome — the DB update never ran) is reclaimed to `pending`
 * and re-attempted; if the original attempt actually reached the provider
 * before the crash, this is a genuine duplicate send with no way to avoid it
 * from this side, absent a provider-supplied idempotency key. That residual
 * risk is the honest limit of what a claim can guarantee — see the
 * investigation notes on finding #3.
 */
export class CampaignSendService {
  constructor(
    private readonly prisma: FalconPrismaClient,
    private readonly email: CampaignEmailSender,
  ) {}

  /**
   * Drains pending rows for the organization, or — when `campaignId` is
   * given — only that campaign's rows. A manual send scopes to its own
   * campaign; an organization-wide drain (a future scheduled worker) omits
   * it. See the investigation notes on finding #5.
   */
  async drainPending(
    organizationId: string,
    options?: { campaignId?: string; limit?: number },
  ): Promise<{ sent: number; failed: number; skippedNoEmail: number }> {
    const scope = options?.campaignId === undefined ? {} : { campaignId: options.campaignId };
    const now = new Date();

    // Reclaim rows a prior processor claimed but never resolved — see the
    // class doc.
    await this.prisma.campaignSend.updateMany({
      where: {
        organizationId,
        ...scope,
        status: 'sending',
        claimedAt: { lt: new Date(now.getTime() - campaignSendLeaseMs) },
      },
      data: { status: 'pending', claimedAt: null },
    });

    const candidates = await this.prisma.campaignSend.findMany({
      where: { organizationId, ...scope, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: options?.limit ?? 500,
      include: { campaign: true, lead: true },
    });

    let sent = 0;
    let failed = 0;
    let skippedNoEmail = 0;
    for (const row of candidates) {
      // The atomic claim. A concurrent drain racing this same row finds 0
      // rows here and moves on — Postgres serializes the two UPDATEs, so
      // the loser's WHERE re-evaluates against the winner's already
      // committed `sending` status.
      const claim = await this.prisma.campaignSend.updateMany({
        where: { organizationId, id: row.id, status: 'pending' },
        data: { status: 'sending', claimedAt: now, attempts: { increment: 1 } },
      });
      if (claim.count === 0) continue;

      const address = row.lead.email?.trim() ?? '';
      if (address === '') {
        // Recorded, not dropped: the reported counts have to add up to the
        // recipient set the filter produced.
        await this.mark(organizationId, row.id, 'skipped_no_email', null);
        skippedNoEmail += 1;
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
    return { sent, failed, skippedNoEmail };
  }

  /**
   * Re-offers a campaign's `failed` rows for another attempt, bounded by
   * `maxCampaignSendAttempts`. Rows already at the cap stay `failed` and
   * are reported separately rather than silently skipped, so a caller can
   * tell "nothing to retry" apart from "retries exhausted".
   */
  async retryFailed(
    organizationId: string,
    campaignId: string,
  ): Promise<{ requeued: number; permanentlyFailed: number }> {
    const requeued = await this.prisma.campaignSend.updateMany({
      where: {
        organizationId,
        campaignId,
        status: 'failed',
        attempts: { lt: maxCampaignSendAttempts },
      },
      data: { status: 'pending', error: null },
    });
    const permanentlyFailed = await this.prisma.campaignSend.count({
      where: {
        organizationId,
        campaignId,
        status: 'failed',
        attempts: { gte: maxCampaignSendAttempts },
      },
    });
    return { requeued: requeued.count, permanentlyFailed };
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
