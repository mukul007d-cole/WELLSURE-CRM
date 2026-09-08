# Phase 19 — Status Visibility (status-scoped role record visibility)

Status: **proposed — awaiting approval. Nothing in this plan is implemented.**
Per `PLANS.md`, no code changes ship until this plan is explicitly approved,
same discipline Phase 2 (the permission engine itself) and Phase 14a (the
`TEAM`-scope decision) received.

## Goal

Let an admin restrict which Roles can see a lead **while one of its process
instances sits in a given Status** — so a lead worked by Sales through to
"Ready For Onboarding" becomes invisible to Sales and visible only to Ops from
that point, and invisible to Ops once it moves past their stage — as a new,
additive clause in `resolveAuthorization`, never a parallel authorization path,
and enforced identically across the Seller List, search, Seller 360, and the
activity timeline.

## Docs read

`docs/permissions/access-model.md`, `docs/permissions/permission-engine-schema.md`,
`docs/architecture/decisions/0001-single-status-field.md`,
`0006-team-scope-from-hierarchy.md`, `0009-admin-bootstrap-and-permission-catalog.md`,
`0011-endpoint-doc-drift-and-activity-read.md`,
`0014-teams-are-not-team-scope.md`, `0015-per-status-assignment-routing.md`,
`docs/planning/phase-11-seller-record-workspace.md`,
`docs/planning/phase-13a-field-role-visibility-at-creation.md`,
`docs/planning/phase-14a-teams-within-departments.md`,
`docs/planning/phase-14b-per-status-assignment-routing.md`,
`docs/requirements/glossary.md`, `docs/api/endpoints.md`,
`docs/workflows/journey-definitions.md`, `docs/testing/quality-gates.md`,
`AGENTS.md`, `PLANS.md`.

Code read (not assumed from the docs): `packages/permission-engine/src/{decision,scope,types,fields}.ts`
and its `__tests__/fixtures.ts`; `apps/api/src/routes/leads.ts` (`resolveLeadAccess`,
`listSellers`, `getSeller360`, `getLeadActivity`, `createLead`, `editLead`,
`moveLeadJourney`); `apps/api/src/leads/{filter-sql,prisma-lead-repository}.ts`
(`processExists`, `sellerWhere`/`processWhere`); `apps/api/src/routing/{service,rule-service}.ts`;
`apps/api/src/permissions/prisma-permission-repository.ts`; the `Status`,
`RoleJourneyAccess`, `FieldVisibility`, `StatusRoutingPermission` models in
`packages/database/prisma/schema.prisma`; `apps/web/src/pages/admin/{JourneyDetailPage,StatusRoutingPermissions}.tsx`;
`apps/web/src/components/layout/GlobalSearch.tsx`.

---

## THE DECISION THIS PLAN NEEDS FIRST: what does an unconfigured Status mean?

**Nothing else here can be finalized before this is settled** — it is the
single most consequential choice in this phase, called out explicitly rather
than folded into §Risks, the same treatment 14a's `TEAM`-scope question got.

### The two existing precedents, and why neither transfers cleanly

`field_visibility` and `role_journey_access` are both allow-lists where
**absence means denied**:

- A new Field is invisible to every role, including its creator's, until an
  admin opens the Role page (`configuration/service.ts` writes only the `fields`
  row and an audit entry — nothing else). Phase 13a documented this as the
  *existing* semantic and deliberately did not change it.
- A new Journey would be exactly as invisible, **except** `createJourney`
  papers over it: `grantJourneyAccessToConfigRoles` auto-grants access to every
  role that already holds `journeys_statuses:view`, specifically so a Journey
  is never created invisible to its own author. That auto-grant is the load-
  bearing detail — `role_journey_access` reads as "absence denies" in the
  schema, but in practice no admin-facing role experiences a silent "no
  Journey visible" on a pre-existing deployment, because every deployment's
  Journeys already carry these rows from creation time.

Both precedents share a property Status Visibility does not have: **the thing
being gated is newly created**, so "starts hidden" costs nothing to a live
deployment — nobody was seeing it before it existed, and (for Journeys) the
gap is closed at creation time anyway. Every Status this feature would apply
to **already exists**, in every organization, with leads actively sitting in
it, visible today under ordinary `DataScope` rules to whichever roles hold
`leads:view`.

If "absence denies" is copied literally: the moment this ships, **every
Status in every organization has zero `status_visibility` rows** (the table is
new and empty), so the new clause denies every role, for every lead, in every
Status, everywhere — not a rough edge, a total outage, org-wide, with no
migration able to prevent it short of an admin enumerating every
Status × every Role that should keep working *before* the deploy goes out.
That is exactly the risk the task brief named, and it is real: this is not a
smaller-blast-radius case like hiding one Field's value on an otherwise-
visible record — this hides the **entire lead**, on every surface, from
everyone.

### The precedent that actually fits: Phase 14b's own routing rules

`status_routing_rules` is also a per-Status table introduced onto pre-existing
Statuses, and 14b's own words for its default: **"a Status with no rule is
simply unrouted."** No rule does not mean "no assignment permitted" — it means
the feature has not been turned on for that Status, and behavior is exactly
what it was before the table existed. That is the shape of default this
feature needs, applied to a different axis.

### Recommended decision

**A Status with zero `status_visibility` rows imposes no restriction at all —
ordinary `DataScope`, Journey access, and direct-grant rules apply exactly as
they do today.** A Status gains a restriction only once an admin adds at least
one row to it, at which point visibility of leads currently sitting in that
Status narrows to the listed Roles (still `AND`ed with ordinary scope — see
§5 below). Clearing every row for a Status returns it to the default,
unrestricted state — not to "denied for everyone." (There is deliberately no
way to configure "visible to no Role" — see Risk 6.)

This keeps the row **shape** identical to `field_visibility` /
`role_journey_access` (an allow-list, audited, gated on `roles_permissions`,
copyable CRUD pattern) while diverging, deliberately and for a stated reason,
on what *absence* means — because what is being hidden here is the whole
record, not one field or one not-yet-existing Journey. No backfill or
migration is required: the empty-table state on day one is the correct,
intended "feature not yet used" state for every existing Status, not a defect
needing repair.

If you want the stricter allow-list-from-day-one behavior instead, say so at
approval — it would require a mandatory backfill step (populate
`status_visibility` for every existing Status with every Role that must keep
seeing it) gated *before* the migration is allowed to run in any environment
with existing data, and I do not recommend building that gate for a feature
whose entire point is "some Statuses need this, most don't."

---

## Current state

### Terminology — proposed name, checked for collisions

**"Status Visibility."** Mirrors "Field Visibility" naming exactly (glossary
has no standalone "Visibility" entry — it appears only as prose in
`access-model.md` §D, prefixed each time, so "Status Visibility" slots in
beside it without redefining anything). Table `status_visibility`. Not to be
confused with `status_routing_permissions` (Phase 14b) — that gates who may
*configure or operate routing* for a Status; this gates who may *see a lead*
while it sits in one. Both are per-`(status, role)` allow-lists, both are
edited under `roles_permissions:*`, and that surface similarity is exactly why
this plan calls out the distinction rather than letting the names blur.

`docs/requirements/glossary.md`'s existing "Status" row needs one added
sentence once this ships: a Status can additionally carry a Role allow-list
governing lead visibility, independent of `outcome_type`/`behavior_type`.

### `resolveAuthorization` has no status concept today

Read in full (`packages/permission-engine/src/{decision,scope,types}.ts`).
`AuthorizationRequest` carries `journeyId?`, `leadId?`, field-id lists,
`assignmentTypes?` — no `statusId` field anywhere, and `decision.ts` never
reads a lead's or process instance's current Status. This is a genuinely new
input to the decision, not a gap in an existing one.

Journey access is checked **two ways** today, and Status Visibility needs the
same duality, for the same reason — a single-record decision and a many-row
SQL filter are different shapes of the same question:

| | Single-record ("is this one allowed?") | Many-row ("which of these are allowed?") |
|---|---|---|
| Journey | `hasJourneyAccess(roleId, journeyId)` → boolean, checked when `AuthorizationRequest.journeyId` is set | `RecordPredicate.journeyIds`, bound into `filter-sql.ts`'s `= ANY(...)` |
| Status Visibility (proposed) | `hasStatusVisibility(roleId, statusId)` → boolean, checked when `AuthorizationRequest.statusId` is set | `RecordPredicate.roleId` (new — see below), bound into an `EXISTS`/`NOT EXISTS` pair in `filter-sql.ts` |

### The per-process "union of visible processes" pattern already exists, and a new blocking `PermissionDeniedReason` composes with it for free

`resolveLeadAccess` (`routes/leads.ts:486-538`, shared by `getSeller360` and
`getLeadActivity`) loops over a lead's **active** process instances, calls
`resolveAuthorization` once per process with that process's `journeyId`, and
keeps the process only if every *blocking* denial reason is absent
(`FIELD_VIEW_DENIED` is explicitly non-blocking — it strips fields, it does
not drop the process). The lead 403s only when **no** process instance
survives; a surviving process's activity rows are the only ones
`getLeadActivity` returns.

This is precisely Phase 11's answer to the task's multi-Journey question,
already built and already tested for a different axis (Journey access). If
Status Visibility is added as **one more blocking `PermissionDeniedReason`**
inside `resolveAuthorization` — evaluated against `process.currentStatusId`,
the same way `journeyId` is evaluated against `process.journeyId` — this loop
requires **zero changes** to compose correctly: a lead with one process
instance in a denied Status and another in an allowed one keeps the lead
visible through the allowed process, and only that process's rows appear in
the timeline. This is a structural consequence of plugging into the existing
per-process loop, not a new rule that has to be written for the multi-Journey
case — confirmed by reading the loop, not assumed.

The one place this does **not** fall out for free: `listSellers`'s SQL
predicate (§ below) filters many leads at once, not one process instance at a
time, so the new clause has to be written directly into the SQL that already
implements "does *any* process instance of this lead satisfy access" —
`processExists()` in `filter-sql.ts`. Adding the clause **inside** that
function's inner `EXISTS` (rather than as a sibling top-level `AND` on
`leads`) is what makes the list surface honor the same per-process union the
detail surface gets automatically. Getting this placement wrong would silently
turn "one visible process is enough" into "every process instance must be
visible," which is the opposite of Phase 11's own rule and would regress
existing Journey-access behavior on multi-Journey leads, not just this new
axis. Flagged here so the implementation is checked against it directly.

### `createLead`/`editLead`/`moveLeadJourney` need one clarified rule, not a new mechanism

- **`editLead`/status changes**: the gate must be evaluated against the
  process instance's **current** Status at the time of the request, not the
  Status being written to. A Sales rep moving a lead into "Ready For
  Onboarding" is expected to lose visibility of it **immediately after** the
  move succeeds — that is the literal request — not to be blocked from making
  the move because they can't see the destination. This mirrors how a `SELF`-
  scoped rep already loses a lead the instant they reassign it away; nothing
  new is needed beyond checking the record's pre-edit Status, which
  `resolveAuthorization` already does for every other axis.
- **`createLead`**: there is no existing process instance yet, so "current
  Status" means the Status the lead is about to land in (the Journey's
  `isDefaultOnCreate` Status, or an explicit `statusId`). Recommended:
  `createLead`'s authorization check should include that landing Status, so a
  role that could never see leads in that Status is refused at creation rather
  than allowed to create a lead it cannot immediately find. Flagged as a
  judgment call, not an inference — say so at approval if you would rather
  allow creation and let the lead disappear from its own creator immediately
  after, matching 14b's own precedent of naming a creation-time gap explicitly
  rather than silently deciding it (14b §5).
- **`moveLeadJourney`**: checked against both the source and target Journey
  today (§`routes/leads.ts:193-223`); Status Visibility should be checked the
  same way — the source process instance's current Status (can the mover
  still see what they're moving?) is already covered by the existing
  `editAction` check on the source Journey; the target's landing Status
  follows the same "should creation-style checks include the landing Status"
  judgment call as `createLead`, for the same reason.

### The routing-pool interaction is real, and 14b's own "skip, don't fail" precedent resolves it

Read in full: `apps/api/src/routing/{rule-service,service}.ts`.
`status_routing_rules` pools are **user-level** — a Team's members or a named
user list (`validatePool` in `rule-service.ts` checks only that a pool member
is an active User in the organization; it has no concept of Role at all).
Status Visibility is **role-level**. Nothing today stops a routing rule from
assigning a lead to a user whose Role is not allowed to see the Status it is
being routed into — exactly the self-inflicted bug the task named: route,
then the new owner can't find what they were just given.

**Recommended: filter routing candidates by Status Visibility at evaluation
time, not at rule-configuration time.** `StatusRoutingService.choose()`
(`routing/service.ts:111-141`) already filters the pool down to active users
before picking one (`"A pool member who has since been deactivated is not a
candidate"`). Add one more filter of the identical shape: a candidate whose
Role is not allow-listed for `rule.statusId` (when that Status has any
`status_visibility` rows at all — an unconfigured Status excludes nobody) is
not a candidate either. If every remaining candidate is filtered out this
way, this is a new `SkipReason` (e.g. `no_visible_candidate`) through the
**existing** skip path — no assignment, existing assignment untouched,
`routing_skipped` activity written, status change still commits. This is
14b's own §6 decision ("a rule that cannot produce a candidate is a
configuration condition, not a fault") applied to one more reason a pool can
come up empty; it needs no new mechanism, only one more candidate filter and
one more `SkipReason` value.

This also means routing pool membership is **not** validated against
Status Visibility at rule-write time, and deliberately so: a Team's
membership changes after the rule is saved (14a), and a user's Role can be
reassigned after the rule is saved — validating once at configuration time
would go stale exactly the way an upfront check always does in this codebase
(see 14b's own team-deactivation-after-rule-creation sequencing). Filtering at
evaluation time stays correct automatically as either configuration changes,
with no re-validation step to remember. A configuration-time *warning*
("every current candidate for this rule is excluded from this Status's
visibility") is a plausible frontend nicety but is **out of scope** here — it
is cosmetic, not a correctness requirement, since the evaluation-time filter
already prevents the bug structurally.

### Full record-visibility gate, confirmed

Per the task brief's own framing, restated here as a recorded decision rather
than left implicit: this hides the **entire lead** — from the Seller List,
from search (`GlobalSearch.tsx` routes into the same Seller List query with a
`search` param; there is no separate search backend to fix separately —
confirmed by reading it), from Seller 360, and from the activity timeline —
**and** from a direct request by id (`getLeadById`, `getSeller360`). It is not
field-level redaction (that is `field_visibility`'s job, unchanged and
untouched by this feature) and not "hidden from one view but reachable by
link" — a denied role's request for the record by id gets exactly the same
403 a denied Journey or denied scope already produces.

### Composition with data scope: `AND`, never `OR` — stated explicitly per the task brief

A Role in a Status's allow-list gains **no new reach**. It still only sees a
lead if the lead is *also* within that Role's ordinary `SELF`/`TEAM`/
`DEPARTMENT`/`ORGANIZATION` scope (and Journey access, and an active user, and
so on) — Status Visibility is one more required condition `AND`ed onto the
existing chain in `resolveAuthorization`, contributing one more blocking
`PermissionDeniedReason` (`STATUS_VISIBILITY_DENIED`) exactly alongside
`RECORD_SCOPE_DENIED` and `JOURNEY_DENIED`. There is no code path where this
feature widens what a Role can see; it only ever narrows.

One emergent property worth recording because it is a strength, not a
coincidence: **moving a lead's Status automatically changes who can see it,
with no transition-specific code.** The gate is evaluated fresh against
`process.currentStatusId` on every request, so it needs no "on status change,
revoke X and grant Y" hook the way a notification rule fires once on the
status-change event — it is simply always re-derived, matching every other
axis in this engine (`13a`: *"Enforcement is per-request... 'immediately after
creation' is testable without any invalidation work"*).

---

## Proposed approach

### 1. Schema — one new table, modeled directly on `field_visibility`

```prisma
model StatusVisibility {
  id             String   @default(uuid()) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  statusId       String   @map("status_id") @db.Uuid
  roleId         String   @map("role_id") @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  status       Status       @relation(fields: [organizationId, statusId], references: [organizationId, id], onDelete: Restrict)
  role         Role         @relation(fields: [organizationId, roleId], references: [organizationId, id], onDelete: Restrict)

  // Allow-list, scoped per Status. Absence for a *whole Status* (no rows at
  // all) means unrestricted — see the decision above. Once any row exists for
  // a Status, presence of a (status, role) row is what grants that Role
  // visibility of leads currently in it.
  @@unique([organizationId, statusId, roleId])
  @@index([organizationId, roleId])
  @@map("status_visibility")
}
```

No `accessLevel` column — this is membership, not a VIEW/EDIT tri-state; a
Role either can see the record while it's in this Status, or the row is
absent. One migration, additive, no existing table altered. Rollback is
`DROP TABLE status_visibility` (see §Rollback).

### 2. Permission engine — one new optional request field, one new repository method, one new denial reason

`packages/permission-engine/src/types.ts`:

- `AuthorizationRequest.statusId?: string` (single-record form, parallel to
  `journeyId`).
- `PermissionRepository.hasStatusVisibility(input: { roleId, organizationId, statusId }): Promise<boolean>` —
  encodes the whole default-then-restrict rule in one place:
  `NOT EXISTS (any row for statusId) OR EXISTS (a row for statusId AND roleId)`.
- `PermissionDeniedReason` gains `STATUS_VISIBILITY_DENIED`.
- `RecordPredicate` gains `roleId: string` — needed so the SQL/Prisma list
  path (§4) can bind the caller's Role into its `EXISTS` clause the same way
  `journeyIds`/`allowedUserIds` are already bound. `buildRecordPredicate` in
  `scope.ts` already has every input `resolveAuthorization` computes
  (`role.id` is resolved earlier in `decision.ts` before `buildRecordPredicate`
  is ever called) — this is an additive field on an existing call, not a new
  parameter threaded through new call sites.

`decision.ts` gains, mirroring the existing `journeyAllowed` block exactly:

```ts
const statusVisible =
  input.request.statusId === undefined
    ? true
    : await input.repository.hasStatusVisibility({
        roleId: role.id,
        organizationId: input.request.organizationId,
        statusId: input.request.statusId,
      });
if (!statusVisible) deniedReasons.push('STATUS_VISIBILITY_DENIED');
```

Unconditional when `statusId` is absent (list-style calls that don't name one
specific Status), exactly like `journeyAllowed` defaults to `true` when
`journeyId` is absent. No other line in `decision.ts` changes. This is the
"additional clause on the existing decision, not a parallel path" the task
requires, made concrete.

`packages/permission-engine/src/scope.ts`: `buildRecordPredicate` passes
through `roleId` into the returned `RecordPredicate`, no other change.

### 3. Repository implementation

`apps/api/src/permissions/prisma-permission-repository.ts`: `hasStatusVisibility`,
structurally identical to `hasJourneyAccess` — one query against the new
table, `NOT EXISTS (...) OR EXISTS (...)` compiled either as two Prisma calls
or one raw boolean query; whichever keeps parity with the SQL form used in §4
is preferred, since a divergence here is exactly the kind of drift
`filter-sql.ts`'s own header comment warns about for the list path.

`packages/permission-engine/src/__tests__/fixtures.ts`: extends the shared
fixture repository with a `statusVisibility` array and the corresponding
method, following the existing `journeys`/`fields` arrays' shape, so
`decision.ts`'s table-driven tests can exercise the new clause without a
database.

### 4. List/count — the SQL and Prisma-oracle predicates, together

`apps/api/src/leads/filter-sql.ts`'s `processExists()` gains one more clause
inside its existing `parts` array (alongside `p.active`, the Journey `= ANY`,
and the optional `p.current_status_id = ...` filter) — **inside** the
per-process `EXISTS`, not as a sibling clause on `leads`, per the multi-Journey
finding above:

```sql
(NOT EXISTS (SELECT 1 FROM status_visibility v
              WHERE v.organization_id = p.organization_id AND v.status_id = p.current_status_id)
 OR EXISTS (SELECT 1 FROM status_visibility v
             WHERE v.organization_id = p.organization_id AND v.status_id = p.current_status_id
               AND v.role_id = <bound predicate.roleId>))
```

`apps/api/src/leads/prisma-lead-repository.ts`'s `processWhere` (the Prisma-
builder oracle `sellerWhere` is built from, kept in sync only by the
`phase13b.postgres.integration.test.ts` parity test) gets the equivalent
`NOT` / nested `some`/`none` filter. Both must change together or the parity
test catches the drift — which is precisely what that test exists for, so it
is the safety net for this exact class of mistake, not incidental coverage.

Because `buildSellerListQuery`'s `ids` and `count` fragments both call the
same `whereClause` → `accessClause` → `processExists` chain, and
`listMatchingLeadIds` (bulk campaign send) shares the same predicate, all
three inherit the fix from one change — no separate list-vs-count-vs-bulk
logic to keep in sync, matching `access-model.md`'s "counts use the exact same
access-filtering query as lists" rule directly.

`listSellers`'s explicit `statusId` filter (`SellerListInput.statusId`, when
an admin filters the Seller List UI by one specific Status) should also be
passed into `resolveAuthorization`'s `AuthorizationRequest.statusId`, exactly
as `journeyId` already is — so filtering by a Status the caller's Role cannot
see 403s cleanly instead of silently returning zero rows.

### 5. Wiring the single-record call sites

`apps/api/src/routes/leads.ts`:

- `resolveLeadAccess` (shared by `getSeller360`/`getLeadActivity`): pass
  `statusId: process.currentStatus.id` into the per-process
  `resolveAuthorization` call it already makes. No other change — the union
  behavior is inherited per §Current-state above.
- `getLeadById`: pass `statusId: process.currentStatusId` (needs adding to
  `LeadDetailRecord.processInstances`, which today carries only
  `{ journeyId, active }` — this is the one repository-shape change on this
  path).
- `editLead`: pass the process instance's **current** `statusId` (pre-edit),
  per the current-vs-target rule decided above.
- `createLead`: pass the landing Status's id (the explicit `statusId` or the
  Journey's default-on-create Status), per the judgment call flagged above —
  confirm at approval.
- `moveLeadJourney`: pass the source process instance's current `statusId` on
  the source-Journey check; the target-Journey check's status question is the
  same judgment call as `createLead`.
- An explicit audit pass over every other `resolveAuthorization` caller with a
  `leadId` (bulk reassign/status-change, export, attachment access) is an
  implementation-time checklist item — this plan does not claim to have found
  every call site, only the ones read directly above.

### 6. Configuration CRUD — mirrors `status_routing_permissions` exactly

```
GET  /api/v1/statuses/:statusId/visibility   roles_permissions:view
PUT  /api/v1/statuses/:statusId/visibility   roles_permissions:edit
```

`PUT` body `{ "roleIds": ["…"] }` — a whole-Status replace, matching every
other allow-list write in this codebase. `{ "roleIds": [] }` clears every row
for the Status, returning it to the default unrestricted state (never
"denied for everyone" — see Risk 6). No new permission-catalog module: gated
on `roles_permissions`, **never** on `journeys_statuses`, following 13a's and
14b's identical self-escalation rule — an admin who can configure Statuses
but not edit permissions must not be able to grant themselves (or anyone)
visibility rights, including by omission (nobody left off a first
configuration keeps today's unrestricted behavior, so there is no
self-*denial* footgun either).

Write path (`RoutingRuleService.replaceGrants` is the direct template):

1. Lock/validate the Status exists and is in the organization.
2. Validate every `roleId` exists in the organization (`AdminError`/
   `validation_error` otherwise, same taxonomy as every other admin write).
3. Read old rows, `deleteMany`, `createMany` the new set, in one transaction.
4. Bump **every affected Role's** `version` — Roles gaining *and* losing a row
   — sorted by id before the update loop, exactly as
   `replaceRoleVisibilityForField` and `RoutingRuleService.replaceGrants`
   already do, and for the identical deadlock-avoidance reason.
5. One `system_audit_logs` row: `entity_type = 'status_visibility'`,
   `entity_id = statusId`, `action = 'replace'`, `old_value`/`new_value` = the
   role id arrays.

New service class `apps/api/src/statuses/status-visibility-service.ts` (or a
method group inside the existing `RoutingRuleService`'s file, given how
closely it mirrors `replaceGrants` — a decision left for implementation, not
because it changes behavior, but because duplicating an entire service class
for one method group would be its own review comment).

### 7. Admin UI — inside Journey → Manage Journey → Statuses, not a new tab

Placement matches 14b's own routing panel exactly, because the task requires
it and because it is the established precedent for "configuration that lives
per-Status": `JourneyDetailPage`'s Statuses list gains a second expandable
section beside "Routing" — "Visibility" — rendered as a Role checklist
(`StatusRoutingPermissions.tsx` is the direct template: same query shape, same
derived-not-copied edit state per 13a's stale-copy lesson, same
`roles_permissions:edit`-gated save), collapsed to a single boolean per Role
rather than a three-action grid, since there is no VIEW/CONFIGURE/OPERATE
distinction here.

The list/detail row for a Status should show a plain indicator when it has
any visibility restriction configured (e.g. "Visible to 2 roles" vs. nothing),
so an admin looking at the Statuses list is not surprised by a restriction
they cannot see without opening every panel — a small addition, listed here
so it is not silently skipped, not because it changes enforcement.

### 8. Audit and permission-gating summary

Every write is transactional, audited, and gated on `roles_permissions:edit`
(never on `journeys_statuses:*`); every read is gated on
`roles_permissions:view`. No hard deletes anywhere in this feature — a
`PUT` is always a full, audited replace, matching every configuration entity
in the system.

---

## Files to touch

**Database**
- `packages/database/prisma/schema.prisma` — `StatusVisibility` model (§1).
- New migration (additive; no existing table altered).

**Permission engine**
- `packages/permission-engine/src/types.ts` — `AuthorizationRequest.statusId`,
  `PermissionRepository.hasStatusVisibility`, `PermissionDeniedReason.STATUS_VISIBILITY_DENIED`,
  `RecordPredicate.roleId`.
- `packages/permission-engine/src/decision.ts` — the new clause (§2).
- `packages/permission-engine/src/scope.ts` — `buildRecordPredicate` passes
  `roleId` through.
- `packages/permission-engine/src/__tests__/fixtures.ts` — synthetic
  `statusVisibility` fixture data and repository method.

**API**
- `apps/api/src/permissions/prisma-permission-repository.ts` —
  `hasStatusVisibility`.
- `apps/api/src/leads/filter-sql.ts` — `processExists()`'s new clause (§4).
- `apps/api/src/leads/prisma-lead-repository.ts` — `processWhere`'s matching
  clause; `LeadDetailRecord.processInstances` gains `statusId` for
  `getLeadById`.
- `apps/api/src/routes/leads.ts` — every call site in §5.
- `apps/api/src/routing/service.ts` — `choose()`'s new candidate filter and
  `SkipReason` value (§ routing interaction).
- `apps/api/src/routing/rule-service.ts` — read once more, unmodified unless
  the configuration-time warning (out of scope) is later requested.
- New: `apps/api/src/statuses/status-visibility-service.ts` (or an addition to
  `routing/rule-service.ts` — see §6) and its `validation.ts` entries
  (`roleIds` reuses `admin/validation.ts`'s existing `ids()` shape).
- `apps/api/src/http/routes/routing.ts` or a new `http/routes/statuses.ts` —
  the two new routes; `http/build-server.ts`, `http/types.ts`, `main.ts` wired
  the same way 14b's routing routes were.
- `apps/api/src/routes/*` — permission-gating use case for the two new routes,
  mirroring `routes/routing.ts`'s existing grant endpoints.

**Web**
- `apps/web/src/pages/admin/JourneyDetailPage.tsx` — the new "Visibility"
  toggle beside "Routing".
- New `apps/web/src/pages/admin/StatusVisibilityPanel.tsx`, modeled on
  `StatusRoutingPermissions.tsx`.
- `apps/web/src/lib/api-client.ts`, `apps/web/src/types/domain.ts` — the two
  new endpoints and their row type.
- `apps/web/src/mocks/handlers.ts` — MSW handlers for both.

**Tests** — see §Test plan.

**Docs**
- `docs/permissions/access-model.md` — a new lettered item alongside A–D (or a
  clearly marked "E"), stating the `AND`-not-`OR` composition rule explicitly.
- `docs/permissions/permission-engine-schema.md` — the new table.
- `docs/requirements/glossary.md` — one sentence on the "Status" row.
- `docs/api/endpoints.md` — the two new routes, in the same style as the
  routing section.
- `docs/workflows/journey-definitions.md` — a pointer, if this ships near any
  other Status-behavior documentation change.
- New ADR-0019, recorded once approved and implemented (the default-state
  decision above, and the routing-pool interaction resolution), matching how
  14a/14b's approved decisions became ADR-0014/0015 — not written before
  approval.
- This plan, updated with what implementation found, matching every prior
  phase's post-delivery amendment style.

## Out of scope

- Any change to `field_visibility`, `role_journey_access`, or
  `status_routing_permissions` themselves — this is a fourth, independent
  allow-list, not a rework of the other three.
- Any change to what `TEAM`/`DEPARTMENT`/`ORGANIZATION` scope mean (ADR-0006,
  ADR-0014 stand untouched) — this is `AND`ed on top, never a redefinition.
- A configuration-time warning when a routing pool's candidates are already
  excluded by a Status's visibility rows (cosmetic; the evaluation-time filter
  already prevents the bug — see §routing interaction).
- Retroactively re-deriving Team pool membership, or any other change to
  Phase 14b's routing mechanism beyond the one candidate filter in §5/§routing.
- A "visible to no Role" state — deliberately unrepresentable (Risk 6).
- Any UI or API surface outside `JourneyDetailPage`'s Statuses list — no new
  top-level tab, per the task's explicit placement instruction.
- Bulk-operation and export code paths beyond confirming they route through
  `recordPredicate`/`resolveAuthorization` (§5's checklist item) — if any
  turn out not to, that is a separate, narrower follow-up, not silently
  absorbed into this phase's scope.

## Risks / open questions

1. **The default-state decision above is the one this plan cannot proceed
   without.** Recommended: unconfigured Status = unrestricted. Flagged with
   the full weight the task asked for; say so explicitly at approval if you
   want the stricter allow-list-from-day-one behavior and its mandatory
   backfill gate instead.
2. **Whether `createLead`/`moveLeadJourney`'s target-Status check is in
   scope.** Recommended: yes, check the landing Status so a lead is never
   created invisible to its own creator. A judgement call, not an inference —
   confirm at approval, matching 14b's own practice of naming rather than
   silently deciding this class of gap.
3. **Routing-pool interaction — evaluation-time filtering, not configuration-
   time validation.** Argued in full above; this is the resolution the task
   asked this plan to make explicit rather than leave implicit.
4. **`RecordPredicate.roleId` is a new field on a widely-consumed type.**
   Additive, so no existing caller breaks, but every consumer of
   `RecordPredicate` (there are at least three: `filter-sql.ts`,
   `prisma-lead-repository.ts`'s oracle, and anything importing the type from
   `@falcon/permission-engine`) should be grep-checked during implementation
   so none silently ignores it where it should not.
5. **The multi-Journey/union behavior depends on exact clause placement**
   inside `processExists()`'s per-process `EXISTS`, not beside it. Called out
   explicitly in §Current-state because it is easy to get backwards and have
   it compile, pass unrelated tests, and still be wrong — the test plan below
   pins this directly with a multi-Journey fixture.
6. **No way to configure "visible to no Role."** An empty replacement means
   "unrestricted," by construction of the default-state decision — it cannot
   also mean "restricted to nobody," so there is structurally no way to lock
   every Role out of a Status. Recorded as an accepted consequence: a Status
   nobody can see is not a real product need (someone must always be able to
   work a lead sitting anywhere), and this makes it impossible to reach that
   state by accident.
7. **Every other `resolveAuthorization`/`recordPredicate` call site with a
   `leadId`** (bulk reassign, bulk status change, export, attachment access)
   needs to be located and checked during implementation; this plan lists the
   ones read directly (§5) and does not claim that list is exhaustive.
8. **No conflict found between `docs/` and the repository for this feature** —
   there is nothing to reconcile because the feature does not exist yet in
   either place. The one documentation gap (glossary's "Status" row not yet
   naming this axis) is filled by this plan's Docs section, not by opening a
   drift ADR the way 0011 did for a genuine divergence.

## Test plan

Per `docs/testing/quality-gates.md`; real-Postgres integration tests with the
same rigor as the permission engine's own suite, synthetic fixtures only
(`AGENTS.md`) — no Wellsure journey, status, or role name anywhere.

### The security-critical assertion — whole-response, matching ADR-0011's precedent

A synthetic Role A (allowed) and Role B (denied) for a synthetic Status; a
lead whose process instance sits in that Status, within both Roles' ordinary
`ORGANIZATION` scope so scope alone would otherwise show it to both:

- As Role B: `GET /leads` (list) body does not contain the lead id anywhere,
  in any shape (`JSON.stringify`, whole-response, per ADR-0011's fixed style);
  `GET /leads/:id` (detail) 403s; `GET /leads/:id/activity` (timeline) 403s;
  a Seller List search matching the lead's name returns nothing (proving
  search, which is the same query, inherits the fix); `count` matches `list`
  exactly (the counts-vs-lists parity rule).
- As Role A: all four surfaces show the lead, proving step one isn't vacuous
  because the value was never there.
- Checked for vacuity the way 14a's and 14b's security tests were: mutate the
  new clause's placement (e.g., move it beside `processExists()` instead of
  inside it) and confirm the multi-Journey test below fails before restoring
  it — recorded in the delivered plan's amendment section, not asserted here
  in advance.

### Multi-Journey union (Phase 11's pattern, proven for this axis specifically)

- A lead with two active process instances, in two different Journeys, one
  currently in a Status denied to the caller's Role and one in a Status with
  no restriction at all. The lead is visible on every surface through the
  unrestricted process instance; the denied process instance's own activity
  rows are absent from the timeline; the Seller 360 body's `processInstances`
  contains only the visible one.

### Default-state behavior

- A Status with zero `status_visibility` rows: every ordinarily-authorized
  Role sees leads in it, unchanged from today's behavior — a regression test
  pinning the exact "unconfigured = unrestricted" decision above.
- Adding the **first** row for a Status immediately restricts every other
  Role that was seeing leads there a moment before (no caching, per-request
  re-evaluation, matching 13a's "immediately after creation" property).
- Clearing every row returns the Status to fully unrestricted — not to
  restricted-for-everyone.

### Composition with scope — `AND`, not `OR`

- A Role allow-listed for the Status but **outside** its ordinary `SELF`
  scope for that lead still cannot see it — proving the new axis grants
  nothing beyond the existing scope, only narrows.

### Routing interaction

- A routing rule's pool contains one candidate whose Role is excluded by the
  Status's visibility rows and one whose Role is not; the excluded candidate
  is never picked, in either algorithm.
- Every candidate excluded: the status change still commits, no assignment is
  made or changed, a `routing_skipped` activity is written with the new skip
  reason — 14b's own skip-path test, transposed.
- A Status with **no** visibility rows configured at all: routing behaves
  exactly as it does today, proving the new filter is a no-op until the
  feature is actually configured for that Status.

### Configuration CRUD

- Round-trip: `PUT` then `GET` returns exactly the rows written; a second
  `PUT` full-replaces rather than merging.
- Every affected Role's `version` is bumped, including a Role that lost its
  row.
- Authorization: `roles_permissions:edit` required for `PUT`,
  `roles_permissions:view` for `GET`; a `journeys_statuses:edit`-only holder
  gets 403 from both — the self-escalation test, transposed from 13a/14b.
- Audit: one `system_audit_logs` row per `PUT`, `entity_type='status_visibility'`,
  `action='replace'`, old/new values matching the role-id sets.
- Tenant isolation: a `statusId` or `roleId` from another organization is
  rejected.

### Unit (permission engine)

- Table-driven, `packages/permission-engine`'s own style: every combination of
  {no rows for the Status, rows excluding the caller's Role, rows including
  it} × {statusId present, absent} against `resolveAuthorization` directly,
  no database.

### Gates

`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
plus the Postgres suite via `FALCON_POSTGRES_URL`, all run and their actual
results reported — not assumed — before this is considered done, per every
prior phase's stated practice.

## Rollback plan

One new table, additive: `DROP TABLE status_visibility`. No existing table is
altered, so dropping it returns the system to exactly its pre-Phase-19
behavior — every lead's visibility reverts to ordinary scope/Journey rules
with nothing left to clean up, because absence of the table is
indistinguishable from the table existing with zero rows (the default state
this plan recommends in the first place). The permission-engine and
`filter-sql.ts` changes are additive clauses; reverting the commit removes
them with no data migration in either direction. The one non-additive touch —
`RecordPredicate.roleId` — is a new field, not a renamed or removed one, so
reverting is a plain `git revert` with no consumer left in an inconsistent
state.
