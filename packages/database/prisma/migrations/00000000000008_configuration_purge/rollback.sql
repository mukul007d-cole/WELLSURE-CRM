-- Rollback for 00000000000008_configuration_purge.
--
-- Restores `reject_configuration_delete()` to the unconditional body installed
-- by `00000000000000_initial/migration.sql:316-320`, byte for byte. After this
-- runs, `roles`, `journeys`, `statuses`, `fields` and `services` refuse every
-- delete again, from every code path including the purge transaction — the
-- `falcon.purge` GUC stops meaning anything.
--
-- No table, column, index, constraint or trigger is touched. The five
-- `*_no_delete` triggers stay attached throughout and keep pointing at this
-- same function, so replacing the body is the whole of the schema rollback.
--
-- **Safe to run while the application is live.** It can only make deletes more
-- restricted, never less, so there is no window in which a purge slips through
-- half-rolled-back. A purge already in flight fails with the original message
-- and its transaction aborts, which leaves the entity intact.
--
-- **Not recoverable:** rows already purged. That is inherent to the feature
-- rather than a defect in this script — the `system_audit_logs` row with
-- `action = 'purge'` holds the entity and its cascaded mapping rows in
-- `old_value`, and a database backup is the only route to the data itself.
-- Those audit rows are append-only and are deliberately left in place: they
-- are the record of what happened, and they stay readable after rollback.

CREATE OR REPLACE FUNCTION reject_configuration_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% configuration is deactivated/versioned, never deleted', TG_TABLE_NAME;
END;
$$;

-- Grants of the `purge` action, which no longer exists in the catalog once the
-- application is rolled back with this migration.
--
-- Deliberately destructive, and the alternative is worse: `admin/validation.ts`
-- validates `role_permissions` writes against the catalog, so a stored pair the
-- catalog does not define is ungrantable, unrevocable through the role editor,
-- and invisible in the permission matrix — exactly the orphan-pair state that
-- made configuration deactivation impossible for every role before PR #33.
--
-- Rolling forward again does not restore these grants, which is correct:
-- `purge` is withheld from bootstrap precisely so that holding it is always a
-- deliberate, audited act (ADR-0017 D4). Re-grant it under Roles & Permissions.
DELETE FROM role_permissions WHERE action = 'purge';
