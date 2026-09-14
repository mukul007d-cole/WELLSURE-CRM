# ADR-0006: TEAM Scope From Reporting Hierarchy

**Status:** Accepted

## Context

Falcon needs distinct `TEAM` and `DEPARTMENT` record scopes, but the confirmed
model has a user reporting hierarchy and Departments, not separate Team or
TeamMembership entities. Creating Teams speculatively would add a product
concept not required by the current baseline.

## Decision

`TEAM` consists of the requesting User plus every active User who reports to
them recursively through `users.manager_id`.

`DEPARTMENT` consists of all active Users with the same `department_id`,
regardless of reporting branch or depth.

`ORGANIZATION` covers the full organization. `SELF` covers records assigned to
the requesting User according to the applicable assignment rule.

## Consequences

TEAM and DEPARTMENT remain meaningfully distinct without a new table. Hierarchy
traversal must be tenant-scoped, cycle-safe, and tested at multiple depths. An
indexed recursive CTE is acceptable initially; a maintained closure table may be
added for performance without changing these semantics.

A future cross-functional or non-hierarchical team requirement is a
schema/product change requiring a new ADR, not something pre-built in V1.

### Amendment — a deactivated user must not sever the chain below them

`expandTeamUserIds` (`packages/permission-engine/src/scope.ts`) originally used
one set for two different questions: "is this user included in the result"
(correctly, only if active) and "should the walk continue through this user to
their own reports" (incorrectly, gated on the same `active` check). A
deactivated manager was therefore excluded from the result *and* treated as a
dead end — anyone still reporting to them, however still active, became
unreachable from anyone above. A manager going on leave or being offboarded
before their reports are reassigned silently cut that whole remaining branch
off from the rest of the hierarchy.

Fixed by splitting the two concerns: a `visited` set (every id the walk has
queued, active or not) decides traversal and termination; a separate
`included` set (active ids only) is what the function returns. Reaching a
user's reports no longer depends on that user themselves being active — only
on whether they are still linked into the tree at all. This scope was always
used for `TEAM`, and — since ADR-0020 — is now also how Status Visibility
computes a routed lead's visible ancestors, which is what surfaced the gap: a
previously cosmetic edge case for one record scope became a correctness
requirement for a security check that runs on nearly every scoped list and
detail request.
