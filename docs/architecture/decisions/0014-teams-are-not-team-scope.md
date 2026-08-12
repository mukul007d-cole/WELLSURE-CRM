# ADR-0014: A Team is not the `TEAM` data scope

**Status:** Accepted

## Context

Phase 14a introduces a Team entity: a named group of Users inside one
Department, with one or more Team Leaders. This is the event ADR-0006
anticipated when it closed with "a future cross-functional or non-hierarchical
team requirement is a schema/product change requiring a new ADR."

The request that prompted it framed Teams as the thing `TEAM` permission scope
already refers to. It is not. `TEAM` resolves through `users.manager_id`
(`packages/permission-engine/src/scope.ts`), and three of its properties have no
counterpart in a membership model:

- **Every user has one with zero configuration.** No deployment can be in a
  "not set up yet" state.
- **It is transitive to any depth.** A manager sees their whole sub-tree.
- **It crosses Departments freely.** `manager_id` carries no department
  constraint; a cross-department reporting line works today.

Redefining `TEAM` to mean Team membership would therefore change the meaning of
every existing role holding that scope, at once, with no error and no signal.
On the day of the change, any user in no Team would have `TEAM == {self}` —
identical to `SELF`. Managers would silently stop seeing their reports' records
until an admin had rebuilt the entire organization as Teams.

## Decision

**Team membership and `TEAM` scope are independent, and deliberately so.**

`TEAM` continues to mean exactly what ADR-0006 says: the requesting User plus
every active User reachable downward through `users.manager_id`. The permission
engine does not read `teams` or `team_members`, and Phase 14a modifies no file
in `packages/permission-engine`.

A Team is an organizational and routing concept: a named, department-scoped set
of Users that Phase 14b assigns leads to. It has no effect on who can see what.

Two consequences are accepted deliberately:

**"Team" means two things in the product.** This is the real cost of the
decision and it is mitigated by naming, not by architecture. The role editor
renders the scope as **"Team (reporting line)"** with helper text stating that
it is unrelated to Teams configured under Departments, and the Teams editor
carries the converse note. That wording is a deliverable of Phase 14a, asserted
by a test.

**If membership-based visibility is wanted later, it arrives as a new scope
value** — `TEAM_MEMBERSHIP` alongside the existing four — that a role opts into
per module. Additive is reviewable and reversible per role; redefinition is
neither.

### Rejected alternatives

**Resolve `TEAM` against membership.** The silent scope collapse above, plus the
loss of transitivity and of cross-department reporting lines. A manager with
hierarchy reports outside their Team has no good answer: dropping them is a
silent access loss, keeping them makes `TEAM` a union of two mechanisms and the
hardest possible shape to review.

**Resolve against membership, falling back to the hierarchy when the user is in
no Team.** Removes the collapse, but makes "why can this user see this record?"
depend on configuration state elsewhere in the system. That question needs one
deterministic answer.

**Keep `manager_id` and Team membership in sync by convention** (a TL is set as
their members' manager). Unenforced it is not a guarantee and drifts invisibly.
Enforced it is worse — a routing screen silently rewriting the org chart, which
also drives reporting and `TEAM` scope for people outside the Team. It is also
structurally impossible with multiple leaders, since `users.manager_id` is a
single column, so it would force exactly one TL for an implementation reason.

## Related decisions recorded here

**Membership is confined to the Team's Department, enforced by a foreign key.**
`team_members` carries a denormalized `department_id` and two composite keys —
to `teams(organization_id, department_id, id)` and to
`users(organization_id, department_id, id)` — so neither a member from another
Department nor a spoofed `department_id` can be written. This is a database
constraint rather than only a service-layer check because Phase 14b routes lead
assignments through membership: a stale row would send a Department's leads to
someone who left it.

The same keys make a Department change fail while memberships remain, so
`updateUser` and `deactivateUser` end memberships inside their existing
transactions. Forgetting would be loud, not silent.

**A leader is a member with `is_leader`**, not a column on `teams`. A leader is
then structurally inside their own team, there is no second source of truth, and
co-leads cost nothing.

**An *active* Team has at least one leader.** The rule binds configuration:
create and member-replace both reject a leaderless set, consistent with this
system's refusal of accountability-free states (`replacePermissions` rejects a
replacement leaving no permission administrator).

A leader leaving the Department or being deactivated is **not** a configuration
act, and refusing a personnel action to protect a routing invariant is the wrong
trade. So the cascade removes the membership and, if that leaves an active Team
with no leader, **deactivates the Team in the same transaction** with its own
audit row. The invariant as stated — *active* implies led — holds at every
commit, and no HR operation is ever blocked. Reactivating is an ordinary edit
once a leader exists.

**Teams are administered under `users:view/create/edit`**, per ADR-0009, with no
new permission module. The blast radius of `users:edit` grows accordingly: it
now confers team administration and, once 14b lands, influence over lead
routing. Named here rather than discovered later.

## Consequences

ADR-0006 stands unmodified; this ADR extends rather than supersedes it. No
existing deployment changes authorization behaviour, which is what makes Phase
14a safe to roll back: reverting drops two tables and one index and restores
prior behaviour exactly.

Cross-functional teams spanning Departments remain unsupported. That is a
different entity with a different boundary and would need its own decision, not
a relaxation of the foreign key above.
