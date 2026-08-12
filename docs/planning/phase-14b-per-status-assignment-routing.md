# Phase 14b — Per-status assignment routing rules

Status: approved 2026-08-12. **Delivered.** Sub-phase 2 of 2 in Phase 14.
Depends on 14a (delivered, `40f3388`) for the Team pool option.

All four decisions were taken as recommended: Option A (per-Status role grants),
`outcome_type = 'open'` org-wide and restricted to the rule's assignment type
with `archived` not excluded, skip-don't-fail on an unresolvable pool, and
dropping `auto_reassign_to_role_id`. Recorded as ADR-0015.

Five things the implementation found that the plan did not anticipate:

- **The "no duplicate assignment" requirement was already enforced by the
  database.** `assignments (organization_id, process_instance_id,
  assignment_type) WHERE is_current` is a partial unique index dating from Phase
  5. Removing the supersession does not produce two live assignments — it
  produces a constraint violation. Stronger than §3 claimed, and the vacuity
  check below had to account for it.
- **`activity_logs` and `system_audit_logs` are append-only by trigger**, so the
  integration tests cannot be isolated by deleting what they wrote. They are
  isolated by never sharing a Status instead — each test creates its own, so one
  test's rule, audit trail and assignments are unreachable from another's.
- **A shared-user concurrency test would have been wrong, not flaky.** With
  candidates carrying unequal prior load, sending three concurrent leads to the
  same candidate is the *correct* least-loaded answer, and the test would have
  failed while the code was right. Both concurrency tests now create dedicated
  zero-load candidates, which is what makes "one each" the only correct outcome.
- **`validatePool` refuses an inactive Team**, so a rule cannot be created
  against one. The skip test therefore deactivates the Team *after* the rule
  exists — which is also the sequence 14a's leaderless cascade actually produces.
- **The `useEffect`-plus-`setState` idiom for seeding editor state is banned by
  lint.** The grant editor derives its rendered set from the query instead, which
  independently removes the stale-copy defect 13a had to fix for field grants.

The security-critical test was checked for vacuity twice, since the first
mutation was caught by the Phase 5 index rather than by the visibility
assertions: removing the supersession fails the status change outright, and
granting the previous holder a direct share instead fails on the whole-response
list assertion (`expected '{"total":1,...}' not to contain '<leadId>'`). Both
restored.

## Goal

For each Status in a Journey, let an admin configure how leads are automatically
assigned when a lead transitions into it — a pool (a 14a Team, or a named set of
Users) plus an algorithm (round robin or least loaded) — reusing the existing
trigger detection rather than adding a fourth "what just happened" mechanism,
and ending the previous assignment in the same transaction so the previous
holder genuinely loses the lead.

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/source-of-truth.md`,
`docs/requirements/glossary.md`, `docs/permissions/access-model.md`,
`docs/data-model/schema.md`, `docs/api/endpoints.md`,
`docs/workflows/journey-definitions.md`, `docs/testing/quality-gates.md`,
`docs/planning/phase-9-lead-sharing-and-notifications-plan.md`,
`docs/planning/phase-13a-…`, `phase-13c-…`, `phase-14a-…`,
ADR-0001, ADR-0006, ADR-0009, ADR-0010, ADR-0013, ADR-0014.

## Current state

Verified against `40f3388` (14a merged into the branch). Re-checked rather than
carried over from the kickoff brief — three things below differ from what that
brief assumed.

### SELF scope resolves purely through current assignments — so ending the row is sufficient

`expandScopeUserIds` returns `[user.id]` for `SELF`
(`packages/permission-engine/src/scope.ts:15-16`), and that id is applied to
records in exactly two places, both keyed on the assignment row:

- List/count SQL (`leads/filter-sql.ts:136-157`): `a.is_current` AND
  `a.user_id = ANY(allowedUserIds)`, inside an `EXISTS` over `process_instances`.
- Detail decisions (`permission-engine/src/scope.ts:99-113`): the same
  `isCurrent` + `userId` test over `AssignmentSnapshot`.

So **flipping `is_current` to false is sufficient** for the previous holder to
lose the lead. No second mechanism is needed. Two caveats that the security test
must pin rather than assume:

- A **direct grant** (`user_access_grants`, i.e. a lead share) is an independent
  `OR` branch (`filter-sql.ts:162-167`). A previously-assigned user who also
  holds a live share keeps access — correct, by ADR-0010's design, but it means
  "loses visibility" is a claim about assignment-derived access only.
- **TEAM/DEPARTMENT/ORGANIZATION** scope holders keep seeing the lead if the new
  assignee falls in their scope. Also correct. The test therefore uses a
  `SELF`-scoped previous holder so the assertion is unambiguous.

### There is already a correct reassignment path, and it is not on the shared fan-out

`LeadSharingService.reassign` (`leads/sharing.ts:192-252`) already does exactly
what 14b needs, in one transaction: find the current assignment of that type,
set `isCurrent: false`, create the replacement, write a `reassignment`
`activity_logs` row carrying `oldValue {assignmentType, userId}` and
`newValue {assignmentType, userId}`. 14b must reuse this shape, not invent one.

**But it calls `new NotificationService(tx).evaluate(...)` directly** rather than
going through `trigger-dispatch.ts`. Only `PrismaLeadRepository.writeActivity`
(`:345-379`) uses the shared dispatch and fans out to both consumers. The
consequence today: **a manual reassignment reaches Notification Rules but never
reaches Campaign triggers.** Harmless so far, because `CampaignTriggerService`
ignores everything except `status_changed` — but it is a live divergence, and
adding routing as a third writer on a third path would entrench it. §2 proposes
fixing it as part of this phase.

The `previous_assignment_holder` notification resolver reads
`oldValue.userId` off that activity (`notifications/service.ts:230-233`), so the
activity shape is load-bearing, not cosmetic.

### Only `status_change` is a trigger — creation and journey moves are not

`triggerTypeFor` (`leads/trigger-dispatch.ts:33-46`) maps four action types.
Checked against the writers:

| Operation | `action_type` written | Trigger |
|---|---|---|
| `editLead` with a new status | `status_change` | `status_changed` ✅ |
| `createLead` (lands in a status) | `field_edit` | `field_edited` — **not** a status entry |
| `moveJourney` (lands in a status) | `journey_change` | **none at all** |

So a lead **created** into a routed status, or **moved** into one, will not be
routed. Campaigns have the identical gap today. §5 makes this an explicit
decision rather than a surprise.

### `statuses.auto_reassign_to_role_id` is dormant and overlaps this phase

The column exists and `docs/workflows/journey-definitions.md:60` documents it as
a `follow_up` behaviour side-effect ("if `auto_reassign_to_role_id` is set,
reassign ownership"). A repo-wide search finds it **only in generated Prisma
types** — no reader, no writer, no seed, no UI. It is a specified-but-unbuilt
version of the feature this phase actually builds. §7 proposes retiring it.

### `assignment_type` is configurable free text, discovered from data

`validateAssignments` requires only non-blank strings (`leads/validation.ts:25-35`),
and `GET /journeys/:id` returns `assignmentTypes` computed as the **distinct
types on existing current assignments** for that journey
(`configuration/prisma-configuration-repository.ts:62-70`). On a journey with no
leads that list is empty. A routing rule must therefore name its assignment type
as free text, with the observed list offered as suggestions — it cannot be a
picker over a closed set, and inventing a canonical owner string is exactly what
`docs/api/endpoints.md:274` says the API must not do.

### The Statuses UI is a flat list inside the Journey detail page

`/admin/journeys/:journeyId` → `JourneyDetailPage`, reached from a **Manage**
link on each Journeys row (`JourneysPage.tsx:84-91`). Its "Statuses" card holds
an `<ol>` where each item is one line — name, `outcomeType · behaviorType`, and
Move up / Move down / Edit / Deactivate buttons (`JourneyDetailPage.tsx:214-263`).
There is no per-status expandable region today; §8 adds one. 14a did not touch
this file.

### 14a's Teams are available as pools

`teams` / `team_members` with `is_leader`, members guaranteed by foreign key to
be active Users of the Team's Department, memberships ended automatically when a
user changes Department or is deactivated, and a Team deactivated if that leaves
it leaderless (ADR-0014). For routing this means **a Team pool cannot contain a
departed or deactivated member** — the invariant 14a paid for, now collected.

---

## Proposed approach

### 1. Routing is the third consumer of the existing detection

```
writeActivity → triggerTypeFor(actionType) → TriggerDispatcher
                                              ├→ NotificationService.evaluate
                                              ├→ CampaignTriggerService.evaluate
                                              └→ StatusRoutingService.evaluate   (new)
```

`StatusRoutingService.evaluate` ignores every trigger except `status_changed`,
reads the entered status id via the existing `enteredStatusId(newValue)` helper,
and looks up an active rule for that exact status id. **Exact match per
ADR-0001** — no `sort_order`, no "at or beyond".

### 2. One dispatcher, so the manual-reassign divergence is fixed rather than doubled

ADR-0013 promised that "adding a third consumer is now a registration rather
than another copy of the classification". Collecting that promise means the
consumer list has to live in one place, which today it does not — `writeActivity`
knows both consumers, and `sharing.reassign` knows one.

So `trigger-dispatch.ts` grows a small `TriggerDispatcher` holding a
`TriggerConsumer[]`, and **all three writers dispatch through it**:
`writeActivity`, `LeadSharingService.reassign`, and routing's own reassignment.
Net behaviour change: a manual reassignment now also reaches
`CampaignTriggerService`, which ignores it. That is a no-op today and the
right shape tomorrow.

**Termination.** Routing writes a `reassignment` activity, which dispatches
`lead_reassigned`, which routing ignores. One hop, no loop. This is asserted by
a test rather than argued, because it is the kind of property that silently
stops being true when a fourth consumer arrives.

### 3. Assignment supersession — reuse the existing path, do not build a parallel one

Inside the same transaction as the status change:

1. `SELECT … FOR UPDATE` the rule row (see §4).
2. Resolve candidates; pick one by the algorithm.
3. Find the current assignment for `(process_instance, assignment_type)`; if one
   exists, set `is_current = false`.
4. Create the replacement assignment.
5. Write one `reassignment` activity with
   `oldValue {assignmentType, userId: <previous or null>}` and
   `newValue {assignmentType, userId: <picked>}`, `source: 'routing'`.
6. Dispatch it.

Step 3 is what makes the previous holder lose the lead, per §Current state. There
is never a second live assignment of the same type — the requirement's "do not
add a duplicate alongside the old one" is satisfied structurally, and §Test plan
asserts the row count directly.

When the lead had **no** prior assignment of that type, this is an initial
assignment, not a reassignment. It still writes the same `reassignment` action
type with `oldValue.userId: null`, because the timeline renderer and the
`previous_assignment_holder` resolver already handle that shape and a new action
type would need both to learn it. Called out because it is a judgement call.

`source: 'routing'` (rather than `lead_api`) is how an auditor tells an automatic
assignment from a human one; it is a free-text column already.

### 4. Concurrency: lock the rule row, both algorithms

Round robin's "next" is shared mutable state; least loaded's input is a count
that the previous pick changes. Both are wrong under concurrency for the same
reason, so both take the same lock:

```sql
SELECT id FROM status_routing_rules
 WHERE organization_id = $1 AND id = $2 FOR UPDATE
```

matching `lockRole` / `lockField` / `lockTeam`. Two status changes hitting the
same rule serialize; two hitting *different* rules do not. Serializing per rule
is inherent to a shared counter and is stated as the accepted cost rather than
hidden.

**Round robin state is the last-assigned user id, not an index.** Candidates are
sorted by user id; the pick is the first candidate whose id is greater than the
cursor, wrapping to the first if none is. An integer index breaks the moment the
pool changes size — this survives members joining and leaving, which for a Team
pool 14a makes routine.

### 5. What "open" means for least loaded — decision requested

**Recommended:** a candidate's load is the number of assignments where
`is_current`, the assignment type equals the rule's, the process instance is
active, and **the instance's current status has `outcome_type = 'open'`**.

- `outcome_type` is the engine's own terminal/non-terminal axis (ADR-0001) and is
  admin-configurable per status. A rep holding 200 `closed_won` leads is not
  loaded.
- **Counted organization-wide, not per journey.** A rep working two journeys is
  genuinely busy in both; scoping the count to the rule's journey would keep
  feeding leads to someone already buried elsewhere.
- **Restricted to the rule's assignment type.** Being a collaborator on 100 leads
  should not make someone ineligible to own one.

Accepted consequence, stated because it is a real edge: a status configured
`outcome_type: open` **and** `behavior_type: archived` counts as load. I am
recommending *against* also excluding `archived`, because `behavior_type` is a
view-default concern ("excluded from active list/kanban views by default, still
queryable") rather than a statement about whether the work is finished, and one
condition is easier to reason about than two. Say so at approval if you want
`archived` excluded too — it is one clause.

Ties break by the same sorted-user-id rule round robin uses, so the algorithm is
deterministic and testable rather than dependent on row order.

### 6. Unresolvable pool skips, it does not fail the status change — decision requested

A rule can fail to produce a candidate: an empty user pool, a Team whose
membership is empty, a Team deactivated by 14a's leaderless cascade, or every
candidate inactive.

**Recommended:** treat this as a configuration condition, not an error. Write no
assignment, leave any existing one untouched, write one `routing_skipped`
activity naming the reason, and let the status change commit. Rationale: a user
moving a lead's status must not have their edit rejected because an admin's pool
is empty. A genuine fault (database error) still throws and still rolls the whole
mutation back, exactly as Phase 9's rollback test requires.

The alternative — refuse the status change — makes routing configuration able to
block ordinary lead work, which is worse than a visible skip.

### 7. Retire `statuses.auto_reassign_to_role_id` — decision requested

**Recommended: drop the column in this phase's migration.** It is the same
feature this phase builds, specified for `behavior_type: follow_up` and never
implemented — no reader, no writer, no data. Leaving a dormant column that
contradicts the mechanism beside it is a trap for whoever reads the schema next.
Rollback is re-adding a nullable column, which is exactly recoverable because
nothing has ever written to it.

`docs/workflows/journey-definitions.md:60` is updated in the same change to point
at routing rules instead. If you would rather keep the column, it stays dormant
and the doc gets a "not implemented; see routing rules" note instead.

### 8. Permissions — two axes, and one structural question that needs your call

A new `lead_routing` module in `packages/permission-engine/src/catalog.ts` with
three actions (ADR-0009 requires explicit `view` actions):

| Action | Grants |
|---|---|
| `view` | see a status's routing rule and its live state |
| `configure` | create/edit/clear the rule — pool and algorithm |
| `operate` | manually assign or override a specific lead at that status |

`configure` and `operate` are separate for the `campaigns:send` vs
`campaigns:edit` reason: deciding who *may* receive leads and moving one
*particular* lead are different levels of trust.

**`operate` is an additional gate, never a replacement.** A manual override still
goes through the normal lead authorization — `leads:edit`, journey access, and
the operator's own record scope — exactly as a manual campaign send stays bounded
by the sender's Leads scope. Holding `lead_routing:operate` never lets someone
touch a lead they otherwise cannot see.

#### The structural question: per-status role grants

The instruction for the UI is a per-status section with "(2) role
visibility/edit/manual-assign permissions **for that status's routing**". Read
literally, that is a **per-(status, role) grant table** — a third permission
layer, on top of the four axes in `access-model.md`, structurally the same as
`field_visibility` is for Fields.

**Option A (recommended): build it, modelled exactly on `field_visibility`.**

```text
status_routing_permissions
  id, organization_id, status_id, role_id, action, created_at
  UNIQUE (organization_id, status_id, role_id, action)
```

Allow-list semantics: no row means denied. Effective decision is
`lead_routing:<action>` **AND** a matching row — the same "module action AND
per-entity grant" shape that `leads:view` AND a `field_visibility` row already
have, so it is a pattern this codebase and its reviewers already know.

Critically, and following 13a's precedent exactly: **editing these grants is
gated on `roles_permissions:edit`, not on `lead_routing:configure`.** A routing
administrator who cannot edit permissions must not be able to grant themselves
routing rights — `access-model.md` already states this principle for Fields, and
the same self-escalation exists here.

Why it earns its place: different statuses in one journey are frequently operated
by different groups — an ops status by ops leads, a sales status by sales leads.
Module-level actions cannot express that, so without this table the only way to
give someone routing control over one status is to give them it over all of them.

**Option B: module actions only, no per-status table.** Simpler by one table, one
endpoint pair, and one UI panel. The cost is that `lead_routing:operate` is
all-or-nothing across every status in every journey, and the instruction's UI
part (2) becomes a link to the role editor rather than a real control.

I recommend **A** and will build it unless told otherwise, but it is the single
largest scope item in this sub-phase and it adds a permission layer, so it should
be an explicit yes rather than an inference from one clause.

### 9. Data model

```text
status_routing_rules
  id, organization_id, journey_id, status_id, assignment_type,
  algorithm (round_robin | least_loaded),
  pool_type (team | users), team_id (nullable),
  round_robin_cursor_user_id (nullable),
  active, version, created_by, updated_by, created_at, updated_at
  UNIQUE (organization_id, status_id)          -- at most one rule per status
  FK (organization_id, journey_id, status_id) -> statuses  -- status must be in the journey
  FK (organization_id, team_id) -> teams
  CHECK (pool_type = 'team' AND team_id IS NOT NULL)
     OR (pool_type = 'users' AND team_id IS NULL)
  CHECK algorithm IN ('round_robin','least_loaded')

status_routing_rule_members            -- pool_type = 'users' only
  id, organization_id, rule_id, user_id, created_at
  UNIQUE (organization_id, rule_id, user_id)

status_routing_permissions             -- §8 Option A
  id, organization_id, status_id, role_id, action, created_at
  UNIQUE (organization_id, status_id, role_id, action)
```

`statuses` already carries `@@unique([organizationId, journeyId, id])` (added for
`process_instances`), so the journey-scoping foreign key above needs no new index
on the parent — the same trick 14a used to make the Department invariant a key.

One rule per status, enforced by a unique constraint rather than by application
code. A status with no rule is simply unrouted; clearing a rule deactivates it
(`active = false`, never a hard delete) so its cursor and audit trail survive.

### 10. API

```
GET    /api/v1/statuses/:statusId/routing            lead_routing:view
PUT    /api/v1/statuses/:statusId/routing            lead_routing:configure
POST   /api/v1/statuses/:statusId/routing/deactivate lead_routing:configure
GET    /api/v1/statuses/:statusId/routing/state      lead_routing:view
POST   /api/v1/leads/:id/routing-assign              lead_routing:operate + leads:edit
GET    /api/v1/statuses/:statusId/routing/permissions roles_permissions:view
PUT    /api/v1/statuses/:statusId/routing/permissions roles_permissions:edit
```

`PUT …/routing` is a whole-rule replace including its member set, matching the
join-row replace precedent. `…/routing/state` returns the live picture the
`operate` UI needs: current cursor holder and each candidate's open count.
`…/routing-assign` is the manual override; it reuses the §3 supersession path so
a manual assignment and an automatic one leave identical evidence.

### 11. Frontend

`JourneyDetailPage`'s Statuses `<ol>` gains a per-status expander — the row keeps
its existing controls and grows a "Routing" toggle that reveals a panel with two
sections, matching the instruction:

1. **Rule** — assignment type (free text, suggestions from the journey's observed
   `assignmentTypes`), pool type (Team picker scoped to active Teams, or a User
   multi-select), algorithm, and the live state readout.
2. **Role permissions** — a role × {view, configure, operate} grid for this
   status, rendered only for a user holding `roles_permissions:edit`, per §8.

No new route, no new tab, no sidebar entry.

## Files to touch

**Database** — `packages/database/prisma/schema.prisma`, new migration
`00000000000006_status_routing` (three tables; drops
`statuses.auto_reassign_to_role_id` per §7).

**Permission engine** — `packages/permission-engine/src/catalog.ts` (the
`lead_routing` module). No change to `scope.ts` or the decision path.

**API**
- `apps/api/src/routing/{service,rule-service,validation,algorithms}.ts` *(new)*
- `apps/api/src/leads/trigger-dispatch.ts` — `TriggerDispatcher` (§2)
- `apps/api/src/leads/prisma-lead-repository.ts` — dispatch through it
- `apps/api/src/leads/sharing.ts` — dispatch through it (fixes the divergence)
- `apps/api/src/http/routes/routing.ts` *(new)*, `http/build-server.ts`,
  `http/types.ts`, `main.ts`
- `apps/api/src/routes/routing.ts` *(new)* — permission gating

**Web** — `pages/admin/StatusRoutingPanel.tsx`, `StatusRoutingPermissions.tsx`
*(new)*, `JourneyDetailPage.tsx`, `lib/api-client.ts`, `types/domain.ts`,
`mocks/handlers.ts`.

**Tests** — `phase14b.postgres.integration.test.ts`, `routing-algorithms.test.ts`,
`AdminFlows.test.tsx`.

**Docs** — new ADR-0015 (routing as third consumer; the `operate`/`configure`
split; retiring `auto_reassign_to_role_id`), `docs/api/endpoints.md`,
`docs/data-model/schema.md`, `docs/permissions/access-model.md`,
`docs/workflows/journey-definitions.md`, this plan.

## Out of scope

- **Routing on lead creation and on journey moves** (§5's gap). Campaigns have
  the same gap; closing it for one feature and not the other would be worse than
  the gap. Named as follow-up, not silently designed around.
- Weighted/capacity-capped/skill-based routing, working hours, holiday cover.
- Re-routing already-assigned leads in bulk, or backfilling routing for leads
  already sitting in a routed status.
- Routing anything other than a single assignment type per rule.
- Notifying the new assignee. Phase 9 rules already fire on `lead_reassigned`; an
  admin who wants that configures a rule. No new notification kind here.
- Changing `TEAM` data scope. ADR-0014 stands; routing reads `team_members`, the
  permission engine still does not.

## Risks / open questions

1. **Decision requested — §8 per-status role grants (Option A vs B).** The
   largest scope item and a new permission layer.
2. **Decision requested — §5 what "open" means**, and whether `archived` is
   excluded.
3. **Decision requested — §6 skip vs fail** on an unresolvable pool.
4. **Decision requested — §7 dropping `auto_reassign_to_role_id`.**
5. **Round robin serializes per rule.** A burst of status changes into one routed
   status queues on one row lock. Correct, and the only correct option for a
   shared counter, but it is a throughput characteristic worth knowing before it
   is discovered in load testing.
6. **§2 changes an existing path.** `sharing.reassign` starts dispatching to
   campaigns. A no-op today because `CampaignTriggerService` returns early on
   anything but `status_changed`, and asserted as a no-op by test.
7. **`lead_routing` in the catalog is visible on every role editor screen**, as
   `campaigns` was in 13c. Intended, but it changes an existing screen.
8. No conflict found between `docs/` and the repository, with one exception
   already handled: `journey-definitions.md:60` documents an auto-reassign
   behaviour that does not exist. §7 resolves it rather than leaving the doc
   describing a phantom.

## Test plan

Per `docs/testing/quality-gates.md`; synthetic fixtures only, no Wellsure names.

### The security-critical assertion

**The previous assignee genuinely loses the lead**, proven on every surface at
once, the way 14a's scope test was:

- A `SELF`-scoped previous holder is assigned a lead; a status change fires a
  rule that routes it to someone else.
- **Whole-response**: the previous holder's seller list body no longer contains
  the lead id, anywhere, in any shape; the record fetch 403s; `authorize()`
  returns `recordAllowed: false` with `RECORD_SCOPE_DENIED`. Three surfaces,
  because counts and lists must agree (`access-model.md`).
- The new holder sees it on all three.
- **Exactly one current assignment** of that type exists for the process
  instance, and the superseded row is present with `is_current = false` — the
  "no duplicate alongside the old one" requirement asserted as data, not implied.
- The `reassignment` activity is in the timeline with both holders, and is
  visible to a reader of the lead.
- **The share caveat is pinned, not left implicit**: a previous holder who also
  holds a live `user_access_grant` still sees the lead. Asserted so the boundary
  is documented by a test rather than discovered as a bug report.

### Concurrency (real Postgres, genuinely concurrent)

Matching 13a's field-visibility replace test, not a single-threaded loop:

- **Round robin**: N simultaneous status changes on N different leads through one
  rule with a 3-member pool distribute exactly evenly, every candidate used, no
  candidate used twice before all are used once, and the cursor lands where the
  sequential result would.
- **Least loaded**: concurrent picks do not all choose the same candidate — the
  failure this catches is two transactions reading the same counts.
- Neither deadlocks; all requests return 200.

### Trigger and transaction behaviour

- Fires on an **exact** status match only; entering a different status in the
  same journey routes nothing (ADR-0001).
- Does **not** fire on lead creation or on a journey move — the §5 gap asserted
  as current behaviour so a future change is a deliberate one.
- **No loop**: one status change produces exactly one routing assignment and one
  `reassignment` activity, and the dispatched `lead_reassigned` produces no
  second assignment.
- **Rollback**: a mutation that fails after routing leaves no assignment, no
  activity, and no cursor movement — Phase 9's rollback property, extended.
- **Skip path** (§6): an empty pool, a deactivated Team, and an all-inactive pool
  each leave the existing assignment untouched, write a `routing_skipped`
  activity, and **still commit the status change**.
- A manual reassignment still reaches Notification Rules and now also reaches
  `CampaignTriggerService` as a no-op (§2, risk 6).

### Permissions

- `configure` and `operate` are independently required; neither implies the other,
  and `campaigns`-style, holding `edit`-equivalents elsewhere grants nothing here.
- A manual override by a holder of `lead_routing:operate` who lacks record scope
  for that lead is **refused** — the "additional gate, never a replacement"
  claim in §8, tested rather than asserted.
- Per-status grants (if Option A): absence of a row denies; grants are edited only
  by a `roles_permissions:edit` holder, and a `lead_routing:configure` holder
  **cannot** grant themselves routing rights — the 13a self-escalation test,
  transposed.
- Every mutation writes `system_audit_logs`; every automatic assignment writes
  `activity_logs`.
- Tenant isolation: a status, team, or role id from another organization is
  rejected on every endpoint.

### Unit

- Round robin picks: wrap-around, cursor holder removed from the pool, single
  candidate, pool reordered, first-ever pick with a null cursor.
- Least loaded: tie-break determinism, terminal statuses excluded, other
  assignment types excluded, inactive process instances excluded.
- Validation: unknown algorithm, `team` pool with a user list, `users` pool with a
  team id, blank assignment type, empty user pool, a team from another
  organization, a status from a different journey than the rule's.

### Frontend

- The Routing panel opens inside the Statuses list, saves a rule, and switches
  pool type between Team and Users.
- The role-permission grid renders only for a `roles_permissions:edit` holder.
- The live-state readout shows the current cursor holder and per-candidate counts.

### Gates

`format:check`, `lint`, `typecheck`, `test`, `build`, plus the Postgres suite,
all run and observed before the PR — and, as in 14a, the security-critical test
checked for vacuity by mutating the supersession step and confirming it fails.

## Rollback plan

Three new tables; rollback is `DROP TABLE status_routing_permissions,
status_routing_rule_members, status_routing_rules`.

The one destructive element is §7's `ALTER TABLE statuses DROP COLUMN
auto_reassign_to_role_id`. Recovery is `ADD COLUMN … uuid NULL` plus its foreign
key — exactly recoverable because the column has never had a writer, so no data
can be lost. If that is not acceptable, §7's alternative keeps the column.

Existing-path changes are the `TriggerDispatcher` extraction and `sharing.reassign`
routing through it; reverting restores the previous direct calls. The permission
engine's decision path and scope resolution are untouched, so — as in 14a — no
authorization behaviour changes in either direction.
