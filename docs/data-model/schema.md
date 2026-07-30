# Data Model / Schema

PostgreSQL. Core fixed columns stay relational; the long tail of admin-defined
custom fields lives in JSONB with GIN indexing. This keeps filtering practical at
200,000+ records while preserving the configurable-engine rule in
`docs/requirements/source-of-truth.md`: names shown in the documentation are
seed/example data, never application logic.

Every configuration object (Journey, Status, Field, Service, Role) carries an
immutable `id` and `key`, editable `name`, `active` flag, `version`,
`created_by`/`updated_by`, and timestamps. Configuration is deactivated or
versioned, never hard-deleted. All tenant-owned tables carry `organization_id`,
even though V1 deploys a single organization.

The following is the reconciled logical schema. The concrete permission-engine
subset is specified in `docs/permissions/permission-engine-schema.md`.

```text
organizations
  id, name, created_at, updated_at

departments
  id, organization_id, key, name, active, version,
  created_by, updated_by, created_at, updated_at

designations
  id, organization_id, key, name, active, version,
  created_by, updated_by, created_at, updated_at

roles
  id, organization_id, key, name, active, version, is_system_default,
  created_by, updated_by, created_at, updated_at

role_permissions
  id, organization_id, role_id, module, action,
  scope (SELF | TEAM | DEPARTMENT | ORGANIZATION), created_at, updated_at

role_journey_access
  id, organization_id, role_id, journey_id, created_at

users
  id, organization_id, name, email, role_id, department_id, designation_id,
  manager_id (self-FK), active, created_at, updated_at
  -- Authentication-provider-specific identity/credential columns are deferred
  -- until ADR-0005 is resolved. One user has exactly one active role.

user_access_grants
  id, organization_id, user_id, lead_id, granted_by_user_id,
  expires_at (nullable), revoked_at (nullable), created_at

journeys
  id, organization_id, key, name, active, version, is_default,
  created_by, updated_by, created_at, updated_at

services
  id, organization_id, key, name, description, active, version,
  created_by, updated_by, created_at, updated_at

journey_services
  id, organization_id, journey_id, service_id, active, created_at, updated_at

statuses
  id, organization_id, journey_id, key, name, active, version,
  is_default_on_create,
  outcome_type (open | closed_won | closed_lost),
  behavior_type (default | call_later | follow_up | archived),
  auto_reassign_to_role_id (nullable), sort_order,
  created_by, updated_by, created_at, updated_at

fields
  id, organization_id, key, name, field_type, validation_rule, section,
  edit_mode, source, active, version,
  created_by, updated_by, created_at, updated_at

field_journey_settings
  id, organization_id, field_id, journey_id,
  requirement (required | optional | hidden),
  required_from_status_id (nullable), active, created_at, updated_at

field_visibility
  id, organization_id, field_id, role_id,
  access_level (VIEW | EDIT), created_at, updated_at
  -- Allow-list: no row means the role cannot receive the field from the API.

leads
  id, organization_id, name, phone, email,
  field_values (JSONB, GIN indexed),
  created_at, updated_at

process_instances
  id, organization_id, lead_id, journey_id, current_status_id,
  is_primary, active, created_at, updated_at
  -- One row per Lead/Journey membership; at most one active primary per Lead.

assignments
  id, organization_id, process_instance_id, assignment_type, user_id,
  assigned_at, is_current
  -- assignment_type is a configurable string/lookup, not a fixed enum.
  -- Superseded rows remain as history; they are never hard-deleted.

lead_services
  id, organization_id, process_instance_id, service_id,
  active, enrolled_at, ended_at (nullable)

lead_links
  id, organization_id, lead_id_a, lead_id_b, relation_type, created_at
  -- Rare relationship between separate top-level Lead records representing
  -- the same real-world contact; not used for multi-Journey membership.

activity_logs
  id, organization_id, lead_id, process_instance_id (nullable),
  actor_user_id (nullable), timestamp,
  action_type (comment | status_change | reassignment | field_edit),
  source, comment_text, recording_reference_url (nullable),
  old_value, new_value
  -- Append-only. Example sources include manual,
  -- migrated_cronberry_remark, and migrated_cronberry_call_log.

system_audit_logs
  id, organization_id, actor_user_id, timestamp,
  entity_type, entity_id, action, old_value, new_value
  -- Append-only. Configuration mutations, including deactivation, are audited.

tasks
  id, organization_id, lead_id, process_instance_id (nullable),
  assigned_to_user_id, due_date, type, status,
  created_from_status_id (nullable), source, created_at, updated_at

notifications
  id, organization_id, user_id, type, reference_lead_id (nullable),
  message, read, created_at

attachments
  id, organization_id, lead_id, field_id (nullable), s3_key,
  uploaded_by, uploaded_at, active, version

import_jobs
  id, organization_id, source, file_key, status, mapping_json,
  created_by, created_at, updated_at

invoices
  id, organization_id, lead_id, invoice_number, customer_name,
  issue_date, total_amount, due_amount, due_date,
  status (unpaid | partial | paid | overdue), created_at, updated_at

payments
  id, organization_id, invoice_id, lead_id, amount_paid, payment_date,
  payment_method, reference_number, created_at

settings
  id, organization_id, key, value (JSONB), version, updated_by, updated_at
```

## Relationship invariants

- A Lead has zero or more `process_instances`; Journey and current Status are
  properties of that membership, not of the Lead.
- Enforce one active process instance per `(organization_id, lead_id,
  journey_id)` and at most one active primary instance per Lead with partial
  unique indexes.
- `process_instances.current_status_id` must identify an active/historically
  valid Status belonging to the same Journey. The API and database transaction
  boundary both enforce this invariant.
- `assignments` belongs to a process instance. Multiple current rows may coexist
  when their assignment types differ. The API ends the old row before creating
  its replacement for a given assignment type and emits an activity event.
- `lead_links` must prevent self-links and duplicate reverse pairs.
- Statuses with active process instances cannot be deactivated until those
  instances are reassigned.
- All cross-table foreign keys must remain within one `organization_id`.

## Indexing

- GIN index on `leads.field_values`.
- B-tree indexes on normalized `leads.phone`, normalized `leads.email`, and
  `leads.updated_at`; business identifiers used for deduplication need
  expression/custom-field indexes selected by the field configuration design.
- B-tree indexes on `process_instances(organization_id, journey_id,
  current_status_id)`, `(organization_id, lead_id)`, and active/primary partial
  indexes supporting membership invariants.
- Partial index on current assignments by `(organization_id,
  process_instance_id, assignment_type)` and an index on current assignments by
  `user_id` for `SELF` scope.
- Index `users(organization_id, manager_id)` for hierarchy traversal.
- `TEAM` scope is derived recursively from `users.manager_id`; `DEPARTMENT` is a
  flat same-`department_id` scope. No Teams table exists (ADR-0006).
- Index active direct grants by `(organization_id, user_id, lead_id,
  expires_at)`.
- Index activity timeline reads by `(organization_id, lead_id, timestamp DESC)`.
- Use the exact permission-filtered relation for both lists and counts. Consider
  a maintained reporting-closure table rather than a recursive hierarchy query
  per request for 100+ concurrent users.

## Type-safety constraint on `field_values`

JSONB is the current baseline. If a typed-value-table approach is preferred,
record that change in an ADR and use typed columns per value type (`text_value`,
`number_value`, `date_value`, `boolean_value`, `json_value`, `document_id`) with
a database constraint ensuring only the column matching the configured
`field_type` is populated. Do not mix JSONB and typed value storage without an
ADR.

## Phase 0 reconciliation result

The previously sketched single-Journey Lead and single-owner model has been
corrected through `process_instances` and `assignments`. This schema now uses the
canonical terminology in `docs/requirements/glossary.md` and the workflow model
in `docs/workflows/journey-definitions.md`. Remaining source-data questions do
not change this product model and are listed in
`docs/requirements/open-decisions.md` rather than resolved by assumption.
