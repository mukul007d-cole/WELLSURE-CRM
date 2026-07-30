# ADR-0006: TEAM Scope Uses the Reporting Hierarchy

**Status:** Accepted

**Context:** Falcon needs distinct `TEAM` and `DEPARTMENT` record scopes, but the
confirmed model has a user reporting hierarchy and Departments—not separate Team
or TeamMembership entities. Creating Teams speculatively would add a product
concept not required by the current baseline.

**Decision:** `TEAM` consists of the requesting User plus every active User who
reports to them recursively through `users.manager_id`. `DEPARTMENT` consists of
all active Users with the same `department_id`, regardless of reporting branch or
depth. `ORGANIZATION` covers the full organization. `SELF` covers records assigned
to the requesting User according to the applicable assignment rule.

**Consequences:** TEAM and DEPARTMENT remain meaningfully distinct without a new
table. Hierarchy traversal must be tenant-scoped, cycle-safe, and tested at
multiple depths. An indexed recursive CTE is acceptable initially; a maintained
closure table may be added for performance without changing these semantics. A
future cross-functional or non-hierarchical team requirement is a schema/product
change requiring a new ADR, not something pre-built in V1.
