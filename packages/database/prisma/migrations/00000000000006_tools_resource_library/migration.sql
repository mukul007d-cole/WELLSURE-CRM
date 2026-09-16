-- Phase 22 — Tools resource library.
--
-- A Resource is a link or an uploaded file, plus optional usage instructions
-- (a StructuredDocument, `@falcon/validation`'s `document.ts`), gated per-Role
-- by `resource_visibility` — the reverse allow-list shape `field_visibility`
-- established (Phase 13a): full-replace, gated on `roles_permissions:edit`,
-- never on `tools:*` (the same self-escalation rule `field_visibility` and
-- `status_routing_permissions` already use).
--
-- The *default* deliberately matches `field_visibility`'s "absence means
-- hidden", not the (superseded) `status_visibility`'s "absence means
-- unrestricted": a Resource is a brand-new entity type with zero rows in any
-- organization on the day this ships, exactly Field's situation at the
-- moment a new Field is created — not Status's, where the default had to
-- flip specifically because every Status (and the leads already sitting in
-- it) predated the feature and was already visible. See
-- docs/planning/phase-22-tools-resource-library.md.
--
-- No accessLevel column on resource_visibility, unlike field_visibility:
-- membership only (a Role may access the Resource, or the row is absent),
-- matching status_visibility's original shape — there is no view/download
-- distinction to encode.
--
-- One row per Resource, not one row per file version: file metadata is
-- overwritten in place when an admin replaces a file, matching
-- `attachments.version`'s own accepted, never-completed versioning story
-- (ADR-0012) rather than building it here. The row itself is only ever
-- deactivated, never hard-deleted.
--
-- Purely additive: no existing table is altered.
CREATE TYPE "ResourceType" AS ENUM ('link', 'file');

CREATE TABLE resources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  category text,
  type "ResourceType" NOT NULL,
  url text,
  s3_key text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  instructions jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX resources_active_sort_idx ON resources (organization_id, active, sort_order);

CREATE TABLE resource_visibility (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, resource_id) REFERENCES resources(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX resource_visibility_uq ON resource_visibility (organization_id, resource_id, role_id);
CREATE INDEX resource_visibility_role_idx ON resource_visibility (organization_id, role_id);
