# ADR-0025: Role reporting lines and the `REPORTING_ROLES` scope

**Status:** Accepted (Phase 24). Extends ADR-0006 and ADR-0020; neither is superseded.

## Context

Wellsure's real hierarchy, exported from Cronberry, is defined between
**roles**: every role lists the roles it reports to ("Sales Executive" reports
to "Team Leader", which reports to "Sales Manager"; "Operations Executive"
reports to both "Team Leader" and "Operations Manager"). A user sees the leads
owned by users whose role sits below their own. No user record carries a
manager.

Falcon's two hierarchy-dependent mechanisms both read `users.manager_id`:
`TEAM` scope (ADR-0006) and Status Visibility's "assignee plus their
ancestors" (ADR-0020). With 161 migrated users and no managers, every routed
status would be visible to its assignee alone and no manager-style role could
be expressed at all.

## Decision

1. **Roles gain reporting lines.** `role_reporting_lines(organization_id,
   role_id, reports_to_role_id)`, many-to-many, edited on the Role screen
   ("Reports to"). Self-lines and cycles are rejected on write; traversal is
   cycle-safe anyway.
2. **A fifth `DataScope`, `REPORTING_ROLES`** ("Reporting roles" in the UI):
   the caller plus every user whose role is a transitive descendant of the
   caller's role. It counts **inactive** users too, unlike `TEAM`: the role
   relationship outlives a person, and a departed owner's leads must stay
   visible to the people who have to reassign them. It is a scoped action's
   ordinary scope — it never widens anything on its own.
3. **Status Visibility's ancestor set becomes the union** of the manager chain
   (ADR-0020, unchanged) and role ancestry: a lead in a routed status is
   visible to its assignee, everyone above the assignee through
   `manager_id`, and everyone whose role is above the assignee's role. Both
   the single-record decision and `RecordPredicate.hierarchyUserIds` use the
   same union, so list, count, detail and export stay in parity.
4. `TEAM` keeps its exact ADR-0006/ADR-0014 meaning. An organization that
   never configures reporting lines sees no behaviour change.

## Consequences

- A manager role sees every lead owned by its descendant roles, organization
  wide — wider than a sparse `manager_id` chain, and exactly what Cronberry
  did. Roles that should see only some executives use `TEAM` and real
  managers instead; both can coexist on one user.
- Role-tree expansion is one recursive CTE per request, cached for the
  decision like the manager walk.
- Rollback: rewrite `REPORTING_ROLES` grants to `TEAM`, drop the table and the
  enum value (migration `00000000000008_cutover_engine_rules`'s `rollback.sql`).
