-- Rollback for 00000000000007_bulk_import.
--
-- Destructive in exactly one place, stated plainly: dropping `import_job_rows`
-- destroys the per-row import history — which import created which lead, and why
-- a row did not become one. The leads themselves are untouched; only the
-- provenance link is lost. Nothing else in the system reads that table.
--
-- Everything else is exactly recoverable. The `import_jobs` columns are all
-- NOT NULL DEFAULT on a table that had no writer before this migration, so no
-- data can be lost by dropping them, and `leads_email_lower_idx` is an index.

DROP INDEX IF EXISTS leads_email_lower_idx;

DROP TABLE IF EXISTS import_job_rows;

DROP INDEX IF EXISTS import_jobs_recent_idx;

ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_counts_check;

ALTER TABLE import_jobs DROP COLUMN IF EXISTS rejected_count;
ALTER TABLE import_jobs DROP COLUMN IF EXISTS skipped_count;
ALTER TABLE import_jobs DROP COLUMN IF EXISTS created_count;
ALTER TABLE import_jobs DROP COLUMN IF EXISTS row_count;
ALTER TABLE import_jobs DROP COLUMN IF EXISTS file_name;

-- `file_key` keeps whatever hashes were written to it; after rollback nothing
-- reads the column, exactly as before this migration.
COMMENT ON COLUMN import_jobs.file_key IS NULL;
