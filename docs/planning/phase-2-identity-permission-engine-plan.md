## Goal
Deliver the Phase 2 provider-independent permission engine plan for Falcon CRM: resolve role, journey, hierarchy data-scope, direct-grant, and field-level authorization contracts without implementing login, sessions, provider SDKs, or provider-specific identity storage while OD-001 remains open.

## Docs read
- `docs/requirements/source-of-truth.md`
- `docs/requirements/glossary.md`
- `docs/requirements/v1-scope.md`
- `docs/requirements/open-decisions.md`
- `docs/architecture/decisions/0001-single-status-field.md`
- `docs/architecture/decisions/0002-gst-one-to-one-marketplace-account.md`
- `docs/architecture/decisions/0003-finance-scope-v1.md`
- `docs/architecture/decisions/0004-migration-dedup-priority.md`
- `docs/architecture/decisions/0005-auth-provider-deferred.md`
- `docs/architecture/decisions/0006-team-scope-from-hierarchy.md`
- `docs/permissions/access-model.md`
- `docs/permissions/permission-engine-schema.md`
- `docs/data-model/schema.md`
- `docs/data-model/prisma-translation-notes.md`
- `docs/planning/phase-1-backlog.md`
- `docs/testing/quality-gates.md`
- `PLANS.md`

## Current state
- Phase 1 has established the permission-engine workspace shell at `packages/permission-engine`, but it currently only exports a stable workspace name and has no authorization behavior.
- The provider-independent authorization schema already exists in `packages/database/prisma/schema.prisma`, including `User`, `Role`, `RolePermission`, `RoleJourneyAccess`, `Field`, `FieldVisibility`, `UserAccessGrant`, `Department`, `ProcessInstance`, `Assignment`, `Lead`, and `SystemAuditLog` models.
- `users` intentionally has authorization/profile fields only; it does not include passwords, provider subjects, sessions, JWT helpers, or Cognito/Keycloak-specific columns because OD-001 / ADR-0005 is unresolved.
- The schema represents one active role per user through required `role_id`; direct exceptions are modeled through `user_access_grants`, not through additional roles.
- `TEAM` scope has an accepted definition from ADR-0006: the requesting user plus all active recursive downstream reports through `users.manager_id`; `DEPARTMENT` is all active users sharing the requester’s `department_id`; no Team table exists.
- Current database notes require hierarchy queries to be tenant-scoped and cycle-safe, field permissions to be allow-list based, and count/list/export/bulk paths to use the same permission-filtered predicates.
- Configuration and security-relevant mutations must be audited through `system_audit_logs`; lead-level mutations use `activity_logs`. Both log tables are append-only at the database layer.
- Phase 1 backlog confirms foundations are intended to provide real-Postgres/Testcontainers hooks and quality gates, but no CRM feature, permission decision, audit behavior, or performance claim should be treated as implemented merely because the harness exists.

## Proposed approach
1. Define the `packages/permission-engine` public contract around authorization inputs and outputs, not authentication:
   - Input identity is an already-resolved Falcon `userId` + `organizationId` supplied by a future API/auth boundary.
   - The engine never validates passwords, parses sessions, verifies JWTs, calls Cognito/Keycloak, or stores provider identities.
   - Output is an authorization decision and reusable enforcement metadata: allowed/denied, denial reason, effective `DataScope`, journey allow/deny, record predicate fragments, field visibility/editability sets, a `workflowCheck` placeholder typed as not enforced, and audit/cache invalidation hints.
2. Implement feature/action permission resolution from `role_permissions`:
   - Treat `module` and `action` as configurable/string-backed permission vocabulary, not role-name or journey-name logic.
   - Require active user and active role before any allow decision.
   - Resolve exactly one effective scope for `(organization_id, role_id, module, action)` using the existing unique constraint.
3. Implement journey access resolution from `role_journey_access`:
   - Require an explicit row for the role and target journey.
   - Deny access to inactive journeys unless later journey-builder requirements explicitly define historical visibility behavior.
   - Do not special-case seed journeys or Wellsure example names.
4. Implement scope expansion and record predicates:
   - `SELF`: current assignments for the applicable process instance assignment rule; because assignment types are configurable, expose a caller-supplied assignment-rule parameter rather than hardcoding assignment-type strings.
   - `TEAM`: tenant-scoped recursive traversal from the requesting user through active reports via `users.manager_id`, including the requester, with cycle protection.
   - `DEPARTMENT`: active users in the requester’s organization with the same non-null `department_id`; users without a department should not receive department-wide expansion unless a later ADR says otherwise.
   - `ORGANIZATION`: all records within `organization_id`.
   - Provide one shared predicate-building path for list/detail/count/saved-view/bulk/export/reporting callers so count/list parity is testable.
5. Implement direct-record grant handling through `user_access_grants`:
   - Treat an active, non-revoked, non-expired grant as additive to the record-scope axis only.
   - Do not let a grant bypass active-user, feature/action, journey, field, workflow, or tenant checks.
   - Surface grant provenance in the decision result for audit/debug traces without leaking unrelated grants.
6. Implement field-level enforcement helpers for API callers:
   - Resolve `field_visibility` rows for the active role and requested fields.
   - Absence of a row means hidden; `EDIT` implies `VIEW`; `VIEW` does not imply `EDIT`.
   - Return `visibleFieldIds`, `editableFieldIds`, `strippedFieldIds`, and mutation rejection details. The API layer remains responsible for actually stripping response data and rejecting forbidden writes.
7. Define audit hook points without building provider-specific auth or full admin APIs:
   - Role create/edit/deactivate, permission-row replacement, journey-access changes, field-visibility changes, user role changes, user activation/deactivation, hierarchy/department changes affecting scope, and direct grant create/revoke/expiry operations must call a system-audit writer in the same transaction as the mutation.
   - The permission engine should expose typed audit-event payload shapes or callback interfaces for future admin/API services; actual route handlers and provider identity actors remain outside this task.
8. Define cache/invalidation boundaries conservatively:
   - Cache keys, if any, must include `organizationId`, `userId`, `roleId`, role `version`, and grant/user hierarchy freshness markers.
   - Prefer correctness-first uncached queries for initial implementation; any cache must fail closed and be invalidated by the audit/mutation hooks above.
9. Preserve provider neutrality and configurability throughout:
   - No password fields, sessions, JWT helpers, provider-subject columns, Cognito/Keycloak SDKs, or custom-auth scaffolding.
   - No hardcoded Wellsure role names, journey names, department names, field names, status names, module labels derived from examples, or Cronberry values in application logic or tests.

## Files to touch
- `packages/permission-engine/src/index.ts`
- `packages/permission-engine/src/index.test.ts`
- `packages/permission-engine/src/types.ts`
- `packages/permission-engine/src/decision.ts`
- `packages/permission-engine/src/fields.ts`
- `packages/permission-engine/src/scope.ts`
- `packages/permission-engine/src/grants.ts`
- `packages/permission-engine/src/audit-hooks.ts`
- `packages/permission-engine/src/__tests__/permission-matrix.test.ts`
- `packages/permission-engine/src/__tests__/field-visibility.test.ts`
- `packages/permission-engine/src/__tests__/direct-grants.test.ts`
- `packages/permission-engine/src/__tests__/scope.integration.test.ts`
- `packages/permission-engine/package.json`
- `packages/database/prisma/schema.prisma` only if implementation discovers a documented schema/constraint gap that blocks the accepted permission model; otherwise do not touch it.
- `packages/database/prisma/migrations/<timestamp>_permission_engine_gap/` only if the previous schema file changes; otherwise do not create a migration.
- `docs/permissions/access-model.md` only if the implemented API contract needs clarification that does not alter accepted semantics.
- `docs/permissions/permission-engine-schema.md` only if a documented schema gap is confirmed.
- `docs/architecture/decisions/<new-adr>.md` only if an actual conflict or product/schema decision is discovered; stop for approval before implementing the disputed behavior.

## Out of scope
- Authentication-provider selection or resolution of OD-001 / ADR-0005.
- Login, logout, password reset, password storage, plaintext credential handling, session tables, refresh tokens, JWT helpers, middleware that validates provider tokens, Cognito integration, Keycloak integration, or custom-auth scaffolding.
- Provider-specific identity columns on `users` or new provider-specific identity tables.
- UI implementation for role management, user management, field builder, journey builder, Seller List, Seller 360, dashboards, or exports.
- API route implementation and actual response stripping; this phase defines and tests the engine contract the API will call.
- Workflow/status-transition enforcement beyond exposing a placeholder contract boundary for a future workflow engine check.
- Seed data for Wellsure roles, journeys, departments, statuses, fields, or Cronberry examples.
- A Team or TeamMembership model; ADR-0006 defines team scope from the reporting hierarchy.
- Production dependency additions unless a later approved implementation plan amendment explains why.
- Performance claims for Seller List/search at 200,000 records; Phase 2 can test predicate correctness and query shape but not claim end-to-end product performance before API endpoints exist.

## Risks / open questions
- OD-001 is internally inconsistent with phase naming: `open-decisions.md` says authentication provider is “blocking before Phase 2 Identity & Permission Engine begins,” while the same entry and ADR-0005 allow Falcon’s provider-independent authorization tables to be designed and tested before provider choice. This plan resolves that only by scoping Phase 2 to provider-independent permission engine work and explicitly excluding identity-provider/login/session work; if stakeholders intend “Identity” to include authentication, work must stop until OD-001 is accepted.
- `SELF` scope depends on the “applicable assignment rule,” but assignment types are configurable strings and there is no fixed assignment-type table. The implementation should require callers to provide the assignment rule or module context; if Wellsure wants a default owner semantics, that needs a documented decision rather than hardcoded strings.
- Users may have nullable `department_id` and `manager_id`; the conservative behavior proposed here is no department expansion when `department_id` is null and only self when no reports exist. Any broader behavior needs approval.
- Recursive manager traversal must be cycle-safe. The database currently indexes `users(organization_id, manager_id)` but does not document a trigger preventing reporting cycles, so the query must protect itself and integration tests must cover cycles.
- Direct grant expiry is time-dependent. Tests need deterministic clocks or database-controlled timestamps to avoid flaky active/expired grant assertions.
- The permission engine can define audit hook payloads, but the actual guarantee that audit rows commit atomically with admin mutations depends on future API/admin services using the hooks correctly.
- The module/action vocabulary is stored as strings. That preserves configurability but means tests must use synthetic stable fixture keys rather than implying a finite enum of business permissions.
- If implementation discovers that existing Prisma compound relations or indexes are insufficient for performant/correct permission predicates, any schema change requires a reversible migration or documented rollback path and may require a separate approval.
- No raw Cronberry data is needed for this phase. Test fixtures must be synthetic and must not reuse real Wellsure personal data, plaintext credentials, or legacy `pass` values.

## Test plan
- Add table-driven permission-matrix unit tests covering the relevant role × module × action × scope combinations using synthetic role/module/action/journey/field keys, not Wellsure seed names.
- Add unit tests for deny precedence: inactive user, inactive role, missing feature/action permission, missing journey allow-list row, missing field-visibility row, `VIEW` without `EDIT`, cross-organization references, and workflow-boundary denial stubs.
- Add field-level tests confirming absence means hidden, `EDIT` implies `VIEW`, response-stripping metadata identifies fields to remove, and mutation metadata rejects writes to non-editable fields.
- Add direct-grant tests confirming grants expand only record scope and do not bypass feature/action, journey, field, workflow, tenant, or active-user checks; include expired and revoked grants.
- Add real-Postgres Testcontainers integration tests for hierarchy/scope query behavior, including `SELF`, recursive `TEAM` at multiple depths, `DEPARTMENT`, `ORGANIZATION`, inactive users, users with null departments, cycle-safe traversal, cross-organization isolation, and active direct-grant predicates.
- Add count/list predicate parity tests at the query-helper level so the same permission-filtered relation is used for both paths.
- Add bulk/export contract tests showing every selected record is rechecked and export field metadata includes only permitted rows and permitted fields.
- Add audit-hook contract tests that role/permission/journey-access/field-visibility/user-scope/direct-grant mutation payloads include actor, organization, entity type/id, action, old value, and new value needed for `system_audit_logs`.
- Run the repository quality gates required by `docs/testing/quality-gates.md`: formatting, lint, typecheck, tests, and build from the root after implementation approval.
- Test data must be entirely synthetic, organization-scoped, and generated in fixtures; it must not collide with or depend on real Cronberry/Wellsure data, seed labels, credentials, phone numbers, emails, GST values, or the legacy `pass` field.

## Rollback plan
- Preferred Phase 2 implementation should be package-only and require no schema migration; rollback is reverting the permission-engine package changes and any documentation clarifications.
- If a schema gap is approved and a migration is added, include a matching rollback SQL file that drops only the newly introduced indexes/constraints/tables in reverse dependency order and document any data-preserving alternative if a destructive rollback would be unsafe.
- Keep provider-specific auth artifacts out of the diff so rollback never needs to remove credentials, sessions, provider subjects, SDK setup, or secret-bearing configuration.
- Because this plan pass does not implement application code or schema changes, rollback for this commit is simply reverting `docs/planning/phase-2-identity-permission-engine-plan.md`.
