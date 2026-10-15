# ADR-0026: Journey-limited actions, journey members, status rules and follow-ups

**Status:** Accepted (Phase 24).

## Context

Configuring Falcon from Wellsure's real Cronberry setup exposed five
capabilities Cronberry relies on daily that Falcon did not have:
per-journey permissions, per-journey user lists, status-level rules, field
rules beyond required/optional/hidden, and follow-ups. `v1-scope.md` already
listed "feature × journey" permissions and tasks as must-haves.

## Decisions

### Journey-limited actions

`role_permissions.journey_ids uuid[]` — empty means "every journey the role
can access" (every existing row). A single-record check whose journey is not
listed is `FEATURE_ACTION_DENIED`; a list-level check narrows the predicate's
journeys to the intersection. Export intersects its view predicate with the
journeys its `leads:export` grant names (ADR-0016's "view decides the rows"
still holds; this only removes journeys).

### Journey members

`journeys.restrict_to_members boolean default false` plus `journey_members`.
When a journey is restricted, access needs the role's journey access **and**
membership. Default `false` keeps every existing deployment unchanged.
Editing members is gated on `users:edit` (it is a personnel assignment, like
Teams, ADR-0014) and audited.

### Status rules

- `status_allowed_roles` — who may *choose* the status. No rows = unrestricted,
  the same default Status Visibility and routing permissions use. Enforced on
  every path where a request picks a status; a default-on-create landing and
  system moves (routing, status consolidation) are exempt. The catalog gains
  `leads:bypass_status_rules`, granted by bootstrap, never implied by anything.
- `status_required_fields` — must be non-empty to **enter** the status; not
  re-checked while the lead stays there. This is a transition gate, unlike
  `field_journey_settings.required_from_status_id`, which keeps its existing
  "while in" meaning and is untouched.
- `statuses.color`, `statuses.reason_options`, `process_instances.status_reason`.

### Field rules

Types are validated on create (closes OD-020); `multi_select` and `datetime`
are added with filter operators. Requirement `required_on_create` with
`required_role_ids` enforces "mandatory for these roles" at creation only.

### Follow-ups

The `tasks` table (present since Phase 1, never used) becomes Falcon's
follow-up record: type `follow_up`, status `open | done | rescheduled |
cancelled`, plus `note`, `completed_at`, `completed_by_user_id`. A status
change may schedule one; scheduling closes any open follow-up on the same
process instance. `packages/workflow-engine` remains a placeholder: the logic
is small enough to live beside `LeadService`.

## Consequences

- Five catalog/engine additions appear in the role editor; all default to the
  previous behaviour when unconfigured.
- Status rules apply to bulk import too, because import runs `createLead`;
  the one-time Cronberry cutover writes history directly and does not.
- Rollback: migration `00000000000008_cutover_engine_rules`'s `rollback.sql`.
