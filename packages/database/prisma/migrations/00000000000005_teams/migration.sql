-- Teams within Departments (Phase 14a).
--
-- Two new tables plus one additive unique index on `users`. Nothing existing is
-- altered or dropped, so rollback is two DROPs and one DROP INDEX.
--
-- Read ADR-0014 before changing anything here: a Team is deliberately NOT the
-- `TEAM` permission data scope. That scope resolves through `users.manager_id`
-- and is untouched by this migration. Nothing in these tables is consulted by
-- the permission engine.
--
-- The department-enforcing foreign key is the load-bearing part. A Team belongs
-- to one Department, and its members must belong to that same Department. That
-- invariant is enforced *in the database* via the composite key
-- (organization_id, department_id, user_id) -> users, not only by service-layer
-- validation, because a stale membership row is not a tidiness problem: Phase
-- 14b routes lead assignments through Team membership, so a member who has left
-- the Department would keep receiving that Department's leads.

-- Referenced by the team_members foreign key below. `department_id` is nullable
-- on users, so rows with no Department are all distinct under this index; the
-- pair (organization_id, id) is already the primary key, so this adds a lookup
-- path and a referenceable key, never a new restriction.
CREATE UNIQUE INDEX users_org_department_id_uq ON users (organization_id, department_id, id);

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
  FOREIGN KEY (organization_id, department_id, team_id) REFERENCES teams(organization_id, department_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, department_id, user_id) REFERENCES users(organization_id, department_id, id) ON DELETE RESTRICT
);

-- A user appears at most once in a team; `is_leader` is a property of that one
-- membership, never a second row.
CREATE UNIQUE INDEX team_members_user_uq ON team_members (organization_id, team_id, user_id);
-- "Which teams is this user in?" — the cascade on department change and
-- deactivation reads exactly this.
CREATE INDEX team_members_user_idx ON team_members (organization_id, user_id);
-- "Who leads this team?" — the at-least-one-leader check reads exactly this.
CREATE INDEX team_members_leader_idx ON team_members (organization_id, team_id, is_leader);
