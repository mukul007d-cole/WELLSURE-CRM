DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM leads WHERE active = false)
     OR EXISTS (SELECT 1 FROM user_access_grants WHERE actions <> ARRAY['view']::text[])
     OR EXISTS (SELECT 1 FROM notification_rules)
     OR EXISTS (SELECT 1 FROM notifications WHERE notification_rule_id IS NOT NULL OR activity_log_id IS NOT NULL)
  THEN RAISE EXCEPTION 'Phase 9 rollback blocked: preserve deactivation, capability, rule, or notification provenance data';
  END IF;
END $$;
DROP INDEX IF EXISTS notifications_delivery_uq;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_activity_fkey, DROP CONSTRAINT IF EXISTS notifications_rule_fkey,
  DROP COLUMN IF EXISTS activity_log_id, DROP COLUMN IF EXISTS notification_rule_id, DROP COLUMN IF EXISTS read_at;
DROP TABLE IF EXISTS notification_rule_recipients;
DROP TABLE IF EXISTS notification_rules;
DROP INDEX IF EXISTS user_access_grants_one_active_uq;
ALTER TABLE user_access_grants DROP CONSTRAINT IF EXISTS user_access_grants_actions_check, DROP COLUMN IF EXISTS actions;
DROP INDEX IF EXISTS leads_organization_active_updated_idx;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_deactivated_by_fkey,
  DROP COLUMN IF EXISTS deactivated_by_user_id, DROP COLUMN IF EXISTS deactivated_at, DROP COLUMN IF EXISTS active;
