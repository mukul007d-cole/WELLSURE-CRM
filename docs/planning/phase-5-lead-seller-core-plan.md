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

---

## Phase 5 Completion

### Goal
Complete Phase 5 by replacing the current in-memory-only Lead/Seller implementation with real Prisma-backed repositories, real-Postgres integration coverage, corrected multi-Journey Seller 360 field aggregation, and approved cross-Journey Seller List all-Journeys behavior.

### Docs read
- `AGENTS.md`
- `PLANS.md`
- `docs/requirements/source-of-truth.md`
- `docs/requirements/glossary.md`
- `docs/requirements/v1-scope.md`
- `docs/data-model/schema.md`
- `docs/permissions/access-model.md`
- `docs/testing/quality-gates.md`
- `docs/planning/phase-5-lead-seller-core-plan.md`
- `apps/api/src/leads/service.ts`
- `apps/api/src/leads/validation.ts`
- `apps/api/src/leads/activity.ts`
- `apps/api/src/leads/errors.ts`
- `apps/api/src/routes/leads.ts`
- `apps/api/src/__tests__/leads.test.ts`
- `apps/api/src/auth/prisma-auth-repository.ts`
- `apps/api/src/permissions/prisma-permission-repository.ts`
- `apps/api/src/__tests__/auth-flow.integration.test.ts`
- `packages/permission-engine/src/__tests__/scope.integration.test.ts`

### Current state
- Phase 5 is partially implemented in route/service/validation layers: `createLead`, `editLead`, `listSellers`, `getLeadById`, and `getSeller360` exist, with typed service errors and append-only `activity_logs` writes modeled through the `LeadRepository` interface.
- There is no production Prisma-backed implementation for `LeadRepository`, `LeadReadRepository`, or `SellerReadRepository`. This means the current Phase 5 behavior cannot run against the real application database and is not wired to the same standard as custom auth or permissions repositories.
- All current Lead/Seller tests are unit tests backed by an in-memory `MemoryLeadRepository`; there are no Phase 5 real-Postgres integration tests for creation, editing, multi-Journey membership, Seller List count/list parity, Seller 360, activity logging, or tenant isolation.
- The existing service already enforces several intended semantics: caller-supplied assignment types, exact-match `requiredFromStatusId`, hidden/unassigned Field rejection, generic field type validation, activity writes for field edits/status changes, and duplicate active process-instance prevention by repository contract.
- Seller 360 field-visibility aggregation is confirmed wrong for multi-Journey leads: `getSeller360` iterates authorized process instances but overwrites `visibleFieldIds` on each allowed Journey instead of taking the union across all allowed decisions. A user with access to different visible Fields in different Journey contexts may receive only the last authorized Journey's field set.
- Seller List currently rejects requests without `journeyId` before authorization. The approved product behavior is an all-Journeys aggregate view when `journeyId` is omitted, matching the reviewed Seller List UI prototype with first-class All/Journey-specific tabs.
- `PrismaPermissionRepository.getLeadScope` currently reads only the first active process instance for a Lead. That is risky for multi-Journey leads because scope decisions may be computed against the wrong Journey assignment set. Completing Phase 5 should review and, if needed, adjust permission scope lookup so Lead/Seller authorization is Journey/process-aware without forking permission rules in routes.
- The data model already contains the required tables and invariants for this task: `leads`, `process_instances`, `assignments`, `field_journey_settings`, `field_visibility`, `user_access_grants`, and `activity_logs`. No schema migration is expected unless implementation discovers a mismatch between the logical model and Prisma schema.

### Proposed approach
1. Keep this as a Phase 5 completion, not a new phase. Preserve the original Phase 5 plan above as historical decision context, and append this completion section so the remaining implementation work is traceable without deleting prior approved reasoning.
2. Add `apps/api/src/leads/prisma-lead-repository.ts` implementing all three repository contracts used by `apps/api/src/routes/leads.ts`:
   - `LeadRepository` for create/edit transactions, configuration lookup, user validation, process-instance creation/status updates, assignment creation, and `activity_logs` writes.
   - `LeadReadRepository` for the legacy/simple lead detail path if it remains exported.
   - `SellerReadRepository` for Seller List and Seller 360 reads.
3. Follow the repository style used by `PrismaAuthRepository` and `PrismaPermissionRepository`: define a narrow Prisma client interface, tenant-scope every query by `organizationId`, use compound unique keys where available, select only required columns, and return route/service DTOs rather than Prisma rows directly.
4. Implement `transaction` in the Prisma lead repository using `prisma.$transaction`, ensuring Lead rows, process instances, assignments, and activity logs commit or roll back atomically. The transaction-scoped repository must use the transaction client for every read/write inside the callback.
5. Implement real persistence behavior without hardcoded business data:
   - Journey/status lookups use IDs and active flags only.
   - Field settings include the related Field definition needed by `validateFieldValues`.
   - `field_values` remain JSONB keyed by Field IDs.
   - Assignment types are persisted exactly as caller/configuration-supplied strings; no default owner type is introduced.
6. Implement Seller List repository queries with a shared permission-scoped predicate for rows and total count. The same `recordPredicate` returned by `resolveAuthorization` must constrain both queries so counts cannot leak records that list rows omit.
7. Support documented Seller List filters and pagination in the repository: search by Lead name/phone/email, optional Journey filter, optional Status filter, optional current owner filter, safe sort allow-list (`createdAt`, `updatedAt`, `name`), page/page-size normalization, and process-instance inclusion only for relevant active memberships.
8. Correct Seller 360 multi-Journey field visibility by accumulating a set union of `decision.fields.visibleFieldIds` across all authorized active process instances. Seller 360 should return only authorized active process contexts and only dynamic Field values visible in at least one authorized context.
9. Review multi-Journey authorization boundaries before implementation:
   - For Seller 360, each active process instance must be authorized independently for its Journey and record scope.
   - For Seller List with a Journey filter, authorize against that Journey and use that Journey's scoped relation.
   - For Seller List without a Journey filter, implement the approved all-Journeys aggregate view. Authorization must be evaluated across the Journeys the requester's role can access, and the query must include only process memberships that satisfy both Journey access and data scope.
10. Review and fix `PrismaPermissionRepository.getLeadScope` if required for correct Journey-aware scope checks. Any fix that makes Lead/Seller authorization Journey/process-aware must live in the `packages/permission-engine` contract and repository interface, not as workaround scope logic in `apps/api/src/routes/leads.ts`. If implementation starts to fork scope resolution in the route layer, stop and route the change through the permission-engine package with provider-independent package-level tests. The specific regression where a multi-Journey Lead's first active process is not the Journey/process being authorized is mandatory if this contract changes: it must fail against the old first-process-only behavior and pass after the fix.
11. Keep API response shaping in `apps/api/src/routes/leads.ts`: authorization decisions remain in routes, validation/persistence remain in service/repository, and unauthorized dynamic Fields are stripped server-side before returning list/detail responses.
12. Update `docs/api/endpoints.md` after approval/implementation to document create/edit/list/detail request bodies, validation errors, permission stripping, pagination/count behavior, activity logging, and the exact Seller List all-Journeys decision.

### Files to touch
- `docs/planning/phase-5-lead-seller-core-plan.md`
- `apps/api/src/leads/prisma-lead-repository.ts`
- `apps/api/src/leads/service.ts`
- `apps/api/src/leads/validation.ts`
- `apps/api/src/leads/activity.ts`
- `apps/api/src/leads/errors.ts`
- `apps/api/src/routes/leads.ts`
- `apps/api/src/permissions/prisma-permission-repository.ts` only if Journey-aware scope correction requires it
- `packages/permission-engine/src/types.ts` only if the permission repository contract must become Journey/process-aware
- `packages/permission-engine/src/decision.ts` only if Journey/process-aware scope correction requires it
- `packages/permission-engine/src/__tests__/*.test.ts` only if permission-engine behavior changes
- `apps/api/src/index.ts` or the existing API composition file only if real lead routes need dependency wiring there
- `apps/api/src/__tests__/leads.test.ts`
- `apps/api/src/__tests__/leads.integration.test.ts`
- `apps/api/src/__tests__/fixtures/synthetic-leads.ts`
- `docs/api/endpoints.md`
- `packages/database/prisma/schema.prisma` only if a confirmed Prisma schema gap blocks the documented data model
- `packages/database/prisma/migrations/<phase5-lead-seller-core>/migration.sql` only if a schema change is approved
- `packages/database/prisma/migrations/<phase5-lead-seller-core>/rollback.sql` only if a migration is added

### Out of scope
- No UI/web implementation.
- No saved views, bulk reassign, bulk status change, export, dashboards, email, document upload, finance, import/migration, or 200k-record load-test implementation in this completion task.
- No workflow side-effect engine beyond the already planned required-field validation and lead-level activity logging.
- No hardcoded Journey, Status, Field, Role, Department, Service, assignment-type, or Wellsure/Cronberry values in application logic or tests.
- No real Wellsure seller data, real phone/email/GST values, secrets, tokens, plaintext credentials, or legacy `pass` field handling.
- No production dependency additions unless an implementation blocker is found and explicitly justified in the PR/diff.
- No schema migration unless the actual Prisma schema lacks a required invariant/table/column from the documented Lead/Seller model.

### Risks / open questions
- **Approved product decision: Seller List supports an all-Journeys view when `journeyId` is omitted.** The aggregate view is limited to Journeys the role can access and records within the requester's resolved data scope, matching both V1 Seller List wording and the reviewed Seller List UI prototype. Implementation must prove count/list parity and field stripping across multiple Journey contexts.
- **Potential permission-engine contract gap:** The current lead-scope repository shape may not carry Journey/process context, and the Prisma implementation currently selects the first active process instance. If `resolveAuthorization` cannot correctly evaluate record scope for a specific Journey membership, Phase 5 must adjust the provider-independent permission contract rather than adding ad hoc route-side scope logic. This is a hard guardrail, not a preference.
- **Seller 360 field visibility union:** This is not an open question; it is a confirmed correctness bug. Proposed fix is a union of visible Field IDs across authorized process instances, with unauthorized process instances omitted from the response.
- **Status-requiredness blocking behavior:** The prior Phase 5 plan proposed blocking status changes when the destination Status exactly matches a `requiredFromStatusId` and required values are missing. This remains the proposed default for implementation because it preserves data integrity; if product wants warnings instead, that should be approved and documented before implementation.
- **List performance:** Correct permission-scoped queries are the priority for this completion. Full 200k-record p95 validation remains a V1 quality gate, but this task should at least use index-friendly query shapes and avoid separate count/list predicates.
- **Integration fixture setup:** Creating enough synthetic configuration and role data for real-Postgres tests may require fixture helpers. Those helpers must remain synthetic and tenant-scoped, and should not encode Wellsure seed examples.

### Test plan
- Keep/update existing unit tests for validation and route behavior: explicit assignments, exact-match `requiredFromStatusId`, hidden/unassigned Field rejection, edit activity writes, list field stripping, Seller 360 authorization, and cross-organization isolation.
- Add a unit regression test for Seller 360 multi-Journey field visibility proving visible Field IDs are unioned across authorized process instances rather than overwritten by the last authorization decision.
- Add unit tests for the approved Seller List behavior: omitted `journeyId` no longer returns a validation error, produces the all-Journeys aggregate view, and still authorizes safely across accessible Journey contexts.
- Add real-Postgres integration tests for Lead creation through `PrismaLeadRepository`: Lead row, active process instance, current assignment rows, JSONB field values, and `activity_logs` row commit atomically.
- Add real-Postgres integration tests for Lead editing: core field updates, dynamic field merging, status changes, `field_edit` and `status_change` activity rows, and rollback/no partial writes on validation failure.
- Add real-Postgres integration tests for multi-Journey membership: one Lead in two active Journeys, no duplicate active membership for the same Journey, edits scoped to one process instance, and Seller 360 returns only authorized process contexts.
- Add real-Postgres Seller List integration tests for search, Journey filter, Status filter, current owner filter, sorting allow-list, pagination, count/list parity, permission-scoped rows, field stripping for every row, and cross-organization isolation.
- Add real-Postgres tests for permission interactions covering SELF, TEAM, DEPARTMENT, ORGANIZATION, and direct grants where supported by current fixtures, with synthetic users/roles and no business-name dependencies.
- Add or update permission-engine/prisma-permission tests if Journey-aware lead-scope behavior changes. The regression where a multi-Journey Lead's first active process is not the one being authorized is mandatory for such a contract change and must demonstrate failure under the old first-process-only behavior.
- Run required quality gates before final review: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, plus the real-Postgres integration command/path used by the repo. If Docker/Testcontainers or `FALCON_POSTGRES_URL` is unavailable, report that as an environment limitation rather than a pass.

### Rollback plan
- If no migration is needed, rollback is a normal code revert of the Phase 5 repository, route, service, test, and docs changes. Data created through the endpoints remains ordinary application data and must not be hard-deleted.
- If a schema migration is approved, include a matching rollback SQL file that reverses only newly added Phase 5 schema objects or constraints. If destructive rollback would affect lead/activity history, document a data-preserving rollback alternative instead.
- Before rollback in a persistent environment, disable Lead/Seller write endpoints, drain in-flight requests, take a database backup, and preserve existing `activity_logs` because Lead/Seller audit history is append-only.
