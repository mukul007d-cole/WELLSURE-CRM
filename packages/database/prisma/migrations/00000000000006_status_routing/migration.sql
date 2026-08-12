-- Per-status assignment routing rules (Phase 14b).
--
-- Three new tables, plus retiring one dormant column. See ADR-0015.
--
-- What routing does when it fires is deliberately not new machinery: it ends the
-- current assignment for its assignment_type and creates the replacement in the
-- same transaction, which is exactly what a manual reassignment already does.
-- SELF data scope resolves through `assignments.is_current`, so ending that row
-- is what makes the previous holder lose the lead — there is no second
-- visibility mechanism to keep in step.

-- The specified-but-never-built ancestor of this feature.
--
-- `statuses.auto_reassign_to_role_id` was documented as a `follow_up`
-- behaviour side-effect and had no reader, no writer, no seed and no UI in any
-- phase. Leaving a dormant column describing the same idea as the tables below
-- is a trap for the next person reading the schema. Rollback is re-adding a
-- nullable column and its foreign key; no data can be lost, because nothing
-- ever wrote to it.
ALTER TABLE statuses DROP COLUMN auto_reassign_to_role_id;

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
  -- joins or leaves, which for a Team pool is routine (14a ends memberships on
  -- a department change or deactivation).
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
-- Trigger evaluation runs on every status change and looks up exactly this.
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
--
-- The same layering `field_visibility` uses — the effective decision is the
-- `lead_routing` module action AND a row here — so one role can operate routing
-- on an operations status without operating it on a sales status.
--
-- Writing these rows is gated on `roles_permissions:edit`, never on
-- `lead_routing:configure`: a routing administrator who cannot edit permissions
-- must not be able to grant routing rights, including to their own role. Same
-- rule `field_visibility` already follows.
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
-- "What may this role do with routing?" — the decision path reads exactly this.
CREATE INDEX status_routing_permissions_role_idx ON status_routing_permissions (organization_id, role_id, action);
