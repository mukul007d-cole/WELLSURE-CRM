-- Reverses 00000000000003_attachment_metadata.
-- Drops display metadata only; stored objects and their s3_key rows survive.

DROP INDEX IF EXISTS "attachments_lead_recent_idx";
ALTER TABLE "attachments" DROP CONSTRAINT IF EXISTS "attachments_size_bytes_non_negative";
ALTER TABLE "attachments" DROP COLUMN IF EXISTS "size_bytes";
ALTER TABLE "attachments" DROP COLUMN IF EXISTS "mime_type";
ALTER TABLE "attachments" DROP COLUMN IF EXISTS "file_name";
