-- Email marketing campaigns.
--
-- Two tables, both new; nothing existing is altered, so rollback is a pair of
-- DROPs.
--
-- `campaigns.body_document` stores a closed-vocabulary JSON document rather
-- than HTML. The server renders and escapes the markup at send time, so no
-- client-supplied markup is ever stored or re-emitted, and an interpolated
-- value containing markup cannot inject anything.
--
-- `campaign_sends` is both the sent-count stat and the idempotency record: the
-- unique constraint on (organization_id, campaign_id, lead_id) is what stops a
-- lead re-entering a triggered status from being emailed twice. Rows are
-- written inside the mutation transaction as `pending` and delivered after it
-- commits, because an email cannot be rolled back.

CREATE TABLE campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  subject text NOT NULL,
  body_document jsonb NOT NULL DEFAULT '{"blocks":[]}'::jsonb,
  type text NOT NULL,
  filter jsonb,
  journey_id uuid,
  status_id uuid,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journey_id) REFERENCES journeys(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, status_id) REFERENCES statuses(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT campaigns_type_check CHECK (type IN ('manual', 'triggered')),
  -- The two campaign kinds carry different targeting, and neither may carry the
  -- other's: a triggered campaign with a filter, or a manual one with a status,
  -- would be a silently half-configured send.
  CONSTRAINT campaigns_targeting_check CHECK (
    (type = 'manual' AND journey_id IS NULL AND status_id IS NULL)
    OR (type = 'triggered' AND journey_id IS NOT NULL AND status_id IS NOT NULL AND filter IS NULL)
  )
);

CREATE UNIQUE INDEX campaigns_key_uq ON campaigns (organization_id, key);
-- Trigger evaluation runs on every status change, so it looks up by exactly
-- this shape.
CREATE INDEX campaigns_trigger_idx ON campaigns (organization_id, type, active, journey_id, status_id);

CREATE TABLE campaign_sends (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text,
  sent_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, campaign_id) REFERENCES campaigns(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT campaign_sends_status_check CHECK (status IN ('pending', 'sent', 'failed', 'skipped_no_email'))
);

-- One send per lead per campaign, ever. This is the idempotency guarantee
-- itself, not a convenience index: a lead re-entering the configured status
-- must not produce a second email.
CREATE UNIQUE INDEX campaign_sends_lead_uq ON campaign_sends (organization_id, campaign_id, lead_id);
-- The drain reads exactly this.
CREATE INDEX campaign_sends_pending_idx ON campaign_sends (organization_id, status, created_at);
