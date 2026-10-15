-- Phase 24 — engine rules needed to run Wellsure on its real configuration.
-- See docs/planning/phase-24-cronberry-cutover.md, ADR-0025, ADR-0026, ADR-0027.
--
-- Additive throughout: every new column is nullable or defaulted to the
-- previous behaviour, every new table is empty, so the running application is
-- unaffected until something writes to them. Safe to apply before the code
-- that reads them (docs/operations/deployment.md, "Run a migration").

-- ADR-0025 — a fifth data scope, resolved through role reporting lines.
-- ADD VALUE is permitted inside a transaction on PostgreSQL 12+ as long as the
-- new value is not used in that same transaction; nothing below uses it.
ALTER TYPE "DataScope" ADD VALUE IF NOT EXISTS 'REPORTING_ROLES';

CREATE TABLE role_reporting_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  role_id uuid NOT NULL,
  reports_to_role_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reports_to_role_id) REFERENCES roles(organization_id, id) ON DELETE RESTRICT,
  CHECK (role_id <> reports_to_role_id)
);
CREATE UNIQUE INDEX role_reporting_lines_uq ON role_reporting_lines (organization_id, role_id, reports_to_role_id);
CREATE INDEX role_reporting_lines_parent_idx ON role_reporting_lines (organization_id, reports_to_role_id);

-- ADR-0026 — journey-limited actions. Empty = every journey the role can access,
-- which is what every existing row means today. (Empty rather than NULL:
-- Prisma scalar lists cannot be optional.)
ALTER TABLE role_permissions ADD COLUMN journey_ids uuid[] NOT NULL DEFAULT '{}';

-- ADR-0026 — journey members.
ALTER TABLE journeys ADD COLUMN restrict_to_members boolean NOT NULL DEFAULT false;
CREATE TABLE journey_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, journey_id) REFERENCES journeys(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX journey_members_uq ON journey_members (organization_id, journey_id, user_id);
CREATE INDEX journey_members_user_idx ON journey_members (organization_id, user_id);

-- ADR-0026 — status rules.
ALTER TABLE statuses ADD COLUMN color text;
ALTER TABLE statuses ADD COLUMN reason_options text[] NOT NULL DEFAULT '{}';
ALTER TABLE process_instances ADD COLUMN status_reason text;

CREATE TABLE status_allowed_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  status_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, status_id) REFERENCES statuses(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX status_allowed_roles_uq ON status_allowed_roles (organization_id, status_id, role_id);
CREATE INDEX status_allowed_roles_role_idx ON status_allowed_roles (organization_id, role_id);

CREATE TABLE status_required_fields (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  status_id uuid NOT NULL,
  field_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, status_id) REFERENCES statuses(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, field_id) REFERENCES fields(organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX status_required_fields_uq ON status_required_fields (organization_id, status_id, field_id);
CREATE INDEX status_required_fields_field_idx ON status_required_fields (organization_id, field_id);

-- ADR-0026 — "mandatory for these roles" on create. Empty = every role.
ALTER TABLE field_journey_settings ADD COLUMN required_role_ids uuid[] NOT NULL DEFAULT '{}';

-- ADR-0027 — a source-prefixed identifier of the record a process instance was
-- migrated from ('cronberry:<audience_id>'). Matched first on a re-run, which
-- is what makes the cutover idempotent.
ALTER TABLE process_instances ADD COLUMN external_ref text;
CREATE UNIQUE INDEX process_instances_external_ref_uq
  ON process_instances (organization_id, external_ref) WHERE external_ref IS NOT NULL;

-- ADR-0026 — follow-ups use the long-dormant tasks table.
ALTER TABLE tasks ADD COLUMN note text;
ALTER TABLE tasks ADD COLUMN completed_at timestamptz(6);
ALTER TABLE tasks ADD COLUMN completed_by_user_id uuid;
ALTER TABLE tasks ADD CONSTRAINT tasks_completed_by_fk
  FOREIGN KEY (organization_id, completed_by_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('open', 'done', 'rescheduled', 'cancelled'));
CREATE INDEX tasks_process_open_idx ON tasks (organization_id, process_instance_id, status);
