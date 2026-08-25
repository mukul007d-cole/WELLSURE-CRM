# Prisma Translation Notes

This document records the non-obvious decisions used to translate
`docs/data-model/schema.md` and `docs/permissions/permission-engine-schema.md`
into `packages/database/prisma/schema.prisma` and its PostgreSQL migration. It is
a review aid, not application behavior.

Phase 17 squashed the nine historical migrations into one baseline,
`prisma/migrations/00000000000000_baseline`. Statements this document once
attributed to "the initial migration" now live there; nothing about the resulting
schema changed, which was verified by diffing the two catalogs.

## Fixed concepts versus configuration

Only four confirmed engine-level concepts are Prisma/PostgreSQL enums:

- `DataScope`: `SELF`, `TEAM`, `DEPARTMENT`, `ORGANIZATION`
- `FieldAccessLevel`: `VIEW`, `EDIT`
- `OutcomeType`: `open`, `closed_won`, `closed_lost`
- `BehaviorType`: `default`, `call_later`, `follow_up`, `archived`

Journey, Status, Role, Field, Department, Designation, Service, assignment type,
activity source/action, task type/status, notification type, invoice status, and
similar labels remain rows or strings. Wellsure seed names do not appear in the
schema.

## Tenant isolation and relations

Tenant-owned models use compound primary keys `(organization_id, id)`. Relations
between tenant-owned records use Prisma multi-field relations and PostgreSQL
composite foreign keys referencing that pair. Target tables therefore have a
matching primary/unique key. This declaratively prevents a child in one
Organization from referencing an ID in another.

The `process_instances.current_status` and
`field_journey_settings.required_from_status` relations additionally include
`journey_id`, referencing the Status triple `(organization_id, journey_id, id)`.
This prevents a membership or field rule from selecting a Status belonging to a
different Journey.

No tenant trigger fallback was needed for ordinary relations. The polymorphic
`system_audit_logs(entity_type, entity_id)` target cannot have a conventional
foreign key because it may identify multiple configuration tables; its
`organization_id` and actor are still constrained, while the writer must verify
the tenant-scoped target in the same transaction.

## TEAM and DEPARTMENT scopes

ADR-0006 defines TEAM as the requester plus all recursive downstream reports via
`users.manager_id`. DEPARTMENT is the flat set of active Users with the same
`department_id`. There is deliberately no Team or TeamMembership model. Hierarchy
queries must be tenant-scoped and cycle-safe; the manager index supports an
initial recursive CTE. A future cross-functional Team entity is a schema/product
change.

## Configuration actors and bootstrap

Configuration `created_by` and `updated_by` columns are nullable solely to break
the first-Role/first-User bootstrap cycle. No seed data is introduced in Phase 1.
After bootstrap, ordinary API validation must require an authenticated, active
actor for configuration mutations, and the mutation plus audit event must commit
in one transaction. Null is not a general “unknown actor” escape hatch.

A reserved system-user seed was not chosen because authentication identity and
bootstrap ownership remain coupled to open ADR-0005. Nullable composite actor
foreign keys keep the schema provider-neutral without inventing an identity.

## Custom fields and JSON

`leads.field_values`, validation rules, mapping metadata, settings, and audit
before/after values use PostgreSQL JSONB. A manual GIN index on
`leads.field_values` supports configurable filtering. Moving to typed value rows
requires the ADR already called for by the logical schema.

## Prisma migration extensions

`schema.prisma` is the source of truth for what the Prisma Client can see.
`prisma/migrations/00000000000000_baseline/migration.sql` is the source of truth
for what the database actually enforces, and it is deliberately the larger of the
two: Prisma's schema language cannot express most of this schema's correctness
guarantees, so they exist only in the SQL.

Phase 17 measured the gap rather than estimating it, by diffing the catalog of a
database built from the migration against one built from a from-empty
`prisma migrate diff --from-empty --to-schema`. A Prisma-only baseline would
omit:

- **31 CHECK constraints** — every `version >= 1` and non-negative-count guard,
  the date-ordering guards on sessions, reset tokens and grants, the Lead-link
  self-link and canonical-order checks, and the shape constraints that keep a
  campaign, a routing rule and an import row from being half-configured;
- **8 triggers and 3 trigger functions** — the append-only rule on
  `activity_logs` and `system_audit_logs`, the no-hard-delete rule on core
  configuration (with ADR-0017's `falcon.purge` carve-out), and the block on
  deactivating a Status that active process instances still use;
- **the `pgcrypto` extension and 107 column defaults** — `gen_random_uuid()` on
  every `id` and `now()` on every timestamp. Prisma's `@default(uuid())` and
  `@updatedAt` are client-side, so a Prisma-generated schema has no database
  default at all. Raw-SQL inserts (bulk import, the Postgres integration tests)
  supply no id and depend on these;
- **9 indexes Prisma has no syntax for** — the GIN index on
  `leads.field_values`, the `lower(email)` expression index that makes
  case-insensitive dedup possible, and the partial unique indexes for one active
  Lead/Journey membership, one active primary process per Lead, one current
  assignment per process/assignment type, one live share per (user, lead), and
  one rule-generated notification per (rule, activity, recipient).

### The GIN index is not optional and not declared

`leads_field_values_gin_idx` exists only in migration SQL. It has never been in
`schema.prisma`, because Prisma cannot declare a GIN index on a `Json` column
here. That asymmetry is why an incremental `prisma migrate diff` against a live
database proposes `DROP INDEX "leads_field_values_gin_idx"` with no matching
recreation: the diff describes Prisma's model, and Prisma's model does not know
the index exists. The drop is not version drift and must not be applied.
`apps/api/src/__tests__/phase13b.postgres.integration.test.ts` asserts the
planner chooses it by name — 1.1ms with it against 116.5ms without.

### Residual divergence, and why it is expected

Run against a correct database, `prisma migrate diff --to-schema` still reports
roughly 230 statements. Every one falls into a known class, and none of them
should be applied:

| Class | Count | What it is |
| --- | --- | --- |
| FK drop + recreate | 113 | Adds Prisma's default `ON UPDATE CASCADE`. Inert — the referenced keys are UUIDs that are never updated. |
| `ALTER COLUMN ... DROP DEFAULT` | 66 | Removes the `gen_random_uuid()` / `now()` defaults above. |
| `ALTER INDEX ... RENAME` | 50 | Prisma's index naming convention versus the hand-written names. |
| `DROP INDEX` / `CREATE INDEX` | 3 / 1 | The GIN index, `sessions_token_active_idx` (undeclared), and the `DESC` on `leads_organization_active_updated_idx`. |

Notably the diff never mentions the CHECK constraints or the triggers: Prisma
does not model them, so an *incremental* diff leaves them alone. Only a
*from-empty* diff destroys them, by omission. That is the trap this table exists
to document.

Audit/activity corrections are written as new compensating rows; existing rows
are never edited. The baseline's `rollback.sql` drops the whole schema in reverse
dependency order and is intentionally destructive — it is a from-scratch
teardown for disposable databases, not an incremental rollback. For a populated
environment the documented reversal is a point-in-time restore.

## Assignment representation

`assignments.assignment_type` is a string, as approved. History is preserved by
ending the previous row (`is_current = false`) and inserting its replacement.
The partial unique index prevents two current assignments of the same type for a
process instance while allowing different current types and unlimited history.
No speculative assignment-type table or enum is introduced.

## User and authentication shape

ADR-0007 supersedes ADR-0005 for V1 and selects custom, self-hosted session
authentication. `users.password_hash` stores only argon2id password hashes and is
nullable solely for bootstrap/admin-created users who have not completed password
issuance. The legacy Cronberry `pass` field and any plaintext credentials remain
excluded from migration and storage.

Server-side `sessions` are tenant-scoped, stored in PostgreSQL, referenced from
secure httpOnly sameSite cookies, and revoked through `revoked_at` rather than
hard deletion. Password reset tokens store hashes only, expire, and become
single-use through `used_at`. Failed login attempts are tracked per organization
and normalized email so lockout thresholds can remain configurable in the API.

One User has exactly one Role through required `role_id`. Department,
designation, and manager are nullable because the logical docs do not require
them during initial user provisioning; authorization must treat absent hierarchy
attributes conservatively.

## Append-only records

Both activity and system audit tables are protected by database triggers in
addition to future API rules. Imported history can have nullable actors when a
source identity cannot be resolved, while native mutation writers must supply an
actor. `system_audit_logs.entity_id` remains polymorphic, so its target integrity
is checked by the future writer rather than a cross-table foreign key.

## Time, IDs, and deletion

IDs use PostgreSQL UUIDs and timestamps use `timestamptz(6)`. Source-only dates
use PostgreSQL `date` where time-of-day is not part of the documented meaning.
Configuration tables carry `active` and `version`; relational foreign keys use
`ON DELETE RESTRICT`. Deactivation/versioning—not deletion—is the application
lifecycle.

Prisma's `@updatedAt` updates timestamps through Prisma writes. Database-side
writers introduced later must also update timestamps explicitly or add a shared
trigger through a reviewed migration.

## Finance precision and currency

Money uses `Decimal(19,4)`, avoiding floating-point storage and leaving headroom
for imported values. V1 assumes one currency and therefore stores no currency
code or conversion data. This matches the current single-organization,
presumed-INR deployment. If Wellsure needs another currency or conversions,
that is a schema/product change requiring a currency model—not a configurable
Field and not an implicit conversion.

Invoice/payment status and method values remain strings because the docs do not
confirm them as immutable engine concepts. Validation belongs in later module
contracts.

## Extensible and polymorphic values

The following stay strings/JSON because their vocabularies are configurable or
not yet decision-gated: field type/edit mode/source, field requirement, relation
type, assignment type, activity action/source, task type/status/source,
notification type, import source/status, invoice status, payment method, audit
entity/action, and settings values. Later validation may constrain them through
configuration or contracts without a database enum migration.

## Runtime client boundary

Prisma 7 generates a TypeScript client into `packages/database/generated`, which
is ignored as a build artifact. No runtime driver adapter is selected yet because
there is no API/worker database connection in this foundation milestone. The
schema, generation, and migrations are real; runtime connection ownership will
be chosen when an application first consumes the client.

## Mapping and grant row lifecycle

The no-hard-delete rule applies to primary configuration entities with independent identity and downstream foreign-key references: Journey, Status, Field, Service, and Role. **One bounded exception exists** — see ADR-0017: an entity that is already deactivated and has zero blocking dependents may be purged permanently, which deletes it and the mapping rows below in one audited transaction. The `*_no_delete` triggers still refuse every other delete path; the purge transaction satisfies them with a transaction-scoped `SET LOCAL falcon.purge = 'on'`. Pure relationship rows such as `journey_services`, `field_journey_settings`, `field_visibility`, and `role_journey_access` are current-state mappings/grants. Nothing references those row IDs, so unmapping or revoking one of those relationships deletes the row and preserves history through a `system_audit_logs` entry whose `old_value` is the removed row and whose `new_value` is null.

Status reassignment-assisted deactivation has two histories. The configuration action writes one `system_audit_logs` row, while each affected lead also receives an `activity_logs` row with `action_type = status_change` and the same old/new status values that an individual status change would record. The process-instance updates and both log families must commit in the same transaction.
