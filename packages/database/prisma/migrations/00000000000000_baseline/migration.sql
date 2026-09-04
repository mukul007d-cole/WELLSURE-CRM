-- Falcon CRM squashed baseline (Phase 17, Part 1).
--
-- This one migration replaces the nine that preceded it
-- (`00000000000000_initial` .. `00000000000008_configuration_purge`). It
-- describes the complete end state of the schema directly rather than
-- accumulating nine historical deltas. The reasoning behind each historical
-- change is not lost: it lives in `docs/planning/` and in ADR-0001..0017,
-- none of which this squash touches.
--
-- Squashing was done before any environment existed. Once a real database is
-- tracking migrations by name in `_prisma_migrations`, replacing the files
-- breaks `prisma migrate` against it — so this was the last free moment.
--
-- ## Why this file is hand-written and not `prisma migrate diff` output
--
-- A from-empty `prisma migrate diff --to-schema` was generated and compared
-- against the database the nine migrations actually produce. It is not a safe
-- substitute: Prisma's schema language cannot express most of what this
-- schema's correctness rests on, so the generated script silently omits it.
-- Measured against the real catalog, a Prisma-only baseline would drop:
--
--   * 31 CHECK constraints — every version/count/date-ordering guard, and the
--     shape constraints on campaigns, status routing rules and import rows;
--   * 8 triggers and 3 trigger functions — the no-hard-delete, append-only and
--     safe-status-deactivation guarantees `AGENTS.md` calls non-negotiable and
--     deliberately places in the database rather than in application code;
--   * the `pgcrypto` extension and every `gen_random_uuid()` / `now()` column
--     default that depends on it — raw-SQL inserts (bulk import, integration
--     tests) supply no id and rely on those defaults;
--   * 9 indexes Prisma has no syntax for: the GIN index on `leads.field_values`,
--     the `lower(email)` expression index, and four partial unique indexes that
--     are load-bearing uniqueness rules, not optimizations.
--
-- The GIN index specifically: `leads_field_values_gin_idx` has been present in
-- the migration history since `00000000000000_initial` and is asserted by name
-- in `apps/api/src/__tests__/phase13b.postgres.integration.test.ts` (1.1ms with
-- it, 116.5ms without). It has never been declared in `schema.prisma`, which is
-- the whole reason an incremental `prisma migrate diff` proposed dropping it
-- with no recreation — Prisma was describing its own model, which does not know
-- the index exists. It is preserved verbatim below.
--
-- The residual, expected divergence between this file and `schema.prisma` is
-- documented in `docs/data-model/prisma-translation-notes.md`. `schema.prisma`
-- stays the source of truth for what the Prisma Client can see; this file stays
-- the source of truth for what the database actually enforces.
--
-- Rollback: `rollback.sql` in this directory. It is a full teardown, not an
-- incremental one — read its header before running it.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "DataScope" AS ENUM ('SELF', 'TEAM', 'DEPARTMENT', 'ORGANIZATION');
CREATE TYPE "FieldAccessLevel" AS ENUM ('VIEW', 'EDIT');
CREATE TYPE "OutcomeType" AS ENUM ('open', 'closed_won', 'closed_lost');
CREATE TYPE "BehaviorType" AS ENUM ('default', 'call_later', 'follow_up', 'archived');

-- ---------------------------------------------------------------------------
-- Organization, identity and the permission axes
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, key text NOT NULL, name text NOT NULL,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, is_system_default boolean NOT NULL DEFAULT false,
  created_by uuid, updated_by uuid, created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CHECK (version >= 1)
);
CREATE INDEX roles_organization_active_idx ON roles (organization_id, active);

CREATE TABLE departments (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, key text NOT NULL, name text NOT NULL,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, created_by uuid, updated_by uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT, CHECK (version >= 1)
);
CREATE INDEX departments_organization_active_idx ON departments (organization_id, active);

CREATE TABLE designations (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, key text NOT NULL, name text NOT NULL,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, created_by uuid, updated_by uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT, CHECK (version >= 1)
);
CREATE INDEX designations_organization_active_idx ON designations (organization_id, active);

CREATE TABLE users (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, name text NOT NULL, email text NOT NULL,
  role_id uuid NOT NULL, department_id uuid, designation_id uuid, manager_id uuid, active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  -- Custom session auth (ADR-0007). Nullable: a user provisioned by an admin has
  -- no password until they complete the setup-token flow.
  password_hash text,
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, email),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, designation_id) REFERENCES designations(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, manager_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (manager_id IS NULL OR manager_id <> id)
);
CREATE INDEX users_manager_idx ON users (organization_id, manager_id);
CREATE INDEX users_department_idx ON users (organization_id, department_id);
-- Referenced by the team_members foreign key. `department_id` is nullable, so
-- rows with no Department are all distinct under this index; (organization_id,
-- id) is already the primary key, so this adds a lookup path and a referenceable
-- key, never a new restriction. See ADR-0014.
CREATE UNIQUE INDEX users_org_department_id_uq ON users (organization_id, department_id, id);

-- Deferred until `users` exists: these three tables are created before it.
ALTER TABLE roles ADD FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE roles ADD FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE departments ADD FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE departments ADD FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE designations ADD FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE designations ADD FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT;

CREATE TABLE role_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, role_id uuid NOT NULL,
  module text NOT NULL, action text NOT NULL, scope "DataScope" NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, role_id, module, action),
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX role_permissions_lookup_idx ON role_permissions (organization_id, module, action);

-- ---------------------------------------------------------------------------
-- Journeys, services, statuses and fields — all configuration, never constants
-- ---------------------------------------------------------------------------

CREATE TABLE journeys (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, key text NOT NULL, name text NOT NULL,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, is_default boolean NOT NULL DEFAULT false,
  created_by uuid, updated_by uuid, created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (version >= 1)
);
CREATE INDEX journeys_organization_active_idx ON journeys (organization_id, active);

CREATE TABLE role_journey_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, role_id uuid NOT NULL, journey_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(), PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, role_id, journey_id),
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journey_id) REFERENCES journeys(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX role_journey_access_lookup_idx ON role_journey_access (organization_id, journey_id, role_id);

CREATE TABLE services (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, key text NOT NULL, name text NOT NULL,
  description text, active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, created_by uuid, updated_by uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (version >= 1)
);

CREATE TABLE journey_services (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, journey_id uuid NOT NULL, service_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true, created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, journey_id, service_id),
  FOREIGN KEY (organization_id, journey_id) REFERENCES journeys(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, service_id) REFERENCES services(organization_id, id) ON DELETE RESTRICT
);

-- `auto_reassign_to_role_id` is deliberately absent. It shipped in the initial
-- migration, never gained a reader, writer, seed or UI, and was retired by
-- phase 14b in favour of `status_routing_rules` below. See ADR-0015.
CREATE TABLE statuses (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, journey_id uuid NOT NULL, key text NOT NULL, name text NOT NULL,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, is_default_on_create boolean NOT NULL DEFAULT false,
  outcome_type "OutcomeType" NOT NULL, behavior_type "BehaviorType" NOT NULL, sort_order integer NOT NULL,
  created_by uuid, updated_by uuid, created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, journey_id, key), UNIQUE (organization_id, journey_id, id),
  FOREIGN KEY (organization_id, journey_id) REFERENCES journeys(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (version >= 1)
);
CREATE INDEX statuses_journey_active_sort_idx ON statuses (organization_id, journey_id, active, sort_order);

CREATE TABLE fields (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, key text NOT NULL, name text NOT NULL,
  field_type text NOT NULL, validation_rule jsonb, section text, edit_mode text NOT NULL, source text NOT NULL,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, created_by uuid, updated_by uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (version >= 1)
);
CREATE INDEX fields_organization_active_idx ON fields (organization_id, active);

CREATE TABLE field_journey_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, field_id uuid NOT NULL, journey_id uuid NOT NULL,
  requirement text NOT NULL, required_from_status_id uuid, active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, field_id, journey_id),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journey_id) REFERENCES journeys(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journey_id, required_from_status_id) REFERENCES statuses(organization_id, journey_id, id) ON DELETE RESTRICT
);

CREATE TABLE field_visibility (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, field_id uuid NOT NULL, role_id uuid NOT NULL,
  access_level "FieldAccessLevel" NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, field_id, role_id),
  FOREIGN KEY (organization_id, field_id) REFERENCES fields(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX field_visibility_role_idx ON field_visibility (organization_id, role_id, access_level);

-- ---------------------------------------------------------------------------
-- Leads and their journey membership
-- ---------------------------------------------------------------------------

CREATE TABLE leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, name text NOT NULL, phone text, email text,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  -- Leads are never hard-deleted; deactivation is the only removal. See AGENTS.md.
  active boolean NOT NULL DEFAULT true, deactivated_at timestamptz(6), deactivated_by_user_id uuid,
  PRIMARY KEY (organization_id, id), FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT leads_deactivated_by_fkey
    FOREIGN KEY (organization_id, deactivated_by_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX leads_phone_idx ON leads (organization_id, phone);
CREATE INDEX leads_email_idx ON leads (organization_id, email);
CREATE INDEX leads_updated_idx ON leads (organization_id, updated_at);
CREATE INDEX leads_organization_active_updated_idx ON leads (organization_id, active, updated_at DESC);
-- Containment filtering on the configurable field bag. `schema.prisma` has no
-- syntax for a GIN index, so this exists only here — and
-- phase13b.postgres.integration.test.ts asserts the planner picks it by name
-- (1.1ms with, 116.5ms without). Do not remove it because a Prisma diff says so.
CREATE INDEX leads_field_values_gin_idx ON leads USING GIN (field_values);
-- Case-insensitive duplicate detection for bulk import (ADR-0016).
-- `leads_email_idx` is on the raw column and cannot serve `lower(email) = $1`.
CREATE INDEX leads_email_lower_idx ON leads (organization_id, lower(email));

CREATE TABLE process_instances (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id uuid NOT NULL, journey_id uuid NOT NULL,
  current_status_id uuid NOT NULL, is_primary boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journey_id) REFERENCES journeys(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journey_id, current_status_id) REFERENCES statuses(organization_id, journey_id, id) ON DELETE RESTRICT
);
-- Partial uniqueness: a lead joins a journey once while active, and has exactly
-- one primary membership. Both are rules, not optimizations, and neither is
-- expressible in `schema.prisma`.
CREATE UNIQUE INDEX process_instances_active_membership_uq ON process_instances (organization_id, lead_id, journey_id) WHERE active;
CREATE UNIQUE INDEX process_instances_active_primary_uq ON process_instances (organization_id, lead_id) WHERE active AND is_primary;
CREATE INDEX process_instances_status_idx ON process_instances (organization_id, journey_id, current_status_id);
CREATE INDEX process_instances_lead_idx ON process_instances (organization_id, lead_id);

CREATE TABLE assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, process_instance_id uuid NOT NULL,
  assignment_type text NOT NULL, user_id uuid NOT NULL, assigned_at timestamptz(6) NOT NULL DEFAULT now(), is_current boolean NOT NULL DEFAULT true,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, process_instance_id) REFERENCES process_instances(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
-- One current holder per assignment type. SELF data scope resolves through
-- `is_current`, so this partial unique index is the visibility rule itself.
CREATE UNIQUE INDEX assignments_current_type_uq ON assignments (organization_id, process_instance_id, assignment_type) WHERE is_current;
CREATE INDEX assignments_current_user_idx ON assignments (organization_id, user_id, is_current);

CREATE TABLE lead_services (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, process_instance_id uuid NOT NULL, service_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true, enrolled_at timestamptz(6) NOT NULL DEFAULT now(), ended_at timestamptz(6),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, process_instance_id, service_id),
  FOREIGN KEY (organization_id, process_instance_id) REFERENCES process_instances(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, service_id) REFERENCES services(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE lead_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id_a uuid NOT NULL, lead_id_b uuid NOT NULL,
  relation_type text NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(), PRIMARY KEY (organization_id, id),
  UNIQUE (organization_id, lead_id_a, lead_id_b, relation_type),
  FOREIGN KEY (organization_id, lead_id_a) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lead_id_b) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  -- Ordered pair, so one relationship cannot be stored twice under two spellings.
  CHECK (lead_id_a <> lead_id_b), CHECK (lead_id_a < lead_id_b)
);

-- ---------------------------------------------------------------------------
-- Sharing
-- ---------------------------------------------------------------------------

CREATE TABLE user_access_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, user_id uuid NOT NULL, lead_id uuid NOT NULL,
  granted_by_user_id uuid NOT NULL, expires_at timestamptz(6), revoked_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  actions text[] NOT NULL DEFAULT ARRAY['view']::text[],
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, granted_by_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT user_access_grants_actions_check
    CHECK (cardinality(actions) > 0 AND actions <@ ARRAY['view','edit','comment']::text[])
);
CREATE INDEX user_access_grants_lookup_idx ON user_access_grants (organization_id, user_id, lead_id, revoked_at, expires_at);
-- One live share per (user, lead); revoking one frees the pair for a new grant.
CREATE UNIQUE INDEX user_access_grants_one_active_uq
  ON user_access_grants (organization_id, user_id, lead_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Audit trails — append-only, enforced by trigger
-- ---------------------------------------------------------------------------

CREATE TABLE activity_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id uuid NOT NULL, process_instance_id uuid,
  actor_user_id uuid, timestamp timestamptz(6) NOT NULL DEFAULT now(), action_type text NOT NULL, source text NOT NULL,
  comment_text text, recording_reference_url text, old_value jsonb, new_value jsonb, PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, process_instance_id) REFERENCES process_instances(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX activity_logs_timeline_idx ON activity_logs (organization_id, lead_id, timestamp DESC);

CREATE TABLE system_audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, actor_user_id uuid,
  timestamp timestamptz(6) NOT NULL DEFAULT now(), entity_type text NOT NULL, entity_id uuid NOT NULL,
  action text NOT NULL, old_value jsonb, new_value jsonb, PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX system_audit_logs_entity_idx ON system_audit_logs (organization_id, entity_type, entity_id, timestamp DESC);

CREATE OR REPLACE FUNCTION reject_append_only_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; write a compensating row instead', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER activity_logs_append_only BEFORE UPDATE OR DELETE ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER system_audit_logs_append_only BEFORE UPDATE OR DELETE ON system_audit_logs FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

-- ---------------------------------------------------------------------------
-- Tasks, notification rules and notifications
-- ---------------------------------------------------------------------------

CREATE TABLE tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id uuid NOT NULL, process_instance_id uuid,
  assigned_to_user_id uuid NOT NULL, due_date timestamptz(6) NOT NULL, type text NOT NULL, status text NOT NULL,
  created_from_status_id uuid, source text NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, process_instance_id) REFERENCES process_instances(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, assigned_to_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_from_status_id) REFERENCES statuses(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX tasks_assignee_due_idx ON tasks (organization_id, assigned_to_user_id, status, due_date);

CREATE TABLE notification_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  key text NOT NULL, name text NOT NULL, trigger_type text NOT NULL, scope jsonb,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL, updated_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (trigger_type IN ('field_edited','status_changed','lead_reassigned','shared_lead_modified_by_non_owner','lead_deactivated'))
);
CREATE INDEX notification_rules_trigger_active_idx ON notification_rules (organization_id, trigger_type, active);

CREATE TABLE notification_rule_recipients (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  rule_id uuid NOT NULL, resolver_type text NOT NULL, parameters jsonb NOT NULL DEFAULT '{}', sort_order integer NOT NULL,
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, rule_id, sort_order),
  FOREIGN KEY (organization_id, rule_id) REFERENCES notification_rules(organization_id, id) ON DELETE CASCADE,
  CHECK (resolver_type IN ('assignment_holder','assignment_holder_manager','previous_assignment_holder','share_creator','active_shared_users_except_actor','feature_permission_holders'))
);

CREATE TABLE notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, user_id uuid NOT NULL, type text NOT NULL,
  reference_lead_id uuid, message text NOT NULL, read boolean NOT NULL DEFAULT false,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  read_at timestamptz(6), notification_rule_id uuid, activity_log_id uuid,
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reference_lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT notifications_rule_fkey
    FOREIGN KEY (organization_id, notification_rule_id) REFERENCES notification_rules(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT notifications_activity_fkey
    FOREIGN KEY (organization_id, activity_log_id) REFERENCES activity_logs(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX notifications_user_unread_idx ON notifications (organization_id, user_id, read, created_at);
-- Rule-generated deliveries are idempotent per (rule, activity, recipient).
-- Partial, because a notification written outside the rule engine carries
-- neither id and must not collide with anything.
CREATE UNIQUE INDEX notifications_delivery_uq
  ON notifications (organization_id, notification_rule_id, activity_log_id, user_id)
  WHERE notification_rule_id IS NOT NULL AND activity_log_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Attachments, imports, finance and settings
-- ---------------------------------------------------------------------------

CREATE TABLE attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id uuid NOT NULL, field_id uuid,
  s3_key text NOT NULL,
  uploaded_by uuid NOT NULL, uploaded_at timestamptz(6) NOT NULL DEFAULT now(), active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  -- Display metadata: a stored document had no name to show, no content type to
  -- serve it back with, and no size to display until phase 12.
  file_name text, mime_type text, size_bytes bigint,
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, s3_key, version),
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, uploaded_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (version >= 1),
  CONSTRAINT attachments_size_bytes_non_negative CHECK (size_bytes IS NULL OR size_bytes >= 0)
);
CREATE INDEX attachments_lead_recent_idx ON attachments (organization_id, lead_id, uploaded_at DESC);

CREATE TABLE import_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, source text NOT NULL, file_key text NOT NULL,
  status text NOT NULL, mapping_json jsonb NOT NULL, created_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  file_name text NOT NULL DEFAULT '',
  -- Reconciliation: source = created + skipped + rejected
  -- (`docs/migration/cronberry-mapping.md` §4).
  row_count integer NOT NULL DEFAULT 0, created_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0, rejected_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, id), FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT import_jobs_counts_check CHECK (
    row_count >= 0 AND created_count >= 0 AND skipped_count >= 0 AND rejected_count >= 0
  )
);
CREATE INDEX import_jobs_status_idx ON import_jobs (organization_id, status, created_at);
CREATE INDEX import_jobs_recent_idx ON import_jobs (organization_id, created_at DESC);
COMMENT ON COLUMN import_jobs.file_key IS 'sha256:<hex> of the uploaded bytes. Not an object-storage key — see ADR-0016.';

-- Written on commit only. A preview runs the identical code inside a
-- transaction that is deliberately rolled back, so its rows never land here.
CREATE TABLE import_job_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  import_job_id uuid NOT NULL,
  -- The record's position in the file, counting the header as 1.
  row_number integer NOT NULL,
  outcome text NOT NULL,
  lead_id uuid,
  process_instance_id uuid,
  matched_lead_id uuid,
  -- A rejection's error code and message, generated from configuration ids.
  -- Never a cell from the source file, so an excluded source column cannot
  -- reach durable storage through an error payload.
  reason text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, import_job_id) REFERENCES import_jobs(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, matched_lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, process_instance_id) REFERENCES process_instances(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT import_job_rows_outcome_check CHECK (outcome IN ('created', 'skipped_duplicate', 'rejected')),
  -- The outcome determines which references are meaningful, so a row can never
  -- claim to have created a lead without naming it.
  CONSTRAINT import_job_rows_shape_check CHECK (
    (outcome = 'created' AND lead_id IS NOT NULL AND matched_lead_id IS NULL AND reason IS NULL)
    OR (outcome = 'skipped_duplicate' AND lead_id IS NULL AND process_instance_id IS NULL)
    OR (outcome = 'rejected' AND lead_id IS NULL AND process_instance_id IS NULL AND matched_lead_id IS NULL)
  )
);
CREATE UNIQUE INDEX import_job_rows_uq ON import_job_rows (organization_id, import_job_id, row_number);
CREATE INDEX import_job_rows_lead_idx ON import_job_rows (organization_id, lead_id);

CREATE TABLE invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id uuid NOT NULL, invoice_number text NOT NULL,
  customer_name text NOT NULL, issue_date date, total_amount decimal(19,4) NOT NULL, due_amount decimal(19,4) NOT NULL,
  due_date date, status text NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, invoice_number),
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX invoices_lead_status_idx ON invoices (organization_id, lead_id, status);

CREATE TABLE payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, invoice_id uuid NOT NULL, lead_id uuid NOT NULL,
  amount_paid decimal(19,4) NOT NULL, payment_date date NOT NULL, payment_method text, reference_number text,
  created_at timestamptz(6) NOT NULL DEFAULT now(), PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoices(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX payments_invoice_date_idx ON payments (organization_id, invoice_id, payment_date);

CREATE TABLE settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, key text NOT NULL, value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1, updated_by uuid, updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (version >= 1)
);

-- ---------------------------------------------------------------------------
-- Configuration delete guards and safe status deactivation
-- ---------------------------------------------------------------------------

-- `AGENTS.md`: configuration is deactivated/versioned, never deleted. That rule
-- lives here rather than in application code so it holds from psql and from a
-- future migration too, not only from the API.
--
-- ADR-0017 carves out exactly one exception — a purge that has already proven
-- the entity is inactive and has no blocking dependents. `PurgeService` issues
-- `SET LOCAL falcon.purge = 'on'` inside its transaction after taking the row
-- lock and passing its checks. Every other path still raises, because
-- `current_setting` returns NULL there and NULL IS DISTINCT FROM 'on'. The
-- escape hatch cannot be left switched on: `SET LOCAL` dies with its
-- transaction, and it is greppable — one `SET LOCAL` in one service.
CREATE OR REPLACE FUNCTION reject_configuration_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('falcon.purge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '% configuration is deactivated/versioned, never deleted', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER roles_no_delete BEFORE DELETE ON roles FOR EACH ROW EXECUTE FUNCTION reject_configuration_delete();
CREATE TRIGGER journeys_no_delete BEFORE DELETE ON journeys FOR EACH ROW EXECUTE FUNCTION reject_configuration_delete();
CREATE TRIGGER statuses_no_delete BEFORE DELETE ON statuses FOR EACH ROW EXECUTE FUNCTION reject_configuration_delete();
CREATE TRIGGER fields_no_delete BEFORE DELETE ON fields FOR EACH ROW EXECUTE FUNCTION reject_configuration_delete();
CREATE TRIGGER services_no_delete BEFORE DELETE ON services FOR EACH ROW EXECUTE FUNCTION reject_configuration_delete();

CREATE OR REPLACE FUNCTION block_in_use_status_deactivation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.active AND NOT NEW.active AND EXISTS (
    SELECT 1 FROM process_instances
    WHERE organization_id = OLD.organization_id AND current_status_id = OLD.id AND active
  ) THEN
    RAISE EXCEPTION 'status has active process instances; reassign them before deactivation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER statuses_safe_deactivation BEFORE UPDATE OF active ON statuses
  FOR EACH ROW EXECUTE FUNCTION block_in_use_status_deactivation();

-- ---------------------------------------------------------------------------
-- Custom session auth (ADR-0007)
-- ---------------------------------------------------------------------------

CREATE TABLE sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, user_id uuid NOT NULL,
  token_hash text NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(), expires_at timestamptz(6) NOT NULL,
  revoked_at timestamptz(6), last_seen_at timestamptz(6) NOT NULL DEFAULT now(), ip_address text, user_agent text,
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, token_hash),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at), CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX sessions_user_active_idx ON sessions (organization_id, user_id, revoked_at, expires_at);
-- Every authenticated request resolves a session by exactly this shape.
CREATE INDEX sessions_token_active_idx ON sessions (organization_id, token_hash, revoked_at, expires_at);

CREATE TABLE password_reset_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, user_id uuid NOT NULL,
  token_hash text NOT NULL, created_at timestamptz(6) NOT NULL DEFAULT now(), expires_at timestamptz(6) NOT NULL,
  used_at timestamptz(6), ip_address text, user_agent text,
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, token_hash),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at), CHECK (used_at IS NULL OR used_at >= created_at)
);
CREATE INDEX password_reset_tokens_user_lookup_idx ON password_reset_tokens (organization_id, user_id, used_at, expires_at);

CREATE TABLE failed_login_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, normalized_email text NOT NULL,
  failed_count integer NOT NULL DEFAULT 0, window_started_at timestamptz(6) NOT NULL,
  locked_until timestamptz(6), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, normalized_email),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CHECK (failed_count >= 0)
);
CREATE INDEX failed_login_attempts_locked_idx ON failed_login_attempts (organization_id, locked_until);

-- ---------------------------------------------------------------------------
-- Email marketing campaigns (ADR-0013)
-- ---------------------------------------------------------------------------

-- `body_document` stores a closed-vocabulary JSON document rather than HTML.
-- The server renders and escapes the markup at send time, so no client-supplied
-- markup is ever stored or re-emitted.
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
-- Trigger evaluation runs on every status change and looks up exactly this.
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
CREATE INDEX campaign_sends_pending_idx ON campaign_sends (organization_id, status, created_at);

-- ---------------------------------------------------------------------------
-- Teams within Departments (ADR-0014)
-- ---------------------------------------------------------------------------

-- A Team is deliberately NOT the `TEAM` permission data scope. That scope
-- resolves through `users.manager_id` and nothing here is consulted by the
-- permission engine.
CREATE TABLE teams (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
-- Scoped to the parent Department, mirroring statuses' key scoping to a journey
-- rather than roles' organization-wide key.
CREATE UNIQUE INDEX teams_key_uq ON teams (organization_id, department_id, key);
-- Referenced by the team_members foreign key: it is what ties a membership row's
-- department_id to its team's department_id.
CREATE UNIQUE INDEX teams_department_id_uq ON teams (organization_id, department_id, id);
CREATE INDEX teams_department_idx ON teams (organization_id, department_id, active);

CREATE TABLE team_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  team_id uuid NOT NULL,
  department_id uuid NOT NULL,
  user_id uuid NOT NULL,
  is_leader boolean NOT NULL DEFAULT false,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  -- These two together are the invariant: the row's department must equal the
  -- team's department AND the member's department. Neither FK alone says that.
  -- A stale membership is not a tidiness problem — routing sends that
  -- Department's leads to someone who has left it.
  FOREIGN KEY (organization_id, department_id, team_id) REFERENCES teams(organization_id, department_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, department_id, user_id) REFERENCES users(organization_id, department_id, id) ON DELETE RESTRICT
);
-- A user appears at most once in a team; `is_leader` is a property of that one
-- membership, never a second row.
CREATE UNIQUE INDEX team_members_user_uq ON team_members (organization_id, team_id, user_id);
CREATE INDEX team_members_user_idx ON team_members (organization_id, user_id);
CREATE INDEX team_members_leader_idx ON team_members (organization_id, team_id, is_leader);

-- ---------------------------------------------------------------------------
-- Per-status assignment routing (ADR-0015)
-- ---------------------------------------------------------------------------

CREATE TABLE status_routing_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  status_id uuid NOT NULL,
  assignment_type text NOT NULL,
  algorithm text NOT NULL,
  pool_type text NOT NULL,
  team_id uuid,
  -- Durable round-robin state: the user this rule assigned last, not an index
  -- into the pool. An index silently means someone else the moment a member
  -- joins or leaves, which for a Team pool is routine.
  cursor_user_id uuid,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  -- Three columns, not two: this is what stops a rule naming a Status that
  -- belongs to a different Journey than the rule claims.
  FOREIGN KEY (organization_id, journey_id, status_id) REFERENCES statuses(organization_id, journey_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, team_id) REFERENCES teams(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, cursor_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT status_routing_rules_algorithm_check CHECK (algorithm IN ('round_robin', 'least_loaded')),
  -- A Team pool reads `team_members`; a user pool reads
  -- `status_routing_rule_members`. Carrying both would leave the real pool
  -- ambiguous, so the shape is constrained rather than merely conventional.
  CONSTRAINT status_routing_rules_pool_check CHECK (
    (pool_type = 'team' AND team_id IS NOT NULL)
    OR (pool_type = 'users' AND team_id IS NULL)
  )
);
-- One rule per Status, ever. A Status with no row is simply unrouted; clearing a
-- rule deactivates it so its cursor and audit trail survive.
CREATE UNIQUE INDEX status_routing_rules_status_uq ON status_routing_rules (organization_id, status_id);
CREATE INDEX status_routing_rules_lookup_idx ON status_routing_rules (organization_id, status_id, active);

CREATE TABLE status_routing_rule_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, rule_id) REFERENCES status_routing_rules(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX status_routing_rule_members_uq ON status_routing_rule_members (organization_id, rule_id, user_id);

-- Per-(Status, Role) routing grants, allow-list semantics: absence denies.
-- The same layering `field_visibility` uses — the effective decision is the
-- `lead_routing` module action AND a row here. Writing these rows is gated on
-- `roles_permissions:edit`, never on `lead_routing:configure`: a routing
-- administrator who cannot edit permissions must not be able to grant routing
-- rights, including to their own role.
CREATE TABLE status_routing_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  status_id uuid NOT NULL,
  role_id uuid NOT NULL,
  action text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, status_id) REFERENCES statuses(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT status_routing_permissions_action_check CHECK (action IN ('view', 'configure', 'operate'))
);
CREATE UNIQUE INDEX status_routing_permissions_uq ON status_routing_permissions (organization_id, status_id, role_id, action);
CREATE INDEX status_routing_permissions_role_idx ON status_routing_permissions (organization_id, role_id, action);
