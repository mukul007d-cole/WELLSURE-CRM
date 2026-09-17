-- Rollback for 00000000000007_campaign_send_claims_and_retry.
--
-- Safe only once no row is `sending` — a deployment rolling this back
-- mid-flight should let in-flight claims resolve (or wait out the lease
-- timeout so they self-reclaim to `pending`) first. The UPDATE below
-- degrades any that are still `sending` back to `pending` regardless, so
-- the rollback never leaves a row in a status the old CHECK constraint
-- would reject.
UPDATE campaign_sends SET status = 'pending' WHERE status = 'sending';

ALTER TABLE campaign_sends DROP CONSTRAINT campaign_sends_attempts_non_negative;
ALTER TABLE campaign_sends DROP COLUMN attempts;
ALTER TABLE campaign_sends DROP COLUMN claimed_at;

ALTER TABLE campaign_sends DROP CONSTRAINT campaign_sends_status_check;
ALTER TABLE campaign_sends ADD CONSTRAINT campaign_sends_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'skipped_no_email'));
