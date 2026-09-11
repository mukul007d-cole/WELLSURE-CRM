# Phase 20 — Reconcile Status Routing and Status Visibility

Status: **implemented.** Part 1: no code mismatch reproduced; regression
test added regardless. Part 2: design decided directly with the task's
requester (see below — it supersedes the three-option analysis this plan
originally presented, kept in the appendix for the record) and implemented
in full — schema, permission engine, API, web, and both ADR-0019
(recorded retroactively) and ADR-0020.

## Goal

Part 1: make Status Routing's `configure`/`operate` reachable if — after
investigation — they are actually ungrantable, and prove it with a
regression test either way.

Part 2: **unite Status Routing and Status Visibility into one feature.**
Per the approved decision: visibility of a lead sitting in a routed Status
is no longer a separately admin-configured, Role-level allow-list. It is
computed entirely from the routing assignment itself — the lead's current
assignee, plus that assignee's management chain ("TLs etc."), and no one
else. Routing decides visibility; there is no more explicit grant for
anyone else to configure.

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/source-of-truth.md`,
`docs/architecture/decisions/0006-team-scope-from-hierarchy.md`,
`docs/architecture/decisions/0014-teams-are-not-team-scope.md`,
`docs/architecture/decisions/0015-per-status-assignment-routing.md`,
`docs/planning/phase-14b-per-status-assignment-routing.md` (in full),
`docs/planning/phase-19-status-scoped-role-visibility.md` (in full, including
its amendments section), `docs/permissions/access-model.md`,
`docs/api/endpoints.md`, `docs/workflows/journey-definitions.md`,
`docs/requirements/glossary.md`.

Code read: `packages/permission-engine/src/{catalog,decision,scope,types}.ts`
and `__tests__/fixtures.ts`; `apps/api/src/routes/routing.ts`,
`apps/api/src/http/routes/routing.ts`,
`apps/api/src/routing/{service,rule-service,validation,algorithms}.ts`;
`apps/api/src/statuses/{status-visibility-service,errors,validation}.ts`,
`apps/api/src/routes/status-visibility.ts`,
`apps/api/src/http/routes/status-visibility.ts`;
`apps/api/src/leads/{filter-sql,prisma-lead-repository}.ts`;
`apps/api/src/routes/leads.ts` (`resolveLeadAccess`, `getLeadById`,
`editLead`, `createLead`, `moveLeadJourney`);
`apps/api/src/permissions/prisma-permission-repository.ts`;
`apps/api/src/admin/{bootstrap,validation}.ts`;
`packages/database/prisma/schema.prisma` (`Status`, `StatusRoutingRule`,
`StatusVisibility`, `Assignment`, `User`);
`apps/web/src/pages/admin/{JourneyDetailPage,StatusRoutingPanel,StatusRoutingPermissions,StatusVisibilityPanel,RoleDetailPage}.tsx`;
`apps/web/src/lib/api-client.ts`; `apps/web/src/types/domain.ts`;
`apps/api/src/__tests__/{phase14b,phase19,phase13b}.postgres.integration.test.ts`,
`apps/api/src/__tests__/permission-wiring.test.ts`.

---

## Part 1 — investigation finding

**The PR #33-shaped bug does not reproduce against this repository's current
`main`.** This was checked exhaustively, not assumed:

- `packages/permission-engine/src/catalog.ts` defines `lead_routing` with
  `actions: ['view', 'configure', 'operate']`, not withheld from bootstrap.
- Every call site that checks it — `apps/api/src/routes/routing.ts`'s
  `authorize()` (all four gated routes: `getRouting`, `getRoutingState`,
  `putRouting`, `deactivateRouting`, `routingAssign`), the frontend's
  `can('lead_routing', 'view'|'configure')` gates in `JourneyDetailPage.tsx`
  and `StatusRoutingPanel.tsx`, `docs/api/endpoints.md`, and
  `docs/permissions/access-model.md` — uses the identical, correctly-spelled
  module and action strings. A programmatic scan of every
  `module: '...' … action: '...'` literal pair across `apps/` and `packages/`
  against the real catalog (`isPermissionPair`) found zero mismatches anywhere
  in the codebase, not just in routing.
- Built the workspace against a real local Postgres 16 and ran the actual
  bootstrap → HTTP flow end to end (`bootstrapFirstAdmin` → `GET
  /permissions/catalog` → `PUT /statuses/:id/routing`): the fresh
  administrator's role is granted `lead_routing:view/configure/operate` at
  bootstrap exactly as the catalog says; the catalog endpoint lists it; and,
  after adding the one per-Status grant the design requires (see below), the
  same admin successfully configures a routing rule. `apps/api/src/__tests__/phase14b.postgres.integration.test.ts`
  (13 tests) and the full `permission-engine` suite also pass unmodified.

So `lead_routing:configure`/`operate` **are** in the catalog, **are** visible
and checkable on every Role's page, and **do** work once granted. This is not
PR #33's shape: that bug made a pair permanently ungrantable for every role
including full admins, with no code path that could ever satisfy it. Here,
every code path is internally consistent and the pair is grantable and
functional.

**What is real, and probably what was observed:** `status_routing_permissions`
(the per-Status allow-list layered on top of the module action, per ADR-0015)
starts **completely empty** for every Status, for every organization,
including a freshly-bootstrapped one — mirroring `field_visibility`'s own
"starts empty, absence denies" precedent (Phase 13a), which this codebase
already treats as correct, not as a defect. This means the very first time
*anyone*, including a full administrator, opens a Status's Routing panel, the
`GET .../routing/state` call 403s — reproduced in the empirical test above. A
role holding `roles_permissions:edit` (the bootstrap admin does) can grant the
per-Status permission to itself from a section inside the same panel
(`StatusRoutingPermissions.tsx`, gated on `roles_permissions:edit`, rendered
independently of the state fetch's own error). A role that holds
`lead_routing:configure`/`operate` but **not** `roles_permissions:edit` — the
"routing administrator" persona ADR-0015 itself names as the intended holder
of that module action — has no such escape hatch, and nothing on the Role
page explains why, because the missing piece isn't a Role-level setting at
all. This is friction, and it is confusing, but it is the **documented,
deliberate self-escalation rule** ADR-0015 states explicitly ("a routing
administrator who cannot edit permissions must not be able to grant routing
rights, including to their own role") — the same rule `field_visibility`
already follows. This part of Status Routing's own permission model
(`status_routing_permissions`, who may *configure/operate* routing) is
untouched by Part 2 below, which only changes who may *see* a lead —
Status Visibility.

**Regression test added regardless** (the task asked for one either way):
`apps/api/src/__tests__/phase14b.postgres.integration.test.ts` gains a case
bootstrapping a fresh organization (not hand-built role rows) and walking the
exact admin flow — grant is visible on `GET /permissions/catalog`, first
`PUT /statuses/:id/routing` 403s with no per-Status grant, granting the
per-Status permission via `PUT .../routing/permissions` succeeds, the same
`PUT /statuses/:id/routing` then succeeds — so the reachability path is
pinned permanently, independent of Part 2.

> **Correction, recorded when the mistake was found (see "Amendments found
> during implementation" below):** the paragraph above treated
> `status_routing_permissions` starting completely empty and denying
> everyone as `field_visibility`'s correct, deliberate precedent. That's
> right for the self-escalation rule (untouched, still correct) but wrong
> for the default-state question underneath it — this axis needed exactly
> the correction ADR-0019 had already given Status Visibility's identical
> mistake, and hadn't received it. The 403 the test above pins at "first
> `PUT /statuses/:id/routing` 403s with no per-Status grant" only holds
> once *some other* role already has a per-status row on that action; on a
> Status with zero rows for that action, the same call now succeeds on the
> module action alone. The test was updated accordingly, not removed.

---

## Part 2 — uniting Status Routing and Status Visibility

### The decision, as given

Discussed directly with the task's requester after presenting three options
(validation-only coupling, derived Role visibility, and a merged
configuration surface — the first version of this plan below the fold has
the full analysis, kept for the record). The requester's answer changes the
shape of the problem rather than picking from the three:

> Visibility only for those they're assigned to, while ensuring they're
> visible to the hierarchical parent of that employee so TLs etc. can see
> them. No explicit visibility for anyone else. Routing decides visibility.

This is not Role-based at all. It is: **the assignee, plus everyone above
the assignee in the reporting hierarchy (any depth), and no one else** — for
whichever Status the routing rule governs. Concretely:

- "Those they're assigned to" is `SELF` — a lead's current assignee sees it.
- "Hierarchical parent... TLs etc." is exactly `TEAM` scope's existing
  relation (ADR-0006): "the requesting User plus every active User reachable
  downward through `users.manager_id`," evaluated from the *manager's*
  side — a manager already reaches every report below them, transitively,
  with no depth limit. Confirmed with the requester this means the
  reporting line (`manager_id`), not Phase 14a's Team entity — "TL" here is
  the requester's own name for "the assignee's manager," not
  `team_members.is_leader`. This is the exact distinction ADR-0014 wrote a
  whole ADR to keep separate, so it is called out explicitly here too rather
  than assumed.
- "No explicit visibility for anyone else" retires the Role-based allow-list
  entirely — `status_visibility`, `StatusVisibilityService`, its two
  endpoints, and its admin panel all go away. There is no longer a
  configuration surface where an admin lists which Roles may see a Status's
  leads.

### Why this is a better fit than any of the three original options

Re-examined against ADR-0014's constraint (Status Visibility must not
require reading Team membership) and against the actual bug the task
opened with (an assignee who can't see their own lead):

- **It needs no new coupling to `teams`/`team_members` at all.** The
  relation it needs — walking `users.manager_id` from a given user, any
  depth, active users only, same organization — is `expandTeamUserIds` in
  `packages/permission-engine/src/scope.ts`, which already exists, already
  has no dependency on the Team entity, and is exactly what `TEAM` scope
  has used since ADR-0006. This phase calls it one more way (from the
  would-be *viewer*, to build their downward-reachable set, then checks
  whether the *assignee* is in it) — it does not add a new algorithm.
- **It makes the specific broken state structurally impossible, not just
  harder to configure.** Under a Role-based allow-list (any of the three
  original options), an admin could still, in principle, misconfigure
  things. Under this design, visibility for a routed Status *is* "assignee
  or assignee's manager chain" by definition — there is no longer a second,
  independently-configured allow-list that could drift out of sync with who
  is actually assigned. The assignee can never fail to see their own lead,
  because seeing it and being assigned it are now the same fact.
- **It closes the manual-override gap for free.** Investigation (kept
  below) found `StatusRoutingService.choose()` already filters routing
  candidates by the old Role-based Visibility before picking one, but the
  manual override path (`lead_routing:operate` /
  `POST /leads/:id/routing-assign` with an explicit target) bypassed that
  filter entirely — a real, live gap under the old design. Under the new
  one there is nothing to bypass: whoever ends up assigned, by algorithm or
  by override, is visible to themselves by construction. `visibleCandidates()`
  becomes dead code and is removed along with it.
- **It is a genuine simplification, matching "unite" literally.** One
  fewer table, one fewer admin screen, one fewer thing for an admin to
  remember to keep in sync. Status Routing's own configuration (pool,
  algorithm) is now the *only* thing that determines both who gets the lead
  and who can see it.

### The real cost, stated plainly

This is a materially bigger change than any of the three original options,
and worth naming precisely:

- **It removes a shipped, tested Phase 19 feature** — the ability for an
  admin to grant a Role (e.g. Ops, or a QA reviewer) visibility into a
  Status's leads *without* that Role being anyone's manager or the assignee.
  The task's own example of the feature this replaces — a lead visible only
  to Ops once it reaches "Ready For Onboarding," regardless of who is
  assigned or where they sit in the org chart — is no longer expressible.
  If any oversight/QA use of Status Visibility exists in practice beyond
  the routing-vs-visibility mismatch this phase was scoped to fix, it loses
  its mechanism. Confirmed acceptable by the requester ("no explicit
  visibility to anyone" is the explicit instruction, not a gap they missed).
- **Visibility for a routed Status no longer follows a Role's own configured
  scope at all**, even where that scope is broader. A Role granted
  `leads:view` at `ORGANIZATION` scope — who would ordinarily see every
  lead in the org — is narrowed down to just their own assigned leads and
  their reports' assigned leads, for any Status that has an active routing
  rule. This is a bigger narrowing than Phase 19 ever did (Phase 19 only
  ever *added* a Role-allow-list restriction on top of whatever scope
  already permitted; this replaces the restriction with a specific,
  hierarchy-shaped one that can cut below `DEPARTMENT`/`ORGANIZATION` scope
  for *any* Role, including ones an admin never thought about in relation
  to this Status). This is the explicit intent ("no explicit visibility to
  anyone else"), not an oversight, but it means turning routing on for a
  Status is a bigger visibility change than admins configuring it today may
  expect, and the UI should say so plainly (see below).
- **A Status with no active routing rule is unaffected** — ordinary
  `DataScope`/Journey access apply exactly as before this phase, preserving
  Phase 19's safe default in spirit (now keyed off "no active routing rule"
  rather than "no visibility rows," which is the identical shape ADR-0015
  already established for `status_routing_rules` itself: "a Status with no
  rule is simply unrouted").
- **Every current assignment counts, not only the routing rule's own
  assignment type.** A lead can carry more than one `assignmentType`
  (e.g. `owner` and `verifier`). Visibility is granted if the caller is, or
  manages, the holder of *any* current assignment on the process instance —
  matching how `SELF` scope already treats "assigned to me" (any current
  assignment matching the request's own `assignmentTypes`, not one specific
  type), rather than inventing a narrower rule tied to one routing rule's
  configured type.

### Design

**`decision.ts`.** `hasStatusVisibility` is replaced by a check computed
from two existing primitives, not a table lookup:

1. `repository.hasActiveRoutingRule({organizationId, statusId})` — does this
   Status have an active `status_routing_rules` row? If not, unrestricted
   (`true`), exactly Phase 19's default, re-keyed.
2. If it does, and a specific `leadId` is named: `expandScopeUserIds({user:
   caller, scope: 'TEAM'})` (the caller's self-plus-every-active-report set,
   unconditional on the caller's own Role's configured scope for this
   action) and `assignmentScopeAllowsLead({assignments, leadId,
   allowedUserIds: <that set>, assignmentTypes, journeyIds})` — reusing
   `assignmentScopeAllowsLead` unchanged, just fed the hierarchy set instead
   of the Role's own resolved scope. `assignments` is the same
   `listCurrentAssignments` call `decision.ts` already makes for
   `recordAllowed`, hoisted so it runs whenever a `leadId` is present rather
   than only when `effectiveScope !== null` — Status Visibility must be
   computable independently of whether the caller's Role has *any* granted
   scope, exactly as before.
3. No `leadId` (a general/create-style check): `true` — nothing is assigned
   yet to compare against, matching `recordAllowed`'s own existing "no
   record named → true" default. This also **removes** Phase 19's
   `createLead`/`moveLeadJourney` "landing Status" judgment call entirely:
   there is no assignee to check visibility against until an assignment
   exists, so the question Phase 19 flagged as a judgment call no longer
   arises.

**List/count/search (`filter-sql.ts`, `prisma-lead-repository.ts`).** The
`(status, role)` `EXISTS`/`NOT EXISTS` pair becomes: `NOT EXISTS (an active
routing rule for this process's current Status) OR EXISTS (a current
assignment on this process instance whose user is the caller or one of the
caller's active reports, any depth)`. The caller's reachable-user-id array
is computed once per request (the same `expandTeamUserIds` call, run
unconditionally rather than only when the caller's own scope is `TEAM`) and
bound into the query exactly the way `allowedUserIds` already is for
ordinary `TEAM`-scope callers — no per-row recursion in SQL, since the set
is already a concrete array. All three `accessClause()` branches
(`processExists()`, `shared_with_me`, the `all` branch's own shared-record
arm) get the identical clause, in the identical places, that Phase 19's own
post-delivery correction already established — this phase changes what the
clause *computes*, not where it lives.

**`packages/permission-engine`:**
- `types.ts`: `PermissionRepository.hasStatusVisibility` → removed, replaced
  by `hasActiveRoutingRule`. `RecordPredicate.roleId` → removed (nothing
  needs the caller's Role for this anymore); add
  `RecordPredicate.hierarchyUserIds: readonly string[]`.
- `scope.ts`: `buildRecordPredicate` takes `hierarchyUserIds` instead of
  `roleId`.
- `decision.ts`: as above.
- `__tests__/fixtures.ts`: the in-memory double gets an `activeRoutingRuleStatusIds`
  set instead of a `statusVisibility` array.

**Routing (`apps/api/src/routing/service.ts`):** `visibleCandidates()` and
the `no_visible_candidate` `SkipReason` are removed — dead code once
visibility is derived from the assignment itself rather than checked
against it. `choose()` goes back to exactly Phase 14b's original shape
(active-user filter, then load, then pick). The manual-override path needs
no new check: an override target becomes visible to themselves the instant
they're assigned, by the same mechanism as everyone else.

**Retired outright:** `status_visibility` table (new migration, `DROP
TABLE`), `StatusVisibility` Prisma model and its three relations
(`Organization.statusVisibility`, `Role.statusVisibility`,
`Status.visibilityRoles`), `apps/api/src/statuses/status-visibility-service.ts`
and its errors/validation, `apps/api/src/routes/status-visibility.ts`,
`apps/api/src/http/routes/status-visibility.ts` (and their registration in
`build-server.ts`), `apps/web/src/pages/admin/StatusVisibilityPanel.tsx`,
the "Visibility" button/panel/indicator in `JourneyDetailPage.tsx`,
`statusVisibilityApi` in `apps/web/src/lib/api-client.ts`, the
`StatusVisibilityGrant` type in `apps/web/src/types/domain.ts`, and the
corresponding MSW mock handlers.

**UI addition, replacing what's removed:** `JourneyDetailPage.tsx`'s
Statuses list gains a plain, read-only note on any Status with an active
routing rule — "Visible only to the assigned user and their manager chain"
— so an admin turning on routing for a Status is told, at the point they do
it, that this also narrows who can see its leads. No configuration control,
since there is nothing left to configure; a `journeys_statuses:view`-visible
note, not gated on `roles_permissions` (nothing here is a grant).

### Files to touch

**Database**
- `packages/database/prisma/schema.prisma` — drop `StatusVisibility` and
  its three relation fields.
- New migration `00000000000003_retire_status_visibility` — `DROP TABLE
  status_visibility`; paired `rollback.sql` that recreates it (structure
  only — Phase 19's own rows, if any exist in a real deployment, are not
  recoverable, named explicitly in the migration's own comment and in
  §Rollback below).

**Permission engine**
- `packages/permission-engine/src/types.ts`,
  `packages/permission-engine/src/decision.ts`,
  `packages/permission-engine/src/scope.ts`,
  `packages/permission-engine/src/__tests__/fixtures.ts`,
  `packages/permission-engine/src/__tests__/status-visibility.test.ts`
  (rewritten for the new semantics; renamed if that reads better once
  written).

**API**
- `apps/api/src/permissions/prisma-permission-repository.ts` —
  `hasStatusVisibility` → `hasActiveRoutingRule`.
- `apps/api/src/leads/filter-sql.ts`, `apps/api/src/leads/prisma-lead-repository.ts`
  — the new clause, in all three branches, kept in lockstep per
  `phase13b.postgres.integration.test.ts`'s parity check.
- `apps/api/src/routing/service.ts` — remove `visibleCandidates()` and
  `no_visible_candidate`.
- Removed: `apps/api/src/statuses/status-visibility-service.ts`,
  `apps/api/src/statuses/errors.ts` (or the subset specific to visibility),
  `apps/api/src/routes/status-visibility.ts`,
  `apps/api/src/http/routes/status-visibility.ts`.
- `apps/api/src/http/build-server.ts` — remove the visibility route
  registration.
- `apps/api/src/routes/leads.ts` — no signature changes expected; re-checked
  once the above lands, since Status Visibility remains "additive when
  `statusId` is present," unchanged in shape.

**Web**
- Removed: `apps/web/src/pages/admin/StatusVisibilityPanel.tsx`.
- `apps/web/src/pages/admin/JourneyDetailPage.tsx` — remove the Visibility
  button/panel/indicator/`canSeeVisibility`; add the read-only note above.
- `apps/web/src/lib/api-client.ts`, `apps/web/src/types/domain.ts` — remove
  `statusVisibilityApi`/`StatusVisibilityGrant`.
- `apps/web/src/mocks/handlers.ts` — remove the visibility mock handlers.

**Tests** — see §Test plan.

**Docs**
- `docs/permissions/access-model.md` — item E rewritten: Status Visibility
  is no longer a Role allow-list; it is derived from the Status's routing
  assignment plus the reporting hierarchy.
- `docs/api/endpoints.md` — remove the two visibility routes; note the
  `lead_routing`-only surface.
- `docs/workflows/journey-definitions.md` — update the one sentence
  describing Status Visibility.
- `docs/requirements/glossary.md` — update the "Status" row's Visibility
  sentence.
- New ADR-0020, recorded once implemented and this plan's amendments
  section is filled in — not written before then, per this project's
  practice.

## Out of scope

- Phase 14b's own routing-configuration permission model
  (`lead_routing:view/configure/operate`, `status_routing_permissions`) —
  untouched. Part 1's finding about its friction stands as a separate,
  undecided question.
- Redefining `TEAM`/`DEPARTMENT`/`ORGANIZATION` scope, or anything about
  ADR-0006/0014 — this phase calls `expandTeamUserIds` one more way; it
  does not change what it computes.
- Phase 14a's Team entity or Team membership in any way — deliberately not
  read by anything in this design, confirmed above.
- A configuration surface for "view-only, never assigned" oversight access
  (e.g. a QA role that should see a Status's leads without being anyone's
  manager). Retired along with the rest of Status Visibility, per the
  explicit "no explicit visibility to anyone else" instruction. If this
  turns out to be needed later, it is new product scope, not a gap in this
  phase.

## Risks / open questions

1. **All current assignments count, not just the routing rule's own
   assignment type** (decided above) — flagged in case the intent was
   narrower (visible only via the specific assignment type the rule
   manages). Say so if you want it scoped that way instead; the change is
   a one-line difference in what gets passed as `assignmentTypes`.
2. **Whatever real deployment data exists in `status_visibility` today is
   lost** on this migration (the table is dropped, not migrated into
   anything, since there is no equivalent state to migrate it to — an
   explicit Role/Status pairing has no hierarchy-shaped analogue).
   Confirmed acceptable given the instruction that no explicit visibility
   should remain configurable at all; named here so it isn't a silent
   side-effect of the migration.
3. **A Role with no `leads:view` grant at any scope still sees nothing**,
   including their own reports' routed leads — this new mechanism narrows
   what a Role can see, it never grants `leads:view` itself. Worth
   confirming this matches intent: a manager who should see their team's
   routed leads still needs `leads:view` (at whatever scope) on their Role
   first; this phase does not change that any Role needs the ordinary
   grant before Status Visibility's narrowing (or, now, its hierarchy rule)
   even applies.

## Test plan

Real-Postgres integration tests, synthetic fixtures only (`AGENTS.md`).
`apps/api/src/__tests__/phase19.postgres.integration.test.ts` is rewritten
in place (same file, new semantics) rather than superseded by a new
`phase20` file, since it is testing the same axis (`STATUS_VISIBILITY_DENIED`)
under a new definition, not a new axis.

- **The assignee always sees their own lead in a routed Status** — the
  exact scenario the task opened with, now proved as a guarantee rather
  than a bug: a lead assigned to a synthetic user, in a Status with an
  active routing rule, is visible to that user on every surface (list,
  detail, activity, search) — with **no** separate visibility configuration
  step required, unlike the old design's need for an admin to add a row.
- **The assignee's manager, and their manager's manager (two levels), see
  it too** — proving "any depth," matching `TEAM` scope's own multi-level
  test shape. A user in a *different* reporting line, holding a broad
  `ORGANIZATION`-scope grant on `leads:view`, does **not** see it — proving
  this narrows below ordinary `DataScope`, not just adds to it.
- **A Status with no active routing rule is unrestricted** — ordinary
  `DataScope` applies unchanged, the preserved safe default.
- **Deactivating the routing rule reopens the Status** — matches "no rule
  means unrouted" for both routing and, now, visibility.
- **Manual override (`operate`) grants visibility immediately, with no
  extra code path** — the new assignee sees the lead right after an
  override, proving the fix that used to need its own check now falls out
  of the design for free.
- **Multi-Journey union, and the two direct-grant branches
  (`shared_with_me`, the `all` branch's shared-record arm)** — re-run
  against the new clause, since `filter-sql.ts`'s three-branch shape is
  unchanged; only what each branch's clause computes is different.
- **Round-robin and least-loaded** both still route correctly with
  `visibleCandidates()` removed — `routing-algorithms.test.ts` and
  `phase14b.postgres.integration.test.ts`'s routing-interaction tests
  updated to drop the now-nonexistent visibility-filtering assertions.

## Rollback plan

The migration drops one table with no equivalent replacement — real
`status_visibility` data in any existing deployment does not survive a
rollback either (`rollback.sql` recreates the empty table, not its rows).
Every other change (permission engine, `filter-sql.ts`, routing service,
removed routes/UI) is a plain `git revert`, with the caveat that reverting
without also restoring the table (and, in a live deployment, its data from
a backup) would leave the reverted code querying a table that no longer
exists.

---

## Appendix: the three originally-analyzed options

Kept for the record, since the task asked that real options be presented
and reasoned about, not just the final answer. Superseded by the design
above.

**(a) Validation-only coupling.** At routing-pool save time, resolve the
pool to its members' Roles and check each against `status_visibility` for
that Status; block or warn if any aren't covered. Cost: a point-in-time
check that can go stale as Team membership or a user's Role changes later
— the same staleness `validatePool`'s existing active-user check already
accepts, but real. Needed no permission-engine change and no new coupling.

**(b) Derived visibility.** A Role automatically has visibility if it's the
Role of any active routing-pool member, unioned with explicit grants.
Rejected: requires `decision.ts` to resolve Team membership to compute
visibility — the exact coupling ADR-0014 wrote itself to avoid, without a
case that this feature is different enough to justify it — and over-grants,
handing an entire Role blanket visibility into every lead in the Status
(including leads no pool member is near, and Role-holders who were never in
the pool at all), which cuts against Status Visibility's own "narrows,
never widens" rule.

**(c) Merge into one configuration surface.** One screen for both, pool
membership implying visibility by construction. Resolves to either (b)'s
coupling if computed live, or a write-time snapshot needing a provenance
column (to tell derived rows from explicit ones) and no answer for
Team-membership drift without coupling Team administration to
routing/visibility in the opposite direction.

The design actually adopted differs from all three: instead of coupling
Visibility to routing's *pool configuration* (Users/Teams, a
configuration-time concept prone to drift), it computes Visibility from the
routing rule's *live effect* — the current assignment — plus the reporting
hierarchy the permission engine already resolves for `TEAM` scope. That is
what makes it immune to the staleness problem (a); avoids (b)'s
Team-membership coupling and over-grant, since it reads `manager_id`, not
`team_members`, and grants exactly one assignee's chain rather than a whole
Role; and needs no provenance tracking (c) would (there is no longer a
persisted allow-list row to distinguish "derived" from "explicit" — the
whole allow-list is gone).

---

## Amendments found during implementation

- **The manual-override fix this plan called for is unnecessary under the
  approved design.** The original analysis (kept in the appendix) planned
  to add a Status Visibility check to `routingAssign`'s override branch,
  matching Phase 19's `choose()` filter. Once visibility is derived from
  the assignment itself, there is nothing for an override to bypass —
  `visibleCandidates()` and the `no_visible_candidate` skip reason were
  removed instead of matched, and a test proves the override target gains
  visibility immediately with no extra check (`phase19.postgres.integration.test.ts`,
  "a manual override grants the new assignee visibility immediately").
- **A latent bug in `moveLeadJourney`'s target-Journey check, found while
  reasoning through the new design, not observed as a test failure first.**
  The target check already passed `leadId`, which — once Status Visibility
  began consulting the lead's *current* assignments — would look for an
  assignment in the *target* Journey that cannot exist yet (the process
  instance isn't created there until the move succeeds), denying every
  caller on any Status with an active routing rule, not narrowing it for
  anyone in particular. Fixed by omitting `leadId` from the target check
  entirely, matching `createLead`'s own treatment of a landing Status (see
  ADR-0020). Caught during implementation and fixed before it could ship as
  a regression; recorded in `routes/leads.ts`'s own comment at the fix.
- **Turning routing on for a Status is a bigger visibility change than
  admins configuring it may expect, confirmed by test failures during
  implementation, not just reasoned about in advance.** Two existing tests
  broke for exactly this reason and were updated rather than worked around:
  `phase14b.postgres.integration.test.ts`'s "leaves a live share intact"
  test found that a Lead Share to a previous holder no longer survives a
  move into a routed Status (the share is "explicit visibility to someone
  else," which routing now decides instead) — renamed and re-asserted as
  `403`, with a comment explaining why. A `phase19` comment-route test
  needed `assignmentTypes` added to its request bodies once Status
  Visibility began depending on assignment identity rather than a
  Role-only check that ORGANIZATION scope could bypass regardless.
- **`hierarchyUserIds` is computed unconditionally whenever a caller holds
  any granted scope for the action in question** (inside `buildRecordPredicate`,
  not gated on the caller's own scope being `TEAM`), so a repository double
  that never implemented `listReports` correctly — several test fixtures
  did not, `hasStatusVisibility` never having exercised that path before —
  now must. Every repository double in `apps/api`'s test suite was
  audited and fixed as part of this phase (`leads.test.ts`,
  `leads.integration.test.ts`, `permission-wiring.test.ts`,
  `fixtures/synthetic-configuration.ts`,
  `http/web-api.postgres.e2e.test.ts` — the last of which had several
  method names already stale relative to the real `PermissionRepository`
  interface, predating this phase, fixed alongside the rename). Named here
  as a real cost: this is one more query on every scoped list/detail
  request now, not only ones a `TEAM`-scoped caller already paid for.
  Acceptable for the guarantee it buys, but real, and worth watching
  against the Seller List's own p95 target if it's ever measured and found
  wanting — no attempt was made in this phase to short-circuit it (e.g., by
  first checking whether the organization has any active routing rule at
  all before resolving the hierarchy), since correctness came first and the
  common case (an individual contributor with no reports) resolves it in
  one query.
- **A hand-rolled Postgres schema in `leads.integration.test.ts` (not the
  real migrations, a minimal one built for that file alone) had a
  `status_visibility` temp table standing in for the old mechanism.**
  Replaced with a minimal `status_routing_rules` temp table matching what
  the new clause actually queries.
- **Found after shipping, reported directly by a user: Status Routing was
  unreachable for everyone but the pre-seeded admin role, with no way to
  fix it from Role Management.** Not a regression from this phase's own
  changes — a pre-existing bug in `status_routing_permissions`
  (`RoutingRuleService.roleHasGrant`), Phase 14b's *other* per-status
  allow-list, which this plan's Part 1 investigation had already looked at
  and, in hindsight, dismissed too quickly as "friction by design." It
  copied `field_visibility`'s "absence of a row denies" default without
  the scrutiny Phase 19 gave the identical question for Status Visibility
  (ADR-0019, Decision 1) — a default that fits a brand-new Field but not a
  Status that already exists in every organization. Granting
  `lead_routing:configure`/`operate` from Role Management left a role
  refused on every Status regardless, since nothing in Role Management
  reveals or fixes a per-*Status* gate. Fixed the same way ADR-0019 fixed
  Status Visibility's identical default-state mistake: a `(status, action)`
  with zero `status_routing_permissions` rows is now unrestricted (the
  module action alone suffices); a row still narrows that action, on that
  Status, to the Roles it names. See ADR-0015's amendment section,
  `RoutingRuleService.roleHasGrant`, and the rewritten
  `phase14b.postgres.integration.test.ts` "requires configure and operate
  independently" test, which now proves both halves: the open default, and
  that naming even one role for an action still narrows it for everyone
  else. This is a correction to this plan's own Part 1 finding, not a new
  phase — recorded here rather than in a fresh planning doc because it is
  the same axis this plan already reasoned about and got half right.

---

## Bookkeeping

- **Phase numbering confirmed.** `docs/planning/` runs 1 through 19 with no
  gaps or collisions; this plan is Phase 20. No file needed renaming.
- **Phase 19's plan doc header.** Checked directly (`git log -p`): it read
  `Status: **proposed — awaiting approval. Nothing in this plan is
  implemented.**` for exactly one commit (`7c0593b`, the engine/repository
  layer) and was corrected to `Status: **implemented.**` in the very next
  commit (`1d2e6e6`, the admin UI). On the current tree it already reads
  correctly — there was nothing stale to fix by the time this phase started.
  Its own "Docs to touch" section promised `docs/architecture/decisions/0019-*.md`,
  "recorded once approved and implemented" — and it never was; there was no
  ADR-0019 in the tree. Written as part of this phase's own bookkeeping
  (`docs/architecture/decisions/0019-status-visibility-default-state.md`),
  documenting the decisions Phase 19 actually shipped, with an amendment
  noting Phase 20 replaces the mechanism (not the two default-state
  decisions it records, which still hold in spirit — see ADR-0020 once
  written).
