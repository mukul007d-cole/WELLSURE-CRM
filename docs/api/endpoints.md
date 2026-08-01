# API Endpoints (REST, OpenAPI-documented)

Versioned under `/api/v1`. All endpoints enforce `docs/permissions/access-model.md` server-side.

### Auth
```
POST   /auth/login
POST   /auth/logout
GET    /auth/me
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
```

### Journeys, Statuses, Services
```
GET    /journeys
POST   /journeys
PATCH  /journeys/:id
DELETE /journeys/:id

GET    /journeys/:id/statuses
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
PUT    /roles/:roleId/field-visibility/:fieldId -- body: { accessLevel }
```

### Leads
```
GET    /leads                          -- server-side search, filter, sort, pagination
POST   /leads
GET    /leads/:id
PATCH  /leads/:id
PATCH  /leads/:id/status               -- triggers behavior_type side effects
PATCH  /leads/:id/reassign
POST   /leads/:id/services
GET    /leads/:id/activity
POST   /leads/:id/comments
POST   /leads/bulk/reassign
POST   /leads/bulk/status
GET    /leads/export
POST   /leads/import
```

### Tasks
```
GET    /tasks
PATCH  /tasks/:id/complete
```

### Attachments
```
POST   /leads/:id/attachments
GET    /attachments/:id
```

### Finance
```
GET    /invoices
POST   /invoices
GET    /invoices/:id
POST   /invoices/:id/payments
```

### Reports
```
GET    /reports/dashboard
GET    /reports/pipeline-value
GET    /reports/conversion
GET    /reports/leaderboard
POST   /reports/custom                 -- Phase 2
```

### Integrations
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

### Seller 360

- `GET /leads/:id` returns core Lead/Seller fields, visible dynamic `fieldValues`, authorized active process instances/Journeys/statuses, and current assignments.
- A Lead with multiple active Journey memberships returns only the process instances the requester is authorized to see.
- Activity timeline, tasks/reminders, attachments, linked-lead expansion, services, and finance sections remain deferred until their underlying module contracts are implemented.
