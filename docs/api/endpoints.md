# API Endpoints (REST, OpenAPI-documented)

Versioned under `/api/v1`. All endpoints enforce `docs/permissions/access-model.md` server-side.

### Auth
```
POST   /auth/login
POST   /auth/logout
GET    /auth/me
GET    /auth/capabilities              -- caller's own effective grants; authenticated without role-config view permission
POST   /auth/password-reset/request
POST   /auth/password-reset/complete
```
These are the currently bound Phase 6 routes. `/auth/refresh` remains a
documented target without a backing route function and is not exposed by the
HTTP transport.

### Users, Roles, Departments
```
GET    /users
POST   /users
GET    /users/:id
PUT    /users/:id
POST   /users/:id/deactivate            -- deactivate and revoke sessions

GET    /roles
POST   /roles
GET    /roles/:id
PUT    /roles/:id
POST   /roles/:id/deactivate            -- optional atomic replacementRoleId
GET    /roles/:id/permissions
PUT    /roles/:id/permissions
GET    /roles/:id/journey-access
PUT    /roles/:id/journey-access
GET    /roles/:id/field-visibility
PUT    /roles/:id/field-visibility

GET    /permissions/catalog

GET    /departments
POST   /departments
GET    /departments/:id
PUT    /departments/:id

GET    /departments/:id/teams
POST   /departments/:id/teams           -- body: key, name, members[] (>=1 isLeader)
GET    /teams/:id                       -- includes members
PUT    /teams/:id                       -- name only
POST   /teams/:id/deactivate
PUT    /teams/:id/members               -- body: complete members array; whole-set replace
```

Team routes are gated on `users:view/create/edit` like the rest of Department
administration (ADR-0009). Members must be active Users of the Team's own
Department, and an active Team must have at least one leader — see ADR-0014 for
both, and for why a Team is not the `TEAM` data scope.

### Journeys, Statuses, Services

Routing rules live under a Status. Every routing route needs both the
`lead_routing` module action **and** a `status_routing_permissions` row for that
(status, role, action) — the same layering `field_visibility` uses. Editing those
grants is gated on `roles_permissions:edit`, never on `lead_routing:configure`.
See ADR-0015.
```
GET    /journeys
POST   /journeys
PATCH  /journeys/:id
DELETE /journeys/:id
PUT    /journeys/:id/status-order      -- body: complete ordered statusIds array; atomic

GET    /statuses/:id/routing              -- lead_routing:view; null rule = unrouted Status
PUT    /statuses/:id/routing              -- lead_routing:configure; whole-rule replace
POST   /statuses/:id/routing/deactivate   -- lead_routing:configure
GET    /statuses/:id/routing/state        -- lead_routing:view; cursor holder + per-candidate open counts
GET    /statuses/:id/routing/permissions  -- roles_permissions:view
PUT    /statuses/:id/routing/permissions  -- roles_permissions:edit; whole-set replace
POST   /leads/:id/routing-assign          -- lead_routing:operate AND the caller's normal leads:edit + record scope

GET    /journeys/:id/statuses          -- NOT IMPLEMENTED: registered for POST only; read statuses from GET /journeys/:id, which returns them nested, active-filtered and sortOrder-ordered
POST   /journeys/:id/statuses
PATCH  /statuses/:id
DELETE /statuses/:id                   -- requires lead-migration step

GET    /services
GET    /services/:id
POST   /services
PUT    /journeys/:id/services
```

The services mapping request is `{ action: "map" | "unmap", serviceId }`.

### Fields
```
GET    /fields
GET    /fields/:id
POST   /fields
PATCH  /fields/:id
DELETE /fields/:id
GET    /journeys/:id/fields
PUT    /journeys/:id/fields/:fieldId   -- requirement, required_from_status, visibility
DELETE /journeys/:id/fields/:fieldId   -- semantic unmap/deactivate
PUT    /roles/:roleId/field-visibility/:fieldId -- body: { accessLevel }
GET    /fields/:fieldId/visibility     -- all roles' access to one Field; roles_permissions:view
PUT    /fields/:fieldId/visibility     -- body: { visibility: [{ roleId, accessLevel }] }; roles_permissions:edit
```

`field_visibility` is reachable from either axis: `/roles/:roleId/field-visibility`
replaces one role's whole set, `/fields/:fieldId/visibility` replaces one
Field's whole set across roles, and both write the same rows. Both are gated on
`roles_permissions`, not on `fields` — granting a Field to a role is a
permission change, and gating the Field-side routes on `fields` would let a
Fields administrator grant their own role a Field it is denied. An absent row
still means hidden, so a newly created Field is visible to nobody until one of
these routes grants it. A full replace across roles emits one
`system_audit_logs` row with `entity_type = 'field_visibility'`,
`entity_id = <fieldId>` and `action = 'replace_field_roles'`, distinct from the
role-side `action = 'replace'` whose `entity_id` is a role.

### Campaigns
```
GET    /campaigns                      -- campaigns:view; each row carries sent/failed/pending/skipped counts
GET    /campaigns/:id                  -- campaigns:view
POST   /campaigns                      -- campaigns:create
PUT    /campaigns/:id                  -- campaigns:edit
POST   /campaigns/:id/activation       -- campaigns:edit; body { active }
POST   /campaigns/:id/send             -- campaigns:send; manual campaigns only
```

- **Campaigns email Leads. Notification Rules notify Users.** They share trigger
  detection and nothing else — see ADR-0013.
- `type` is `manual` or `triggered`. A manual campaign stores a Phase 13b
  filter and is sent on request; a triggered one stores a Journey/Status pair
  and fires when a lead's process instance enters that status, matched exactly
  per ADR-0001. A database constraint refuses a campaign carrying the other
  kind's targeting.
- `bodyDocument` is a closed-vocabulary JSON document — blocks `paragraph`,
  `heading`, `bullet_list`, `numbered_list`; marks `bold`, `italic`,
  `underline`; links restricted to `http(s)` and `mailto`. **The server renders
  the HTML and escapes every text node at send time**, so no client-supplied
  markup is stored or emailed, and an interpolated recipient value cannot inject
  anything.
- Variables are `{{name}}`, `{{email}}`, `{{phone}}` and `{{field:<fieldId>}}`.
  Availability is checked against the **campaign author's** field visibility at
  create/edit time — one template serves a whole batch, so there is no single
  recipient whose visibility could govern interpolation. A field token the
  author cannot view is refused with `403`.
- A manual send re-evaluates the stored filter through the same compiler the
  Seller List uses, under the **sender's** own data scope and field visibility,
  and is capped at 5,000 recipients per request.
- `campaigns:send` is never implied by `campaigns:edit`. Sending a deactivated
  campaign is a `409`.
- Sends are recorded in `campaign_sends` before delivery and delivered after the
  transaction commits. A lead receives a given campaign at most once, ever.
  Leads without an email address are recorded `skipped_no_email` rather than
  dropped, so the reported counts add up.
- **Not implemented, deliberately: unsubscribe, consent, and suppression.** See
  the Phase 13c plan; this is not safe to point at a real transport.

### Leads
```
GET    /leads                          -- server-side search, filter, sort, pagination; `filter` is a JSON-encoded condition list (see below)
POST   /leads
GET    /leads/:id
PATCH  /leads/:id
PATCH  /leads/:id/status               -- NOT IMPLEMENTED: status changes ride on PATCH /leads/:id with statusId in the body
PATCH  /leads/:id/reassign
PATCH  /leads/:id/journey                -- move a process instance to another journey; authorized on both (see ADR-0012)
POST   /leads/:id/services             -- NOT IMPLEMENTED
GET    /leads/:id/activity             -- paginated {page,pageSize,total,items}, newest first; gated on leads:view; old_value/new_value redacted against the caller's visible field set (see ADR-0011)
POST   /leads/:id/comments
GET    /leads/:id/shares
POST   /leads/:id/shares
PUT    /leads/:id/shares/:shareId
DELETE /leads/:id/shares/:shareId
POST   /leads/:id/deactivate
POST   /leads/bulk/reassign            -- NOT IMPLEMENTED (leads:bulk_reassign is grantable but honoured by no route)
POST   /leads/bulk/status              -- NOT IMPLEMENTED (leads:bulk_status_change is grantable but honoured by no route)
GET    /leads/export                   -- NOT IMPLEMENTED (leads:export is grantable but honoured by no route)
POST   /leads/import                   -- NOT IMPLEMENTED
```


### Notifications
```
GET    /notifications
GET    /notifications/unread-count
PATCH  /notifications/:id/read
GET    /notification-rules
POST   /notification-rules
PUT    /notification-rules/:id
```

### Tasks

**Not implemented.** No route file exists. The `Task` model and the `call_later`/`follow_up` behavior types are in place, but `packages/workflow-engine` is still a placeholder, so nothing creates or reads a task. Paths below are the V1 target, not the current surface.

```
GET    /tasks
PATCH  /tasks/:id/complete
```

### Attachments

Implemented, and registered **only when object storage is configured** — see
ADR-0012. Without the `S3_*` environment variables the list and upload routes
answer `503 storage_not_configured` and the rest are absent.

```
GET    /leads/:id/attachments          -- gated on attachments:download (no view action exists)
POST   /leads/:id/attachments          -- multipart; fields: file, name. attachments:upload
GET    /attachments/:id                -- streams the object; attachments:download
DELETE /attachments/:id                -- soft delete (active=false); attachments:delete
```

### Finance

**Not implemented.** No route file exists. Paths below are the V1 target, not the current surface.

```
GET    /invoices
POST   /invoices
GET    /invoices/:id
POST   /invoices/:id/payments
```

### Reports

**Not implemented.** No route file exists. The dashboard derives its counts from scoped `GET /leads` totals instead. Paths below are the V1 target, not the current surface.

```
GET    /reports/dashboard
GET    /reports/pipeline-value
GET    /reports/conversion
GET    /reports/leaderboard
POST   /reports/custom                 -- Phase 2
```

### Integrations

**Not implemented.** No route file exists. Paths below are the V1 target, not the current surface.

```
POST   /integrations/email/send
POST   /webhooks/accounting            -- fires on outcome_type = closed_won
```

## Standards

- Errors: consistent JSON shape `{ error: string, details? }` — `error` is a
  stable, machine-readable code (e.g. `not_found`, `forbidden`,
  `validation_error`); `details` is optional structured context (e.g.
  `{ fieldId }`). There is no separate `message` field; clients render their
  own copy from the code (see `apps/web/src/lib/api-error.ts`).
- Pagination: cursor or offset+limit, consistent across all list endpoints
- List and count endpoints share identical access-filtering logic (see access model doc)
- Rate limiting on auth endpoints specifically (lockout after repeated failed logins)

## Configuration Engine API (Phase 4)

Configuration endpoints operate on tenant-scoped IDs/keys and never depend on Wellsure seed names. Implementations must authorize every request server-side through the permission engine before mutating configuration.

### Supported configuration mutations

- Journeys: create, edit, deactivate. Journeys are not hard-deleted; deactivation is blocked while active process instances still depend on the Journey.
- Statuses: create, edit, deactivate. Deactivation is blocked while active process instances use the Status unless the request supplies a replacement Status in the same Journey. Reassignment-assisted deactivation writes both one `system_audit_logs` row for the builder change and one `activity_logs` `status_change` row per affected lead.
- Services: create, edit, deactivate, and Journey-to-Service map/unmap. Services are not hard-deleted; Journey-to-Service unmapping is a real delete of the mapping row with system audit history.
- Fields: create, edit, deactivate. Field values already stored on leads are preserved. Field-to-Journey setting and field-visibility rows are mapping rows and are deleted on unmap/revoke with system audit history.
- Select Field definitions store their configurable choices as
  `validationRule.options: string[]`. Option labels are configuration data;
  clients must not branch on a Field key or name. Unknown future Field types
  remain readable as configuration and require an explicitly documented
  renderer before they become editable controls.
- Field visibility: uses the existing `field_visibility` allow-list contract consumed by the permission engine. No separate visibility evaluator exists in the API.

### Mapping row deletion rule

`journey_services`, `field_journey_settings`, `field_visibility`, and `role_journey_access` represent current relationships rather than independently versioned configuration entities. Removing one of these relationships is a real DELETE. The required history is the corresponding `system_audit_logs` row with the previous row in `old_value` and `new_value = null`.

## Lead/Seller Core API (Phase 5)

Lead/Seller endpoints use the same server-side permission-engine decision contract as the configuration routes. Dynamic field values are accepted and returned by Field ID, never by hardcoded business field names.

### Creation and editing

- `POST /leads` creates a Lead/Seller or adds a Journey process instance to an existing Lead when an existing Lead ID is supplied by the route contract.
- Creation requires a target `journeyId`, a valid initial `statusId` or the Journey's default-on-create Status, core fields, dynamic `fieldValues`, and a non-empty `assignments` array.
- Each assignment entry supplies caller-configured `assignment_type` and `userId`. The API validates that at least one assignment exists and that assignment users belong to the request organization; it does not invent or require any canonical owner type string.
- Dynamic values are rejected when their Field is not actively assigned to the target Journey, when the Field-Journey setting is `hidden`, or when the value fails the Field's generic `field_type` / `validation_rule` contract.
- `required_from_status_id` is exact-match only: a Field becomes required only when the process instance's `current_status_id` equals that configured Status. `statuses.sort_order` is display-only and must not be used for required-field validation.
- `PATCH /leads/:id` edits a specific process instance context. A status change that would make a required Field missing is blocked with a validation error; it is not allowed as a warning-only incomplete transition.
- Successful field edits write `activity_logs.action_type = field_edit`; successful status changes write `activity_logs.action_type = status_change`. Lead/Seller mutations do not write `system_audit_logs` unless they delegate to a configuration mutation.

### Seller List

- `GET /leads` supports server-side search over name, phone, and email; optional filters for Journey, Status, and owner assignment; safe allow-listed sorting; and pagination. When `journeyId` is omitted, Seller List returns the approved all-Journeys aggregate view across Journeys the requester is allowed to access.
- List rows and total counts must use the same permission-scoped predicate produced from `resolveAuthorization`. Counts must not reveal records outside the requester's role scope, Journey access, or direct grants. The same parity rule applies to both Journey-filtered and all-Journeys aggregate requests.
- Field-level visibility applies to every row in the paginated response. Unauthorized dynamic Fields are stripped server-side.

#### Filter engine (Phase 13b)

- `filter` is a JSON-encoded object: `{ "conditions": [{ "target", "operator", "values" }] }`, capped at 20 conditions. `target` is either `{ "kind": "field", "fieldId" }` or `{ "kind": "core", "column" }`, where `column` is one of a fixed allow-list: `name`, `phone`, `email`, `createdAt`, `status`, `journey`.
- **Conditions are combined with AND only.** OR and grouping are deliberately not implemented; adding them is a model change, not a parameter.
- Operators are derived from each Field's configured `field_type`, never from the value: text-like types take `equals`/`contains`/`starts_with`/`is_empty`/`is_not_empty`; `number` takes `equals`/`greater_than`/`less_than`/`between`/`is_empty`; `date` takes `before`/`after`/`between`/`is_empty`; `select` takes `in`/`not_in`; `boolean` takes `is_true`/`is_false`; `json` takes presence only. A Field whose type is outside the nine the engine supports is not filterable, and says so rather than guessing. Core columns use the same catalog through their equivalent kind.
- **A condition naming a Field the caller cannot view is rejected with `403`**, not dropped and not treated as false — either of those silently changes the result set. The response body names no field id, so the endpoint cannot be used to probe which Fields exist; an unknown field id is answered identically to a denied one.
- Filters are ANDed into the same scoped predicate as the rest of the query, so no filter can widen data scope, and the count uses that same predicate.
- `date` Field values are stored as strings and compared lexicographically. Filter inputs must be `YYYY-MM-DD`; correctness for non-ISO stored values is a known limitation recorded in the Phase 13b plan.

### Seller 360

- `GET /leads/:id` returns core Lead/Seller fields, visible dynamic `fieldValues`, authorized active process instances/Journeys/statuses, and current assignments.
- A Lead with multiple active Journey memberships returns only the process instances the requester is authorized to see.
- The activity timeline is served by `GET /leads/:id/activity` (see ADR-0011). Tasks/reminders, attachments, linked-lead expansion, services, and finance sections remain deferred until their underlying module contracts are implemented.
