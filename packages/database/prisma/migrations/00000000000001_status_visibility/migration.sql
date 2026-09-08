-- Phase 19 — status-scoped role visibility.
--
-- Which Roles may see a lead while it sits in this Status. Allow-list shape
-- copied from `status_routing_permissions`/`field_visibility`, but the
-- *default* deliberately diverges: a Status with zero rows here is
-- unrestricted, matching `status_routing_rules`' own "no rule means
-- unrouted" default rather than `field_visibility`'s "no row means hidden".
-- Every Status already exists in every organization today, so "absence
-- denies" would deny every lead, in every Status, everywhere, the moment
-- this table exists — see docs/planning/phase-19-status-scoped-role-visibility.md.
--
-- Editing these rows is gated on `roles_permissions:edit`, never on
-- `journeys_statuses:*`, matching `field_visibility` and
-- `status_routing_permissions`'s identical self-escalation rule.
--
-- Purely additive: no existing table is altered. Safe to apply ahead of the
-- application code that reads it — an empty table imposes no restriction,
-- so there is no window where behaviour changes between the migration
-- landing and the code that consults it deploying.
CREATE TABLE status_visibility (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  status_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, status_id) REFERENCES statuses(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX status_visibility_uq ON status_visibility (organization_id, status_id, role_id);
CREATE INDEX status_visibility_role_idx ON status_visibility (organization_id, role_id);
