# ADR-0023: Reassignment grace visibility — eligibility gating and the direct-grant/Status-Visibility fix

**Status:** Accepted and implemented.

## Context

Phase 21 Part 2 lets a user opt in, on their own account, to keep 30 days
of view-only access to a lead after they stop being its assignee — manually
reassigned or moved by Status Routing (ADR-0015/ADR-0020) — implemented as
an automatically-created `user_access_grants` row (Phase 9), reusing Phase
21 Part 1's time-bounded grant mechanism rather than a second parallel one.

Two decisions came out of designing and implementing that feature, both
worth recording on their own rather than folding silently into the plan
doc: who may even see the personal opt-in at all, and a correctness defect
in how a direct grant already interacted with Status Visibility that this
feature would otherwise have inherited and made worse.

## Decision 1 — Role-based eligibility gating, not Department-based

The task that requested this feature framed eligibility as
Department-scoped: "the admin account will have an option in permissions
to select what all departments should have this settings in their
account." Three options were considered:

**(a) Build it as specified** — a new, admin-configurable Department-level
allow-list, independent of the permission catalog, controlling whether
users in a Department may even see the personal toggle.

**(b) Role-based, via the existing permission catalog** — a new action,
`leads:retain_view_after_reassignment`, granted or revoked per Role exactly
like every other capability in this system (`role_permissions`, validated
against `packages/permission-engine/src/catalog.ts`, replaced wholesale
through the existing, audited `AdminService.replacePermissions()` /
`PrismaAdminRepository.replacePermissions()` path).

**(c) Something else** — considered and set aside: making the opt-in
available to anyone holding ordinary `leads:view`, with no additional
gate. Rejected because the task was explicit that an admin-controlled
allow-list is wanted; recorded as the alternative this investigation
surfaced, not silently dropped.

**Option (b) was chosen.**

Direct evidence that Department has never gated a capability anywhere in
this system, gathered before deciding, not assumed:

- `docs/permissions/access-model.md`: "Department administration is part
  of the User scope and uses `users:view/create/edit`; V1 has no separate
  Department permission module."
- `packages/permission-engine/src/catalog.ts`'s `users` module is labeled
  `'Users & Departments'` — Department administration rides on `users:*`,
  the same way Team administration does (ADR-0014).
- `DEPARTMENT` exists only as a `DataScope` value — a record-ownership
  question ("whose Lead is this") for `leads:view/edit/...` — never a
  capability-gating dimension. Building (a) would introduce Department as
  a second, unrelated kind of thing for the first time in the app's
  history, alongside its existing role as a `DataScope` value and as an
  org-unit configuration entity (glossary: "org unit ... admin-editable").
- (b) is nearly free to build on existing, already-audited infrastructure:
  `replacePermissions()` already validates, self-escalation-guards,
  versions, and audits any catalog pair; the Role editor
  (`RoleDetailPage.tsx`) already renders any new catalog action generically
  (`action.replaceAll('_', ' ')` as its label), with zero bespoke UI code.
  (a) would need a new table, new repository methods, new audit wiring, a
  new admin route, and a new admin UI section — real, unshared surface
  area for a single yes/no switch.

The genuine tradeoff, not dismissed by (b)'s convenience alone: Department
*is* an organizational-unit concept, and a single Department-level switch
would auto-follow everyone in it as people move between Roles inside that
Department — something Role-gating structurally cannot do. If that
auto-following behavior is specifically wanted later (not just "Sales
generally gets this," which a Sales-flavored Role already expresses), that
is new, distinct product scope, not a gap in this decision — the schema
sketch is a `Department.allowsReassignmentGraceOptIn` column, gated on
`users:edit` like every other Department field, if it is ever pursued.

**Bootstrap default:** the new action is bootstrap-granted, like most of
the catalog (unlike `purge`) — it carries no destructive or irreversible
risk of its own; the personal opt-in it gates is still required on top of
it before anything happens.

## Decision 2 — a direct grant is its own exception to Status Visibility

### The defect this closes

ADR-0020 made Status Visibility's routing-based narrowing unconditional:
once a Status has an active routing rule, only the lead's current assignee
and that assignee's reporting-hierarchy ancestors may see it, and — per
ADR-0020's own text and ADR-0021's Consequences section — **nothing
bypasses this, including a deliberately-granted share.** That was reasoned
through deliberately, not missed: ADR-0021 chose a Role-level backstop
(`leads:bypass_status_visibility`) specifically *because* it treated a
narrower, per-share fix as out of scope, and said so explicitly ("an admin
who needs to hand a specific lead to a specific non-ancestor colleague, in
a routed Status, still has no first-class way to do that other than
granting that person's Role the bypass outright").

Phase 21 Part 2 made this concrete and costly rather than theoretical: the
one purpose a direct grant (`user_access_grants`) exists for is being an
individual, one-off exception to the general rules — it already works that
way against ordinary `DataScope` (`decision.ts`'s `RECORD_SCOPE_DENIED`
block already lets a matching grant override a Role's own scope entirely).
A reassignment-grace grant's *entire reason to exist* is surviving the
exact event — a routed reassignment — that ADR-0020's narrowing keys off.
Building Part 2 on top of the pre-Phase-21 rule would have shipped a
feature that silently did nothing whenever it mattered most: the previous
owner's grant would sit in the database, valid and unexpired, and still
lose to `STATUS_VISIBILITY_DENIED` the moment the lead's Status had active
routing — which, for a routing-driven reassignment, is always.

### The decision

**A valid, unexpired direct grant now overrides Status Visibility's
routing-based narrowing, the same way it already overrides ordinary
`DataScope`.** Changed in the three places that independently compute this
axis, kept in lockstep by `phase13b.postgres.integration.test.ts`'s
scope-parity test as before:

- `packages/permission-engine/src/decision.ts` — the direct-grant lookup
  (`getActiveDirectGrant`) is hoisted so it is computed once and consulted
  from both the existing `RECORD_SCOPE_DENIED` override and a new
  short-circuit inside the `statusVisible` computation: a matching grant
  makes `STATUS_VISIBILITY_DENIED` never fire, without paying for the
  routing-rule/hierarchy lookups once the grant is already known to apply.
- `apps/api/src/leads/filter-sql.ts` — the two direct-grant branches
  `accessClause()` compiles (`shared_with_me`, and the `all` branch's own
  shared-record arm) no longer call `statusVisibilityClause()` at all; they
  keep whatever existence/Journey check they already had
  (`anyProcessActive()`, and the Journey filter in the `all` branch,
  respectively). `processExists()` — the ordinary, assignment-derived
  route to a record — is unchanged: Status Visibility still narrows
  everyone who reaches a lead through assignment/scope alone.
- `apps/api/src/leads/prisma-lead-repository.ts`'s `sellerWhere` — the
  Prisma-oracle mirror of the same two branches, for the same reason
  (`phase13b`'s parity test compares this file's shape against the SQL,
  not the other way around).

`ADR-0021`'s own bypass (`leads:bypass_status_visibility`) is unaffected
and unrelated: that is a Role-level, every-lead exemption for
admin/oversight Roles; this is a per-lead, per-user exemption that already
existed for `DataScope` and now also covers Status Visibility. Neither
subsumes the other.

### What this reopens, named plainly

Exactly the reach ADR-0020/ADR-0021 described as closed: **a share into a
routed Status now reaches its recipient again**, even when that recipient
is outside the new assignee's manager chain. This is not an unintended
side effect — it is the fix, and it is a real, deliberate widening of who
can see a lead in a routed Status beyond ADR-0020's stated design. Judged
acceptable, and correct, because:

- A direct grant is always **individual and deliberate** — created by name,
  for one lead, by someone who already had `leads:edit` on that lead at
  share time (Phase 9's own admission rule), or (Part 2) automatically for
  exactly one specific person as a direct consequence of an event that
  just happened to them. It is not a Role-wide reach the way
  `bypass_status_visibility` is, and does not reintroduce the Role-based
  allow-list ADR-0020 retired — there is still no configuration surface
  where an admin lists which Roles may see a Status's leads in general.
- The alternative — leaving Part 2 built on the old rule — would mean
  shipping a feature that silently does not work for its own stated
  purpose whenever routing is involved, discovered only by a user
  reporting "I turned this on and I still can't see my old lead."

### Existing tests updated to match, not newly written around the old behavior

- `packages/permission-engine/src/__tests__/status-visibility.test.ts` —
  two new cases: a grant lets a request through despite an active routing
  rule that would otherwise deny it, and an *expired* grant does not.
- `apps/api/src/__tests__/phase14b.postgres.integration.test.ts` — "a live
  share no longer keeps a previous holder in once the Status is routed
  (Phase 20)" is rewritten to assert the opposite (the share survives),
  renamed accordingly, with a new sibling test proving `STATUS_VISIBILITY_DENIED`
  still applies with no grant in the identical setup.
- `apps/api/src/__tests__/phase19.postgres.integration.test.ts` — "does not
  let a direct grant bypass Status Visibility, on the plain list,
  shared_with_me, or detail" is rewritten to assert the grant now
  succeeds on all three surfaces, with the identical no-grant case kept
  alongside it as the negative control.
- `apps/api/src/__tests__/phase21.postgres.integration.test.ts` — a
  dedicated case proves a reassignment-grace grant specifically survives
  routing narrowing end to end (HTTP detail/list, and `resolveAuthorization`
  against the real Postgres-backed repository), the concrete scenario this
  fix exists for.

## Decision 3 — eligibility revoked after grants already exist

If a Role's `leads:retain_view_after_reassignment` grant is later revoked
(or a user's Role changes to one that never held it), grants already
issued under the old eligibility are **honored to their natural expiry,
never retroactively revoked.** Eligibility is evaluated live, once, at the
moment a reassignment creates a grant — the same way every other
fresh-per-request check in this system is evaluated — but a grant, once
created, is a historical record of one completed event, not an ongoing
entitlement re-derived from current Role state on every read (unlike
Status Visibility itself, which *is* re-evaluated live on every request
because it has no persisted row to consult). No code in this system
retroactively invalidates a `user_access_grants` row because the
condition that produced it later changed — a Lead Share is not stripped
if the sharer's own permissions are later reduced, either. The user's
personal opt-in boolean is likewise not force-cleared when eligibility is
revoked; it goes dormant and re-activates automatically if eligibility is
restored, re-checked fresh at the next reassignment.

## Consequences

- Department remains exactly what it has always been in this system: an
  org-unit configuration entity and a `DataScope` value, never a
  capability-gating dimension. This phase's decision keeps that
  invariant intact rather than introducing a second, inconsistent
  gating mechanism alongside the permission catalog.
- A direct grant (Lead Share, and now a reassignment-grace grant) is, from
  this phase forward, a uniform "individual exception to the general
  rules" primitive: it already overrode ordinary `DataScope`, and now also
  overrides Status Visibility's routing-based narrowing, consistently,
  rather than winning against one axis and silently losing to the other.
- `leads:bypass_status_visibility` (ADR-0021) remains the only Role-wide,
  every-lead exemption. Nothing in this ADR expands what that permission
  does or who needs it; an admin/oversight Role that never held it and
  never will still needs it for cases a direct grant cannot cover
  (seeing every lead in a Status, not one named lead).
- No new schema surface for Decision 2 — the fix is entirely in
  `packages/permission-engine` and `apps/api/src/leads`'s existing
  predicate-construction code, mirrored across all three call sites that
  must already agree by `phase13b`'s parity test.
