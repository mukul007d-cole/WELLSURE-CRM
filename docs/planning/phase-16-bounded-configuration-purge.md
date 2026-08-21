# Phase 16 — Bounded hard-delete (purge) for configuration entities

Status: **approved 2026-08-18. Delivered.** All seven decisions (D1–D7) were
approved as proposed, including the three that contradict a rule in `AGENTS.md`
or in the phase brief: the two-class dependent split (D3), amending the
no-hard-delete rule, and withholding `purge` from the bootstrap grant (D4).
Recorded in ADR-0017.

Three things the implementation found that the plan did not, all covered by
tests:

- **Statuses ship API-only, like Services.** `GET /journeys/:id` filters its
  nested statuses by the same `active` flag that filters the Journey, so no
  request returns an active Journey's deactivated Statuses and a purge control
  there would have been dead UI. D7's dialog is wired into Journeys, Fields,
  Teams, Roles and Notification Rules.
- **The dependency table is checked against the database, not by hand.** A test
  asks `pg_constraint` for every foreign key pointing at each purgeable table
  and fails unless each one is classified as a blocker or a cascade — the
  standing obligation ADR-0017 records, made mechanical for the FK half of it.
- **The routes live in their own module** (`routes/purge.ts`,
  `http/routes/purge.ts`) rather than being split across the configuration and
  admin route files as the plan's file list assumed. Seven entity types share
  one handler because the difference between them is the descriptor table, not
  control flow.

This is Part 2 of Phase 16 and is independent of Part 1 (the deactivation
permission fix) for review purposes. It is **not** independent of it
functionally — see §Current state.

## Goal

Let an administrator permanently remove a configuration entity that was never
really used — test data, a typo, an abandoned experiment — while making it
impossible to destroy or orphan anything real, and leaving a `system_audit_logs`
row that still says what was removed after the row is gone.

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/source-of-truth.md`,
`docs/requirements/glossary.md`, `docs/requirements/v1-scope.md`,
`docs/data-model/schema.md`, `docs/data-model/prisma-translation-notes.md`,
`docs/permissions/access-model.md`,
`docs/permissions/permission-engine-schema.md`, `docs/api/endpoints.md`,
`docs/testing/quality-gates.md`, `docs/operations/runbook.md`,
`docs/architecture/decisions/0009` (bootstrap and permission catalog), `0012`
(object storage), `0014` (Teams are not TEAM scope), `0015` (per-status
routing), `0016` (bulk import and export),
`docs/planning/phase-4-configuration-engine-api-plan.md`,
`docs/planning/phase-13a-field-role-visibility-at-creation.md`,
`docs/planning/phase-14a-teams-within-departments.md`,
`docs/planning/phase-15-bulk-import-export.md`.

## Current state

Six things the investigation established. Each one changed the design.

### 1. Hard delete is blocked in the database, not just in the application

`00000000000000_initial/migration.sql:316-325` installs
`reject_configuration_delete()` and wires it to **five** `BEFORE DELETE`
triggers:

```
roles_no_delete   journeys_no_delete   statuses_no_delete
fields_no_delete  services_no_delete
```

Any `DELETE` on those tables raises
`'% configuration is deactivated/versioned, never deleted'`, from any client,
including a migration or a psql session. This is not incidental — it is the
enforcement of the `AGENTS.md` rule. **Five of the eight entity types the brief
proposes cannot be purged without changing this trigger** (D6).

`teams`, `departments` and `notification_rules` carry no such trigger, which
matches `prisma-translation-notes.md:169` naming only "Journey, Status, Field,
Service, and Role" as protected.

### 2. `system_audit_logs.entity_id` is a bare column, so audit survives a purge

```prisma
entityType String @map("entity_type")
entityId   String @map("entity_id") @db.Uuid   // no @relation, no FK
```

The only foreign keys on the table are `organization_id` and
`(organization_id, actor_user_id)`. It is a polymorphic reference, so deleting
the entity leaves its audit history intact and does not need
`ON DELETE SET NULL` anywhere. `system_audit_logs_append_only`
(`migration.sql:245`) additionally makes those rows immune to `UPDATE` and
`DELETE`, so the record of a purge cannot itself be purged. **No schema change
is needed for the audit trail to work.**

### 3. Foreign keys do not cover every reference — four JSONB columns hold entity ids

`onDelete: Restrict` is on every relation, so an FK-referenced row makes a
delete fail loudly. But four columns reference configuration entities with no
constraint at all:

| Column | Holds | Purge it would silently orphan |
|---|---|---|
| `leads.field_values` | JSONB object **keyed by field id** | Field |
| `campaigns.filter` | Phase 13b conditions, `target.fieldId` (`filter-model.ts:21`) | Field |
| `import_jobs.mapping_json` | `journeyId`, `columns[].fieldId` (`import/mapping.ts:36-40`) | Field, Journey |
| `notification_rules.scope` | `unknown`, stored and never read (`notifications/service.ts`) | — (dormant) |

This is exactly why the brief requires a real per-type check rather than
"attempt the delete and see whether the constraint fires": a constraint would
never fire for any of these. `leads.field_values` is served by
`leads_field_values_gin_idx` (`migration.sql:166`), a default `jsonb_ops` GIN
index, so `field_values ? $fieldId` is index-backed and does not seq-scan.

### 4. Several entities are *born* with dependent rows

A literal "zero dependent records" rule makes the feature inert for most of the
proposed list:

- Creating a Journey writes `role_journey_access` for every role holding
  `journeys_statuses:view` (`prisma-configuration-repository.ts:140-156`), so a
  Journey has dependents the instant it exists.
- A Team must have at least one member and at least one leader
  (`admin/validation.ts:122-138`), so `team_members` is never empty for a Team
  that exists.
- A Notification Rule must have at least one recipient
  (`notifications/service.ts:299-315`), so `notification_rule_recipients` is
  never empty. That relation is also the schema's **only** `onDelete: Cascade`.
- A Field created through the Field Builder normally gets `field_visibility`
  rows in a second request (phase 13a).

D3 addresses this.

### 5. Departments cannot currently be deactivated at all

`AdminService` exposes `listDepartments`, `getDepartment`, `createDepartment`,
`updateDepartment` — and no deactivate. `http/routes/admin.ts` binds no
deactivate route for them either, though `departments.active` exists in the
schema. Under the "must already be inactive" precondition proposed in D5, a
Department could never reach a purgeable state. See D1.

### 6. This work depended on Part 1, which has landed

Purge requires the entity to be inactive first (D5), and deactivating a Journey,
Status, Service or Field was denied to every role — the Part 1 bug. Part 1
merged as `35d2b36` (PR #33), so the precondition is now reachable and this
phase has no blocker of its own. Two things it settled that this plan builds on:

- `journeys_statuses:delete` and `fields:delete` are the deactivate gates, and
  `services:edit` is the Services one because the catalog gives `services` no
  `delete` action. D2's `purge` naming assumes exactly that split.
- `mutate` in `routes/configuration.ts` now types its action against the
  catalog entry for the module, so the purge routes get that check for free and
  cannot repeat the ungrantable-pair failure.

## Proposed approach

### D1 — Which entity types get purge *(decision)*

| Entity | Verdict | Blocking dependents | Cascaded with the purge |
|---|---|---|---|
| Journey | include | `statuses`, `process_instances`, `campaigns.journey_id`, `import_jobs.mapping_json ->> 'journeyId'` | `role_journey_access`, `journey_services`, `field_journey_settings` |
| Status | include | `process_instances.current_status_id`, `tasks.created_from_status_id`, `campaigns.status_id`, `status_routing_rules`, other entities' `field_journey_settings.required_from_status_id` | `status_routing_permissions` |
| Field | include | `leads.field_values ? id`, `attachments.field_id`, `campaigns.filter` targets, `import_jobs.mapping_json` columns | `field_journey_settings`, `field_visibility` |
| Service | include | `lead_services` | `journey_services` |
| Team | include | `status_routing_rules.team_id` | `team_members` |
| Role | include, with two extra guards | `users.role_id` | `role_permissions`, `role_journey_access`, `field_visibility`, `status_routing_permissions` |
| Notification Rule | include | `notifications.notification_rule_id` | `notification_rule_recipients` |
| **Department** | **exclude from V1** | `users.department_id`, `teams.department_id` | — |

**Department is the one exclusion, and the reason is §Current state 5**: there is
no way to deactivate one, so under D5 it can never become purgeable. Adding a
Department deactivate route is a separate, small piece of work; Departments can
join in the phase that adds it. Purging a Department nobody can first deactivate
would also be the single most destructive item on the list — it is the parent of
Teams and the `DEPARTMENT` data scope's anchor.

**Role keeps two guards beyond zero-dependents:**

- Refuse when `is_system_default` is true. Nothing else in the codebase reads
  that flag yet, and a purge is the wrong place to discover what it protects.
- The "last permission administrator" invariant that `deactivateRole` and
  `replacePermissions` both enforce is *satisfied automatically* here — a role
  with zero `users` rows contributes zero active administrators — but the check
  is written and tested explicitly rather than argued from. Cheap, and the
  argument stops holding the moment the invariant is reworded.

Leads, Users, Organizations, Campaigns, Import Jobs, Attachments, Invoices,
Payments, and every log table are out of scope and unchanged, per the brief.

### D2 — The permission action *(decision)*

A new `purge` action per module, never implied by any other action:

| Module | New action | Governs |
|---|---|---|
| `journeys_statuses` | `purge` | Journeys, Statuses |
| `fields` | `purge` | Fields |
| `services` | `purge` | Services |
| `users` | `purge` | Teams |
| `roles_permissions` | `purge` | Roles, Notification Rules |

`purge` rather than `hard_delete` or `destroy`: one word, unused anywhere in the
catalog, and it reads as more severe than `delete`. It also resolves a naming
collision Part 1 documents — on configuration modules `delete` now explicitly
means *deactivate*, so the irreversible operation needs a name of its own.

**Sub-decision D2a — `users:purge` is a trap that needs a deliberate answer.**
Department administration and Team administration both ride on `users:*`
(ADR-0009, ADR-0014). So the action gating Team purge would be called
`users:purge` while purging a User is explicitly out of scope and impossible.
Three options:

1. **Accept `users:purge` for Teams only**, documented emphatically in the access
   model and labelled in the role editor as "Purge Teams". Consistent with
   `users:edit` already conferring Team restructuring without conferring
   anything about user records. *(Recommended.)*
2. Exclude Teams from V1 purge, leaving the module untouched.
3. Introduce a `teams` module — reverses ADR-0014's deliberate choice not to,
   and drags Team `view/create/edit` along with it.

**Sub-decision D2b — Notification Rules are coupled to Part 1's open question.**
They are currently gated on `roles_permissions:view/create/edit`. Part 1 raises
whether they should get their own `notification_rules` module. If that is
approved, rule purge becomes `notification_rules:purge`; if not, it is
`roles_permissions:purge`. This plan assumes the latter and changes with that
decision.

### D3 — What "has dependents" means *(decision — deviates from the brief)*

The brief says purge is permitted only for an entity with **zero dependent
records**. Taken literally, §Current state 4 makes the feature inert: no Journey,
Team or Notification Rule can ever be purged, and most Fields cannot either.

**Proposal: two classes of referencing row, decided per relationship, not per
count.**

- **Blocking dependents** — anything with independent identity or belonging to
  another entity's configuration: leads, process instances, tasks, attachments,
  notifications, campaigns, lead services, users, teams, statuses, routing
  rules, and every JSONB soft reference from §Current state 3. Any one of these
  returns `409 dependency_conflict`. Nothing here is ever deleted by a purge.
- **Cascaded with the purge** — pure relationship and grant rows that exist only
  to describe *this* entity's participation and that nothing else references by
  id: `role_journey_access`, `journey_services`, `field_journey_settings`,
  `field_visibility`, `status_routing_permissions`, `team_members`,
  `role_permissions`, `notification_rule_recipients`. Deleted in the same
  transaction, captured in `oldValue` first.

This is not an invention for this phase. `prisma-translation-notes.md:169`
already draws exactly this line and already says these rows are deleted rather
than deactivated, with the audit row as their history; the same paragraph is
restated in `endpoints.md` under "Mapping row deletion rule". The safety
argument survives intact: **nothing can be orphaned**, because no row anywhere
references a mapping row's id, and **nothing is lost**, because every cascaded
row is in the audit snapshot.

Alternatives, both rejected: strict zero-rows (feature is inert); or requiring
the admin to clear mappings through the existing endpoints first (impossible for
Teams and Notification Rules, whose validation forbids the empty state).

### D4 — Does the bootstrap CLI grant `purge`? *(decision)*

**Proposal: no.** `purge` is the first catalog action the initial administrator
does not receive.

The protection is honestly weak — the bootstrap admin holds
`roles_permissions:edit` and can grant themselves `purge` in a few clicks. Its
actual value is different and worth having: enabling purge becomes a deliberate
act that lands in `system_audit_logs` as a permission change with an actor and a
timestamp, instead of a capability every organization silently carries from day
one.

The cost is real and must be accepted knowingly: ADR-0009 states bootstrap
provisions "the complete catalog", and this makes that false. To avoid a second
source of truth about the catalog — the exact failure mode Part 1 was — the
exclusion is expressed **in the catalog itself** (a per-action
`grantOnBootstrap: false` marker) and `bootstrapFirstAdmin` keeps deriving its
grant set from the catalog with no hard-coded list of its own. ADR-0009 is
amended by ADR-0017 rather than contradicted quietly, the bootstrap CLI prints
that purge was deliberately withheld, and the runbook says how to grant it.

Alternative: grant it with everything (simpler, no ADR-0009 amendment, and the
first admin is trusted with everything else including deactivation). Reasonable
— the recommendation is a judgement call, not a correctness argument.

### D5 — Preconditions, and the shape of the operation

1. **The entity must already be inactive.** Purge is the second step of
   "deactivate, then remove", never a shortcut past deactivation's own checks.
   It also closes the one race the FKs cannot: a Field with no constraint
   protecting `leads.field_values` could otherwise gain a value between the
   dependency check and the commit, and an inactive Field cannot — lead writes
   reject values for Fields not actively mapped to the journey.
2. **Row lock first.** `SELECT ... FOR UPDATE` on the target, the pattern
   `lockRole`/`lockField`/`lockTeam` already use. This is load-bearing, not
   ceremony: inserting a child row takes `FOR KEY SHARE` on the parent, which
   conflicts with `FOR UPDATE`, so a concurrent insert of a real dependent
   serialises against the purge instead of slipping between the check and the
   delete.
3. **Re-check dependents inside the transaction**, after the lock.
4. **Snapshot, then delete, then audit** — all in one transaction:
   `oldValue = { entity: <full row>, cascaded: { <table>: [rows] } }`,
   `newValue = null`, `action = 'purge'`, `entityType` unchanged from what
   deactivation already writes for that entity.
5. **`409 dependency_conflict`** when blocked, with `details` naming each
   blocking relationship and its count — e.g.
   `{ leads: 3, campaigns: 1, processInstances: 0 }` omitted where zero. Counts
   and relationship names only; never record contents.

**No preflight endpoint.** The confirmation dialog renders the `409` body rather
than asking a separate "can I purge this" route. A second implementation of the
dependency rule is a second opinion that can disagree with the real one, silently
and only in the cases nobody tested — the same argument ADR-0016 makes for
refusing a validate-only import path.

Routes, matching the house style for non-idempotent state changes
(`POST /users/:id/deactivate`, `POST /teams/:id/deactivate`):

```
POST /api/v1/journeys/:journeyId/purge          -- journeys_statuses:purge
POST /api/v1/statuses/:statusId/purge           -- journeys_statuses:purge
POST /api/v1/services/:serviceId/purge          -- services:purge
POST /api/v1/fields/:fieldId/purge              -- fields:purge
POST /api/v1/teams/:teamId/purge                -- users:purge
POST /api/v1/roles/:roleId/purge                -- roles_permissions:purge
POST /api/v1/notification-rules/:id/purge       -- roles_permissions:purge (D2b)
```

### D6 — The database triggers *(decision — changes a Phase 0 safety mechanism)*

`reject_configuration_delete()` must stop being unconditional for
`roles/journeys/statuses/fields/services`.

**Proposal: keep the trigger, give it one explicit, transaction-scoped escape
hatch** rather than dropping it:

```sql
CREATE OR REPLACE FUNCTION reject_configuration_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('falcon.purge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION '% configuration is deactivated/versioned, never deleted', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$;
```

The purge transaction issues `SET LOCAL falcon.purge = 'on'` after taking its
lock. Every other code path in the system — an accidental `prisma.journey
.delete()`, a stray psql session, a future migration — still raises exactly as
today. The escape hatch is greppable, scoped to one transaction, and impossible
to leave switched on.

Rejected: dropping the five triggers. It converts a database-enforced invariant
into a convention maintained by code review, and the whole reason this feature is
dangerous is that the database is currently the thing preventing the damage.

No `schema.prisma` change is needed — triggers live only in migration SQL.

### D7 — The confirmation UI *(decision)*

**Finding: there is no existing "are you sure" to be more serious than.**
Deactivating a Journey, Field or Team fires immediately from a `danger` button
inside the hover-revealed `RowActions`, with no confirmation at all
(`JourneysPage.tsx:105-113`, `FieldsPage.tsx:197`,
`DepartmentDetailPage.tsx:189`). Only Status and Role deactivation show
anything, and that is an inline panel whose real job is picking a replacement.

**Proposal: a shared `PurgeDialog` built on the existing `Dialog`, requiring the
admin to type the entity's stable `key` to enable the confirm button.**

- The **key**, not the display name: names are editable, may repeat, and may
  contain characters that make retyping a coin flip; `key` is unique per
  organization, immutable after creation, and is already the identifier this
  system treats as canonical (`configKey` validation, `@@unique([organizationId,
  key])`).
- The dialog states plainly that the entity will be permanently removed and that
  this cannot be undone, lists the cascaded rows that go with it, and names the
  audit row as the only surviving record.
- A `409` re-renders in place with the blocking relationships and counts, so the
  admin learns *what* is still referencing the entity without leaving the dialog.

Type-to-confirm earns its friction here specifically because the trigger sits
one hover away from Edit, and because it is the only irreversible action in the
product.

**`services:purge` will have no UI in V1** — there is no Services admin page
(`apps/web/src/pages/admin` has none, and nothing in the web app calls
`can('services', …)`). The endpoint exists and is tested; the button arrives with
the page. Flagged rather than silently shipping a permission nobody can exercise.

## Files to touch

**Permission catalog**
- `packages/permission-engine/src/catalog.ts` — five `purge` actions; the
  `grantOnBootstrap: false` marker (D4)
- `packages/permission-engine/src/catalog.test.ts`

**Database**
- `packages/database/prisma/migrations/00000000000008_configuration_purge/migration.sql`
  — `CREATE OR REPLACE FUNCTION reject_configuration_delete()` (D6). No table,
  column, or `schema.prisma` change.

**API — purge engine**
- `apps/api/src/configuration/purge.ts` *(new)* — the per-entity dependency
  table: which relationships block, which cascade, in one readable place
- `apps/api/src/configuration/purge-service.ts` *(new)* — lock, re-check,
  snapshot, cascade, delete, audit, one transaction
- `apps/api/src/configuration/prisma-configuration-repository.ts` — dependency
  counts (including the four JSONB probes) and the deletes
- `apps/api/src/configuration/audit.ts` — `'purge'` action, `'team'`/`'role'`/
  `'notification_rule'` entity types
- `apps/api/src/configuration/errors.ts` — no change; `dependency_conflict`
  already exists and already maps to `409`

**API — routes**
- `apps/api/src/routes/configuration.ts` — journey, status, service, field purge
- `apps/api/src/routes/admin.ts` — role, team purge
- `apps/api/src/http/routes/configuration.ts`, `apps/api/src/http/routes/admin.ts`,
  `apps/api/src/http/routes/notifications.ts` — bindings
- `apps/api/src/notifications/service.ts` — `purgeRule`
- `apps/api/src/admin/prisma-admin-repository.ts` — role and team purge
- `apps/api/src/admin/service.ts` — pass-through
- `apps/api/src/admin/bootstrap.ts` — honour `grantOnBootstrap`
- `apps/api/src/bootstrap-cli.ts` — print that purge was withheld

**Web**
- `apps/web/src/components/ui/PurgeDialog.tsx` *(new)*
- `apps/web/src/lib/api-client.ts`, `apps/web/src/lib/api-error.ts`
- `apps/web/src/pages/admin/JourneysPage.tsx`, `JourneyDetailPage.tsx`,
  `FieldsPage.tsx`, `RolesPage.tsx`, `DepartmentDetailPage.tsx` (Teams),
  `NotificationRulesPage.tsx`
- `apps/web/src/mocks/handlers.ts`, `apps/web/src/mocks/permissions.ts`

**Docs**
- `AGENTS.md` — the "Nothing is hard-deleted" non-negotiable becomes "Nothing is
  hard-deleted except through the bounded purge in ADR-0017"
- `docs/architecture/decisions/0017-bounded-configuration-purge.md` *(written
  with this plan)*
- `docs/permissions/access-model.md`, `docs/api/endpoints.md`,
  `docs/data-model/schema.md`, `docs/data-model/prisma-translation-notes.md`,
  `docs/operations/runbook.md`

**Tests**
- `apps/api/src/__tests__/purge.test.ts` *(new)*
- `apps/api/src/__tests__/phase16.postgres.integration.test.ts` *(new)*
- `apps/api/src/__tests__/fixtures/synthetic-configuration.ts`
- `apps/web/src/pages/admin/AdminFlows.test.tsx`

## Out of scope

- Leads, Users, Organizations, and everything with audit or legal weight —
  deactivation only, unchanged.
- Departments — see D1.
- Bulk purge of several entities in one request, and cascading purge of a
  Journey together with its Statuses. A Journey with Statuses is blocked until
  each Status is purged individually; that is a deliberate limit, not an
  oversight.
- Any change to how deactivation itself works. Part 1 fixed *whether it could
  run at all*; neither part changes its rules, its conflict checks, or its
  audit.
- Undo, restore, or a recycle bin. Purge is final; backups are the only recovery.
- Purging `activity_logs` or `system_audit_logs` rows — both are append-only by
  database trigger and stay that way.

## Risks / open questions

1. **This phase contradicts `AGENTS.md`.** "Nothing is hard-deleted" is listed
   under Non-negotiable rules. Approving this phase means amending it. Recorded
   in ADR-0017 rather than edited quietly, per the `PLANS.md` conflict rule.
2. **D3 relaxes the brief's "zero dependent records"** to "zero blocking
   dependents, mapping rows cascade". Without it the feature does nothing for
   four of the seven included types. Needs explicit approval.
3. **D6 weakens a database-enforced invariant.** The escape hatch is narrow and
   explicit, but it is still the case that after this phase the database will
   permit a configuration delete under some condition, and it does not today.
4. **JSONB references are checked by convention, not by constraint.** A future
   feature that stores a field or journey id in a new JSONB column will not be
   caught by the FKs and will not be caught by these checks either unless
   somebody remembers. Mitigation: the dependency table in `purge.ts` is the one
   place to add it, and the ADR states the obligation. A stronger mitigation —
   a test that fails when a new JSONB column appears — is not obviously
   expressible; flagged as an accepted gap.
5. **`users:purge` naming** (D2a) — an action that cannot purge users.
6. **`services:purge` ships without UI** (D7).
7. **Notification-rule gating depends on Part 1's open decision** (D2b).
8. **Purge order is admin-visible.** Removing a test Journey means purging its
   Statuses first, then the Journey. If that proves annoying in practice, the
   answer is a cascading purge in a later phase, not a weaker check here.
9. **Rollback cannot restore purged rows.** See below.

## Test plan

Per `docs/testing/quality-gates.md`. Synthetic fixtures only; no Cronberry
sample, no real personal data.

**Real Postgres (`*.postgres.integration.test.ts`), through the real HTTP
transport and the real permission engine**, with grants written as
`role_permissions` rows:

1. **Per entity type, purge succeeds with zero blocking dependents** — Journey,
   Status, Field, Service, Team, Role, Notification Rule. Asserted by the row
   being absent afterwards, not by a 200.
2. **Per entity type, purge is blocked by a real dependent** — a Field with one
   `leads.field_values` entry; a Field named by a `campaigns.filter` target; a
   Journey with a process instance; a Journey named in an `import_jobs` mapping;
   a Status with a task; a Service with a lead service; a Team named by a
   routing rule; a Role with one user; a Rule with one delivered notification.
   Each asserts `409`, the `dependency_conflict` code, the naming of the right
   relationship in `details`, **and that the row still exists**.
3. **The cascade is exactly the cascade** — the mapping rows named in D3 are
   gone, and nothing else in the organization changed. Asserted as a full
   table-count snapshot before and after, so an over-broad delete fails.
4. **The audit row survives and is usable** — read back *after* the entity is
   gone; `action = 'purge'`, `newValue = null`, and `oldValue` carries the
   entity's own columns plus every cascaded row. Asserted by reconstructing the
   entity's key and name from the audit row alone.
5. **Permission enforcement** — a role holding the whole catalog *except*
   `<module>:purge` gets `403` on every route, with journey access held so the
   denial is attributable to the module action. The engine-level assertion is
   `FEATURE_ACTION_DENIED`.
6. **Bootstrap does not grant purge** (D4) — `bootstrapFirstAdmin` runs, and the
   initial administrator gets `403` on every purge route until the action is
   granted, then `200`. This is the test that makes D4 real rather than
   aspirational.
7. **Tenant isolation** — an actor in another organization gets `404`, and the
   entity in the first organization is untouched. Run for each entity type.
8. **The active precondition** (D5) — purging an active entity is refused, and
   the same entity purges cleanly once deactivated.
9. **The trigger still guards everything else** (D6) — a direct
   `DELETE FROM journeys` outside a purge transaction still raises, in the same
   test file, so the escape hatch is proven narrow rather than assumed narrow.
10. **Concurrency** — two purges of the same entity: one succeeds, the other gets
    `404`. A purge racing an insert of a real dependent does not lose the
    dependent.

**Unit**: the dependency table in `purge.ts` — every entity type names every
relationship the schema actually has. Table-driven, with a case that fails if a
new FK to a purgeable table appears without a decision about it.

**Web**: the dialog does not enable its confirm button until the typed key
matches exactly; a `409` renders the blocking relationships; the action is absent
without `can(module, 'purge')`.

**Vacuity**: every "blocked" case is re-run with the block removed and must then
succeed, and every "succeeds" case is re-run with a dependent added and must then
fail — the pattern phases 14b, 15 and Part 1 used, checked by mutation before the
PR.

## Rollback plan

The migration replaces one function body and touches no table, column, index, or
constraint.

- **Forward**: `CREATE OR REPLACE FUNCTION reject_configuration_delete()` with
  the `falcon.purge` guard.
- **Back**: `CREATE OR REPLACE FUNCTION` restoring the unconditional
  `RAISE EXCEPTION` body. One statement, no data movement, safe to run while the
  application is live — it can only make deletes *more* restricted.
- **Also on rollback**: `DELETE FROM role_permissions WHERE action = 'purge'`.
  Reverting the catalog without this leaves rows whose pair no longer exists —
  ungrantable, unremovable through the role editor, and invisible in the
  permission matrix. This is precisely the failure mode Part 1 was, and it is
  cheap to avoid.
- **Not recoverable**: rows already purged. The `system_audit_logs` snapshot is
  the record of what was removed, and a database backup is the only route to the
  data itself. Stated plainly because it is the point of the feature rather than
  a defect in it.

Before applying either direction in a persistent environment: take a backup,
and preserve `activity_logs` and `system_audit_logs` — both are append-only and
must not be edited or removed as part of any rollback.
