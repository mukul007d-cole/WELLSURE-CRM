ALTER TABLE leads
  ADD COLUMN active boolean NOT NULL DEFAULT true,
  ADD COLUMN deactivated_at timestamptz(6),
  ADD COLUMN deactivated_by_user_id uuid;
ALTER TABLE leads ADD CONSTRAINT leads_deactivated_by_fkey
  FOREIGN KEY (organization_id, deactivated_by_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT;
CREATE INDEX leads_organization_active_updated_idx ON leads (organization_id, active, updated_at DESC);

ALTER TABLE user_access_grants ADD COLUMN actions text[] NOT NULL DEFAULT ARRAY['view']::text[];
ALTER TABLE user_access_grants ADD CONSTRAINT user_access_grants_actions_check
  CHECK (cardinality(actions) > 0 AND actions <@ ARRAY['view','edit','comment']::text[]);
CREATE UNIQUE INDEX user_access_grants_one_active_uq
  ON user_access_grants (organization_id, user_id, lead_id) WHERE revoked_at IS NULL;

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

ALTER TABLE notifications
  ADD COLUMN read_at timestamptz(6),
  ADD COLUMN notification_rule_id uuid,
  ADD COLUMN activity_log_id uuid;
ALTER TABLE notifications ADD CONSTRAINT notifications_rule_fkey
  FOREIGN KEY (organization_id, notification_rule_id) REFERENCES notification_rules(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE notifications ADD CONSTRAINT notifications_activity_fkey
  FOREIGN KEY (organization_id, activity_log_id) REFERENCES activity_logs(organization_id, id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX notifications_delivery_uq
  ON notifications (organization_id, notification_rule_id, activity_log_id, user_id)
  WHERE notification_rule_id IS NOT NULL AND activity_log_id IS NOT NULL;
