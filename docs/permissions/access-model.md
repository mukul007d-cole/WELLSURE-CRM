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
| Leads | view, create, edit, comment, delete, export, import, bulk_reassign, bulk_status_change, bypass_status_visibility |
| Fields | view, create, edit, delete, purge |
| Journeys & Statuses | view, create, edit, delete, purge |
| Services | view, create, edit, purge |
| Users | view, create, edit, deactivate, purge |
| Roles & Permissions | view, create, edit, purge |
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

`purge` is the one irreversible action in the system and is never implied by
`delete` — the same "additional gate, never a replacement" shape as
`leads:import` (ADR-0016) and `lead_routing:operate` (ADR-0015). It permanently
removes a **deactivated** configuration entity that has **zero blocking
dependents**, in one audited transaction, and refuses everything else. It is
also the only catalog action `bootstrapFirstAdmin` does **not** grant: an
administrator grants it deliberately, so enabling it appears in
`system_audit_logs` with an actor and a timestamp. See ADR-0017 for the full
decision, including why `users:purge` governs **Teams only** and can never
purge a User or a Department.

| Entity | Gated on |
|---|---|
| Journey, Status | `journeys_statuses:purge` |
| Field | `fields:purge` |
| Service | `services:purge` |
| Team | `users:purge` |
| Role, Notification Rule | `roles_permissions:purge` |

Configuration entities are otherwise deactivated, never hard-deleted
(`AGENTS.md`), so `delete` on a configuration module is the *deactivate* gate:
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
`status_routing_permissions` — but unlike `field_visibility`, that layer
starts **open**: a `(status, action)` with zero rows is unrestricted, so the
module action alone reaches every Status until an admin adds at least one
row for that action, which then narrows it to only the Roles named. This is
the same default `status_routing_rules` itself uses ("no rule means
unrouted") and Status Visibility now uses too, not `field_visibility`'s
"absence hides" — a Status, unlike a brand-new Field, already exists for
every organization. Editing those rows is gated on `roles_permissions:edit`,
never on `lead_routing:configure`. See ADR-0015 (amended).

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

**E. Status Visibility** — gates who may see a **whole lead** while it sits in a given Status, on every surface (Seller List, search, Seller 360, activity timeline, direct fetch by id) — not field-level redaction, which stays `field_visibility`'s job. Originally (Phase 19) an admin-configured, Role-level allow-list in a `status_visibility` table. **Phase 20 united it with Status Routing**: there is no more allow-list. A Status with no *active routing rule* imposes no restriction at all — the identical "absence means unrestricted" default Phase 19 established, now keyed off routing rather than a table of rows (matching `status_routing_rules`' own "no rule means unrouted"). Once a Status has an active routing rule, visibility narrows to the lead's **current assignee** plus everyone above the assignee in the reporting hierarchy (`users.manager_id`, any depth — the identical relation `TEAM` scope resolves, ADR-0006, asked from the manager's side). No Role, and no separately-configured grant, plays any part in the check — routing decides visibility, including for a Role with `ORGANIZATION` scope and including a live Lead Share.

**`leads:bypass_status_visibility` (ADR-0021)** is the one deliberate exception: a Role holding it skips this narrowing entirely, on every request, as if no Status it ever asks about had an active routing rule. It grants no reach beyond that Role's own configured data scope — a `SELF`-scoped Role with the bypass still can't see someone else's lead — it only turns off the *extra* restriction routing would otherwise layer on top. A narrow backstop for specifically-designated admin/oversight Roles, not a general escape hatch: granted to the bootstrap administrator by default (unlike `purge`, so the very first admin is never the one who gets locked out), but not implied by `ORGANIZATION` scope, `roles_permissions:edit`, or anything else — an admin grants it to any other Role deliberately.

Status Visibility is `AND`ed onto A–D, never `OR`ed: being the assignee or their manager gains no new reach beyond what the caller's own data scope already grants for the module action in question, and still only shows a lead that is *also* within ordinary data scope and Journey access — narrower, in fact, than Phase 19 ever was, since it can now cut below `DEPARTMENT`/`ORGANIZATION` scope for any Role once routing is active, not just a Role an admin explicitly excluded. A lead with process instances in more than one Journey stays visible through any one process instance an ordinarily-authorized caller can also see there — the same per-process union Journey access already uses — so one denied Status never hides a lead a caller can otherwise reach through a different, unrestricted process instance, or one where they are the assignee or a manager. Evaluated fresh against the process instance's *current* Status and its *current* assignment on every request: moving a lead's Status, or reassigning it (automatically or via a manual routing override), changes who can see it immediately, with no transition-specific invalidation. A share (`user_access_grants`) or any other route to a lead is equally subject to this check — nothing bypasses it, including a deliberately-granted share, once the Status the lead sits in has active routing. There is no more configuration surface for this axis at all; `status_routing_permissions` (who may configure or operate a Status's assignment routing) is unchanged and still separate — that gates the routing feature itself, not lead visibility.

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
