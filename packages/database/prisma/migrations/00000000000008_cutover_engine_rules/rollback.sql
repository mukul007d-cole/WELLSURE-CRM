-- Rollback for 00000000000008_cutover_engine_rules.
--
-- Run only after deploying a release that no longer reads these columns
-- (docs/operations/deployment.md: a narrowing migration runs after the deploy).
-- Data written into the dropped tables is configuration and history that the
-- system_audit_logs rows written alongside it already record, except follow-up
-- tasks' note/completion columns, which are lost.

DROP INDEX IF EXISTS tasks_process_open_idx;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_completed_by_fk;
ALTER TABLE tasks DROP COLUMN IF EXISTS completed_by_user_id;
ALTER TABLE tasks DROP COLUMN IF EXISTS completed_at;
ALTER TABLE tasks DROP COLUMN IF EXISTS note;

DROP INDEX IF EXISTS process_instances_external_ref_uq;
ALTER TABLE process_instances DROP COLUMN IF EXISTS external_ref;

ALTER TABLE field_journey_settings DROP COLUMN IF EXISTS required_role_ids;

DROP TABLE IF EXISTS status_required_fields;
DROP TABLE IF EXISTS status_allowed_roles;
ALTER TABLE process_instances DROP COLUMN IF EXISTS status_reason;
ALTER TABLE statuses DROP COLUMN IF EXISTS reason_options;
ALTER TABLE statuses DROP COLUMN IF EXISTS color;

DROP TABLE IF EXISTS journey_members;
ALTER TABLE journeys DROP COLUMN IF EXISTS restrict_to_members;

ALTER TABLE role_permissions DROP COLUMN IF EXISTS journey_ids;

DROP TABLE IF EXISTS role_reporting_lines;

-- PostgreSQL cannot drop an enum value: rewrite REPORTING_ROLES grants to TEAM,
-- then recreate the type without it.
UPDATE role_permissions SET scope = 'TEAM' WHERE scope = 'REPORTING_ROLES';
ALTER TYPE "DataScope" RENAME TO "DataScope_old";
CREATE TYPE "DataScope" AS ENUM ('SELF', 'TEAM', 'DEPARTMENT', 'ORGANIZATION');
ALTER TABLE role_permissions
  ALTER COLUMN scope TYPE "DataScope" USING scope::text::"DataScope";
DROP TYPE "DataScope_old";
