-- Bounded hard-delete (purge) for configuration entities (Phase 16). See ADR-0017.
--
-- `roles`, `journeys`, `statuses`, `fields` and `services` each carry a
-- `BEFORE DELETE` trigger installed by the initial migration, all running
-- `reject_configuration_delete()`, which raises unconditionally. That trigger —
-- not application code — is what has enforced the `AGENTS.md` no-hard-delete
-- rule from any client, including psql and future migrations.
--
-- ADR-0017 carves out exactly one exception: a purge that has already proven the
-- entity is inactive and has no blocking dependents. This migration expresses
-- that exception in the trigger itself rather than by dropping it.
--
-- The guard is a transaction-scoped GUC. `PurgeService` issues
-- `SET LOCAL falcon.purge = 'on'` inside its transaction, after taking the row
-- lock and after its checks pass. Every other code path in the system — a stray
-- `prisma.journey.delete()`, an ad-hoc psql session, a future migration — still
-- raises exactly as it did before, because `current_setting` returns NULL there
-- and NULL IS DISTINCT FROM 'on'.
--
-- Three properties this shape buys, none of which dropping the triggers would:
--   * the guarantee stays in the database, not in a convention maintained by
--     code review;
--   * the escape hatch is greppable — one `SET LOCAL` in one service;
--   * it cannot be left switched on, because `SET LOCAL` dies with its
--     transaction.
--
-- `RETURN OLD` is what permits the delete to proceed; the previous body never
-- returned at all, because it always raised.
--
-- Rollback: re-run the original body from
-- `00000000000000_initial/migration.sql:316-320`. One statement, no data
-- movement, safe while the application is live — it can only make deletes more
-- restricted. Rolling back the application alongside it should also
-- `DELETE FROM role_permissions WHERE action = 'purge'`, or those rows outlive
-- the catalog entry that makes them grantable.
--
-- `teams`, `departments` and `notification_rules` carry no such trigger and are
-- untouched here.

CREATE OR REPLACE FUNCTION reject_configuration_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('falcon.purge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '% configuration is deactivated/versioned, never deleted', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$;
