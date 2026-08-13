-- Bulk lead import and export (Phase 15). See ADR-0016.
--
-- `import_jobs` has existed since phase 1 with no reader and no writer. It is
-- the right header record — actor, timestamp, mapping, state — and it is missing
-- the two things the feature has to record: how many rows did what, and which
-- leads came out of which row. Both are added here rather than in a parallel
-- table invented alongside it.

-- Counts, so an import run reconciles: source = created + skipped + rejected.
-- `docs/migration/cronberry-mapping.md` §4 requires exactly this reconciliation
-- of any importer.
--
-- All NOT NULL DEFAULT, so the ALTER is safe in both directions on a table that
-- has never had a writer. Rollback is DROP COLUMN for each.
ALTER TABLE import_jobs ADD COLUMN file_name text NOT NULL DEFAULT '';
ALTER TABLE import_jobs ADD COLUMN row_count integer NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN created_count integer NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN skipped_count integer NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN rejected_count integer NOT NULL DEFAULT 0;

ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_counts_check CHECK (
    row_count >= 0 AND created_count >= 0 AND skipped_count >= 0 AND rejected_count >= 0
  );

-- History is listed newest-first; the existing index leads with `status`, which
-- does not serve that ordering.
CREATE INDEX import_jobs_recent_idx ON import_jobs (organization_id, created_at DESC);

-- `file_key` changes meaning without changing type: it now holds `sha256:<hex>`
-- of the uploaded bytes rather than an object-storage key.
--
-- Two reasons. Object storage is optional (ADR-0012) — a deployment without S3
-- would otherwise have no import at all, including CI. And a content hash buys a
-- real guarantee the phase needs: the preview returns it, the commit echoes it,
-- and a commit whose bytes hash differently is refused, so "the dry run predicts
-- what the commit does" cannot be defeated by swapping the file between steps.
COMMENT ON COLUMN import_jobs.file_key IS 'sha256:<hex> of the uploaded bytes. Not an object-storage key — see ADR-0016.';

-- What each row of an imported file actually did.
--
-- Written on commit only. A preview runs the identical code inside a transaction
-- that is deliberately rolled back, so its rows never reach this table — which is
-- the property that makes "a dry run writes nothing" true of the audit trail too,
-- not just of the leads.
CREATE TABLE import_job_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  import_job_id uuid NOT NULL,
  -- The record's position in the file, counting the header as 1.
  row_number integer NOT NULL,
  outcome text NOT NULL,
  -- Set when the row created a lead: the "trace back what was created" link.
  lead_id uuid,
  process_instance_id uuid,
  -- Set when the row was skipped: which existing lead it matched.
  matched_lead_id uuid,
  -- A rejection's error code and message, generated from configuration ids.
  -- Never a cell from the source file, so an excluded source column cannot
  -- reach durable storage through an error payload
  -- (`docs/migration/cronberry-mapping.md` §2).
  reason text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, import_job_id) REFERENCES import_jobs(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, matched_lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, process_instance_id) REFERENCES process_instances(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT import_job_rows_outcome_check CHECK (outcome IN ('created', 'skipped_duplicate', 'rejected')),
  -- The outcome determines which references are meaningful. Constrained rather
  -- than merely conventional, so a row can never claim to have created a lead
  -- without naming it.
  CONSTRAINT import_job_rows_shape_check CHECK (
    (outcome = 'created' AND lead_id IS NOT NULL AND matched_lead_id IS NULL AND reason IS NULL)
    OR (outcome = 'skipped_duplicate' AND lead_id IS NULL AND process_instance_id IS NULL)
    OR (outcome = 'rejected' AND lead_id IS NULL AND process_instance_id IS NULL AND matched_lead_id IS NULL)
  )
);

-- One outcome per row of one file, ever.
CREATE UNIQUE INDEX import_job_rows_uq ON import_job_rows (organization_id, import_job_id, row_number);
-- "Which import created this lead?" — the reverse lookup the trace exists for.
CREATE INDEX import_job_rows_lead_idx ON import_job_rows (organization_id, lead_id);

-- Case-insensitive email matching for duplicate detection (phase 15 §D4).
--
-- `leads_email_idx` is on the raw column and cannot serve `lower(email) = $1`.
-- Dedup that misses `A@x.com` against `a@x.com` is not dedup, so the expression
-- index is the price. Rollback is DROP INDEX, with no data implication.
CREATE INDEX leads_email_lower_idx ON leads (organization_id, lower(email));
