-- Rollback for the squashed baseline (Phase 17, Part 1).
--
-- ## Read this before running it
--
-- This is a FROM-SCRATCH teardown, not an incremental one. There is no
-- "previous migration" to return to: the baseline *is* the whole schema, so
-- undoing it means removing the whole schema. Running this drops every table,
-- every trigger function and every enum the application owns, and with them all
-- data in the database.
--
-- The nine migrations this baseline replaced each had their own rollback that
-- returned the database to the intermediate state before it. Those intermediate
-- states no longer exist anywhere, so those scripts were removed along with the
-- migrations. That is expected, not a loss: what each historical change was for
-- is recorded in `docs/planning/` and in ADR-0001..0017.
--
-- ## When this is the right tool
--
--   * Resetting a disposable local or CI database.
--   * Tearing down an environment that is being decommissioned.
--
-- ## When it is not
--
--   * Recovering from a bad deploy in an environment that holds real data.
--     Restore from a backup instead — this script destroys the data it would be
--     recovering. `AGENTS.md` requires migrations to be reversible or to have a
--     documented rollback path; for a baseline, the documented path for a
--     populated database is point-in-time restore, and this file is only the
--     disposable-database path.
--
-- `AGENTS.md` forbids hard-deleting configuration, and the database enforces
-- that with BEFORE DELETE triggers. DROP TABLE is DDL, not a DELETE, so those
-- triggers do not fire and do not need the ADR-0017 purge GUC to be set. The
-- guarantee they exist for — that no *row* is quietly deleted — is unaffected.
--
-- Order: tables first (CASCADE clears the foreign keys and the triggers that
-- hang off them), then the functions those triggers referenced, then the enums
-- the columns referenced. `pgcrypto` is left installed: it is a database-level
-- extension that other schemas may rely on, and dropping it is not this
-- migration's to undo.

DROP TABLE IF EXISTS
  status_routing_permissions, status_routing_rule_members, status_routing_rules,
  team_members, teams,
  campaign_sends, campaigns,
  failed_login_attempts, password_reset_tokens, sessions,
  settings, payments, invoices,
  import_job_rows, import_jobs, attachments,
  notifications, notification_rule_recipients, notification_rules, tasks,
  system_audit_logs, activity_logs,
  user_access_grants, lead_links, lead_services, assignments, process_instances, leads,
  field_visibility, field_journey_settings, fields, statuses,
  journey_services, services, role_journey_access, journeys,
  role_permissions, users, designations, departments, roles, organizations
  CASCADE;

DROP FUNCTION IF EXISTS reject_append_only_change();
DROP FUNCTION IF EXISTS reject_configuration_delete();
DROP FUNCTION IF EXISTS block_in_use_status_deactivation();

DROP TYPE IF EXISTS "BehaviorType", "OutcomeType", "FieldAccessLevel", "DataScope";
