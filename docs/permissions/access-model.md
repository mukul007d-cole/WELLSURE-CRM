# Access Model / RBAC

## Server-side authorization rule (authoritative — API enforces this, UI only reflects it)

```
ALLOW =
  user is active
  AND role grants the feature/action
  AND role grants the journey
  AND (
    data scope includes the record (expanded through hierarchy where relevant)
    OR an active, non-expired direct record grant exists for the record
  )
  AND field permission allows the requested fields
  AND the workflow permits the action in the current status
```

## The four axes (every role is a combination of these — roles themselves are admin-defined, not fixed presets)

**A. Feature permissions** — action × module:

| Module | Actions |
|---|---|
| Leads | view, create, edit, delete, export, bulk_reassign, bulk_status_change |
| Fields | view, create, edit, delete |
| Journeys & Statuses | view, create, edit, delete |
| Services | view, create, edit |
| Users | view, create, edit, deactivate |
| Roles & Permissions | view, create, edit |
| Reports | view_standard, view_financial, build_custom (Phase 2) |
| Attachments | upload, download, delete |
| Integrations | configure |

The immutable runtime source for these identifiers is
`packages/permission-engine/src/catalog.ts`. Department administration is part
of the User scope and uses `users:view/create/edit`; V1 has no separate
Department permission module. See ADR-0009.

**B. Data scope** (per module, independently): `SELF` → `TEAM` → `DEPARTMENT` → `ORGANIZATION`

- `SELF`: records assigned to the requester under the applicable assignment rule.
- `TEAM`: the requester plus all recursive downstream reports through
  `users.manager_id` (ADR-0006).
- `DEPARTMENT`: all active users sharing the requester's `department_id`,
  regardless of reporting branch or depth.
- `ORGANIZATION`: all records in the requester's organization.

**C. Journey access** — explicit allow-list per role. A role with no access to a Journey doesn't see it in the UI at all, not greyed out.

**D. Field-level visibility** — layered on top of A–C via an allow-list in `field_visibility`. Each `(field, role)` row grants `VIEW` or `EDIT`; `EDIT` includes viewing. Absence of a row means the field is hidden entirely for that role. Enforced by stripping fields from the API response server-side, never just hiding them client-side — this is what makes sensitive fields actually secure.

## Additional mechanism: direct record grants

For exceptional one-off access that doesn't fit the role/hierarchy model (e.g. a specific person needs temporary visibility into one lead outside their normal scope), use `user_access_grants` rather than creating a new role or assigning a second role. A non-expired direct grant is additive to normal data scope; it never bypasses feature/action, Journey, field, workflow, or active-user checks. One active role per user, always.

## Example starting roles (seed data — fully editable)

| Role | Leads scope | Journey access | Notes |
|---|---|---|---|
| Sales Executive | SELF | assigned journeys only | create, edit own, no delete/export |
| Team Leader | TEAM | same as team's journeys | bulk_reassign within team, view_standard reports |
| Manager | DEPARTMENT | subset of journeys (varies by manager) | export, view_standard + view_financial |
| Ops Rep | SELF (assigned process instances) | assigned journeys only | operational fields only, no financial field visibility |
| Admin | ORGANIZATION | all | full config access — Fields/Journeys/Roles/Users |

## Non-negotiable implementation rules

- Unauthorized fields are removed by the API, not hidden in the browser.
- Count endpoints use the exact same access-filtering query as list endpoints (a common bug source: counts leaking record existence beyond what a user can actually see).
- Saved views never bypass the permission engine.
- Bulk operations re-check every selected record server-side, not just at selection time.
- Exports include only permitted rows and permitted fields.
- Every reassignment, status change, finance action, document event, bulk action, and export writes to `system_audit_logs` or `activity_logs` as appropriate.
- Build and test the permission engine as an isolated package with table-driven tests before building any UI that depends on it (Seller List, Seller 360).
