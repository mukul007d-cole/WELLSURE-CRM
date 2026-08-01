# Phase 7 Administration Management API Plan

## Goal

Implement the complete Phase 7 administration API: configuration read endpoints, user lifecycle management, coherent role and permission management across all four authorization axes, and department management, with organization isolation, permission-engine enforcement, atomic system auditing, and real-Postgres integration coverage.

## Docs read

* `AGENTS.md`
* `PLANS.md`
* `docs/requirements/source-of-truth.md`
* `docs/requirements/glossary.md`
* `docs/requirements/v1-scope.md`
* `docs/permissions/access-model.md`
* `docs/data-model/schema.md`
* `docs/data-model/prisma-translation-notes.md`
* `docs/planning/phase-1-backlog.md`
* `docs/planning/phase-2-identity-permission-engine-plan.md`
* `docs/planning/phase-3-custom-auth-and-api-wiring-plan.md`
* `docs/planning/phase-4-configuration-engine-api-plan.md`
* `docs/testing/quality-gates.md`
* `docs/architecture/decisions/0006-team-scope-from-hierarchy.md`
* `docs/architecture/decisions/0007-custom-session-auth.md`
* `docs/architecture/decisions/0008-http-framework.md`
* `apps/api/src/configuration/*`
* `apps/api/src/http/routes/configuration.ts`
* `apps/api/src/routes/configuration.ts`
* `apps/api/src/auth/password-reset.ts`
* `apps/api/src/auth/prisma-auth-repository.ts`
* `packages/permission-engine/src/types.ts`
* `packages/permission-engine/src/decision.ts`
* `apps/api/src/permissions/prisma-permission-repository.ts`
* `packages/database/prisma/schema.prisma`

## Current state

* Configuration HTTP routing contains POST/PUT/DELETE mutations only. It has no list or get-single endpoints.
* Journey, status, service, field, journey-service, field-journey-setting, and single-field visibility writes are implemented through `ConfigurationService` and `PrismaConfigurationRepository`.
* The existing field-visibility PUT route calls `upsertFieldVisibility`; new role-level visibility management must reuse this repository/service behavior or refactor it into a shared transactional replacement primitive.
* No API services or routes exist for users, roles, departments, role permissions, role journey access, or a permission catalog.
* Prisma already contains `User`, `Role`, `Department`, `RolePermission`, `RoleJourneyAccess`, and `FieldVisibility`; no parallel authorization tables are needed.
* `resolveAuthorization` reads `RolePermission`, `RoleJourneyAccess`, and `FieldVisibility` through `PermissionRepository`. Correct admin writes to those tables therefore become visible without a translation layer.
* Permission module/action identifiers are stored as strings and there is no exported canonical catalog. A catalog must become the single source used by API validation, seed/test setup, and the catalog endpoint.
* Users can have a null `passwordHash`. The existing password-reset flow creates hashed, expiring, one-use reset tokens, sends the opaque token by email, sets the password hash, revokes sessions, and audits completion.
* No secure first-admin bootstrap mechanism was found. Nullable configuration actor columns solve foreign-key insertion cycles but do not authorize or authenticate a first administrator.

## Proposed approach

### 1. Canonical permission catalog

Add an immutable, typed catalog in `packages/permission-engine`, exported through its public index. Define stable module/action identifiers matching `docs/permissions/access-model.md`:

* `leads`: `view`, `create`, `edit`, `delete`, `export`, `bulk_reassign`, `bulk_status_change`
* `fields`: `view`, `create`, `edit`, `delete`
* `journeys_statuses`: `view`, `create`, `edit`, `delete`
* `services`: `view`, `create`, `edit`
* `users`: `view`, `create`, `edit`, `deactivate`
* `roles_permissions`: `view`, `create`, `edit`
* `reports`: `view_standard`, `view_financial`, `build_custom`
* `attachments`: `upload`, `download`, `delete`
* `integrations`: `configure`

The access-model table does not currently name read permissions for configuration/admin lists. Add an ADR or documentation clarification before implementation to confirm the proposed `view` actions rather than silently overloading `edit`. The API catalog and mutation validators must import the same catalog; do not duplicate literals in route handlers.

Expose `GET /api/v1/permissions/catalog`. Require an authenticated, active user with `roles_permissions:view`. Return modules, display labels, valid actions, and supported scopes. Labels are product vocabulary, not role or organization seed data.

Reject unknown module/action pairs when replacing role permissions. Accept only the four `DataScope` values already defined by the permission engine.

### 2. Configuration read side

Extend `ConfigurationRepository` and `ConfigurationService` with tenant-scoped reads:

* `GET /api/v1/journeys`
* `GET /api/v1/journeys/:journeyId`
* `GET /api/v1/services`
* `GET /api/v1/services/:serviceId`
* `GET /api/v1/fields`
* `GET /api/v1/fields/:fieldId`

Journey responses include ordered statuses. Field responses include per-Journey `FieldJourneySetting` rows. Include active-state filtering with an explicit query option for inactive configuration, defaulting to active records.

Use stable pagination contracts for lists even where present data volumes are small: `page`, `pageSize`, `total`, and `items`, with bounded page size and deterministic ordering by creation time plus ID.

Enforce the catalog’s corresponding `view` permission through `resolveAuthorization`. Journey-specific reads must also enforce role journey access. List endpoints must return only accessible journeys; nested configuration must not disclose inaccessible Journey IDs.

Keep reads organization-scoped at the repository query. Do not fetch cross-organization rows and filter them in memory.

### 3. User management

Add an `admin/users` service and Prisma repository with routes:

* `POST /api/v1/users`
* `GET /api/v1/users`
* `GET /api/v1/users/:userId`
* `PUT /api/v1/users/:userId`
* `DELETE /api/v1/users/:userId` as semantic deactivation, or preferably `POST /api/v1/users/:userId/deactivate` if the project wants transport semantics to make the soft-delete behavior explicit

Support pagination and filters for `roleId`, `departmentId`, and `active`. Use normalized, organization-unique email addresses and deterministic ordering.

Creation accepts name, email, role ID, nullable department ID, and nullable manager ID. It creates an active user with `passwordHash: null`, then invokes a shared password-reset issuance helper to create and email the initial password token. Do not generate, return, log, or persist a plaintext initial password.

Refactor `apps/api/src/auth/password-reset.ts` only as necessary to expose a shared “issue reset for known user” operation. Preserve indistinguishable public reset-request responses while allowing the authenticated admin creation transaction to target the newly created user directly.

Validate that referenced role, department, and manager are active and belong to the same organization. Reject self-management and reporting cycles using a tenant-scoped, cycle-safe hierarchy check.

Editing supports name, email, role, department, and manager. Record old and new values in `system_audit_logs`. Never include password hashes or reset-token material in audit values.

Deactivation sets `active = false`, revokes all active sessions in the same transaction, and audits both the lifecycle change and revoked-session count. Add an invariant preventing an actor from deactivating the organization’s last active user capable of managing users/roles, unless an approved recovery mechanism exists.

Gate list/get with `users:view`, create with `users:create`, edit with `users:edit`, and deactivate with `users:deactivate`.

### 4. First-admin bootstrap

Treat bootstrap as unresolved rather than pretending Phase 1 already authorized it. Record and approve a narrow ADR before building the user endpoint.

Proposed default: implement an out-of-band, one-time CLI bootstrap command rather than an unauthenticated HTTP endpoint. The command must:

1. Require an explicit organization ID and administrator email/name.
2. Acquire a transaction-level lock for the organization.
3. Verify the organization contains zero users.
4. Create a synthetic-key initial role without special-casing its name.
5. Assign every entry from the canonical permission catalog at `ORGANIZATION` scope.
6. Grant access to all currently active Journeys.
7. Grant `EDIT` visibility for all currently active Fields.
8. Create the first user with `passwordHash: null`.
9. Issue an initial-password token through the shared password-reset mechanism.
10. Write bootstrap audit records with nullable actor identity and an explicit bootstrap action.
11. Fail permanently once any user exists in that organization.

Do not add a general permission bypass to normal HTTP handlers. If product requirements demand an HTTP bootstrap instead, stop for a separate security design covering bootstrap authentication, replay prevention, deployment-secret handling, and endpoint retirement.

### 5. Role CRUD and coherent four-axis representation

Add an `admin/roles` service/repository with:

* `POST /api/v1/roles`
* `GET /api/v1/roles`
* `GET /api/v1/roles/:roleId`
* `PUT /api/v1/roles/:roleId`
* role deactivation endpoint

Role detail returns the role plus all four configurable dimensions:

* feature permission rows with `module`, `action`, and `scope`
* accessible Journey IDs
* field visibility rows with `fieldId` and `accessLevel`
* role identity/lifecycle information

Role creation takes an immutable generic key and editable name. Do not infer behavior from either value.

Deactivation sets `active = false`; it must reject deactivation while active users reference the role unless they are reassigned atomically. Never hard-delete a role.

Use `roles_permissions:view/create/edit` decisions for role operations. Managing permissions is itself permission-gated; no role name receives implicit access.

Increment `Role.version` on every role, permission, journey-access, or field-visibility change so any present or future authorization cache key is invalidated. If no cache exists, the direct database read still reflects the mutation immediately.

### 6. Full role-permission replacement

Add:

* `GET /api/v1/roles/:roleId/permissions`
* `PUT /api/v1/roles/:roleId/permissions`

PUT accepts the complete desired set of unique `{module, action, scope}` entries. Validate every pair against the canonical catalog and every scope against `DataScope`.

Within one transaction:

1. Lock and load the tenant-scoped role.
2. Load and normalize its complete old permission set.
3. Validate the complete desired set before changing data.
4. Delete mapping rows absent from the new set.
5. Upsert desired rows.
6. Increment role version.
7. Write one `system_audit_logs` entry containing normalized full old and new sets.
8. Commit atomically.

Deleting obsolete mapping rows is revocation of a pure grant mapping, not deletion of a configuration entity. Preserve the audit snapshot.

Prevent callers from unintentionally removing their own ability to administer roles mid-request only if an approved lockout policy requires this; otherwise document the recovery path through the one-time bootstrap or an operations command.

### 7. Full role journey-access replacement

Add:

* `GET /api/v1/roles/:roleId/journey-access`
* `PUT /api/v1/roles/:roleId/journey-access`

PUT accepts the complete desired set of Journey IDs. Validate that all Journeys belong to the role’s organization. Replace `RoleJourneyAccess` rows atomically, increment role version, and audit normalized full old and new sets.

The absence of a row continues to mean no Journey access. Do not invent an “all journeys” sentinel, because every currently supported configuration must remain directly representable in the existing table.

### 8. Full field-visibility management

Add:

* `GET /api/v1/roles/:roleId/field-visibility`
* optionally `PUT /api/v1/roles/:roleId/field-visibility` for coherent full replacement

The GET response returns every existing allow-list row across Journeys as `{fieldId, accessLevel}` and may include Field/Journey metadata useful to a future UI. Absence means hidden; `EDIT` includes view.

Prefer adding full replacement PUT so all four role axes have coherent desired-state APIs. Implement it by extracting and reusing the validation and persistence logic underlying `ConfigurationService.upsertFieldVisibility`; retain the existing single-field PUT as a compatibility convenience rather than creating a second evaluator.

Validate all Field IDs in the role’s organization, replace rows atomically, increment role version, and audit the complete normalized old/new sets. Revoked rows may be physically deleted because `FieldVisibility` is a pure allow-list mapping and the audit record preserves the change.

### 9. Departments

Add:

* `POST /api/v1/departments`
* `GET /api/v1/departments`
* `GET /api/v1/departments/:departmentId`
* `PUT /api/v1/departments/:departmentId`

Use tenant-scoped immutable keys, editable names, active state, and version increments. Although the requested goal only says create/list/edit, add deactivation only after confirming its permission vocabulary and dependency behavior; do not hard-delete.

Because `docs/permissions/access-model.md` has no Department module, obtain a documentation decision before choosing authorization identifiers. Proposed default is to place Department administration under `users:create/edit/view`, because departments directly configure user scope. A distinct `departments` module is acceptable only if added consistently to the authoritative catalog and documentation.

Every mutation writes an atomic system audit record.

### 10. HTTP and validation contracts

Add route-level request/response schemas rather than using unrestricted `Record<string, unknown>` coercion for new endpoints. Return the project’s established error envelope for validation, forbidden, not-found, conflict, and pagination failures.

Centralize pagination parsing and bounds. Ensure repository interfaces return typed DTOs instead of generic `ConfigRow` values for the new read/admin domain.

All endpoints derive `organizationId` and actor ID from authenticated session context; never accept organization or actor IDs from request bodies.

### 11. Immediate enforcement correctness

Do not create a parallel in-memory permission representation. The admin repository must mutate the same Prisma tables read by `PrismaPermissionRepository`.

After a successful replacement, either avoid authorization caching or invalidate cache entries keyed by organization, role, and role version. Incrementing `Role.version` is mandatory for version-keyed caches and appears in `AuthorizationDecision`.

Add a real-Postgres HTTP integration test that:

1. Creates synthetic organizations, roles, users, Journey access, and lead data.
2. Gives an administrator permission to manage roles.
3. Gives a subject role no `leads:view`.
4. Authenticates the subject and verifies an existing leads route denies access.
5. Authenticates the administrator and replaces the subject role’s permission set through the new HTTP API, granting `leads:view` with an appropriate scope.
6. Reuses or renews the subject session and verifies the same existing leads route now allows access.
7. Removes the permission through the API and verifies denial returns immediately.
8. Confirms the permission engine and admin API used the same `role_permissions` rows and that both replacements were audited.

## Files to touch

Exact implementation file list:

* `docs/planning/phase-7-admin-management-api-plan.md`
* `docs/architecture/decisions/0009-admin-bootstrap-and-permission-catalog.md`
* `docs/permissions/access-model.md`
* `docs/api/endpoints.md`
* `packages/permission-engine/src/catalog.ts`
* `packages/permission-engine/src/index.ts`
* `packages/permission-engine/src/catalog.test.ts`
* `apps/api/src/admin/types.ts`
* `apps/api/src/admin/errors.ts`
* `apps/api/src/admin/validation.ts`
* `apps/api/src/admin/repository.ts`
* `apps/api/src/admin/prisma-admin-repository.ts`
* `apps/api/src/admin/service.ts`
* `apps/api/src/admin/bootstrap.ts`
* `apps/api/src/routes/admin.ts`
* `apps/api/src/http/routes/admin.ts`
* `apps/api/src/http/types.ts`
* `apps/api/src/http/build-server.ts`
* `apps/api/src/configuration/service.ts`
* `apps/api/src/configuration/prisma-configuration-repository.ts`
* `apps/api/src/routes/configuration.ts`
* `apps/api/src/http/routes/configuration.ts`
* `apps/api/src/auth/password-reset.ts`
* `apps/api/src/auth/prisma-auth-repository.ts`
* `apps/api/src/__tests__/admin.test.ts`
* `apps/api/src/__tests__/admin.integration.test.ts`
* `apps/api/src/__tests__/configuration.test.ts`
* `apps/api/src/__tests__/configuration.integration.test.ts`
* `apps/api/src/__tests__/http/admin-permission-change.postgres.e2e.test.ts`
* `apps/api/src/__tests__/fixtures/synthetic-admin.ts`
* `apps/api/package.json` only if a bootstrap CLI script must be registered

Do not change `packages/database/prisma/schema.prisma` or add a migration unless implementation uncovers a concrete schema blocker. The existing tables and constraints represent the required concepts.

## Out of scope

* Admin UI implementation.
* Multiple roles per user.
* Direct-record-grant administration.
* New identity providers, public signup, SSO, MFA, or JWT authentication.
* Wellsure-specific role, Journey, department, Field, or Status behavior.
* New permission tables or a parallel permission evaluator.
* Hard deletion of configuration entities, roles, users, or departments.
* Custom-report implementation; the catalog may expose its documented deferred action.
* Broad unauthenticated bootstrap or permission bypass behavior.
* Designation management unless separately approved.
* Database migrations unless a documented blocker is discovered.

## Risks / open questions

The approval gate resolved risks 1–5 and 9 as follows: the catalog's explicit
`view` actions are authoritative; Departments use the `users` module; bootstrap
is CLI-only; replacements must preserve at least one active permission
administrator; role deactivation rejects active users unless the request
atomically reassigns them; and transactional role row locking is the V1
concurrency mechanism without a client optimistic-lock token. ADR-0009 records
these decisions.

1. Configuration and administration read actions are absent from the current authoritative permission matrix. Approve explicit `view` actions before implementation.
2. Department administration has no named module/action in the access model. Approve whether it belongs under `users` or receives a dedicated catalog module.
3. Phase 1 did not provide a secure first-admin provisioning mechanism. Approve the proposed one-time out-of-band bootstrap command through an ADR.
4. Decide whether permission replacement may remove the acting administrator’s own management permission or whether a last-admin lockout guard is required.
5. Decide whether role deactivation must always reject active-user dependencies or may accept an atomic replacement role.
6. Initial-password email delivery must not cause a committed user with no usable invite unless retry behavior is defined. Prefer persisting the user and reset token atomically, then sending through an outbox or returning an auditable delivery failure that can be retried without recreating the user.
7. Existing password-reset audit entries use the target user as actor. Admin-issued initial password setup may need separate initiating-actor and subject-user semantics.
8. Reporting-cycle prevention is not enforced by the schema; updates need cycle-safe application validation under a transaction.
9. Permission replacement needs a concurrency strategy. Use row locking or optimistic role-version checks so simultaneous admin writes cannot silently overwrite each other.
10. Role version must change when any of the three mapping sets changes; otherwise future authorization caches can remain stale.
11. Confirm whether inactive Journeys/Fields remain in role configuration GET responses for historical reproducibility or are included only through an explicit filter.
12. API list response field filtering must not leak inaccessible Journey configuration or cross-organization identifiers.

## Test plan

Use synthetic role and business labels only.

### Unit and service tests

* Permission catalog contains every documented module/action pair and rejects duplicates.
* Catalog-derived validation accepts only real module/action pairs and valid scopes.
* Configuration list/detail permissions are enforced.
* Pagination bounds, deterministic ordering, and role/department/active filters work.
* User creation validates tenant-scoped role, department, and manager references.
* User creation issues a reset token without generating a plaintext password.
* User editing rejects cross-organization references and reporting cycles.
* Deactivation revokes sessions and writes audit data.
* Full permission, Journey access, and Field visibility replacements normalize order, reject duplicates/foreign IDs, increment role version, and audit complete old/new sets.
* Role/department updates and deactivations follow dependency and no-hard-delete rules.
* The existing single-field visibility endpoint and new full-set endpoint share validation/persistence behavior.

### Real-Postgres integration tests

* Configuration, users, roles, and departments list/get pagination.
* Filtering by role, department, and active state.
* Cross-organization isolation for every repository and HTTP operation.
* Authorization enforcement for all new endpoints using distinct synthetic admin and non-admin roles.
* A role may manage ordinary users without managing permissions when its catalog grants only the corresponding user actions.
* An unauthorized user cannot read or mutate role permissions.
* Full replacements write the exact expected `RolePermission`, `RoleJourneyAccess`, and `FieldVisibility` rows.
* Audit writes commit atomically with mutations and roll back when mutation validation or persistence fails.
* User initial-password token completion works through the existing password-reset path.
* User deactivation invalidates active sessions.
* Bootstrap succeeds once for an organization with zero users, provisions all four axes, and fails after the first user exists.
* Concurrent bootstrap attempts produce exactly one initial user.
* Concurrent role replacement is serialized or rejected by version conflict.
* Reporting hierarchy traversal remains tenant-scoped and cycle-safe.
* Permission replacement changes enforcement immediately through a real existing leads HTTP route, then changes it back on revocation.

### Quality gates

After implementation and with PostgreSQL/Testcontainers available, run and observe:

* `pnpm lint`
* `pnpm typecheck`
* `pnpm test`
* `pnpm build`

Do not claim performance or real-Postgres results unless those checks actually execute successfully in the implementation environment.

## Rollback plan

No schema change is expected. Roll back by reverting the Phase 7 application, package, test, API-documentation, and ADR commits together.

If a schema gap forces a migration, update this plan before implementation with the exact migration path, a matching rollback SQL script, deployment ordering, and data-restoration consequences. Permission mapping replacement must never require destructive configuration-table migration.
