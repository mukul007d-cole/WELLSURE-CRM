# Phase 13a — Field-level role visibility at creation time

Status: approved 2026-08-11. **Delivered.** Sub-phase 1 of 3 in Phase 13.
13b (filter engine) and 13c (campaigns) get their own plan documents and their
own approvals; nothing in them is implemented here.

All four sign-off decisions were approved as proposed: the `roles_permissions`
gate, the two-request create (the atomic alternative was explicitly declined),
the checkbox divergence from `RoleDetailPage`, and the `replace_field_roles`
audit action.

Two things the implementation added beyond the plan, both in the frontend and
both covered by tests:

- The editor opens immediately and an existing Field's grants load into it
  afterwards, rather than the plan's implied load-then-open. Save leaves grants
  untouched until they have actually been read, so a fast Save cannot
  full-replace stored grants with a set the client never saw.
- Reopening the editor for the same Field re-reads its grants. The first cut
  reused a per-field sync marker and would have shown an empty picker on the
  second open — and then revoked every grant on save. `openDraft` clears the
  marker; the regression test was confirmed to fail without that change.

## Goal

Let an admin set which roles can view or edit a Field from the Field Builder
itself — the reverse of today's role-by-role flow — backed by a reverse read
endpoint and a single-request full-replace write, with the "no row = hidden"
default preserved for brand-new fields.

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/source-of-truth.md`,
`docs/data-model/schema.md`, `docs/permissions/access-model.md`,
`docs/permissions/permission-engine-schema.md`, `docs/api/endpoints.md`,
`docs/testing/quality-gates.md`,
`docs/planning/phase-7-admin-management-api-plan.md`,
`docs/planning/phase-9-lead-sharing-and-notifications-plan.md`,
`docs/planning/phase-11-seller-record-workspace.md`,
`docs/architecture/decisions/0009`, `0010`, `0011`.

## Current state

Verified against the tree at `55b97db`, not assumed from the task description.

### `field_visibility` is writable from one direction only

The table is `(organization_id, field_id, role_id, access_level)` with
`@@unique([organizationId, fieldId, roleId])` and an index on
`(organizationId, roleId, accessLevel)`
(`packages/database/prisma/schema.prisma:439-455`). It is an allow-list: absence
of a row means hidden (`docs/permissions/access-model.md:50`).

Three write/read surfaces exist today, all keyed by **role**:

| Route | Handler | Module gate | Shape |
|---|---|---|---|
| `GET /roles/:roleId/field-visibility` | `http/routes/admin.ts:128-134` | `roles_permissions:view` | all fields for one role |
| `PUT /roles/:roleId/field-visibility` | `http/routes/admin.ts:135-141` → `PrismaAdminRepository.replaceFieldVisibility` (`:305-327`) | `roles_permissions:edit` | full replace of one role's set |
| `PUT /roles/:roleId/field-visibility/:fieldId` | `http/routes/configuration.ts:199-206` | `roles_permissions:edit` (`routes/configuration.ts:15`) | single-cell upsert |

**The task description's premise is correct: there is no reverse endpoint.**
No route matches `/fields/:fieldId/visibility` or any equivalent — the only
`/api/v1/fields*` routes are the five CRUD paths at
`http/routes/configuration.ts:78-167`. Nothing anywhere returns "all roles'
access for one field."

Two related facts worth recording, both true today:

- `ConfigurationService.deleteFieldVisibility` (`configuration/service.ts:628`)
  has **no HTTP route**. It is exercised only by a service-level test
  (`__tests__/configuration.test.ts:160`). Revoking one cell over HTTP is
  currently only possible by re-sending the whole role's set through the admin
  `PUT`.
- The single-cell configuration `PUT` has **no web client method**. `adminApi`
  exposes only `saveFieldVisibility` (`apps/web/src/lib/api-client.ts:203-204`),
  the role-side bulk replace.

### The default is already "no roles granted"

`ConfigurationService.createField` (`configuration/service.ts:472-499`) writes
the `fields` row and one `system_audit_logs` row, and nothing else. A new field
is invisible to every role, including its creator's, until someone opens the
Role page. So 13a's stated default is the *existing* semantic — the work is to
keep it while making the grant step reachable at creation time, not to change
it.

This is also why the Field Builder is the right place for the picker: today a
field created through the UI is dead on arrival, and the fix requires leaving
the Fields page for a different admin page entirely.

### The role-side bulk-replace pattern this must copy

`PrismaAdminRepository.replaceFieldVisibility` (`:305-327`) is the Phase 7
pattern:

1. `lockRole` — `SELECT … FOR UPDATE` on the role row (`:403-410`).
2. Validate every referenced field is in the organization.
3. Read the old rows, `deleteMany`, `createMany` the new set.
4. `bump` the role's `version` and `updatedById` (`:411-416`).
5. One `system_audit_logs` row: `entity_type = 'field_visibility'`,
   `entity_id = roleId`, `action = 'replace'`, `old_value` = previous rows,
   `new_value` = new rows.

Validation lives in `admin/validation.ts:63-80` (`visibility`): array, non-blank
`fieldId`, `accessLevel ∈ {VIEW, EDIT}`, no duplicate `fieldId`, sorted output.

`role.version` feeds `AuthorizationDecision.roleVersion`
(`permission-engine/src/decision.ts:169`). Nothing caches on it today, but the
role-side writes all bump it, and a field-side write changes exactly the same
effective grant, so it must bump too or the two paths disagree about what
"changed."

### Enforcement is per-request, so a grant takes effect immediately

`PrismaPermissionRepository.getFieldVisibility` (`:143-157`) queries on every
authorization call; `resolveLeadAccess` (`routes/leads.ts:430-481`) intersects
the caller's requested field ids with the returned set per process instance;
`serializeLead` (`:489-509`) and `serializeActivityEntry`
(`leads/activity-read.ts:70-88`) strip everything outside it. There is no
capability cache on the server, so "immediately after creation" is testable
without any invalidation work.

### Frontend

`FieldsPage` (`apps/web/src/pages/admin/FieldsPage.tsx`) is a list plus an
inline `FieldEditor` card (`:172-293`) using `Field`/`Input`/`Select` from the
shared UI package. It has no notion of roles.

`RoleDetailPage` (`:303-367`) renders the role-side field-visibility axis as a
**three-value `<Select>`** (Hidden / View / Edit) per field, with a dirty-state
`AxisActions` bar and a "Set all fields…" bulk control. Its journey-access axis
(`:265-301`) uses the shared `Checkbox`. So the codebase has both idioms; the
task asks for view/edit checkboxes, which is the `Checkbox` idiom already in
use one section above. See the decision below.

## Proposed approach

### 1. Two endpoints, both gated on `roles_permissions`

```
GET /api/v1/fields/:fieldId/visibility     roles_permissions:view
PUT /api/v1/fields/:fieldId/visibility     roles_permissions:edit
```

`GET` returns the rows that exist, allow-list style, mirroring the role-side
GET's shape with the axes swapped:

```json
[{ "roleId": "…", "accessLevel": "VIEW" }]
```

Roles with no row are simply absent — the client joins against `GET /roles`.
404 when the field id is not in the caller's organization.

`PUT` body is `{ "visibility": [{ "roleId": "…", "accessLevel": "VIEW"|"EDIT" }] }`
and is a **full replace of that field's row set across every role in the
organization**. `{ "visibility": [] }` revokes the field everywhere. This is the
exact mirror of `PUT /roles/:id/field-visibility` and, as a side benefit, gives
the "clear all mappings" step that `deactivateField` requires before it will
deactivate a field (`configuration/service.ts:501-521`) a one-request form.

**Gate decision — `roles_permissions`, not `fields`.** Both existing
field-visibility writes are already gated this way
(`routes/configuration.ts:15`), and the alternative is an escalation path: a
user holding `fields:edit` but not `roles_permissions:edit` could otherwise
grant themselves visibility of a field their role is denied. The consequence is
that an admin with only the Fields module sees the Field Builder without the
picker; the UI handles that by omitting the section, and the server rejects the
call regardless of what the client sends.

**Placement decision — the admin module** (`apps/api/src/admin/*`,
registered in `http/routes/admin.ts`), not the configuration module, even
though the path is `/fields/…`. Reasons: the module gate is the admin module's
own; `lockRole`/`bump`/replace-with-old-and-new-audit already exist there and
nowhere else; and `ConfigurationAuditAction` (`configuration/audit.ts:11-12`)
has no `replace` member, while the admin repository's `audit` helper takes free
strings. A one-line comment at the route registration will say why a
`/fields`-prefixed path lives in the admin route file.

### 2. Repository write: `replaceRoleVisibilityForField`

New method on `AdminRepository` / `PrismaAdminRepository`, structurally the
transpose of `replaceFieldVisibility`:

1. Load and lock the **field** row (`SELECT … FOR UPDATE` on `fields`), 404 if
   absent.
2. Resolve the affected role set = `roleIds` in the payload ∪ `roleIds` on
   existing rows for this field. Lock those role rows **in sorted id order**.
   Sorted order is what keeps this from deadlocking against a concurrent
   field-side replace; the role-side replace only ever holds one role lock, so
   it cannot form a cycle with this.
3. Validate every payload `roleId` exists in the organization. Rows naming a
   role outside the org are a `validation_error`, matching the role-side check
   on fields (`:308-312`).
4. Read old rows for the field, `deleteMany({ organizationId, fieldId })`,
   `createMany` the new set.
5. `bump` **every affected role's** version — both roles gaining and roles
   losing access. This is the one place the transpose is not symmetric with the
   role-side method, and getting it wrong would leave a stale
   `AuthorizationDecision.roleVersion` for the losing roles.
6. One audit row: `entity_type = 'field_visibility'`, `entity_id = fieldId`,
   `action = 'replace_field_roles'`, `old_value` = previous rows,
   `new_value` = new rows. A distinct action string (rather than reusing
   `replace`) is what lets an auditor tell "one role's whole set was rewritten"
   from "one field's whole set was rewritten" — the two carry different
   `entity_id` meanings under the same `entity_type`.

Inactive roles are *not* rejected. Deactivating a role does not delete its
`field_visibility` rows today, the permission engine already denies an inactive
role via `ROLE_INACTIVE`, and rejecting them would make a lossless round-trip
of the GET impossible. The picker instead renders them, flagged, so a save
never silently drops one (see §4).

### 3. Validation

New `roleVisibility(value)` in `admin/validation.ts`, alongside the existing
`visibility`: array; non-blank `roleId`; `accessLevel ∈ {VIEW, EDIT}`; no
duplicate `roleId`; sorted by `roleId`. Same `AdminError('validation_error', …)`
codes and the same `unique()` helper — no new error taxonomy.

### 4. Frontend: a role picker inside `FieldEditor`

`FieldEditor` gains a "Role visibility" section below the existing controls,
built from the shared `Checkbox` — two checkboxes per role, **View** and
**Edit**, matching the task's stated shape and the journey-access idiom at
`RoleDetailPage.tsx:280-293`.

The two checkboxes encode the three states the table can hold, with `EDIT`
implying view per `docs/permissions/access-model.md:50`:

| View | Edit | Stored |
|---|---|---|
| ☐ | ☐ | no row — hidden |
| ☑ | ☐ | `VIEW` |
| ☑ | ☑ | `EDIT` |

Checking Edit checks View; unchecking View unchecks Edit. The fourth
combination is unrepresentable, which is why this is two bound checkboxes over
one tri-state value rather than two independent booleans.

Deliberate divergence from `RoleDetailPage`, flagged rather than silent: that
page uses a `<Select>` for the same tri-state. This plan follows the task's
explicit "view/edit checkboxes" instruction and uses an existing shared
component to do it, so no new component paradigm enters the codebase. If the
inconsistency is unwanted, the cheap resolution is to converge *both* on one
control in a later pass — not to fork a new picker component here.

Other frontend behavior:

- Roles are loaded with `loadAllPages` and **no active filter**, so inactive
  roles holding a grant appear (marked "inactive") and a save round-trips
  losslessly.
- New field: every box starts unchecked, with the hint "Fields start hidden
  from every role." Nothing is pre-checked — that is the whole point of the
  default.
- Bulk affordances mirroring the role page's "Set all…": *Grant view to all* /
  *Clear all*.
- Gating: `can('roles_permissions','edit')` → editable; view-only → a read-only
  summary; neither → the section is not rendered at all (matching journey
  access's "not greyed out" rule in `access-model.md:48`).

**Save flow — two requests, never a per-role loop:**

- Create: `POST /fields` → on success, `PUT /fields/:id/visibility` **once**
  with the full set, and only if any box is checked and the caller may edit.
- Edit: `PATCH /fields/:id` → `PUT /fields/:id/visibility` once, only when the
  visibility draft is dirty.

These are two requests, not one transaction, because the two halves sit behind
two different permission gates and merging them would mean either widening the
`fields:create` gate or refusing field creation to admins who lack
`roles_permissions:edit`. The failure mode is benign and worth stating: if the
create succeeds and the visibility call fails, the field exists granted to
nobody — which is exactly the documented default, not a partially-open field.
The error banner reports it and the admin retries from the edit form.

### 5. Documentation

`docs/api/endpoints.md` gains both paths under **Fields** with their module
gate, and a note that the same `field_visibility` rows are reachable from
either axis. `docs/permissions/access-model.md` §D gains one sentence: the
allow-list is editable from the role side or the field side, both gated on
`roles_permissions`, both audited.

## Files to touch

**API**

- `apps/api/src/admin/types.ts` — add `RoleVisibilityInput { roleId, accessLevel }`.
- `apps/api/src/admin/validation.ts` — add `roleVisibility()`.
- `apps/api/src/admin/repository.ts` — add `listRoleVisibilityForField`,
  `replaceRoleVisibilityForField`.
- `apps/api/src/admin/prisma-admin-repository.ts` — implement both; add a
  `lockField` helper beside `lockRole`.
- `apps/api/src/admin/service.ts` — add the two pass-throughs.
- `apps/api/src/http/routes/admin.ts` — register `GET`/`PUT
  /api/v1/fields/:fieldId/visibility`.

**Web**

- `apps/web/src/lib/api-client.ts` — `adminApi.fieldRoleVisibility(fieldId)` and
  `adminApi.saveFieldRoleVisibility(fieldId, visibility)`.
- `apps/web/src/types/domain.ts` — `FieldRoleVisibility` row type.
- `apps/web/src/pages/admin/FieldsPage.tsx` — picker in `FieldEditor`, draft
  state, two-step save, permission gating.
- `apps/web/src/mocks/handlers.ts` — MSW handlers for both new paths.

**Tests**

- `apps/api/src/__tests__/admin.test.ts` — `roleVisibility()` validation cases.
- `apps/api/src/__tests__/phase13a.postgres.integration.test.ts` — new.
- `apps/web/src/pages/admin/AdminFlows.test.tsx` — Field Builder cases.

**Docs**

- `docs/api/endpoints.md`, `docs/permissions/access-model.md`, this plan.

No Prisma schema change and **no migration**: `field_visibility` already has
the shape, the unique constraint, and the index this needs.

## Out of scope

- Any 13b or 13c work — no filter engine, no campaigns, no `campaign_sends`.
- Changing the role-side endpoints or `RoleDetailPage`. Both keep working
  unchanged; this is a second projection of the same table.
- Giving `ConfigurationService.deleteFieldVisibility` a route, or removing it.
  The new `PUT` covers revocation; the dead service method is noted above and
  left alone rather than deleted in a phase that isn't about it.
- Converging the `<Select>` and checkbox idioms for tri-state visibility.
- Per-journey field visibility. `getFieldVisibility` takes an optional
  `journeyId` (`permission-engine/src/types.ts:92-97`) that no caller passes and
  no row supports; unchanged here.
- Any change to the "no row = hidden" default itself.

## Risks / open questions

1. **Two-request create is not atomic.** Accepted, with the benign failure mode
   argued in §4. The alternative — one endpoint spanning both gates — trades a
   real escalation risk for a cosmetic one. Flagging rather than deciding
   silently: if you want a single atomic create, say so at approval and the
   design becomes `POST /fields` accepting an optional `visibility[]` that is
   rejected outright unless the caller holds `roles_permissions:edit`.
2. **`entity_id` overloading in `system_audit_logs`.** After this, rows with
   `entity_type = 'field_visibility'` carry a role id under `action='replace'`
   and a field id under `action='replace_field_roles'`. Distinct action strings
   are the mitigation; a cleaner fix would be a dedicated entity type, which
   would break existing audit queries for no functional gain.
3. **Deadlock surface.** New multi-row lock ordering. Mitigated by sorted-id
   locking (§2) and covered by a concurrent-replace test.
4. **No conflict found between docs and code for this sub-phase.** The one
   documentation gap — `docs/api/endpoints.md` never described a reverse
   endpoint because none existed — is drift of the kind ADR-0011 already
   settled, so this plan updates the document rather than opening a new ADR.
5. **A role losing access mid-session keeps nothing.** Because visibility is
   re-resolved per request, revocation is immediate. Called out because it is
   the property the security test depends on, and it would silently regress if
   anyone later adds a capability cache.

## Test plan

Per `docs/testing/quality-gates.md`. Synthetic fixtures only — no Wellsure
field, role, journey or status names anywhere, matching every prior phase.

**Unit — `admin.test.ts`**

- `roleVisibility()` normalizes and sorts a valid set.
- Rejects: non-array, blank `roleId`, duplicate `roleId`, `accessLevel` outside
  `{VIEW, EDIT}`.

**Real-Postgres integration — `phase13a.postgres.integration.test.ts`**

Built on the Phase 9 harness (`phase9.postgres.integration.test.ts`): real
schema from the migration files, real `PrismaClient`, real repositories, real
route functions. Two synthetic roles — A (granted) and B (not granted) — one
synthetic journey, one status, one lead.

1. **The core security assertion.** Create a field through the real create
   path; grant `EDIT` to role A through the new `PUT`; write a value into that
   field on a lead as a user in role A. Then, as a user in role B with no row
   for that field, read all three surfaces — `GET /leads` (list), `GET
   /leads/:id` (detail), `GET /leads/:id/activity` (timeline) — and assert that
   **neither the field id nor the stored value appears anywhere in the
   serialized response**, asserted against `JSON.stringify` of the whole body,
   the whole-response style ADR-0011 fixed for the timeline. Also assert
   `GET /auth/capabilities` for role B omits the field.
2. **Non-vacuity.** Grant `VIEW` to role B through the same endpoint, re-read
   all three surfaces, assert the value now appears. Without this, step 1
   passes even if the test never wrote the value.
3. **Round-trip.** Reverse `GET` returns exactly the rows written, including a
   row for an inactive role, and returns `[]` for a field with no grants.
4. **Full-replace semantics.** A second `PUT` omitting role A removes A's row;
   `{ visibility: [] }` clears every row.
5. **Audit.** One `system_audit_logs` row per `PUT`:
   `entity_type='field_visibility'`, `entity_id=<fieldId>`,
   `action='replace_field_roles'`, `old_value`/`new_value` matching the
   before/after sets.
6. **Version bump.** Roles gaining *and* losing access both have `version`
   incremented.
7. **Authorization.** A user without `roles_permissions:edit` gets 403 from the
   `PUT` even when holding `fields:edit`; without `roles_permissions:view`,
   403 from the `GET`; a field id from another organization gets 404; a
   `roleId` from another organization gets 400.
8. **Concurrency.** Two overlapping `PUT`s for the same field settle to one
   coherent row set with two audit rows and no deadlock error.

**Frontend — `AdminFlows.test.tsx`** (MSW, existing conventions)

- Creating a field with two roles checked issues exactly **one** `PUT
  /fields/:id/visibility` carrying the full set — asserted by counting
  intercepted requests, which is the test that would fail if anyone
  reintroduced a per-role loop.
- Checking Edit checks View; unchecking View clears Edit.
- A brand-new field's picker renders with every box unchecked.
- The section is absent for a session without `roles_permissions:edit`.

**Gates:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, plus the Postgres suite
via `FALCON_POSTGRES_URL`. Permission impact and audit behavior are reviewed
explicitly above rather than implied.

## Rollback plan

No schema change, so rollback is `git revert` of the implementation commit. The
new endpoints disappear; existing `field_visibility` rows are untouched and
remain fully editable from the role side, which is where they were editable
before this sub-phase. No data written by 13a needs migrating back — the rows
are indistinguishable from rows written by the role-side endpoint.
