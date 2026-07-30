-- Destructive rollback for disposable Phase 1 databases only.
DROP TABLE IF EXISTS settings, payments, invoices, import_jobs, attachments, notifications, tasks,
  system_audit_logs, activity_logs, user_access_grants, lead_links, lead_services, assignments,
  process_instances, leads, field_visibility, field_journey_settings, fields, statuses,
  journey_services, services, role_journey_access, journeys, role_permissions, users,
  designations, departments, roles, organizations CASCADE;
DROP FUNCTION IF EXISTS reject_append_only_change();
DROP FUNCTION IF EXISTS reject_configuration_delete();
DROP FUNCTION IF EXISTS block_in_use_status_deactivation();
DROP TYPE IF EXISTS "BehaviorType", "OutcomeType", "FieldAccessLevel", "DataScope";
