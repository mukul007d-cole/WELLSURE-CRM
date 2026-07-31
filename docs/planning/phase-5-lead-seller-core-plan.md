# Phase 5 Plan — Lead/Seller Core

## Goal
Implement Lead/Seller creation, editing, Seller List, and Seller 360 endpoints that use the existing auth, permission-engine, and configuration-engine contracts together against configurable Journeys, Statuses, Fields, process instances, assignments, and lead-level activity logs.

## Docs read
- `AGENTS.md`
- `PLANS.md`
- `docs/requirements/source-of-truth.md`
- `docs/requirements/glossary.md`
- `docs/requirements/v1-scope.md`
- `docs/data-model/schema.md`
- `docs/data-model/prisma-translation-notes.md`
- `docs/permissions/access-model.md`
- `docs/testing/quality-gates.md`
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
- `docs/planning/phase-4-configuration-engine-api-plan.md`
- `apps/api/src/routes/leads.ts`
- `apps/api/src/routes/configuration.ts`
- `apps/api/src/configuration/audit.ts`
- `apps/api/src/configuration/errors.ts`
- `apps/api/src/configuration/service.ts`
- `apps/api/src/configuration/validation.ts`
- `packages/permission-engine/src/audit-hooks.ts`
- `packages/permission-engine/src/decision.ts`
- `packages/permission-engine/src/fields.ts`
- `packages/permission-engine/src/grants.ts`
- `packages/permission-engine/src/index.ts`
- `packages/permission-engine/src/scope.ts`
- `packages/permission-engine/src/types.ts`
- `apps/api/src/__tests__/configuration.integration.test.ts`
- `apps/api/src/__tests__/fixtures/synthetic-configuration.ts`

## Current state
- `apps/api/src/routes/leads.ts` currently implements a narrow single-record read path through `getLeadById`. It loads one lead, chooses the first active process instance, calls `resolveAuthorization`, treats field-view denial as non-blocking for read responses, and strips unauthorized dynamic `fieldValues` before returning the response.
- The existing lead route is intentionally partial: it does not expose create, edit, list, Seller 360 process/assignment detail, server-side search/filter/sort/pagination, multi-Journey-specific process selection, or activity-log writes for lead mutations.
- The pre-implementation lead route defaulted to `defaultAssignmentTypes = ['primary']`, but that must be removed during Phase 5. Assignment types are configurable strings/lookups, so creation requires a caller-supplied non-empty assignments array rather than any hardcoded default owner type.
- `apps/api/src/routes/configuration.ts` and `apps/api/src/configuration/*` provide the Phase 4 mutation/service pattern: route-level functions accept `AuthenticatedContext`, call `resolveAuthorization` with the real `PermissionRepository`, delegate transactional work to a service, convert typed service errors into route responses, and write audit/activity rows in the same transaction as the mutation.
- `ConfigurationService` already validates field-to-Journey settings with requirements `required`, `optional`, and `hidden`, and validates `requiredFromStatusId` as an active Status in the same Journey. Lead creation/editing should consume these settings rather than duplicating configuration concepts.
- The permission engine exposes one decision contract through `resolveAuthorization`. It enforces active user/role, module/action permission, explicit Journey access, data scope, direct grants, and field visibility/editability metadata. API routes must not fork this logic.
- `docs/data-model/schema.md` confirms that Lead/Seller is the canonical business record; Journey membership belongs to `process_instances`, and a Lead may have multiple active memberships at the same time. Creation/editing therefore must target a specific process instance/Journey context rather than assuming one Lead has exactly one Journey.
- `activity_logs` is the correct append-only audit surface for lead-level field edits, status changes, and assignment changes. `system_audit_logs` is reserved for configuration and security/admin changes.
- Existing real-Postgres integration patterns already use synthetic fixtures and migration SQL. Phase 5 tests should reuse that style, but setup for Lead/Seller tests must create Journeys, Statuses, Fields, Field-Journey settings, and Field Visibility through the configuration-engine API route/service layer where practical, not by bypassing the configuration engine with raw inserts.
- Seller 360 supporting tables exist for activity logs, tasks, attachments, lead services, and lead links in the logical schema, but the current route scope should include only underlying data that is implemented and queryable through current repository contracts. Activity timeline, tasks, attachments, service detail, and linked-lead expansion should remain deferred unless implementation finds established APIs/contracts already exist.

## Proposed approach
1. Extend `apps/api/src/routes/leads.ts` rather than creating a parallel lead/seller route stack. Keep exported route functions/controllers consistent with the existing framework-light API convention used by `configuration.ts`.
2. Introduce a Lead/Seller service and repository boundary under `apps/api/src/leads/` for transactional core operations. The route layer will handle auth/permission decision calls and response shaping; the service layer will handle configuration resolution, validation, persistence, process-instance updates, assignment writes, and `activity_logs` writes.
3. Keep every business datum configurable and ID based. Do not hardcode Journey names, Status names, Field names, role names, department names, or Wellsure/Cronberry values in application logic or tests. Tests may use synthetic keys/names only as fixture data created through the configuration engine.
4. Lead creation flow:
   - Accept `journeyId`, an initial `statusId` or use the Journey's configured default-on-create Status if the API contract already supports that lookup, core lead fields (`name`, `phone`, `email`), dynamic `fieldValues` keyed by Field IDs, and at least one current owner assignment input.
   - Resolve the active Journey, active initial Status in that Journey, and active `field_journey_settings` for that Journey.
   - Reject dynamic values for Fields not actively assigned to the target Journey or whose Journey setting is `hidden`.
   - Evaluate required fields using the target creation Status: plain `required` fields must be present; fields with `requiredFromStatusId` are required only when the initial Status has reached or is at the configured threshold by exact `current_status_id` match. A field with `requiredFromStatusId` must not block creation unless the initial Status equals that configured Status.
   - Validate each supplied dynamic value against the Field's `field_type` and `validation_rule` through a small validation module. Start with documented/configured generic field types already accepted by existing data; do not introduce field names as validation logic.
   - Call `resolveAuthorization` for module `leads`, action `create`, target Journey, requested edit field IDs, and the relevant assignment types before writing. Feature/action/Journey/scope/field-edit denials block creation server-side.
   - Persist the `leads` row, one active `process_instances` row for the target Journey, the required current assignment row(s), and one `activity_logs` row with `action_type = field_edit` capturing created core/dynamic values in a single transaction. If the initial operation also explicitly sets a non-default Status, document/test whether a separate `status_change` activity row is needed or whether creation captures the initial status in the creation payload.
5. Lead editing flow:
   - Accept a target `processInstanceId` (or an unambiguous `leadId` + `journeyId`) so edits occur against one Journey membership. Do not infer that the first active process instance is the only membership.
   - Load the Lead, target active process instance, current Status, Field-Journey settings for that process instance's Journey, current assignments, and requested dynamic Field IDs.
   - Call `resolveAuthorization` for module `leads`, action `edit`, target Journey, target lead, requested edit fields, and applicable assignment types. Blocking denials return 403; field-edit denials identify rejected fields and block writing those field changes.
   - Apply the same Field assignment/hidden/type/validation rules as creation. Required field checks should consider the resulting Status after the edit, not only the prior Status.
   - Write changed core fields and dynamic `field_values` atomically. Emit one `activity_logs` row with `action_type = field_edit` for field changes and one row with `action_type = status_change` if `current_status_id` changes. If both happen in one request, write both rows in the same transaction with precise old/new JSON values.
6. Required-from-status handling:
   - Treat `required_from_status_id` as an exact-match condition only: the Field becomes required when the process instance's `current_status_id` equals that configured Status. Do not use `statuses.sort_order`; Status is a flat non-sequential field and sort order is UI/display-only.
   - Validate same-Journey Status references through the configuration data and existing database constraints.
7. Multi-Journey membership:
   - Creation should support adding a new process instance for an existing Lead when requested, subject to the database invariant of at most one active membership per `(organization_id, lead_id, journey_id)`.
   - Editing, Seller List filtering, and Seller 360 serialization must query process instances explicitly. Seller 360 should return all active process instances visible to the requester by Journey access and record scope, not just one arbitrary active process.
8. Seller List endpoint:
   - Add a server-side list route/function with search over name/phone/email at minimum; filters for Journey, Status, and owner assignment; sort by a documented safe allow-list of engine-level columns such as `created_at`, `updated_at`, `name`, and status ordering where implemented; and pagination with a maximum page size.
   - Build the data-scope portion from `resolveAuthorization`'s `recordPredicate` instead of separate access checks. Use the same permission-filtered relation for rows and count to satisfy the access-model count/list parity rule.
   - Apply field-level visibility in list responses by resolving requested/list Field IDs through the permission engine and stripping unauthorized `fieldValues` per row, explicitly testing this in list/pagination context.
9. Seller 360 endpoint:
   - Replace or extend the current `getLeadById` response into a full single-lead detail shape: core fields, visible dynamic field values, visible active process instances/Journeys/statuses, and current assignments for the process instances included in the response.
   - Keep activity timeline, tasks/reminders, attachments, service details, linked-lead expansion, and financial detail deferred unless their underlying route/repository contracts already exist. The implementation PR should note the exact deferred sections so the endpoint contract is honest.
   - For multi-Journey leads, authorize each active process instance's Journey and record scope. If at least one process is allowed, return the Lead with only allowed process contexts and only visible Fields; if none are allowed, return 403 or 404 according to the existing route convention.
10. Add API documentation for request/response contracts, validation errors, permission behavior, field stripping, pagination/count parity, and the status-requiredness rule once the open question below is resolved.

## Files to touch
- `docs/planning/phase-5-lead-seller-core-plan.md`
- `apps/api/src/routes/leads.ts`
- `apps/api/src/leads/service.ts`
- `apps/api/src/leads/repository.ts`
- `apps/api/src/leads/validation.ts`
- `apps/api/src/leads/errors.ts`
- `apps/api/src/leads/activity.ts`
- `apps/api/src/index.ts`
- `apps/api/src/__tests__/leads.test.ts`
- `apps/api/src/__tests__/leads.integration.test.ts`
- `apps/api/src/__tests__/lead-list.integration.test.ts`
- `apps/api/src/__tests__/seller-360.integration.test.ts`
- `apps/api/src/__tests__/fixtures/synthetic-leads.ts`
- `docs/api/endpoints.md`
- `docs/testing/quality-gates.md` only if implementation discovers that an existing quality-gate instruction needs clarification, not to weaken it
- `packages/database/prisma/schema.prisma` only if a confirmed schema gap blocks the accepted Lead/Seller model
- `packages/database/prisma/migrations/<phase5-lead-seller-core>/migration.sql` only if the schema changes
- `packages/database/prisma/migrations/<phase5-lead-seller-core>/rollback.sql` only if a migration is added

## Out of scope
- No Wellsure seed data, Cronberry import, real seller data, real phone/email/GST values, plaintext credentials, or legacy `pass` field handling.
- No hardcoded business Journey, Status, Field, Role, Department, Service, assignment-type, or status-name logic.
- No UI/web dynamic-form implementation in this backend phase, unless explicit approval expands scope. The backend should return enough configuration/error metadata for a future dynamic UI to render forms.
- No saved views, bulk reassign, bulk status change, export, dashboards, email, document upload, import/migration, finance, or performance acceptance at 200,000 rows beyond smoke/query-shape tests for the new endpoints.
- No workflow engine/status transition side-effect implementation beyond required-field validation and activity logging. Existing permission-engine `workflowCheck` remains `not_enforced` unless a separate workflow-engine task is approved.
- No new production dependency unless implementation discovers an unavoidable validation/query gap and the PR explicitly explains why.
- No schema migration unless a real gap is confirmed. The current logical schema already contains Leads, process instances, assignments, fields, settings, visibility, and activity logs.

## Risks / open questions
- **Open product decision: should a status change be blocked when the destination Status makes a configured Field newly required and the Lead lacks that value, or should the status change be allowed with an incomplete-field warning?** The current docs require that the transition “surface a clear error” but do not explicitly choose blocking versus warning. Proposed default for approval: block the status change with `validation_error` until required fields are supplied in the same edit request, because this preserves data integrity and avoids silently entering an invalid status. Do not implement this until approved or documented in a new/updated requirement.
- Assignment owner semantics are resolved as fully caller-supplied/configurable. Creation must require a non-empty `assignments` array, and each entry supplies its own `assignment_type` and `userId`; the API validates presence and tenant/user integrity, not a canonical owner type string.
- `required_from_status_id` semantics are exact-match only. `statuses.sort_order` must not be used for validation because statuses are a flat, non-sequential field and sort order is display-only.
- Field `field_type`, `validation_rule`, `edit_mode`, and `source` are string/JSON-backed and intentionally configurable. Implementation must validate generic types/rules without converting example field names into code. If the existing configuration API permits a field type for which no validator exists, creation/editing should fail clearly or treat it as an unsupported configuration until the type contract is documented.
- Seller List count/list parity can leak records if implemented with separate queries. The implementation must share one permission-scoped predicate builder and integration tests must compare counts to actual returned IDs.
- Returning 403 versus 404 for unauthorized Seller 360 records should follow the current `getLeadById` convention where missing process/lead is 404 and authorization denial is 403. Cross-organization guesses should be tested to avoid leaking data through mismatched tenant IDs.
- Creating synthetic configuration through the configuration-engine API in tests may require extra fixture helpers for role permissions and field visibility bootstrapping. Those helpers must remain synthetic and must not bypass the route/service path for the configuration objects this phase is meant to exercise.

## Test plan
- Unit tests for Lead/Seller validation: unknown Field rejection, hidden Field rejection, required Field enforcement, optional Field acceptance, type/validation-rule failures, edit-mode enforcement where applicable, and clear errors for Fields not assigned to the target Journey.
- Unit tests for `required_from_status_id`: a Field with `requiredFromStatusId` does not block creation/editing at any different Status, and does block creation/editing when the target/current Status exactly equals the configured Status; tests must prove `statuses.sort_order` is ignored.
- Unit tests for route permission handling: create/edit/list/detail call `resolveAuthorization` with module `leads`, the correct action, the specific target Journey/process instance, requested view/edit Field IDs, and assignment types; feature/action/Journey/scope denials block server-side.
- Real-Postgres integration tests for Lead creation through synthetic configuration created by the configuration-engine API/service: Journey, Statuses, Fields, Field-Journey settings, and Field Visibility. Verify Lead, process instance, assignment, JSONB field values, and `activity_logs` rows are all committed atomically.
- Real-Postgres integration tests for Lead editing: core field updates, dynamic field updates, status change, activity logging with `field_edit` and `status_change`, rollback on validation failure, and no partial writes.
- Real-Postgres integration test proving multi-Journey membership by putting one Lead in two active Journeys/process instances and editing/listing/detailing against one process instance without corrupting or assuming the other.
- Seller List integration tests for search by name/phone/email, Journey filter, Status filter, owner filter, allowed sorting, pagination, count/list parity, permission-scoped rows, direct-grant inclusion where supported, and cross-organization isolation.
- Seller List field-visibility tests proving unauthorized dynamic Fields are stripped from every row in a paginated list while permitted Fields remain visible.
- Seller 360 integration tests proving core fields, visible dynamic field values, authorized active process instances/Journeys/statuses, and current assignments are returned; unauthorized fields and unauthorized Journey memberships are stripped or denied according to the endpoint contract.
- Role-based tests with synthetic roles and permissions for SELF, TEAM, DEPARTMENT, and ORGANIZATION scopes where fixtures support them. Include a lower-scope user denied from another user's lead and a higher-scope user allowed through the same endpoint path.
- Cross-organization tests confirming guessed Lead, Journey, Status, Field, process-instance, assignment, and owner IDs from another organization cannot be used in create/edit/list/detail requests.
- Audit/activity tests confirming every material lead mutation writes append-only `activity_logs` rows and that no Lead/Seller mutation writes `system_audit_logs` unless it is also a configuration mutation delegated to the configuration engine.
- Run the required quality gates from `docs/testing/quality-gates.md` before final review: formatting, lint, typecheck, tests, build, and real-Postgres migration/apply checks if a migration is added. Do not claim a gate passed unless the command was actually run and observed in this environment.
- Use only synthetic fixtures and generated identifiers; no real Wellsure data, no seed data dependency, no secrets, no tokens, no real personal data, and no legacy plaintext credential fields.

## Rollback plan
- Preferred Phase 5 implementation should use the existing schema. If no migration is needed, rollback is reverting the Lead/Seller route/service/repository/tests/docs changes; application data created through the endpoints remains normal lead data and is not hard-deleted by rollback.
- If a schema gap is confirmed and a migration is approved, include a matching `rollback.sql` that drops only newly added constraints/indexes/tables/functions in reverse order and documents any data-preserving alternative if destructive rollback would be unsafe.
- Before applying rollback in any persistent environment, disable new Lead/Seller write endpoints, drain in-flight requests, take a database backup, and preserve existing `activity_logs` because lead-level audit history is append-only and must not be edited or hard-deleted.
