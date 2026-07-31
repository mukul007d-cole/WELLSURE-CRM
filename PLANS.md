# PLANS.md — Execution Plan Format

For any task larger than a trivial fix, produce a plan in this format before writing code. Do not proceed past the plan without explicit approval.

## Required plan structure

```
## Goal
<one sentence, the specific outcome>

## Docs read
<list the docs/ files actually read for this task>

## Current state
<what exists in the repo today relevant to this task>

## Proposed approach
<the design, referencing docs/data-model, docs/permissions, docs/api as relevant>

## Files to touch
<explicit list — no "and related files">

## Out of scope
<explicitly what this task will NOT change>

## Risks / open questions
<anything uncertain — including any conflict found between raw example data
and docs/, per the source-of-truth precedence rule>

## Test plan
<what tests get added/updated, referencing docs/testing/quality-gates.md>

## Rollback plan
<for schema changes specifically>
```

## Rules

- One plan per coherent milestone — never "build the whole CRM" as one task.
- A plan must be approved before its corresponding implementation begins.
- If a plan reveals a conflict between two source documents, stop and surface it rather than resolving it silently — update `docs/architecture/decisions/` with a new ADR once resolved, then resume.
- Use a separate Git worktree for independent parallel work; never let two tasks modify the same package/module simultaneously.
- Long-running or multi-phase work should reference the phase numbering in `docs/requirements/v1-scope.md` and the original implementation plan's phase breakdown, so progress stays traceable.


---

# Phase 4 Plan — Configuration Engine API

## Goal
Implement Journey, Status, Service, Field, field-to-Journey settings, Journey-to-Service mapping, and field-visibility configuration APIs with server-side permission enforcement, safe deactivation rules, and append-only `system_audit_logs` for every configuration mutation.

## Docs read
- `AGENTS.md`
- `PLANS.md`
- `docs/requirements/source-of-truth.md`
- `docs/requirements/glossary.md`
- `docs/requirements/v1-scope.md`
- `docs/data-model/schema.md`
- `docs/data-model/prisma-translation-notes.md`
- `docs/permissions/access-model.md`
- `docs/permissions/permission-engine-schema.md`
- `docs/workflows/journey-definitions.md`
- `docs/architecture/decisions/0001-single-status-field.md`
- `docs/architecture/decisions/0002-gst-one-to-one-marketplace-account.md`
- `docs/architecture/decisions/0003-finance-scope-v1.md`
- `docs/architecture/decisions/0004-migration-dedup-priority.md`
- `docs/architecture/decisions/0005-auth-provider-deferred.md`
- `docs/architecture/decisions/0006-team-scope-from-hierarchy.md`
- `docs/architecture/decisions/0007-custom-session-auth.md`
- `docs/planning/phase-1-backlog.md`
- `docs/planning/phase-2-identity-permission-engine-plan.md`
- `docs/planning/phase-3-custom-auth-and-api-wiring-plan.md`
- `docs/testing/quality-gates.md`
- `packages/permission-engine/src/audit-hooks.ts`
- `packages/permission-engine/src/decision.ts`
- `packages/permission-engine/src/fields.ts`
- `packages/permission-engine/src/grants.ts`
- `packages/permission-engine/src/index.ts`
- `packages/permission-engine/src/scope.ts`
- `packages/permission-engine/src/types.ts`
- `apps/api/src/routes/leads.ts`
- `apps/api/src/auth/audit.ts`

## Current state
- The Prisma schema already contains configuration tables for `journeys`, `statuses`, `services`, `journey_services`, `fields`, `field_journey_settings`, and `field_visibility`, with tenant-scoped IDs, keys, active flags, versions, audit actor references, and restrictive relations matching the logical schema.
- `statuses` are scoped to Journeys and `process_instances.current_status_id` references statuses through the same Journey, which supports the single-status-per-process-instance ADR and tenant/Journey isolation.
- `field_visibility` already exists and the Phase 2 permission engine already resolves VIEW/EDIT decisions as an allow-list; no duplicate field-visibility evaluator should be created.
- `packages/permission-engine/src/audit-hooks.ts` defines audit payload types only for Phase 2 permission entities, so configuration entities need either a compatible local API audit helper or a narrowly expanded reusable audit entity/action type without changing authorization semantics.
- `apps/api/src/routes/leads.ts` is currently the concrete authorization wiring pattern: load authenticated context, load relevant Journey context, call `resolveAuthorization`, deny blocking reasons server-side, and serialize only permitted data.
- No API route currently creates, edits, deactivates, maps, or safely reassigns/deactivates Journey, Status, Service, or Field configuration records.
- The requested safe Status deactivation trigger is documented in `docs/data-model/prisma-translation-notes.md`, but must be verified in a real Postgres test by attempting to deactivate a Status referenced by active `process_instances`.

## Proposed approach
1. Keep all configuration generic and ID/key based. Do not hardcode any Wellsure seed Journey, Status, Field, Service, role, department, or assignment names in application logic or tests; use synthetic fixture labels such as `Test Journey A` and `Test Field A` only.
2. Define stable configuration permission module/action identifiers for API enforcement, for example module strings for `journeys`, `statuses`, `services`, `fields`, `field_journey_settings`, `journey_services`, and `field_visibility`, with `create`, `edit`, and `delete`/`deactivate` actions as required by `docs/permissions/access-model.md`. These are engine-level API permission identifiers, not business data.
3. Add an API configuration service layer that wraps each mutation in a Prisma transaction and writes the configuration row change plus a matching `system_audit_logs` row atomically. Audit entries will include `organization_id`, authenticated actor, entity type/id, action, and old/new JSON values. The helper will follow the payload shape used by `packages/permission-engine/src/audit-hooks.ts` and `apps/api/src/auth/audit.ts`.
4. Add route-level functions/controllers for:
   - Journey create, update, and deactivate. Deactivation must be blocked when active `process_instances` still depend on the Journey, unless an explicit future reassignment/closure workflow is separately approved.
   - Status create, update, deactivate, and reassignment-assisted deactivate. Plain deactivation must return a clear actionable conflict if active `process_instances` use the Status. Reassignment-assisted deactivation must move active process instances from the old Status to a replacement Status in the same organization and Journey, then deactivate the old Status and audit both the reassignment and deactivation in the same transaction.
   - Service create, update, deactivate, plus Journey-to-Service mapping activation/deactivation. Service deactivation must be blocked while active `lead_services` depend on it, unless those enrollments are explicitly ended first through a reviewed flow.
   - Field create, update, deactivate. Field deactivation must not remove historical JSON field values from leads. The API will deactivate the field and related active Journey settings/visibility only when explicitly requested or will reject dependency conflicts if the request would silently orphan active settings.
   - Field-to-Journey settings upsert/deactivate with `requirement` values `required`, `optional`, or `hidden`, and `required_from_status_id` validated as null or an active Status in the same Journey.
   - Field visibility upsert/deactivate by role using the existing `field_visibility` table and Phase 2 field decision contract. No parallel visibility tables or evaluators.
5. Follow the `leads.ts` authorization pattern exactly for every endpoint: use `AuthenticatedContext`, resolve the target or requested Journey context, call `resolveAuthorization` with the real `PermissionRepository`, treat denied feature/action/journey/scope reasons as blocking, and never rely on UI-only checks. Configuration routes do not expose lead field values, so field response stripping applies only to field-visibility management responses where applicable.
6. Normalize and validate configuration input at the API boundary with typed schemas/functions already used in the repo if present. Validation should cover key shape/uniqueness, enum-like fields (`outcome_type`, `behavior_type`, requirement, access_level) using engine enums only, sort order, same-organization references, same-Journey replacement Statuses, and no plaintext credential/legacy data paths.
7. Verify whether the documented Status deactivation trigger exists and behaves correctly against real Postgres. If it is missing, add a reversible database migration implementing the trigger or equivalent constraint, plus rollback SQL. If it exists but returns a raw database error, map it to a clear API conflict response.
8. Add or update API docs only for the new configuration endpoints and their conflict/audit/permission behavior; do not seed Wellsure data in this phase.

## Files to touch
- `PLANS.md`
- `apps/api/src/routes/configuration.ts`
- `apps/api/src/routes/configuration.test.ts`
- `apps/api/src/configuration/service.ts`
- `apps/api/src/configuration/validation.ts`
- `apps/api/src/configuration/audit.ts`
- `apps/api/src/configuration/errors.ts`
- `apps/api/src/server.ts`
- `apps/api/src/permissions/prisma-permission-repository.ts`
- `apps/api/src/__tests__/configuration.integration.test.ts`
- `apps/api/src/__tests__/fixtures/synthetic-configuration.ts`
- `packages/permission-engine/src/audit-hooks.ts`
- `packages/permission-engine/src/__tests__/audit-hooks.test.ts`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/<phase4-configuration-safety>/migration.sql`
- `packages/database/prisma/migrations/<phase4-configuration-safety>/rollback.sql`
- `docs/api/endpoints.md`
- `docs/data-model/prisma-translation-notes.md`

## Out of scope
- No Wellsure seed data or real Journey/Status/Field/Service names.
- No UI or frontend builder screens.
- No lead creation/editing dynamic form implementation beyond tests needed to prove configuration dependencies and status reassignment behavior.
- No new auth provider, role-builder UI, or permission-engine rewrite.
- No hard deletes for configuration records.
- No import/migration of Cronberry data or plaintext legacy credentials.
- No new production dependency unless implementation discovers an unavoidable gap and the PR explicitly explains it.

## Risks / open questions
- The exact route registration and HTTP framework shape need verification before implementation; if the API still exposes route functions without an HTTP router, tests should follow the current pattern instead of inventing a new framework convention.
- `docs/data-model/prisma-translation-notes.md` says a trigger blocks Status deactivation with active process instances, but the current Prisma schema alone does not prove it. Implementation must verify the actual migration/database state against real Postgres before relying on it.
- `FieldJourneySetting.requirement`, `Field.editMode`, and `Field.source` are plain strings in Prisma. The API must validate the documented allowed values without turning Wellsure-specific field names into code constants.
- `RoleJourneyAccess` currently has no active flag while `field_visibility` also has no active flag in the schema. Deactivation semantics for field visibility likely mean deleting/upserting the allow-list row unless a schema change is approved; this needs confirmation during implementation because “nothing hard-deleted” applies to configuration records, but the existing logical schema models field visibility as an allow-list row without `active`.
- Journey and Service deactivation dependency behavior is less explicitly documented than Status safe deletion. Proposed rule: block deactivation while active dependent process/enrollment rows exist, returning conflict counts and requiring an explicit future migration/reassignment/ending flow.
- Reassignment-assisted Status deactivation changes active process instances and is lead-adjacent. It should write system audit logs for configuration action and may also need lead-level `activity_logs` for each moved process instance; if docs conflict, stop and flag before silently choosing one.

## Test plan
- Unit tests for validation: synthetic keys/names, status outcome/behavior values, field requirement values, same-organization and same-Journey reference checks, and rejection of unsafe replacements.
- Unit tests for permission enforcement with table-driven role/action cases covering Journey, Status, Service, Field, Journey-Service mapping, Field-Journey settings, and Field Visibility create/edit/deactivate actions.
- Unit tests proving `field_visibility` management reuses the existing permission-engine field visibility contract and does not duplicate response-stripping logic.
- Integration tests against real Postgres using the repository’s established Testcontainers or docker-compose approach for Journey CRUD, Status CRUD, Service CRUD plus Journey mapping, Field CRUD, Field-Journey settings, and Field Visibility CRUD.
- A real-Postgres test that creates an active `process_instance` on a Status, attempts Status deactivation, confirms the API returns a clear conflict instead of a raw database error, then reassigns active process instances to a same-Journey replacement Status and confirms deactivation succeeds.
- Real-Postgres tests for no-orphan rules: Journey deactivation blocked with active process instances, Service deactivation blocked with active lead service enrollments, and Field deactivation behavior explicitly verified for active settings/visibility.
- Audit integration tests confirming every create/edit/deactivate/map/unmap/reassign mutation writes exactly the expected `system_audit_logs` row(s) in the same transaction and rolls back audit rows if the mutation fails.
- Cross-organization tests confirming guessed IDs from another organization cannot be edited, mapped, used as required-from statuses, used as replacement statuses, or included in visibility rows.
- Run the full quality gates from `docs/testing/quality-gates.md` before PR: format, lint, typecheck, test, build, and any migration apply/rollback checks required by schema changes.
- All fixtures must be synthetic and must not include Wellsure business labels, Cronberry data, real emails/phones/GSTs, secrets, tokens, or the legacy `pass` field.

## Rollback plan
- If no database migration is needed after trigger verification, rollback is reverting the API/configuration service/docs changes; deactivated configuration rows remain normal data and are not hard-deleted.
- If a Status safety trigger or additional dependency constraints are added, include `rollback.sql` that drops only the new trigger/function/indexes in reverse order without deleting configuration or lead data.
- If a schema change is needed for auditable deactivation semantics on mapping/visibility rows, include a reversible migration and document how existing rows retain their prior allow-list meaning.
- Before applying a destructive rollback in any persistent environment, take a database backup and disable the new configuration endpoints so no in-flight admin mutation writes against a partially rolled-back schema.
