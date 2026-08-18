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
| Leads | view, create, edit, comment, delete, export, import, bulk_reassign, bulk_status_change |
| Fields | view, create, edit, delete |
| Journeys & Statuses | view, create, edit, delete |
| Services | view, create, edit |
| Users | view, create, edit, deactivate |
| Roles & Permissions | view, create, edit |
| Reports | view_standard, view_financial, build_custom (Phase 2) |
| Attachments | upload, download, delete |
| Campaigns | view, create, edit, send |
| Lead Routing | view, configure, operate |
| Integrations | configure |

The immutable runtime source for these identifiers is
`packages/permission-engine/src/catalog.ts`. **An action absent from that file
cannot be granted at all** — `role_permissions` writes are validated against it
and the bootstrap command creates it and nothing else — so a route checking a
pair the catalog does not define is denied to every role, permanently, rather
than merely being ungranted. There is no `deactivate` action for any
configuration module; see the row below for what deactivation actually checks.

Department administration is part of the User scope and uses
`users:view/create/edit`; V1 has no separate Department permission module. See
ADR-0009. **Team administration rides on the same actions**, so `users:edit` now
also confers restructuring the Teams inside any Department (ADR-0014).

Configuration entities are deactivated, never hard-deleted (`AGENTS.md`), so
`delete` on a configuration module is the *deactivate* gate:
`journeys_statuses:delete` deactivates a Journey or a Status, and `fields:delete`
deactivates a Field. Services are the exception — the catalog gives them no
`delete` action, so deactivating a Service and unmapping one from a Journey both
check `services:edit`, matching how role and Team deactivation ride on their
module's `edit` action, and how unmapping a Field from a Journey checks
`fields:edit`.

`lead_routing:configure` and `lead_routing:operate` are distinct for the same
reason: deciding who *may* receive leads at a Status and moving one particular
lead are different levels of trust. `operate` is an **additional** gate — a
manual override still passes `leads:edit`, journey access and the operator's own
record scope. Both are further layered on a per-`(status, role)` row in
`status_routing_permissions`, exactly as field access is layered on
`field_visibility`: the module action and the row are both required, so one
Journey's Statuses can be operated by different groups. Editing those rows is
gated on `roles_permissions:edit`, never on `lead_routing:configure`. See
ADR-0015.

`campaigns:send` is deliberately distinct from `campaigns:edit`: composing a marketing email and actually mailing customers are different levels of trust, and a role may hold one without the other. A manual send is additionally bounded by the sender's own Leads data scope and field visibility, re-evaluated at send time.

**B. Data scope** (per module, independently): `SELF` → `TEAM` → `DEPARTMENT` → `ORGANIZATION`

- `SELF`: records assigned to the requester under the applicable assignment rule.
- `TEAM`: the requester plus all recursive downstream reports through
  `users.manager_id` (ADR-0006). **This is not the Team entity** configured
  under a Department — the two are deliberately independent, and the permission
  engine never reads `teams` or `team_members`. See ADR-0014. The UI names this
  scope "Team (reporting line)" for exactly that reason.
- `DEPARTMENT`: all active users sharing the requester's `department_id`,
  regardless of reporting branch or depth.
- `ORGANIZATION`: all records in the requester's organization.

**C. Journey access** — explicit allow-list per role. A role with no access to a Journey doesn't see it in the UI at all, not greyed out.

**D. Field-level visibility** — layered on top of A–C via an allow-list in `field_visibility`. Each `(field, role)` row grants `VIEW` or `EDIT`; `EDIT` includes viewing. Absence of a row means the field is hidden entirely for that role. Enforced by stripping fields from the API response server-side, never just hiding them client-side — this is what makes sensitive fields actually secure.

The same rows are editable from either direction — one role's access to every field, or one field's access for every role — and both directions are gated on `roles_permissions`, never on `fields`. A Field administrator who cannot edit permissions cannot grant visibility, including to their own role. Both write a full replacement of the axis they address, with the previous and new sets recorded in `system_audit_logs`.

## Additional mechanism: direct record grants

For exceptional one-off access that doesn't fit the role/hierarchy model (e.g. a specific person needs temporary visibility into one lead outside their normal scope), use `user_access_grants` rather than creating a new role or assigning a second role. A non-expired direct grant is additive to normal data scope; it never bypasses feature/action, Journey, field, workflow, or active-user checks. One active role per user, always.

Lead shares are action-scoped direct grants supporting `view`, `edit`, and `comment` (“Add notes” in the UI). A share satisfies only record scope for the requested listed action. Revoked or expired shares do not participate in detail, list, or count decisions.

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
- Exports include only permitted rows and permitted fields. `leads:export` is
  the gate; the rows and fields come from the caller's `leads:view` scope and
  `field_visibility`, so an export can never exceed what the same user sees in
  the Seller List. A Field the caller cannot see is absent from the CSV header
  rather than blank in every row. See ADR-0016.
- `leads:import` is required **in addition to** `leads:create`, never instead of
  it: a bulk import can only create what its actor could create one at a time,
  in a Journey they can access, with Fields they can edit.
- Every reassignment, status change, finance action, document event, bulk action, and export writes to `system_audit_logs` or `activity_logs` as appropriate.
- Build and test the permission engine as an isolated package with table-driven tests before building any UI that depends on it (Seller List, Seller 360).
