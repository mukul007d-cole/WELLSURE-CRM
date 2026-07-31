# API Endpoints (REST, OpenAPI-documented)

Versioned under `/api/v1`. All endpoints enforce `docs/permissions/access-model.md` server-side.

### Auth
```
POST   /auth/login
POST   /auth/logout
POST   /auth/refresh
GET    /auth/me
```
Provider TBD — see ADR-0005. Do not implement until resolved.

### Users, Roles, Departments
```
GET    /users
POST   /users
GET    /users/:id
PATCH  /users/:id
DELETE /users/:id                      -- deactivate, not hard delete
GET    /users/:id/reports              -- downstream hierarchy

GET    /roles
POST   /roles
PATCH  /roles/:id
GET    /roles/:id/permissions
PUT    /roles/:id/permissions
PUT    /roles/:id/journey-access

GET    /departments
POST   /departments
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
POST   /services
PUT    /journeys/:id/services
```

### Fields
```
GET    /fields
POST   /fields
PATCH  /fields/:id
DELETE /fields/:id
GET    /journeys/:id/fields
PUT    /journeys/:id/fields/:fieldId   -- requirement, required_from_status, visibility
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

- Errors: consistent JSON shape `{ error: { code, message, details? } }`
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
