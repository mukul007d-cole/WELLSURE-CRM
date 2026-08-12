# ADR-0015: Per-status assignment routing

**Status:** Accepted

## Context

Phase 14b lets an admin configure, per Status, how a lead is assigned when its
process instance enters that Status: a pool (a 14a Team, or named Users) and an
algorithm (round robin or least loaded). The requirement that shapes everything
else is that the previous assignee must genuinely lose the lead — not gain a
co-owner.

Four facts found while planning, each verified against the tree rather than
assumed:

- **`SELF` scope resolves entirely through `assignments.is_current`.** The list
  SQL (`leads/filter-sql.ts`) and the record decision
  (`permission-engine/src/scope.ts`) both test `is_current` and `user_id`. So
  ending that one row is sufficient; there is no second visibility mechanism to
  keep in step.
- **A correct supersession already exists.** `LeadSharingService.reassign` ends
  the current assignment, creates the replacement and writes a `reassignment`
  activity, all in one transaction.
- **That path was not on the shared fan-out.** It called `NotificationService`
  directly, so a manual reassignment reached Notification Rules and never
  reached campaign triggers — invisible only because campaigns ignore everything
  but `status_changed`.
- **`statuses.auto_reassign_to_role_id` was a dormant ancestor of this feature.**
  Documented in `journey-definitions.md` as a `follow_up` side-effect, present in
  the schema since the initial migration, and with no reader, writer, seed or UI
  in any phase.

## Decision

**Routing is the third consumer of the existing trigger detection**, and the
consumer list moves into one `TriggerDispatcher` that every writer uses —
`writeActivity`, `LeadSharingService.reassign`, and routing's own reassignment.
ADR-0013 promised that a third consumer would be "a registration rather than
another copy of the classification"; collecting that promise required fixing the
divergence above rather than adding a third path beside it. A manual
reassignment now also reaches `CampaignTriggerService`, which ignores it.

**Status matching is exact**, per ADR-0001. Routing fires when the activity's new
status id equals the rule's status id; `sort_order` is never consulted.

**Termination.** Routing writes a `reassignment` activity, which dispatches
`lead_reassigned`, which routing ignores — one hop. The dispatcher routing itself
carries deliberately excludes routing, so termination is structural rather than a
property of one early-return inside a consumer someone may later edit. A test
asserts the hop count.

**The supersession reuses the existing shape.** One transaction: end the current
assignment for that assignment type, create the replacement, write one
`reassignment` activity carrying `oldValue {assignmentType, userId}` and
`newValue {assignmentType, userId}`. Two consequences of reusing it are
deliberate. A first-ever assignment still writes `reassignment`, with
`oldValue.userId: null` — a new action type would have to be taught to the
timeline renderer *and* to Phase 9's `previous_assignment_holder` resolver, which
reads exactly that field. And `source` is `routing` (or `routing_manual`) rather
than `lead_api`, so an auditor can tell an automatic assignment from a human one.

A partial unique index from Phase 5 —
`assignments (organization_id, process_instance_id, assignment_type) WHERE
is_current` — already makes two live assignments of one type impossible. The
"never a duplicate alongside the old one" requirement is therefore enforced by
the database, not only by this code path.

**Both algorithms take the same lock.** `SELECT … FOR UPDATE` on the rule row
before reading the cursor or counting load. Round robin's cursor is shared
mutable state; least loaded's counts are invalidated by the pick in flight. Two
status changes through one rule serialize; two through different rules do not.
Serializing per rule is inherent to a shared counter and is the accepted cost.

**Round-robin state is the last-assigned user id, not an index.** Candidates are
sorted by user id and the pick is the first id above the cursor, wrapping. An
index means a different person the moment the pool changes size — routine for a
Team pool, since 14a ends memberships on a department change or deactivation.

**"Open", for least loaded**, is a current assignment of *this rule's* assignment
type, on an active process instance whose current status has
`outcome_type = 'open'`, counted organization-wide. A rep holding two hundred
closed-won leads is not loaded; a collaborator on a different assignment type is
not this rule's business; and a rep working two Journeys is genuinely busy in
both, so scoping the count to one Journey would keep feeding leads to someone
already buried elsewhere. `behavior_type: archived` is **not** excluded — it is a
view default, not a statement that the work is finished. Ties break by user id,
so the result never depends on row order.

**An unresolvable pool skips; it does not fail the status change.** An empty
pool, a deactivated Team, or an all-inactive pool writes a `routing_skipped`
activity naming the reason, leaves any existing assignment untouched, and lets
the status change commit. A user moving a lead must not have their edit rejected
because an admin's pool is empty. A genuine fault still throws and still rolls
the mutation back, so Phase 9's rollback guarantee is unchanged.

**Two permission axes plus a per-Status grant.** A new `lead_routing` module with
`view`, `configure` and `operate`. `configure` decides who *may* receive leads at
a Status; `operate` moves one particular lead — different levels of trust, the
same split as `campaigns:send` against `campaigns:edit`, and neither implies the
other.

`operate` is an **additional** gate, never a replacement: a manual override still
passes the ordinary lead authorization — `leads:edit`, journey access, and the
operator's own record scope — exactly as a manual campaign send stays bounded by
the sender's Leads scope.

On top of the module action, `status_routing_permissions` grants
`(status, role, action)` with allow-list semantics, layered exactly as
`field_visibility` layers on `leads:view`: **both** are required. One Journey's
Statuses are frequently operated by different groups, which a module-wide action
cannot express.

**Editing those grants is gated on `roles_permissions:edit`, never on
`lead_routing:configure`.** A routing administrator who cannot edit permissions
must not be able to grant routing rights, including to their own role — the same
self-escalation `field_visibility` already refuses.

**`statuses.auto_reassign_to_role_id` is retired**, dropped in this phase's
migration, with `journey-definitions.md` updated in the same change. Leaving a
dormant column describing this feature beside the tables that implement it is a
trap for the next reader. Rollback is re-adding a nullable column and its foreign
key; no data can be lost, because nothing ever wrote to it.

## Consequences

Routing does **not** fire on lead creation or on a journey move. `createLead`
writes `field_edit` and `moveJourney` writes `journey_change`; neither is a
status entry. Campaigns have the identical gap, and closing it for one feature
and not the other would be worse than the gap. Named as follow-up and asserted as
current behaviour, so changing it later is a deliberate act.

The `lead_routing` catalog addition is visible on every role editor screen, as
`campaigns` was in 13c.

Phase 9 and 13c behaviour is otherwise unchanged. The permission engine's scope
resolution and decision path are untouched: ADR-0006 and ADR-0014 stand, and
`TEAM` scope still has nothing to do with Teams or with routing pools.
