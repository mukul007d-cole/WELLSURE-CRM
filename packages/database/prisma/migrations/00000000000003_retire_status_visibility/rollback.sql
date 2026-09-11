-- Rollback for 00000000000003_retire_status_visibility.
--
-- Recreates the table structure only. Any rows that existed before the
-- forward migration ran are not recoverable here — restore them from a
-- database backup taken before the forward migration, if one is needed.
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
