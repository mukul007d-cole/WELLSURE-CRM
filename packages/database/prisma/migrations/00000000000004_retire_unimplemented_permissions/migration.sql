-- ADR-0022 — retire catalog actions that were grantable but never
-- honoured by any route: the whole `reports` module
-- (view_standard/view_financial/build_custom, a Phase 2 placeholder that
-- was never built), and `leads:bulk_reassign`/`leads:bulk_status_change`
-- (grantable since Phase 1, honoured by no route — see
-- docs/api/endpoints.md's own "NOT IMPLEMENTED" note, which this
-- migration makes true rather than just documented).
--
-- Any existing `role_permissions` row for one of these pairs (bootstrap
-- granted all of them, since none were `withheldFromBootstrap`) is now
-- orphaned — the catalog no longer defines the pair, so
-- `resolveAuthorization` can never be asked about it, but the row would
-- otherwise sit in the table forever, granted to no purpose, alongside
-- Role rows real permissions live in. Removed explicitly rather than left
-- as a silent side effect of the catalog change alone.
DELETE FROM role_permissions
WHERE module = 'reports' AND action IN ('view_standard', 'view_financial', 'build_custom');
DELETE FROM role_permissions
WHERE module = 'leads' AND action IN ('bulk_reassign', 'bulk_status_change');
