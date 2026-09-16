-- Phase 21 Part 2 — a personal, self-service opt-in: keep 30 days of
-- view-only access to a lead after a user stops being its assignee, whether
-- reassigned manually or by Status Routing. Off by default for every
-- existing user; only takes effect for a user whose current Role also holds
-- the new `leads:retain_view_after_reassignment` catalog action (a plain
-- role_permissions row, no schema change needed for that half). See
-- docs/architecture/decisions/0023-reassignment-grace-visibility-gating.md.
ALTER TABLE users ADD COLUMN retain_view_after_reassignment boolean NOT NULL DEFAULT false;
