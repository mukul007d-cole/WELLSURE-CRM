-- Rollback for 00000000000005_reassignment_grace_preference.
--
-- Additive boolean column, default false — safe to drop outright. Every
-- change to it is also recorded in system_audit_logs (entity_type 'user',
-- action 'reassignment_grace_preference_changed'), so the value is
-- recoverable from audit history if ever needed after a rollback; the
-- column itself carries no other state worth preserving.
ALTER TABLE users DROP COLUMN retain_view_after_reassignment;
