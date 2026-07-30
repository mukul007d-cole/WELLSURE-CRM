# Data Model / Schema

PostgreSQL. Core fixed columns stay relational; the long tail of admin-defined custom fields lives in JSONB with GIN indexing — this is what keeps filtering fast at 100k+ record scale while staying fully configurable (see `docs/requirements/source-of-truth.md` — no field name below is hardcoded logic, all are examples/seed).

Every configuration object (Journey, Status, Field, Service, Role) carries: immutable `id`/`key`, editable display `name`, `active` flag, `version`, `created_by`/`updated_by`, timestamps. Nothing is hard-deleted — deactivated/versioned instead, so historical records keep the label/config that existed at the time.

```
organizations
  id, name                              -- single-tenant in V1, schema ready for more

departments
  id, name

designations
  id, name

roles
  id, name, is_system_default

role_permissions
  id, role_id, module, action, scope    -- e.g. ('leads','view','own')

role_journey_access
  role_id, journey_id

users
  id, name, email, password_hash, role_id, department_id, designation_id,
  manager_id (self-FK), active, created_at

user_access_grants                       -- exceptional direct-record access, without a second role
  id, user_id, lead_id, granted_by, expires_at (nullable)

journeys
  id, name, is_default, created_at

services
  id, name, description

journey_services
  journey_id, service_id

statuses
  id, journey_id, name, is_default_on_create,
  outcome_type (open | closed_won | closed_lost),
  behavior_type (default | call_later | follow_up | archived),
  auto_reassign_to_role_id (nullable), sort_order

fields
  id, name, field_type, validation_rule, section, edit_mode, source

field_journey_settings
  field_id, journey_id, requirement (required | optional | hidden),
  required_from_status_id (nullable)

field_visibility
  field_id, role_id

leads
  id, journey_id, current_status_id, owner_user_id,
  name, phone, email,
  field_values (JSONB, GIN indexed),
  created_at, updated_at

lead_services
  lead_id, service_id

lead_links                               -- same real-world contact across journeys
  lead_id_a, lead_id_b, relation_type

activity_logs                            -- lead-level, append-only
  id, lead_id, actor_user_id, timestamp,
  action_type (comment | status_change | reassignment | field_edit),
  comment_text, old_value, new_value

system_audit_logs                        -- config-level, append-only, separate from activity_logs
  id, actor_user_id, timestamp,
  entity_type (role | field | status | journey | user | service),
  entity_id, action (create | update | delete), old_value, new_value

tasks
  id, lead_id, assigned_to_user_id, due_date,
  type (call_later | follow_up), status (open | done),
  created_from_status_id

notifications
  id, user_id, type, reference_lead_id (nullable), message, read, created_at

attachments
  id, lead_id, field_id, s3_key, uploaded_by, uploaded_at

import_jobs
  id, source, file_key, status, mapping_json, created_by, created_at

invoices
  id, lead_id, invoice_number, customer_name, total_amount, due_amount,
  due_date, status (unpaid | partial | paid | overdue), created_at

payments
  id, invoice_id, lead_id, amount_paid, payment_date, payment_method,
  reference_number

settings
  key, value (JSONB)
```

## Indexing

- GIN index on `leads.field_values`
- B-tree on `leads.journey_id`, `leads.current_status_id`, `leads.owner_user_id`, `leads.phone`, `leads.email`
- Index `users.manager_id` for hierarchy traversal
- Consider a cached/materialized "all downstream reports" list per user rather than a recursive query per request, given 100+ users and cascading visibility

## Type-safety constraint on field_values

If a typed-column approach is preferred over pure JSONB for `field_values` (safer against bad data, more query-friendly), use typed columns per value type (`text_value`, `number_value`, `date_value`, `boolean_value`, `json_value`, `document_id`) with a database constraint ensuring only the correct one is populated for a given field's `field_type`. Either approach is acceptable; do not mix both without an ADR.
