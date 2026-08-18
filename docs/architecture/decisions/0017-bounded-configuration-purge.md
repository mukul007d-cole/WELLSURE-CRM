# ADR-0017: Bounded hard-delete (purge) for configuration entities

**Status:** Proposed (phase 16, part 2) — **not accepted; nothing implemented.**
Supersedes nothing until approved. Amends the `AGENTS.md` no-hard-delete rule
and ADR-0009's bootstrap contract if accepted.

## Context

`AGENTS.md` lists "Nothing is hard-deleted" among the non-negotiable rules, and
the rule is enforced in three independent places: `onDelete: Restrict` on every
foreign key, five `BEFORE DELETE` triggers
(`roles_no_delete`, `journeys_no_delete`, `statuses_no_delete`,
`fields_no_delete`, `services_no_delete`), and a deactivate-only API surface.

That rule solves "get this out of everyday use". It does not solve "this was
test data and I want it gone". An organization that seeds a Journey to try the
product, or an admin who creates `test_field_1` twice, carries both forever in
every configuration list.

The investigation behind the phase-16 plan established four facts that shape any
answer:

- **The database, not the application, is what currently prevents this.** The
  five triggers raise on any `DELETE`, from any client. Three of the entity
  types under discussion (Teams, Departments, Notification Rules) have no such
  trigger, matching `prisma-translation-notes.md`, which names only Journey,
  Status, Field, Service and Role as protected.
- **`system_audit_logs.entity_id` is a bare `uuid` column with no foreign key**,
  and the table is append-only by trigger. An audit row therefore outlives the
  entity it describes with no schema change at all.
- **Foreign keys do not cover every reference.** `leads.field_values` is a JSONB
  object keyed by field id; `campaigns.filter` and `import_jobs.mapping_json`
  carry field and journey ids. A delete that relied on constraints to fail would
  silently orphan all three.
- **Several entities are born with dependent rows.** Creating a Journey grants
  `role_journey_access` to every configuration-visible role; a Team must have a
  leader; a Notification Rule must have a recipient. A literal "zero dependent
  rows" rule permits almost nothing.

## Decision

### Purge exists, and is bounded by zero *blocking* dependents

An entity may be hard-deleted only when nothing real refers to it. "Real" is
decided per relationship, from the schema, not by attempting the delete and
watching for a constraint violation — a constraint would never fire for the
JSONB references, and its error message could not tell an admin what is in the
way.

Two classes of referencing row:

- **Blocking** — rows with independent identity, or belonging to another
  entity's configuration: leads (including JSONB field values), process
  instances, tasks, attachments, notifications, campaigns, lead services, users,
  teams, statuses, routing rules, import mappings. Any one of them returns
  `409 dependency_conflict` naming the relationship and its count. A purge never
  deletes one.
- **Cascaded** — pure relationship and grant rows describing only this entity's
  participation, which nothing references by id: `role_journey_access`,
  `journey_services`, `field_journey_settings`, `field_visibility`,
  `status_routing_permissions`, `team_members`, `role_permissions`,
  `notification_rule_recipients`. Deleted with the entity, snapshotted into
  `oldValue` first.

This is the line `prisma-translation-notes.md` already draws between versioned
configuration entities and current-state mappings, applied to a new operation
rather than invented for it. What makes purge safe is preserved exactly:
**nothing can be orphaned**, because no row references a mapping row's id, and
**nothing is lost**, because every cascaded row is in the audit snapshot.

### Scope: seven configuration entities, and Departments deliberately excluded

Journeys, Statuses, Fields, Services, Teams, Roles and Notification Rules.

**Departments are excluded from V1**, not because their dependency graph is
unclear but because there is no way to deactivate one — `AdminService` exposes
no deactivate and no route binds one, though `departments.active` exists. Purge
requires the entity to be inactive first, so a Department could never reach a
purgeable state. They join the phase that adds Department deactivation.

Leads, Users and Organizations are out of scope permanently, not pending: they
carry audit and legal weight, and deactivation is the correct operation for
them.

Roles carry two guards beyond zero-dependents: `is_system_default` roles are
refused, and the "last permission administrator" invariant is re-checked
explicitly even though zero users implies it.

### `purge` is a distinct, higher-trust action, never implied by `delete`

`journeys_statuses:purge`, `fields:purge`, `services:purge`, `users:purge`
(Teams), `roles_permissions:purge` (Roles, Notification Rules).

The same "additional gate, never a replacement" shape as `leads:import`
(ADR-0016) and `lead_routing:operate` (ADR-0015). It also disambiguates a
collision: on configuration modules `delete` means *deactivate*, so the
irreversible operation needed a name that is not already spoken for.

`users:purge` gates Team purge while purging a User remains impossible — an
accepted wart, documented in the access model and labelled in the role editor,
consistent with `users:edit` already conferring Team restructuring without
conferring anything about user records.

### Bootstrap does not grant `purge`

`bootstrapFirstAdmin` provisions the whole catalog except actions marked
`grantOnBootstrap: false`, which for now is exactly the purge actions. This
amends ADR-0009's statement that bootstrap provisions the complete catalog.

The protection is deliberately modest — the initial administrator holds
`roles_permissions:edit` and can grant it to themselves. The value is that doing
so is an explicit act with an actor and a timestamp in `system_audit_logs`,
rather than a capability every organization carries silently from its first
minute.

The exclusion lives **in the catalog**, not in a list inside the bootstrap
command. A second source of truth about which pairs exist is the exact defect
Part 1 of this phase repaired, and it will not be reintroduced here.

### The delete triggers stay, with one explicit escape hatch

`reject_configuration_delete()` raises unless `falcon.purge` is set to `on` for
the current transaction, which only the purge transaction does, via `SET LOCAL`
after taking its row lock.

Dropping the five triggers was rejected. The database being the thing that
prevents this damage is precisely why the feature is dangerous; converting that
into a convention maintained by code review trades a guarantee for a habit. An
accidental `prisma.journey.delete()` anywhere else in the system still raises
exactly as it does today, and the escape hatch is greppable, transaction-scoped,
and impossible to leave switched on.

### The confirmation types the entity's key

Purge asks the admin to type the entity's stable `key` — not its display name,
which is editable, may repeat, and may be awkward to retype. The dialog states
that the removal cannot be undone, lists what will be cascaded, and renders a
`409` in place with the blocking relationships.

There is no preflight endpoint. The dialog reads the real operation's `409`
rather than asking a separate "may I" route, because a second implementation of
the dependency rule is a second opinion that can disagree with the real one —
silently, and only for the cases nobody tested. The same reasoning ADR-0016
applied to refusing a validate-only import path.

## Consequences

- **`AGENTS.md`'s "Nothing is hard-deleted" becomes "Nothing is hard-deleted
  except through the bounded purge in ADR-0017."** This is the first deliberate
  exception to a rule repeated in every phase to date, which is why it is
  recorded here rather than edited into the rule list quietly.
- Five new permission identifiers appear in every role editor, as `campaigns`
  did in 13c and `lead_routing` in 14b — but unchecked by default and ungranted
  by bootstrap.
- `services:purge` ships with no user interface: there is no Services admin page
  in the web app. The endpoint is real and tested; the button arrives with the
  page.
- **A new JSONB column holding a configuration id will not be caught by anything
  automatically.** Foreign keys do not see it and the purge checks will not know
  about it. Any future feature storing a field, journey, or status id in JSON
  must add it to the dependency table in `configuration/purge.ts`. Stated as a
  standing obligation because no test can express it.
- Purge is the second step of a two-step operation: deactivate, then remove.
  Part 1 of this phase (PR #33, merged as `35d2b36`) is what made the first step
  possible at all, and it established the gates this decision builds on —
  `journeys_statuses:delete` and `fields:delete` deactivate, while Services use
  `services:edit` because the catalog gives them no `delete` action.
- Rolling the catalog back requires deleting `role_permissions` rows with
  `action = 'purge'`; leaving them behind produces rows whose pair no longer
  exists — ungrantable, unremovable through the role editor, invisible in the
  matrix.
- Purged rows are unrecoverable. The audit snapshot records what was removed;
  the data itself exists only in backups. That is the feature working, not a
  defect in it.
