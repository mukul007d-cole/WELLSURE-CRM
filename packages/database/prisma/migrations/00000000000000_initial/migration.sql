CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "DataScope" AS ENUM ('SELF', 'TEAM', 'DEPARTMENT', 'ORGANIZATION');
CREATE TYPE "FieldAccessLevel" AS ENUM ('VIEW', 'EDIT');
CREATE TYPE "OutcomeType" AS ENUM ('open', 'closed_won', 'closed_lost');
CREATE TYPE "BehaviorType" AS ENUM ('default', 'call_later', 'follow_up', 'archived');

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

CREATE TABLE statuses (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, journey_id uuid NOT NULL, key text NOT NULL, name text NOT NULL,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, is_default_on_create boolean NOT NULL DEFAULT false,
  outcome_type "OutcomeType" NOT NULL, behavior_type "BehaviorType" NOT NULL, auto_reassign_to_role_id uuid, sort_order integer NOT NULL,
  created_by uuid, updated_by uuid, created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), UNIQUE (organization_id, journey_id, key), UNIQUE (organization_id, journey_id, id),
  FOREIGN KEY (organization_id, journey_id) REFERENCES journeys(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, auto_reassign_to_role_id) REFERENCES roles(organization_id, id) ON DELETE RESTRICT,
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

CREATE TABLE leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, name text NOT NULL, phone text, email text,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT
);
CREATE INDEX leads_phone_idx ON leads (organization_id, phone);
CREATE INDEX leads_email_idx ON leads (organization_id, email);
CREATE INDEX leads_updated_idx ON leads (organization_id, updated_at);
CREATE INDEX leads_field_values_gin_idx ON leads USING GIN (field_values);

CREATE TABLE process_instances (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id uuid NOT NULL, journey_id uuid NOT NULL,
  current_status_id uuid NOT NULL, is_primary boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journey_id) REFERENCES journeys(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, journey_id, current_status_id) REFERENCES statuses(organization_id, journey_id, id) ON DELETE RESTRICT
);
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
  CHECK (lead_id_a <> lead_id_b), CHECK (lead_id_a < lead_id_b)
);

CREATE TABLE user_access_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, user_id uuid NOT NULL, lead_id uuid NOT NULL,
  granted_by_user_id uuid NOT NULL, expires_at timestamptz(6), revoked_at timestamptz(6), created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, granted_by_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX user_access_grants_lookup_idx ON user_access_grants (organization_id, user_id, lead_id, revoked_at, expires_at);

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

CREATE TABLE notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, user_id uuid NOT NULL, type text NOT NULL,
  reference_lead_id uuid, message text NOT NULL, read boolean NOT NULL DEFAULT false, created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reference_lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX notifications_user_unread_idx ON notifications (organization_id, user_id, read, created_at);

CREATE TABLE attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, lead_id uuid NOT NULL, field_id uuid,
  s3_key text NOT NULL, uploaded_by uuid NOT NULL, uploaded_at timestamptz(6) NOT NULL DEFAULT now(), active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, PRIMARY KEY (organization_id, id), UNIQUE (organization_id, s3_key, version),
  FOREIGN KEY (organization_id, lead_id) REFERENCES leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, uploaded_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK (version >= 1)
);

CREATE TABLE import_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, source text NOT NULL, file_key text NOT NULL,
  status text NOT NULL, mapping_json jsonb NOT NULL, created_by uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id), FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX import_jobs_status_idx ON import_jobs (organization_id, status, created_at);

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

CREATE OR REPLACE FUNCTION reject_configuration_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% configuration is deactivated/versioned, never deleted', TG_TABLE_NAME;
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
