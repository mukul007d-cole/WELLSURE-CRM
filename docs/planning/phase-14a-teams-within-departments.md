# Phase 14a — Teams within Departments

Status: **awaiting approval.** Sub-phase 1 of 2 in Phase 14. 14b (per-status
assignment routing rules) depends on this one for its "assign to a Team" pool
option and is not planned or built until this is approved and delivered.

## Goal

Let an admin create Teams inside a Department — each with a name, one or more
Team Leaders, and a member list — with full permission-gated, audited CRUD,
administered from the Department section of the admin area.

---

## THE DECISION THIS PLAN NEEDS FIRST: what does `TEAM` permission scope mean?

**Nothing else in this plan can be finalized before this is settled**, so it is
here rather than in §Risks. The request's own framing — *"we already have TEAM
level in permissions so we're making those teams here"* — reads as an assertion
that the `TEAM` data scope already refers to the Teams we are about to build. It
does not, today, and making it do so is not a refactor. It is a semantic change
to a live authorization primitive.

### What `TEAM` means today (verified, not assumed)

`packages/permission-engine/src/scope.ts:32-60` — `expandTeamUserIds` is a
breadth-first walk over `users.manager_id`:

```
TEAM = { requester } ∪ { every active user reachable downward through manager_id }
```

Tenant-scoped (`report.organizationId !== user.organizationId` skipped),
cycle-safe (a `seen` set), and **transitive** — a manager's reports' reports are
included at any depth. `ADR-0006` states exactly this and closes with:

> A future cross-functional or non-hierarchical team requirement is a
> schema/product change requiring a new ADR, not something pre-built in V1.

So this phase is precisely the event ADR-0006 anticipated. There is **no Team
entity anywhere in the tree today** — a repo-wide search for `team` as a word in
`.ts`/`.tsx`/`.prisma` returns zero hits outside the `'TEAM'` scope literal.
`Department` is a flat `id/key/name/active/version` row with no children.

Four properties of today's `TEAM` matter for what follows, because each of them
is something a Team-membership model does *not* have:

| Property of today's `TEAM` | Consequence |
|---|---|
| Every user has one, with zero configuration | No deployment can be in a "not set up yet" state |
| Transitive to any depth | A 3-level manager sees the whole sub-tree |
| Crosses departments freely (`manager_id` has **no** department constraint — `validateUserRefs`, `admin/prisma-admin-repository.ts:511-528`, checks only active + same org) | A cross-department reporting line works today |
| Derived, never edited directly | It cannot drift from the org chart, because it *is* the org chart |

### The three options, honestly

**(a) `TEAM` starts resolving against Team membership.**

Requires a new ADR superseding 0006, a new `PermissionRepository` method, and a
rewrite of `expandTeamUserIds`. What it actually costs:

- **Silent scope collapse on an existing deployment.** The moment the semantics
  flip, any user who is in no Team has `TEAM == {self}` — identical to `SELF`.
  Every role holding TEAM scope loses access to their reports' records until an
  admin has built out the entire org as Teams. This is not a theoretical
  migration concern; it is the default state on the day of deploy.
- **Loss of transitivity.** Team membership is flat. A department head who today
  sees three levels down would see only their own Team's members. Recovering
  transitivity means nesting Teams, which is a second product concept.
- **Silent narrowing across departments.** A Team is scoped to one Department
  (that is the stated requirement). A manager with a cross-department report
  loses them, with no error and no UI signal.
- **The manager/member mismatch has no good answer.** For a manager with
  hierarchy reports outside their Team, either answer is wrong: dropping them is
  a silent access loss; keeping them means `TEAM` is a *union* of two mechanisms,
  which is the hardest possible shape to reason about in a security review.

A tempting variant — **(a′)** resolve against Team membership, *falling back* to
the hierarchy when the user is in no Team — removes the collapse but replaces it
with a rule whose answer depends on configuration state elsewhere in the system.
"Why can this user see that record?" stops having a single answer. I do not
recommend it and am not costing it further.

**(b) `TEAM` stays hierarchy-derived; Team is an organizational + routing-pool
concept with no effect on permission scope.** *(recommended)*

- ADR-0006 stands unmodified. No existing deployment changes behaviour at all.
  The permission engine is not touched by this phase — a claim a test can prove
  rather than a claim I assert.
- 14b gets exactly what it needs: a named, department-scoped set of users to
  route leads into. Routing pools and visibility scopes are genuinely different
  questions, and 14b needs only the former.
- **The real cost, stated plainly:** "team" means two things. An admin reading
  "Data scope: TEAM" on the role editor and "Teams" on the department page has
  no way to know these are unrelated. That is a genuine usability defect and it
  is mitigated by naming, not hand-waved: §5 commits to concrete UI wording, and
  the scope label in the role editor changes from `TEAM` to
  **"Team (reporting line)"** with helper text naming the distinction.

**(c) Reconcile by convention — a TL is set as `manager_id` for their team's
members.**

Investigated and **recommended against**, more strongly than (a):

- Unenforced, it is not a guarantee. Two admins editing two screens produce
  drift, and the drift is invisible until someone sees a record they shouldn't.
- Enforced, it is worse: writing `manager_id` from the team editor means a
  routing-configuration screen silently rewrites the org chart, which drives
  reporting, the org chart page, *and* `TEAM` scope for people outside the Team.
- It is structurally impossible with multiple TLs. `users.manager_id` is a
  single nullable column; two leaders cannot both be it. (c) therefore forces
  exactly one TL — a product constraint adopted for an implementation reason.

### Recommendation

**Option (b).** Build Team as a first-class organizational entity and routing
pool. Leave `TEAM` scope exactly as ADR-0006 defines it. Record the decision in a
**new ADR-0014 that extends rather than supersedes ADR-0006**, stating that Team
membership and `TEAM` scope are deliberately independent and why.

The follow-up path this preserves is the important part of the recommendation:
if Team-membership-based visibility is genuinely wanted later, the right change
is a **new additive scope value** (`TEAM_MEMBERSHIP`, alongside the existing
four) that a role opts into per module — not a redefinition of `TEAM`. Additive
is reviewable and reversible; redefinition changes every existing role's meaning
at once, invisibly.

**If you would rather have (a)**, say so at approval and this plan changes
materially: it gains a supersession of ADR-0006, a backfill migration
constructing one Team per manager from the existing hierarchy so no deployment
lands in the collapsed state, an explicit resolution of the manager/member
mismatch, and the integration tests in §Test plan invert from "scope is
unchanged" to "scope follows membership". That is roughly double this
sub-phase's size, and I would want the backfill approved separately.

---

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/source-of-truth.md`,
`docs/requirements/glossary.md`, `docs/permissions/access-model.md`,
`docs/data-model/schema.md`, `docs/api/endpoints.md`,
`docs/testing/quality-gates.md`, `docs/workflows/journey-definitions.md`,
`docs/planning/phase-13a-field-role-visibility-at-creation.md`,
`docs/planning/phase-13c-email-marketing-campaigns.md`,
ADR-0001, ADR-0006, ADR-0009, ADR-0010, ADR-0013.

## Current state

Verified against `d8606fb` (`main` merged through Phase 13c).

**No Team concept exists.** Confirmed by search, not inference: `\bteam\b` in
`apps/**` and `packages/**` `.ts`/`.tsx`/`.prisma` returns nothing. `TEAM` appears
only as a `DataScope` enum member and in scope tests.

**Departments are a flat list, and thinner than expected.**
`packages/database/prisma/schema.prisma:65-87` — `id, organization_id, key, name,
active, version, created_by, updated_by, timestamps`, composite PK
`([organizationId, id])`. `PrismaAdminRepository` has `listDepartments`,
`getDepartment`, `createDepartment`, `updateDepartment` — and **no deactivate
path**, despite the `active` column existing and the list page rendering an
Active/Inactive filter. That gap is pre-existing and out of scope here (noted in
§Out of scope so it is not mistaken for an omission).

**Department administration is gated on `users:*`**, per ADR-0009 §"Department
administration uses `users:view`, `users:create`, and `users:edit`; V1 does not
introduce a Department permission module." Routes at
`apps/api/src/http/routes/admin.ts:153-167`.

**There is no Department detail page.** `App.tsx` binds `/admin/departments` to
`DepartmentsPage`, a flat table with an inline create/edit card. There is no
`:departmentId` route. `JourneyDetailPage` (`/admin/journeys/:journeyId`) is the
existing precedent for a parent page hosting nested child-entity cards.

**The established conventions this phase must match**, all verified in
`prisma-admin-repository.ts`:

- Config mutations run in `$transaction`, bump `version`, set `updatedById`, and
  call `audit(tx, org, actor, entityType, entityId, action, old, new)` →
  `system_audit_logs`.
- Join/child rows (`role_permissions`, `role_journey_access`, `field_visibility`)
  are **replaced wholesale**, not incrementally patched, with the complete old
  and new sets recorded in one audit row. They are hard-deleted on replace —
  AGENTS.md's no-hard-delete rule governs *entities* (journeys, statuses, fields,
  roles), and the audit row is what preserves history for join rows.
- Contended writes take `SELECT … FOR UPDATE` on the parent row via `lockRole` /
  `lockField` (`:474-491`), and where several rows are locked they are locked in
  **sorted id order** (`:373-376`) so overlapping transactions queue instead of
  deadlocking.

**Relevant to 14b, found while investigating and recorded here so it is not
rediscovered:** `statuses.auto_reassign_to_role_id` already exists in the schema
and is documented at `docs/workflows/journey-definitions.md:60` as a `follow_up`
behaviour side-effect — **and is implemented nowhere.** It is a dormant column.
14b will have to either build on it or explicitly retire it; it is not 14a's
business, but it should not surprise anyone in two weeks.

## Proposed approach

### 1. Data model

```text
teams
  id, organization_id, department_id, key, name, active, version,
  created_by, updated_by, created_at, updated_at
  PK      (organization_id, id)
  UNIQUE  (organization_id, department_id, key)
  UNIQUE  (organization_id, department_id, id)   -- lets team_members FK-enforce
                                                 -- the department in the database
  INDEX   (organization_id, department_id, active)

team_members
  id, organization_id, team_id, department_id, user_id, is_leader, created_at
  PK      (organization_id, id)
  UNIQUE  (organization_id, team_id, user_id)
  INDEX   (organization_id, user_id)
  FK      (organization_id, department_id, team_id) → teams
  FK      (organization_id, department_id, user_id) → users(organization_id, department_id, id)
```

Composite PKs and `(organizationId, …)`-prefixed FKs match every other model.
`key` is scoped to the parent department, mirroring `Status`'s
`@@unique([organizationId, journeyId, key])` rather than roles' org-wide key.

The `department_id` denormalized onto `team_members` is deliberate: it makes
"a member belongs to the team's department" a **foreign-key constraint** rather
than a validation the application must remember to run on every path. That
requires a `UNIQUE (organization_id, department_id, id)` on `users`, which is
additive and index-only.

**Team Leaders: one or more, as a flag on the membership row.** Investigated
against the existing model as asked. `users.manager_id` is single-valued, and
`docs/workflows/journey-definitions.md`'s seed designations ("Sales TL",
"Operations TL") suggest one TL per team in current practice — but since
recommendation (b) does **not** couple Team to `manager_id`, nothing forces
single-valued. A `is_leader` flag rather than a `team_leader_id` column means a
leader is structurally also a member (no second source of truth, no "leader who
isn't in their own team" state), and co-leads or a holiday stand-in cost nothing.

An active Team must have **at least one leader**, enforced in the transaction —
consistent with how this system already refuses accountability-free states (cf.
"replacement would leave no active permission administrator",
`prisma-admin-repository.ts:263-267`). If you'd rather allow leaderless teams,
that is a one-line relaxation; say so at approval.

### 2. Membership is restricted to the Department's own Users — and that has a
### consequence this plan takes on rather than leaves dangling

Members must have `users.department_id` = the team's `department_id`. The
instruction is "Teams inside a Department"; a Team whose members are drawn from
anywhere would make the department a filing location rather than a boundary, and
14b's pool semantics ("route to this department's team") would be misleading.

**The consequence, which is the reason this is in the approach and not a
footnote: changing a user's department, or deactivating them, must cascade.**
Otherwise `team_members` accumulates rows contradicting the invariant, and 14b
happily routes a lead to someone who left the department — a real assignment bug,
not a tidiness one. So `updateUser` and `deactivateUser`
(`prisma-admin-repository.ts`) gain, inside their existing transactions:

- department change → memberships in teams of the **old** department are removed,
  with a `team_member` audit row recording what was removed and why;
- deactivation → all memberships removed, same audit treatment.

This is a change to an existing, well-tested path, so it is called out as a
file-to-touch and gets its own tests. Note the DB constraint in §1 would reject
the stale row anyway — the cascade is what turns a 500 into correct behaviour.

**If cross-department teams turn out to matter** (a "tiger team" spanning Sales
and Ops is a plausible real requirement), the honest answer is that this model
does not bend to it: it is a different entity with a different boundary, and it
would want its own decision. Flagged, per the task's instruction to flag it if it
matters, rather than silently designed around.

### 3. API

Nested collection, flat item — matching `POST /journeys/:journeyId/statuses` +
`PATCH /statuses/:statusId`:

```
GET    /api/v1/departments/:departmentId/teams     users:view
POST   /api/v1/departments/:departmentId/teams     users:create
GET    /api/v1/teams/:teamId                       users:view    -- incl. members
PUT    /api/v1/teams/:teamId                       users:edit    -- name only
POST   /api/v1/teams/:teamId/deactivate            users:edit
PUT    /api/v1/teams/:teamId/members               users:edit    -- whole-set replace
```

No new permission module: ADR-0009 already decided that department
administration rides on `users:*`, and a Team is administered from inside a
Department. This keeps the permission catalog — and therefore every role editor
screen — unchanged by 14a. (14b will add its own two actions; that is 14b's
plan to argue.)

`PUT …/members` takes the complete `[{ userId, isLeader }]` set and replaces it,
exactly like `PUT /roles/:id/field-visibility`. Rationale: the same one this
codebase already settled on — a replace is idempotent, its audit row carries the
whole before/after, and there is no incremental-patch ordering to get wrong.

Concurrency: the team row is locked `FOR UPDATE` before a member replace, so two
concurrent replaces serialize on the same team and the winner's set survives
intact. Where a write touches several rows (a department change removing a user
from multiple teams) the team ids are locked in sorted order, per §Current
state's established pattern.

Deactivation is a soft `active = false` + version bump. Teams are never hard
deleted. Membership rows are replaced-and-audited, following the join-row
precedent rather than growing an `ended_at` column no other join table has.

### 4. Permission-engine impact: none, and that is the assertion under test

Under recommendation (b), `packages/permission-engine` is **not modified by this
phase** — no new `PermissionRepository` method, no `scope.ts` change, no catalog
change. The security-critical test in §Test plan exists to prove that claim holds
end-to-end through `authorize()`, not merely that we didn't edit the file.

### 5. Frontend — inside the Department section, per the instruction

New route `/admin/departments/:departmentId` → `DepartmentDetailPage`, reached
from a **Manage** action on each row of the existing `DepartmentsPage`. Structure
mirrors `JourneyDetailPage`: a header, the department identity card (reusing the
existing `PUT /departments/:id`), then a **Teams** card listing the department's
teams with create/edit/deactivate, and a member editor per team offering only
that department's active users, with a leader toggle per member.

No new top-level admin tab and no sidebar entry — the instruction is explicit.

**Naming, which is the mitigation for option (b)'s one real cost.** The role
editor's scope selector stops rendering the bare token `TEAM` and renders
**"Team (reporting line)"** with helper text: *"Everyone reporting to this user
through the org chart, at any depth. Not related to Teams configured under
Departments."* The Teams card carries the converse note. This is the entire
defence against the two-meanings problem, so it is a committed deliverable of
this phase, not a nicety.

## Files to touch

**Database**
- `packages/database/prisma/schema.prisma` — `Team`, `TeamMember`, relations on
  `Department`/`User`/`Organization`, plus `@@unique([organizationId, departmentId, id])` on `User`
- `packages/database/prisma/migrations/00000000000005_teams/migration.sql` *(new)*

**API**
- `apps/api/src/admin/prisma-admin-repository.ts` — team CRUD, member replace,
  `lockTeam`; cascade in `updateUser` / `deactivateUser`
- `apps/api/src/admin/repository.ts`, `service.ts`, `types.ts`, `validation.ts`
- `apps/api/src/http/routes/admin.ts` — six routes above

**Web**
- `apps/web/src/pages/admin/DepartmentDetailPage.tsx` *(new)*
- `apps/web/src/pages/admin/TeamEditor.tsx` *(new)*
- `apps/web/src/pages/admin/DepartmentsPage.tsx` — Manage link
- `apps/web/src/pages/admin/RoleDetailPage.tsx` + `permission-matrix.ts` — scope label
- `apps/web/src/App.tsx`, `lib/api-client.ts`, `types/domain.ts`, `mocks/handlers.ts`

**Tests**
- `apps/api/src/__tests__/phase14a.postgres.integration.test.ts` *(new)*
- `apps/api/src/__tests__/admin.test.ts` — validation units
- `apps/web/src/pages/admin/AdminFlows.test.tsx` — department → teams flow

**Docs**
- `docs/architecture/decisions/0014-teams-are-not-team-scope.md` *(new)*
- `docs/data-model/schema.md`, `docs/api/endpoints.md`,
  `docs/permissions/access-model.md`, and this plan

## Out of scope

- **Any change to `TEAM` permission scope** — the whole point of the decision
  above. If (a) is chosen instead, this line inverts and the plan grows.
- Nested/sub-teams, cross-department teams, per-team journey access, team-level
  reporting or dashboards.
- **Per-status assignment routing — that is 14b**, and it is not started until
  14a is approved and delivered.
- Department deactivation. The `active` column and its list filter exist without
  a write path today; that pre-existing gap is not this phase's to close, and
  fixing it here would be an unrelated edit AGENTS.md asks me not to make.
- Retiring or implementing `statuses.auto_reassign_to_role_id` (14b's call).
- Seeding any Team data. There is no real org structure to seed and inventing one
  would be exactly the hardcoded-business-data mistake `source-of-truth.md`
  forbids.

## Risks / open questions

1. **The `TEAM`-scope decision (top of document) is the one thing that must be
   answered before implementation starts.** Everything else here is reversible in
   an afternoon; that one is not.
2. **Two meanings of "team" is a real usability defect under (b)**, mitigated by
   naming (§5) and not by architecture. If the naming change to the role editor
   is unacceptable, that materially weakens the case for (b).
3. **The department-change cascade edits a hot, well-tested path.** Mitigated by
   keeping it inside the existing transactions and by dedicated tests, but it is
   the highest-regression-risk edit in the sub-phase.
4. **`users:edit` now confers team administration.** Anyone who can edit users
   can restructure teams — and, once 14b lands, thereby influence lead routing.
   That follows ADR-0009 rather than diverging from it, but it is worth being
   explicit that the blast radius of `users:edit` grows in 14b's direction. If
   Teams should be separately gated, that is a catalog addition and I would
   rather do it deliberately here than discover it in 14b.
5. **At-least-one-leader** may be stricter than wanted (§1); trivially relaxed.
6. **Team administration is gated by action, not by data scope** — consistent
   with departments, roles and journeys, which are configuration rather than
   records. A `users:edit` holder with `TEAM` data scope can still edit any
   department's teams. Stated so it is a decision, not an oversight.
7. No conflict found between `docs/` and the repository. ADR-0006 anticipated
   this phase and is extended, not contradicted, under (b).

## Test plan

Per `docs/testing/quality-gates.md`. Synthetic fixtures only — no Wellsure
journey, status, role, department or person names anywhere, per AGENTS.md.

### The security-critical test (the highest-risk part of this sub-phase)

`phase14a.postgres.integration.test.ts`, on the real-Postgres harness
(`createAdminPostgres`) that 13a/13b/13c already use. The scope decision is
proven **through the real permission engine and the real HTTP surface**, not at
the data layer:

Fixture: manager `M` with reports `R1` and `R2` (`R2` nested under `R1`, so
transitivity is exercised); user `X` in the same department but **not** in `M`'s
reporting line. One lead assigned to each of `R2` and `X`. `M` holds a role with
`leads:view` at `TEAM` scope.

- **Before any Team exists:** `M`'s seller list contains `R2`'s lead and not
  `X`'s. Baseline, so the after-assertion is not vacuous.
- **After a Team containing `M` and `X` is created:** the response is
  **byte-identical in membership** — `X`'s lead is still absent. Asserted as a
  whole-response check on the list body (the lead id must appear nowhere in the
  payload), plus a 403 on the direct record fetch, plus `authorize()` returning
  `recordAllowed: false` with `RECORD_SCOPE_DENIED`. Three surfaces, because
  "count endpoints use the exact same access-filtering query as list endpoints"
  is a named non-negotiable in `access-model.md`.
- **The converse:** removing `R2` from every Team changes nothing — `M` still
  sees `R2`'s lead, because hierarchy is what decides.
- **`expandScopeUserIds(scope: 'TEAM')`** returns the same set before and after
  Team creation, asserted whole-array.

Under option (a) these invert to "membership decides", and gain a manager/member
mismatch case and a backfill test. The set of *things asserted* stays the same.

### Other real-Postgres integration coverage

- Create/edit/deactivate/member-replace each write one `system_audit_logs` row
  with the complete old and new value, and bump `teams.version`.
- Member replace is a true replacement: removed members are gone, the audit row
  carries both sets, and an empty replacement is rejected by the
  at-least-one-leader rule rather than silently emptying the team.
- **Cross-department member rejected** with `validation_error` — at the service
  layer *and*, with the check bypassed, by the FK, so the invariant is proven to
  be enforced in the database and not only in application code.
- Inactive user rejected as a member; leader must be a member (structurally true,
  asserted anyway); duplicate member rejected by the unique constraint.
- **Department change and deactivation cascade**: the user's memberships in the
  old department's teams are gone, audited, and the remaining team is still
  valid (or the operation is refused if it would leave a team leaderless — a case
  worth pinning down explicitly, since it is the one place two invariants meet).
- **Concurrency**: two simultaneous `PUT /teams/:id/members` on the same team
  both return 200, the final state equals one of the two payloads intact (never a
  merge or partial write), and exactly two audit rows exist — the same shape as
  13a's field-visibility replace test.
- **Tenant isolation**: a team id from another organization 404s on read and
  400s on write; a member from another organization is rejected.
- **Permission gating**: every route refuses without the required `users:` action,
  including read; `users:view` alone cannot mutate.
- No hard delete: a deactivated team is still readable with `active: false`.

### Unit / frontend

- Validation: blank name, blank key, duplicate key within a department, zero
  leaders, unknown user id, member list containing duplicates.
- `DepartmentDetailPage` renders the Teams card, creates a team, edits members,
  and hides every mutation control without the corresponding `can()` grant.
- The role editor renders "Team (reporting line)" with its helper text — the
  naming mitigation is asserted, not assumed.

### Gates

`format:check`, `lint`, `typecheck`, `test`, `build`, plus the Postgres suite,
all run and observed before the PR.

## Rollback plan

One additive migration: two new tables plus one additive unique index on `users`.
Nothing existing is altered or dropped, so rollback is
`DROP TABLE team_members; DROP TABLE teams;`, drop the added `users` index, and
revert the code.

The only edits to existing paths are the `updateUser` / `deactivateUser`
cascades and the frontend scope label; reverting restores prior behaviour exactly,
and because the permission engine is untouched under recommendation (b), **no
authorization behaviour changes in either direction** — which is the property
that makes this sub-phase safe to roll back at all.
