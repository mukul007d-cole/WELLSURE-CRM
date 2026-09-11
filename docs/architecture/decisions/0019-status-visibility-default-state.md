# ADR-0019: Status Visibility's default state, and its routing-pool interaction

**Status:** Accepted, then superseded by ADR-0020 (recorded retroactively —
Phase 19 shipped in `7c0593b`/`1d2e6e6`/`49119bb`; this ADR was owed by that
phase's own plan and is being recorded now, per Phase 20's bookkeeping,
alongside the amendment below rather than left permanently missing)

## Context

Phase 19 lets an admin restrict which Roles can see a lead while one of its
process instances sits in a given Status (`status_visibility`, a bare
`(status, role)` allow-list), enforced as one more blocking clause in
`resolveAuthorization` (`STATUS_VISIBILITY_DENIED`), `AND`ed onto ordinary
`DataScope`/Journey access, never `OR`ed — a Role gains no new reach from
being on a Status's allow-list, only narrows what it already had.

Two decisions in that phase were consequential enough to need recording
here rather than only in the phase's planning doc.

## Decision 1: an unconfigured Status is unrestricted, not denied-for-everyone

`field_visibility` and `role_journey_access` are both allow-lists where
absence denies — but both gate something newly created (a new Field, a new
Journey), so starting hidden costs nothing to a live deployment. Every
Status this feature applies to **already exists**, in every organization,
with leads actively sitting in it, visible today under ordinary scope rules.
Copying "absence denies" literally would mean the moment this feature ships,
`status_visibility` is empty everywhere, and the new clause denies every
Role, for every lead, in every Status, org-wide — a total outage, not a
rough edge.

Phase 14b's own precedent for `status_routing_rules` — introduced onto the
same pre-existing Statuses, with the stated default "a Status with no rule
is simply unrouted" — is the shape that actually fits, applied to a
different axis: **a Status with zero `status_visibility` rows imposes no
restriction at all.** A Status gains a restriction only once an admin adds
at least one row; clearing every row returns it to the default, unrestricted
state. There is deliberately no way to configure "visible to no Role" — an
empty replacement means unrestricted, not restricted-for-everyone, because
some Role must always be able to work a lead sitting anywhere.

No backfill or migration is required: the empty-table state on day one is
the intended "feature not yet used" state for every existing Status.

## Decision 2: the routing-pool interaction is resolved at evaluation time, not configuration time

`status_routing_rules` pools are User/Team-scoped; Status Visibility is
Role-scoped. Nothing stops a routing rule from assigning a lead to a user
whose Role isn't allow-listed for the Status it's being routed into.
`StatusRoutingService.choose()` (`apps/api/src/routing/service.ts`) filters
its candidate pool by Status Visibility at the moment it picks a candidate
— a candidate whose Role isn't covered (when the Status has any
`status_visibility` rows at all) is excluded the same way an inactive pool
member already is. If every candidate is excluded this way, routing skips
(`no_visible_candidate`) through the existing skip path rather than
assigning or failing the status change, exactly as an empty pool already
does (ADR-0015 §6).

Routing pool membership is **not** validated against Status Visibility at
rule-configuration time: a Team's membership changes after the rule is
saved (Phase 14a), and a user's Role can be reassigned after the rule is
saved, so a one-time check at save time would go stale the same way any
upfront check in this codebase already does. Filtering at evaluation time
stays correct automatically as either configuration changes.

### Amendment (Phase 20) — superseded, not merely extended

Phase 20 found this evaluation-time filter covers only `choose()` — the
automatic path. The manual-override path (`lead_routing:operate`,
`POST /leads/:id/routing-assign` with an explicit target user) bypassed it
entirely, since it never calls `choose()` — a real, live gap under this
ADR's design. Rather than adding a matching check to the override path,
Phase 20 removed the need for one: Status Visibility no longer reads a
Role-based allow-list at all (Decision 1 and this candidate filter both go
away), so there is nothing left for the override to bypass — whoever ends
up assigned, by algorithm or by override, is visible to themselves and
their manager chain by construction. See
`docs/architecture/decisions/0020-status-routing-visibility-reconciliation.md`.

## Consequences

Status Visibility's absence-is-permissive default means every existing
deployment is unaffected on the day this ships. The routing-pool interaction
is enforced structurally (a filter that runs on every evaluation) rather
than by an admin remembering to keep two configuration screens in sync,
consistent with this project's general preference for filters that can't go
stale over one-time validations that can (see also ADR-0014's rejection of
"keep `manager_id` and Team membership in sync by convention").

`packages/permission-engine` and `filter-sql.ts` gained the new clause
additively; `packages/permission-engine`'s scope resolution
(`TEAM`/`DEPARTMENT`/`ORGANIZATION`, ADR-0006/0014) is otherwise untouched.
