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
