-- Atomic campaign-send claiming and bounded retry.
--
-- Two gaps closed together because both touch campaign_sends:
--
-- 1. `CampaignSendService.drainPending` selected `pending` rows with a
--    plain SELECT and only updated a row's status *after* calling the
--    email transport, so two concurrent drains (two overlapping manual
--    sends, or a future worker running alongside one) could both select
--    the same row and both call the transport for it. The unique
--    constraint on (organization, campaign, lead) only ever guaranteed one
--    *row* — it says nothing about how many times the transport was
--    called for that row. Fixed by an atomic per-row claim (`pending` ->
--    `sending`, a conditional UPDATE checked by affected row count)
--    *before* calling the transport, so only one concurrent caller can
--    ever win a given row. `claimed_at` also lets a row stuck in `sending`
--    (a crash between claiming and recording the outcome) be reclaimed
--    after a lease timeout instead of stranded forever.
--
-- 2. There was no way to retry a `failed` row: `queueManualSend`'s
--    `skipDuplicates` matches the unique constraint regardless of status,
--    so re-offering a failed lead was always a no-op. `attempts` bounds a
--    new explicit retry path so retries cannot loop forever against a
--    permanently-broken address.
ALTER TABLE campaign_sends DROP CONSTRAINT campaign_sends_status_check;
ALTER TABLE campaign_sends ADD CONSTRAINT campaign_sends_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped_no_email'));

ALTER TABLE campaign_sends ADD COLUMN claimed_at timestamptz(6);
ALTER TABLE campaign_sends ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE campaign_sends ADD CONSTRAINT campaign_sends_attempts_non_negative CHECK (attempts >= 0);

-- The existing (organization_id, status, created_at) index already covers
-- `sending` lease lookups scoped to one organization; a dedicated
-- lease-scan index is not worth adding until reclaim volume shows it is.
