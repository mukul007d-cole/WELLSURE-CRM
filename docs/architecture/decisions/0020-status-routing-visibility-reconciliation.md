# ADR-0020: Status Routing and Status Visibility, united

**Status:** Accepted and implemented.

## Context

Two independent mechanisms governed who could interact with a lead sitting
in a given Status. Status Routing (`status_routing_rules`, ADR-0015)
decided who a lead got *assigned* to — User- or Team-scoped. Status
Visibility (`status_visibility`, ADR-0019) was a separate, Role-scoped
allow-list deciding who could *see* a lead in that Status at all, checked
as a hard gate ahead of the assignment-driven data-scope check.

Nothing connected the two. An admin could configure Status Routing to
assign a status's leads to a Team whose members' Roles weren't on that
status's Visibility allow-list, and nothing prevented, warned about, or
caught it at configuration time. The practical result: a lead assigned to
someone who then couldn't see or act on their own assignment — confirmed,
not assumed, by a real-Postgres test showing `STATUS_VISIBILITY_DENIED`
blocking a lead's own current assignee once their Role fell outside the
Status's allow-list.

Investigation (`docs/planning/phase-20-reconcile-status-routing-and-visibility.md`)
found Phase 19's own candidate filter (`StatusRoutingService.choose()`)
already excluded a Role-invisible candidate from *automatic* routing at
evaluation time — but the manual override path (`lead_routing:operate`)
bypassed that filter entirely, since it never calls `choose()`. So the
broken state was live and reachable, just not through the path the task's
framing first assumed.

Three options were analyzed for reconciling the two systems without
reintroducing the Team-membership coupling ADR-0014 deliberately kept out
of the permission engine:

- **(a) Validation-only coupling** — check a routing pool's Roles against
  Status Visibility at save time; block or warn on a mismatch. No schema
  change, but a point-in-time check that can go stale as Team membership or
  a Role assignment changes later.
- **(b) Derived visibility** — a Role automatically gains Status Visibility
  if it's the Role of any routing-pool member. Rejected: requires
  `decision.ts` to resolve Team membership to compute visibility (the
  coupling ADR-0014 exists to avoid), and over-grants — an entire Role
  gains blanket visibility into every lead in the Status, not just a pool
  member's own assignment, reaching Role-holders never in the pool at all.
- **(c) Merge into one configuration surface** — one screen for both,
  pool membership implying visibility by construction. Resolves to (b)'s
  coupling if computed live, or needs a provenance column (to tell derived
  rows from explicit ones) and still doesn't solve Team-membership drift
  without coupling Team administration to routing in the opposite
  direction.

## Decision

**Status Visibility is retired as a separately configured mechanism.**
Visibility of a lead sitting in a Status with an active routing rule is
computed entirely from the routing assignment itself: the lead's current
assignee, plus everyone above the assignee in the reporting hierarchy
(`users.manager_id`, any depth — the identical relation `TEAM` scope
already resolves, ADR-0006, asked from the manager's side rather than the
report's). No Role, and no admin-configured allow-list, plays any part in
the check. Routing decides visibility.

This is not option (a), (b), or (c) above. It differs from all three in
where it attaches: instead of coupling Visibility to routing's *pool
configuration* (Users/Teams, a configuration-time concept that can drift),
it computes Visibility from the routing rule's *live effect* — the current
assignment — using the reporting hierarchy the permission engine already
resolves for `TEAM` scope. That is what makes it:

- **Immune to (a)'s staleness.** There is no longer a second,
  independently-configured allow-list to go stale relative to the pool —
  visibility *is* "assignee or assignee's manager," recomputed from the
  live assignment on every request.
- **Free of (b)'s coupling and over-grant.** The check reads
  `users.manager_id` through `expandScopeUserIds(..., 'TEAM')` — already
  exported from `packages/permission-engine/src/scope.ts`, already
  Team-membership-free — not `teams`/`team_members`. And it grants exactly
  one assignee's chain, not a whole Role's blanket reach into every lead in
  the Status.
- **Free of (c)'s provenance problem.** There is no persisted allow-list
  left to distinguish "derived" rows from "explicit" ones, because the
  entire allow-list is gone.

**Concretely:**

- `PermissionRepository.hasStatusVisibility` (an admin-configured allow-list
  lookup) is replaced by `hasActiveRoutingRule` (does this Status have an
  active `status_routing_rules` row at all?).
- `decision.ts`'s `STATUS_VISIBILITY_DENIED` clause: unrestricted
  (`true`) if the Status has no active routing rule, or if the request
  names no specific lead (a create-style check — there is no assignee yet
  to compare against, so this axis imposes nothing, same as
  `recordAllowed`'s own "no record named" default). Otherwise, restricted
  to whichever of the lead's current assignments (matching the caller's
  requested `assignmentTypes`) has a `userId` inside the caller's own
  `expandScopeUserIds(..., 'TEAM')` set — computed unconditionally,
  regardless of the caller's own Role's configured `DataScope` for the
  action in question.
- `RecordPredicate.roleId` → `RecordPredicate.hierarchyUserIds` (the same
  set, precomputed once per request for the list/SQL path). The
  `filter-sql.ts`/`prisma-lead-repository.ts` clause becomes: unrestricted
  unless the process instance's current Status has an active routing rule,
  in which case a current assignment held by someone in that set must
  exist — in all three branches `accessClause()` compiles (`processExists()`,
  `shared_with_me`, and the `all` branch's shared-record arm), matching
  Phase 19's own placement discipline.
- `StatusRoutingService.choose()`'s Phase 19 candidate filter
  (`visibleCandidates()`) is removed — dead code once visibility is derived
  from the assignment rather than checked against it. The manual-override
  gap this ADR opened with needs no matching fix: whoever ends up assigned,
  by algorithm or by override, is visible to themselves the instant
  they're assigned, by construction.
- `status_visibility` (table, Prisma model, admin service, both HTTP
  routes, and the web admin panel) is dropped entirely. `JourneyDetailPage`
  and `StatusRoutingPanel` gain a plain, read-only note wherever a Status's
  routing rule is active, stating the visibility consequence at the point
  an admin turns routing on.

## Consequences

**This removes a shipped Phase 19 capability**, not just its bugs: an
admin can no longer grant a Role visibility into a Status's leads
independent of assignment (e.g. an oversight/QA Role that should see every
lead in a stage without being anyone's manager or the assignee). If that
capability turns out to be needed later, it is new product scope with its
own decision, not a gap this ADR left unaddressed — it is a deliberate,
explicit trade accepted in exchange for the stronger, structural guarantee
below.

**The specific bug this ADR exists to close can no longer occur, by
construction, for either routing path.** An assignee — however they came to
be one, automatic pick or manual override — is always inside their own
`expandScopeUserIds(..., 'TEAM')` set (it always includes the caller
themselves), so "an assignee who can't see their own assignment" is not
merely harder to configure; there is no configuration or code path left
that produces it.

**Turning routing on for a Status is now a bigger visibility change than
it was before this phase.** A Role holding a broad `DataScope` grant (e.g.
`ORGANIZATION`) — which would ordinarily see every lead in the org — is
narrowed to just their own assigned leads and their reports' assigned
leads the moment a Status they'd otherwise see into gets an active routing
rule, even though no admin explicitly restricted that Role. This also
applies to a Lead Share (`user_access_grants`): a deliberately-granted
share no longer bypasses Status Visibility once its Status has active
routing, exactly as an admin-configured allow-list already didn't under
ADR-0019 — the difference is that *every* routed Status now carries this
restriction, not only ones an admin separately configured. Existing tests
in `phase14b.postgres.integration.test.ts` that route a lead and then
check a share's reach were updated to reflect this.

**`createLead`'s and `moveLeadJourney`'s "landing Status" question, which
ADR-0019/Phase 19 flagged as a judgment call, is resolved by construction
rather than decided.** Neither has an existing assignment to check
hierarchy reach against for a Status the lead isn't in yet, so both default
to unrestricted for this axis — matching `recordAllowed`'s own "no record
named" default used everywhere else in `decision.ts`. A latent bug in
`moveLeadJourney`'s own target-journey check was found and fixed in the
same change: it was already passing `leadId` into the target check, which
would have made `assignmentScopeAllowsLead` look for an assignment that
cannot exist yet in the target Journey — denying every caller, not just
ones a hierarchy check should narrow. The target check now omits `leadId`
entirely, matching `createLead`'s own treatment of a landing Status.

No change to `packages/permission-engine`'s `TEAM`/`DEPARTMENT`/`ORGANIZATION`
scope resolution (ADR-0006), to Team administration or membership
(ADR-0014), or to Status Routing's own configuration-permission model
(`lead_routing:view/configure/operate`, `status_routing_permissions`,
ADR-0015) — this ADR changes only what governs lead *visibility*, not who
may operate routing or what the reporting hierarchy means.
