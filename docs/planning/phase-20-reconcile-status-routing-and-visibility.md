# Phase 20 — Reconcile Status Routing and Status Visibility

Status: **Part 1 investigated (see finding — no code mismatch reproduced;
regression test added). Part 2 proposed, awaiting approval. Nothing in Part 2
is implemented.**

## Goal

Part 1: make Status Routing's `configure`/`operate` reachable if — after
investigation — they are actually ungrantable, and prove it with a
regression test either way.

Part 2: stop Status Routing (`status_routing_rules`, User/Team-scoped) and
Status Visibility (`status_visibility`, Role-scoped) from being configurable
into a state where a lead is routed to someone whose Role can't see it —
without making Status Visibility's checks understand Team membership
(ADR-0014).

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/source-of-truth.md`,
`docs/architecture/decisions/0014-teams-are-not-team-scope.md`,
`docs/architecture/decisions/0015-per-status-assignment-routing.md`,
`docs/planning/phase-14b-per-status-assignment-routing.md` (in full),
`docs/planning/phase-19-status-scoped-role-visibility.md` (in full, including
its amendments section), `docs/permissions/access-model.md`,
`docs/api/endpoints.md`, `docs/workflows/journey-definitions.md`.

Code read: `packages/permission-engine/src/{catalog,decision,scope,types}.ts`;
`apps/api/src/routes/routing.ts`, `apps/api/src/http/routes/routing.ts`,
`apps/api/src/routing/{service,rule-service,validation,algorithms}.ts`;
`apps/api/src/statuses/status-visibility-service.ts`; `apps/api/src/routes/leads.ts`
(`resolveLeadAccess`, `getLeadById`); `apps/api/src/admin/{bootstrap,validation}.ts`;
`apps/web/src/pages/admin/{JourneyDetailPage,StatusRoutingPanel,StatusRoutingPermissions,RoleDetailPage}.tsx`;
`apps/web/src/lib/api-client.ts`; `apps/web/src/app/AuthContext.tsx`;
`apps/api/src/__tests__/{phase14b,phase19}.postgres.integration.test.ts`,
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
already follows. Changing it would be a real (and separate) product decision,
not a bug fix, and is out of scope here unless you say otherwise.

**Recommendation:** no code change for Part 1 beyond the regression test
below. If you have a specific role/permission snapshot from the production
report that contradicts this (e.g. a role that holds `lead_routing:configure`
*and* a `status_routing_permissions` row for the Status in question, and
still gets refused), that would point at a real, different bug and I want to
see it before closing this out.

**Regression test added regardless** (the task asked for one either way):
`apps/api/src/__tests__/phase14b.postgres.integration.test.ts` gains a case
bootstrapping a fresh organization (not hand-built role rows) and walking the
exact admin flow — grant is visible on `GET /permissions/catalog`, first
`PUT /statuses/:id/routing` 403s with no per-Status grant, granting the
per-Status permission via `PUT .../routing/permissions` succeeds, the same
`PUT /statuses/:id/routing` then succeeds — so the reachability path is
pinned permanently, independent of Part 2.

---

## Part 2 — the real design question

### The two systems, confirmed from the code (not assumed)

- **Status Routing** (`status_routing_rules` + `status_routing_rule_members`):
  a pool is either a Phase 14a **Team** (`poolType: 'team'`, resolved via
  `team_members`) or a named list of **Users** (`poolType: 'users'`, resolved
  via `status_routing_rule_members`). `RoutingRuleService.validatePool`
  checks only that a Team is active or that every named user is an active
  user in the organization — **no Role concept at all** at configuration
  time. `StatusRoutingService.choose()` resolves the pool to
  `{id, roleId}` pairs before picking a candidate.
- **Status Visibility** (`status_visibility`): a bare `(status, role)`
  allow-list. Nothing about Users, Teams, or routing.
- **The mapping from a pool to a set of Roles is many-valued and can change
  after the rule is saved**, on both sides: a Team's membership changes
  (14a), a user's Role can be reassigned, and — this is the point — nothing
  requires a Team's members to share one Role. A single Team pool can
  legitimately span several Roles.

### The load-bearing fact, proved against real Postgres

**Confirmed, empirically, not assumed:** `STATUS_VISIBILITY_DENIED` blocks a
user from seeing/acting on a lead **even when they are its current
assignee**, if their Role isn't on that Status's Visibility allow-list.
`decision.ts` pushes `STATUS_VISIBILITY_DENIED` into `deniedReasons`
unconditionally on `hasStatusVisibility`'s result — it does not check
`recordAllowed`/`effectiveScope` first — and every caller in `routes/leads.ts`
treats every denial reason except `FIELD_VIEW_DENIED` as blocking. I proved
this by temporarily adding a case to `phase19.postgres.integration.test.ts`
reusing its own fixtures (`roleSelf`/`userSelf`, `SELF` scope): a lead
assigned to `userSelf` returns `200` on `GET /leads/:id` before any
Visibility row exists for its Status, and `403` immediately after an admin
restricts that Status's Visibility to a different Role — with no change to
the assignment. (Not left in the tree — reverted after confirming; the
permanent version of this test is part of Part 2's test plan below, since it
is the exact scenario the resolved design must guarantee against.)

### The gap this phase actually needs to close, and one part of it already isn't a gap

Reading `routing/service.ts` in full turned up something the task brief's
framing ("nothing prevents it, warns about it, or catches it") doesn't quite
match: **Phase 19 already closed half of this.** `StatusRoutingService.choose()`
calls `visibleCandidates()`, which filters the pool down to users whose Role
has Status Visibility for the target Status (no-op if the Status has no
Visibility rows at all) *before* picking one, exactly the "filter at
evaluation time, not configuration time" resolution
`docs/planning/phase-19-status-scoped-role-visibility.md` already argued for
and shipped. If every remaining candidate is filtered out, routing skips
(`no_visible_candidate`) rather than assigning — the lead's existing
assignee, who by construction could already see it, is left alone. **So the
*automatic* routing path cannot currently produce the broken state the task
describes.** I confirmed this by reading `choose()`'s call graph, not by
assuming the plan doc's claim carried through to code.

**What Phase 19 did *not* cover: the manual override.** `routingAssign`
(`lead_routing:operate`, `POST /leads/:id/routing-assign` with an explicit
`userId`) calls `StatusRoutingService.route()` with `overrideUserId` set,
which **bypasses `choose()` — and therefore `visibleCandidates()` — entirely**
(`route()`: `input.overrideUserId === undefined ? await this.choose(rule) :
{ userId: input.overrideUserId, reason: null }`). The only authorization
check on this path (`routes/routing.ts`'s `routingAssign`) evaluates the
*actor's* access to the lead (`leads:edit` + the actor's own scope +
Status Visibility, via `resolveAuthorization`) — it never asks whether the
Status is visible to the *target* (`overrideUserId`)'s Role. This is a live,
reachable gap: an operator holding `lead_routing:operate` can manually
route any lead to any pool member, including one whose Role cannot see the
Status — reproducing the exact "assigned to someone who then can't see or
act on their own assignment" outcome the task describes, today, independent
of any of the three options below.

**This gap gets closed regardless of which option is chosen below** — it is
a straight continuation of Phase 19's own evaluation-time precedent, applied
to the one path that didn't get it the first time, and it is what actually
makes the "no longer occurs" guarantee (not just "can no longer be
configured") true for automatic *and* manual assignment. Concretely:
`routingAssign` resolves `overrideUserId`'s Role and status, and refuses
(a new, specific error — not a bare 403 — e.g. `routing_target_not_visible`)
when Visibility excludes it. This is additive to `route()`'s existing
`choose()`/override branch, not a rewrite of it.

### The actual decision: how configuration-time drift gets caught

With the live-assignment gap closed above, what's left is **not** "can a bad
assignment happen" (it can't, once the fix above lands) but **"can an admin
build a routing pool that is silently useless — or, before this phase, was
silently dangerous — without any signal at configuration time."** This is
where the three options genuinely differ, and where I want to be explicit
about cost the way 14a's plan was for `TEAM` scope.

**(a) Validation-only coupling.** At `PUT /statuses/:id/routing` (pool
save), resolve the pool to its members' Roles (the routing service already
does this — `choose()`'s own first two steps) and check each Role against
`status_visibility` for that Status (no-op if the Status has zero Visibility
rows — unrestricted, matching Phase 19's default). Block the save, or return
a warning the UI surfaces (`docs/planning/phase-14b`'s and Phase 19's own
"warn, don't silently proceed" precedent for configuration mistakes),
listing which pool members' Roles aren't covered.

- *Cost, stated plainly*: this is a point-in-time check, and it can go stale
  exactly the way `validatePool`'s existing "pool member is an active user"
  check already can — a Team's membership changes, or a user's Role is
  reassigned, after the rule is saved, and the warning doesn't re-fire. This
  is not a new kind of staleness this codebase hasn't already accepted
  (14b's own `validatePool` and the "team-deactivation-after-rule-creation"
  case in the Phase 19 plan are the identical shape), and it is why the
  manual-override fix above is not optional — it is what keeps the
  *guarantee* (assignee can always see their own lead) true even when this
  warning goes stale, while this check is what keeps the *configuration*
  honest at the moment an admin acts.
- Requires zero change to `packages/permission-engine` or to
  `status-visibility-service.ts`. The only new code is in
  `routing/rule-service.ts` (which already resolves pools to Roles for
  `choose()`) and its route/UI surface. Visibility stays exactly what Phase
  19 defined it as: a Role-level allow-list nobody but its own admin screen
  writes to.

**(b) Derived visibility.** `hasStatusVisibility` becomes "explicit row OR
role is currently a role of any active member of this Status's routing
pool." Rejected. This requires the read path Status Visibility uses inside
`decision.ts` — the permission engine's own decision function — to resolve a
Team-based pool to its members' Roles, i.e. to read `teams`/`team_members`
(or a routing-specific projection of them) from inside (or immediately
beside) the same function ADR-0014 was written specifically to keep
Team-membership-free: *"The permission engine does not read `teams` or
`team_members`."* ADR-0014's own three reasons for rejecting a
membership-based `TEAM` scope apply here with only the names changed: the
question "why can this Role see this record?" would no longer have one
deterministic answer sourced from one table — it would depend on a second
table's membership resolved through a different feature's configuration.
I don't think this case is different enough from the one ADR-0014 already
ruled on to justify the reintroduction, and the task explicitly asks that
question to be answered, not skipped. There's a second, independent problem
with (b) even ignoring the coupling: Status Visibility is a
**per-Status, whole-Role, every-lead** grant, but the actual need here is
narrower — one assignee seeing one lead. Deriving visibility from pool
membership grants the *entire* Role blanket visibility into *every* lead
currently in that Status, including ones no pool member is anywhere near —
and, because Roles are reused across Teams and Departments, it can grant
that visibility to Role-holders who were never in the routing pool at all
(anyone else carrying that same Role, anywhere in the org). That is a
materially broader, silent widening of what Status Visibility grants, as an
automatic side effect of a routing change — which cuts against "Status
Visibility is `AND`ed on top, never widens reach," the composition rule
Phase 19 built the whole feature on.

**(c) Merge into one configuration surface.** Attractive on the UI side —
and I understand why it reads as the natural answer, since the two panels
already sit stacked on the same Status in `JourneyDetailPage.tsx` precisely
because they interact. But worked through to an implementation, it resolves
to one of two things, and neither is clean:
  - **Computed live**, the same way (b) is — same coupling, same over-grant,
    same rejection above, with a merged UI on top.
  - **Written at save time** (pool membership auto-writes `status_visibility`
    rows for the pool's Roles, as an ordinary side-effecting write — the
    same shape `grantJourneyAccessToConfigRoles` already uses for Journey
    creation) — which avoids the permission-engine coupling entirely (the
    write happens in `routing/rule-service.ts`, which already legitimately
    resolves pools to Roles for `choose()`; `decision.ts` never changes) and
    is honestly the most defensible version of "unite" if that's the
    direction you want. But it now needs to answer a question Phase 19
    deliberately avoided by keeping the row shape a bare allow-list: which
    `status_visibility` rows came from routing and which were granted by
    hand, so that removing a Role from the pool can retract the derived
    grant without silently revoking a Role an admin explicitly added for
    oversight (a manager who should see but never be assigned — the task's
    own example). That's a provenance column Phase 19's schema doesn't have
    and didn't need. And it still doesn't solve staleness for a Team pool on
    its own: membership changing via the Departments/Teams screen wouldn't
    retro-write `status_visibility` unless Teams' own admin flows are taught
    to call into Status Routing/Visibility on every membership edit — a new
    dependency in the *opposite* direction (Team administration depending on
    a routing/visibility side-effect), which ADR-0014 also didn't want
    Team administration entangled with permission concerns beyond
    `users:edit` governing it.

### Recommendation

**(a), plus the manual-override fix above, unconditionally.** The
manual-override fix is what actually makes "an assignee can always see their
own lead" true, for both routing paths, all the time — it needs no
configuration-time cooperation from an admin and doesn't degrade with
staleness. (a) is what keeps an admin from building an obviously-broken
routing rule in the first place, using exactly the pool→Role resolution
`choose()` already performs, adding no new table, no new coupling to
`packages/permission-engine`, and no change to what Status Visibility means
or how it's read. Both keep Phase 19's default (absence of Visibility
configuration = unrestricted) completely intact — the pool-validation check
in (a) is a no-op the moment a Status has zero Visibility rows, exactly
like `visibleCandidates()` already is.

I'm not asking you to just take this — (b) and (c)'s "computed live" form is
what "unite" naturally means, and it's a real, defensible position if you
value one visible source of truth over avoiding the coupling; I think the
coupling and the over-grant are the wrong trade for what's actually a narrow
problem (one assignee, one lead), but say so if you'd rather have it and I'll
plan that instead.

---

## Files to touch (Part 2, once approved)

**Backend**
- `apps/api/src/routing/service.ts` — `route()`'s override branch gains a
  Status Visibility check on `overrideUserId`'s Role before assigning;
  a new `RoutingError` code (e.g. `routing_target_not_visible`) distinct
  from the ordinary `forbidden`, since the actor *is* authorized to operate
  routing — the target simply cannot receive this assignment.
- `apps/api/src/routing/rule-service.ts` — `replace()`/`validatePool` gains
  the pool→Role Visibility check; a new `RoutingError` (`validation_error`
  or a dedicated code) naming the uncovered Role(s) when blocking, or a
  non-blocking warning field on the response if you'd rather warn than
  block (open question below).
- `apps/api/src/routing/errors.ts` — new error code(s).
- `apps/api/src/routes/routing.ts` — surfaces the new error(s) with the
  right HTTP status.

**Frontend**
- `apps/web/src/pages/admin/StatusRoutingPanel.tsx` — renders the new
  validation error/warning when saving a pool.
- `apps/web/src/lib/api-error.ts` — a friendly message for the new error
  code(s).

**Docs**
- `docs/architecture/decisions/0020-status-routing-visibility-reconciliation.md`
  — written once approved and implemented, per this project's own practice
  (ADR-0014/0015/Phase-19's ADR follow this rule; not written before
  approval).
- `docs/api/endpoints.md`, `docs/permissions/access-model.md` — the new
  error code(s) and the pool-validation rule.
- This plan, updated with implementation findings, per every prior phase's
  practice.

## Out of scope

- Any change to `packages/permission-engine`, `status_visibility`'s schema,
  or `hasStatusVisibility`'s read path — Part 2's recommendation touches
  only routing's configuration and assignment code.
- Redefining what a Team is or how `TEAM` scope resolves — ADR-0006/0014
  stand untouched.
- A UI for "view-only, never auto-assigned" oversight access — that's
  already Status Visibility's existing per-Role checkbox; nothing new is
  needed for a manager who should see a Status's leads without being in its
  routing pool, since Visibility and Routing already write independently
  today. This only becomes a missing feature under option (c), which is not
  what's being proposed.
- Revisiting the algorithms, skip-reason taxonomy beyond the one addition,
  or anything else about Phase 14b/19 not directly touched by this
  reconciliation.

## Risks / open questions

1. **Block vs. warn on the pool-configuration check.** Recommended: block
   (a `validation_error`, same taxonomy as every other admin write
   rejection in this codebase) — a routing pool that can never route
   automatically for lack of visible candidates is not a useful
   configuration to allow silently, and a warning an admin can click past
   without reading recreates the exact blind spot this phase exists to
   close. Say so if you'd rather warn (matching the "cosmetic, not a
   correctness requirement" framing Phase 19 used for a similar,
   deliberately-skipped warning) — the manual-override fix still holds the
   safety guarantee either way.
2. **Whether the pool-validation check should also run on Team-membership
   changes** (adding/removing a member via Departments/Teams), not just on
   `PUT /statuses/:id/routing`. Recommended: no — this would couple Team
   administration to routing/visibility lookups on every membership edit,
   which is its own cost or a new ADR, and the manual-override fix already
   guarantees the safety property regardless of drift. Flagged, not
   silently decided.
3. **Error taxonomy for the manual-override refusal.** Whether
   `routing_target_not_visible` needs its own HTTP status distinct from the
   existing `forbidden`/`validation_error`/`conflict`/`not_found` shape
   `RoutingRouteResult` already uses, or fits into `validation_error` (400)
   since it's a property of the *request* (this specific override target),
   not of the actor's authorization. Leaning `validation_error`.

## Test plan

Real-Postgres integration tests, synthetic fixtures only (`AGENTS.md`).

**Part 1** — see above: a bootstrap-to-configure round trip in
`phase14b.postgres.integration.test.ts` (already specified).

**Part 2**, added to a new `apps/api/src/__tests__/phase20.postgres.integration.test.ts`
(or folded into `phase14b`'s file — decided at implementation time):

- **The load-bearing fact, made permanent.** The exact scenario proved
  above during investigation: a lead's current assignee, in a Status with
  no Visibility rows (visible, `200`), then denied (`403`) the instant an
  admin restricts that Status's Visibility to a different Role, with no
  change to the assignment — pinning the fact this whole phase is built on
  so it can't silently stop being true.
- **Manual override refuses an invisible target.** A routing rule with a
  pool containing a candidate whose Role is excluded by the Status's
  Visibility rows; `POST /leads/:id/routing-assign` with that candidate as
  `overrideUserId` is refused, and the lead's current assignment is
  unchanged. The identical call with a visible candidate succeeds — not
  vacuous.
- **The originally-described broken state no longer occurs.** Configure a
  routing rule whose pool is a Team (or user list) with a member whose Role
  isn't on the target Status's Visibility list, drive a lead into that
  Status so automatic routing fires, and confirm that member is never the
  result (this already passes today, per the investigation above — this
  test is what keeps it that way) *and* that the same member cannot be
  manually routed to via override either (the new fix).
- **Pool-configuration validation** (per whichever of block/warn resolves
  risk 1): saving a routing pool with an uncovered Role is rejected (or
  flagged) with the specific Role(s) named; the identical save succeeds
  once the Status's Visibility list is extended to cover them, or once the
  Status has no Visibility rows at all (unrestricted — proving the check is
  a no-op on an unconfigured Status, matching every other Phase 19 default
  test).
- **Least-loaded and round-robin both respect the override fix identically**
  — the fix lives in `route()`'s shared override branch, not in either
  algorithm, but both are exercised once each to confirm neither bypasses
  it.

## Rollback plan

No schema changes proposed (recommendation (a) adds no table or column —
the check is computed from existing `status_routing_rule_members`/
`team_members`/`status_visibility` rows at request time, and the
manual-override fix adds a code-level check, not a data model change). A
revert is a plain `git revert` of the service/route changes.

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
  What *is* still missing, and is this phase's actual bookkeeping debt: the
  Phase 19 plan's own "Docs to touch" section promised
  `docs/architecture/decisions/0019-*.md`, "recorded once approved and
  implemented" — and it never was; there is no ADR-0019 in the tree. Writing
  it (documenting Status Visibility's default-state decision and the
  routing-pool interaction resolution, matching how 14a/14b's decisions
  became ADR-0014/0015) is folded into this phase, alongside the new
  ADR-0020 for Part 2's reconciliation decision once that's approved and
  implemented.
