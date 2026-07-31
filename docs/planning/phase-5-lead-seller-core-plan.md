# Phase 5 Plan — Lead/Seller Core Completion

## Goal
Complete Phase 5 by replacing the current in-memory-only Lead/Seller implementation with real Prisma-backed repositories, real-Postgres integration coverage, corrected multi-Journey Seller 360 field aggregation, and an explicit approval decision for cross-Journey Seller List behavior.

## Docs read
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

## Current state
- Phase 5 is partially implemented in route/service/validation layers: `createLead`, `editLead`, `listSellers`, `getLeadById`, and `getSeller360` exist, with typed service errors and append-only `activity_logs` writes modeled through the `LeadRepository` interface.
- There is no production Prisma-backed implementation for `LeadRepository`, `LeadReadRepository`, or `SellerReadRepository`. This means the current Phase 5 behavior cannot run against the real application database and is not wired to the same standard as custom auth or permissions repositories.
- All current Lead/Seller tests are unit tests backed by an in-memory `MemoryLeadRepository`; there are no Phase 5 real-Postgres integration tests for creation, editing, multi-Journey membership, Seller List count/list parity, Seller 360, activity logging, or tenant isolation.
- The existing service already enforces several intended semantics: caller-supplied assignment types, exact-match `requiredFromStatusId`, hidden/unassigned Field rejection, generic field type validation, activity writes for field edits/status changes, and duplicate active process-instance prevention by repository contract.
- Seller 360 field-visibility aggregation is confirmed wrong for multi-Journey leads: `getSeller360` iterates authorized process instances but overwrites `visibleFieldIds` on each allowed Journey instead of taking the union across all allowed decisions. A user with access to different visible Fields in different Journey contexts may receive only the last authorized Journey's field set.
- Seller List currently rejects requests without `journeyId` before authorization. The Phase 5 plan and V1 scope describe Journey as an optional filter alongside Status and owner for Seller List, so the current required `journeyId` appears to be an unapproved scope narrowing rather than a documented simplification.
- `PrismaPermissionRepository.getLeadScope` currently reads only the first active process instance for a Lead. That is risky for multi-Journey leads because scope decisions may be computed against the wrong Journey assignment set. Completing Phase 5 should review and, if needed, adjust permission scope lookup so Lead/Seller authorization is Journey/process-aware without forking permission rules in routes.
- The data model already contains the required tables and invariants for this task: `leads`, `process_instances`, `assignments`, `field_journey_settings`, `field_visibility`, `user_access_grants`, and `activity_logs`. No schema migration is expected unless implementation discovers a mismatch between the logical model and Prisma schema.

## Proposed approach
1. Keep this as a Phase 5 completion, not a new phase. Supersede the earlier Phase 5 plan content with this completion plan so implementation remains traceable to the approved Lead/Seller Core scope.
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
   - For Seller List without a Journey filter, do not silently implement until the open decision below is approved. If approved, authorization must be evaluated across the Journeys the requester's role can access, and the query must include only process memberships that satisfy both Journey access and data scope.
10. Review and fix `PrismaPermissionRepository.getLeadScope` if required for correct Journey-aware scope checks. The likely direction is to add process/Journey context to permission lookups or provide a repository method that returns assignments for the relevant Journey rather than the first arbitrary active process. Any permission-engine API change must include package-level tests and be kept provider-independent.
11. Keep API response shaping in `apps/api/src/routes/leads.ts`: authorization decisions remain in routes, validation/persistence remain in service/repository, and unauthorized dynamic Fields are stripped server-side before returning list/detail responses.
12. Update `docs/api/endpoints.md` after approval/implementation to document create/edit/list/detail request bodies, validation errors, permission stripping, pagination/count behavior, activity logging, and the exact Seller List all-Journeys decision.

## Files to touch
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

## Out of scope
- No UI/web implementation.
- No saved views, bulk reassign, bulk status change, export, dashboards, email, document upload, finance, import/migration, or 200k-record load-test implementation in this completion task.
- No workflow side-effect engine beyond the already planned required-field validation and lead-level activity logging.
- No hardcoded Journey, Status, Field, Role, Department, Service, assignment-type, or Wellsure/Cronberry values in application logic or tests.
- No real Wellsure seller data, real phone/email/GST values, secrets, tokens, plaintext credentials, or legacy `pass` field handling.
- No production dependency additions unless an implementation blocker is found and explicitly justified in the PR/diff.
- No schema migration unless the actual Prisma schema lacks a required invariant/table/column from the documented Lead/Seller model.

## Risks / open questions
- **Approval required: Should Seller List support an all-Journeys view when `journeyId` is omitted?** The docs describe Journey as an optional filter, while the current route requires it. Proposed default: support an all-Journeys aggregate Seller List, limited to Journeys the role can access and records within the requester's resolved data scope, because this matches V1 Seller List wording and avoids an undocumented scope narrowing. If this is approved, the implementation must prove count/list parity and field stripping across multiple Journey contexts. If rejected, update docs/API contract to state `journeyId` is required for V1.
- **Potential permission-engine contract gap:** The current lead-scope repository shape may not carry Journey/process context, and the Prisma implementation currently selects the first active process instance. If `resolveAuthorization` cannot correctly evaluate record scope for a specific Journey membership, Phase 5 must adjust the provider-independent permission contract rather than adding ad hoc route-side scope logic.
- **Seller 360 field visibility union:** This is not an open question; it is a confirmed correctness bug. Proposed fix is a union of visible Field IDs across authorized process instances, with unauthorized process instances omitted from the response.
- **Status-requiredness blocking behavior:** The prior Phase 5 plan proposed blocking status changes when the destination Status exactly matches a `requiredFromStatusId` and required values are missing. This remains the proposed default for implementation because it preserves data integrity; if product wants warnings instead, that should be approved and documented before implementation.
- **List performance:** Correct permission-scoped queries are the priority for this completion. Full 200k-record p95 validation remains a V1 quality gate, but this task should at least use index-friendly query shapes and avoid separate count/list predicates.
- **Integration fixture setup:** Creating enough synthetic configuration and role data for real-Postgres tests may require fixture helpers. Those helpers must remain synthetic and tenant-scoped, and should not encode Wellsure seed examples.

## Test plan
- Keep/update existing unit tests for validation and route behavior: explicit assignments, exact-match `requiredFromStatusId`, hidden/unassigned Field rejection, edit activity writes, list field stripping, Seller 360 authorization, and cross-organization isolation.
- Add a unit regression test for Seller 360 multi-Journey field visibility proving visible Field IDs are unioned across authorized process instances rather than overwritten by the last authorization decision.
- Add unit tests for Seller List request validation documenting the approved `journeyId` behavior. If all-Journeys is approved, test that omitted `journeyId` no longer returns validation error and still authorizes safely; if not approved, keep the validation error and update docs.
- Add real-Postgres integration tests for Lead creation through `PrismaLeadRepository`: Lead row, active process instance, current assignment rows, JSONB field values, and `activity_logs` row commit atomically.
- Add real-Postgres integration tests for Lead editing: core field updates, dynamic field merging, status changes, `field_edit` and `status_change` activity rows, and rollback/no partial writes on validation failure.
- Add real-Postgres integration tests for multi-Journey membership: one Lead in two active Journeys, no duplicate active membership for the same Journey, edits scoped to one process instance, and Seller 360 returns only authorized process contexts.
- Add real-Postgres Seller List integration tests for search, Journey filter, Status filter, current owner filter, sorting allow-list, pagination, count/list parity, permission-scoped rows, field stripping for every row, and cross-organization isolation.
- Add real-Postgres tests for permission interactions covering SELF, TEAM, DEPARTMENT, ORGANIZATION, and direct grants where supported by current fixtures, with synthetic users/roles and no business-name dependencies.
- Add or update permission-engine/prisma-permission tests if Journey-aware lead-scope behavior changes, including a regression where a multi-Journey Lead's first active process is not the one being authorized.
- Run required quality gates before final review: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, plus the real-Postgres integration command/path used by the repo. If Docker/Testcontainers or `FALCON_POSTGRES_URL` is unavailable, report that as an environment limitation rather than a pass.

## Rollback plan
- If no migration is needed, rollback is a normal code revert of the Phase 5 repository, route, service, test, and docs changes. Data created through the endpoints remains ordinary application data and must not be hard-deleted.
- If a schema migration is approved, include a matching rollback SQL file that reverses only newly added Phase 5 schema objects or constraints. If destructive rollback would affect lead/activity history, document a data-preserving rollback alternative instead.
- Before rollback in a persistent environment, disable Lead/Seller write endpoints, drain in-flight requests, take a database backup, and preserve existing `activity_logs` because Lead/Seller audit history is append-only.
