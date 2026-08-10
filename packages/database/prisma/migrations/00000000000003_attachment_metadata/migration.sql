-- Attachment display metadata and a lead access path.
--
-- The table shipped with only s3_key, so a stored document had no name to show,
-- no content type to serve it back with, and no size to display. It also had no
-- index on lead_id, meaning "list this lead's documents" — the only query the
-- table exists to serve — had no supporting index.
--
-- Additive and reversible: three nullable columns and one index.

ALTER TABLE "attachments" ADD COLUMN "file_name" TEXT;
ALTER TABLE "attachments" ADD COLUMN "mime_type" TEXT;
ALTER TABLE "attachments" ADD COLUMN "size_bytes" BIGINT;

-- Sizes are non-negative; a negative one means the writer is wrong, not that
-- the file is unusual.
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_size_bytes_non_negative" CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0);

-- Newest first per lead, matching how the locker lists them.
CREATE INDEX "attachments_lead_recent_idx"
  ON "attachments" ("organization_id", "lead_id", "uploaded_at" DESC);
