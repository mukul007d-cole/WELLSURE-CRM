# Phase 8 Admin Frontend Plan

## Goal

Add the administration and configuration layer to the existing Falcon web app without creating a second application, design system, API client, or authorization model. Users will see and reach Journey/Status, Field, User/Department, and Role/Permission management surfaces only when their current effective grants allow the corresponding action. All mutations will continue to be authorized and audited by the API; UI gating is a usability layer, never the security boundary.

This phase also closes the identified self-capability gap: an authenticated user must be able to obtain their own effective feature permissions, Journey access, and Field visibility without being granted permission to inspect role configuration.

## Docs read

* `AGENTS.md`
* `docs/requirements/source-of-truth.md`
* `docs/requirements/glossary.md`
* `docs/requirements/v1-scope.md`
* `docs/permissions/access-model.md`
* `docs/data-model/schema.md`
* `docs/data-model/prisma-translation-notes.md`
* `docs/api/endpoints.md`
* `docs/testing/quality-gates.md`
* `docs/architecture/decisions/0007-custom-session-auth.md`
* `docs/architecture/decisions/0008-http-framework.md`
* `docs/architecture/decisions/0009-admin-bootstrap-and-permission-catalog.md`
* `docs/planning/phase-7-admin-management-api-plan.md`
* The existing auth, permission, administration, configuration, HTTP-route, and repository code under `apps/api/src/`
* The canonical permission catalog and permission types under `packages/permission-engine/src/`
* The existing React application, auth context, protected routes, layout, UI primitives, API client, domain types, MSW handlers/fixtures, tests, and theme under `apps/web/src/`

## Current state

### Frontend

* `apps/web` is a React 19/Vite application using React Router, TanStack Query, React Hook Form/Zod, Tailwind theme tokens, a shared `api-client.ts`, and cookie sessions with `credentials: 'include'`.
* `AuthProvider` calls `GET /api/v1/auth/me` after startup and login. `ProtectedRoute` distinguishes authenticated from unauthenticated users, but there is no permission-aware route guard or capability helper.
* `SessionUser` contains identity, `roleId`, and display-only `roleName`. It has no grants. The top bar may continue displaying `roleName`, but authorization must never derive from it.
* The sidebar currently links only to Sellers; Settings is a disabled “coming soon” item. No administration screens or administration API functions/types exist.
* The reusable visual primitives cover buttons, cards, fields, inputs, selects, checkboxes, banners, pagination, loading, and empty states. Admin screens should extend these established primitives only where a missing interaction requires it (for example, a dialog or table action menu).
* Existing tests use Vitest, Testing Library, and global MSW handlers. Mock authorization currently models lead data scope and restricted fields, but the synthetic users are named after business roles and do not expose feature permission grants.

### Backend and contracts

* Phase 7 exposes authenticated CRUD/list routes for Users, Roles, role permission axes, Departments, and the permission catalog. Lists use `{ page, pageSize, total, items }`; role-axis PUT requests are complete desired-state replacements.
* Department operations deliberately use `users:view/create/edit`. There is no Department permission module.
* The permission catalog is canonical in `packages/permission-engine/src/catalog.ts`; the frontend must fetch it rather than reproduce the module/action matrix.
* `/api/v1/auth/me` returns the authenticated user snapshot (including `roleId` and optional display values), but not resolved grants. The role configuration reads are correctly protected by `roles_permissions:view`, so they cannot serve as a self-capability API.
* Configuration service/repository methods already implement and audit Journey/Status/Field edits and Field–Journey setting upserts. However, the Fastify transport currently binds only configuration list/detail reads, Journey/Status/Field creation, Status/Field deactivation, service mappings, and single Field visibility. It does **not** bind Journey edit/deactivation, Status edit, Field edit, or Field–Journey setting read/write routes. `docs/api/endpoints.md` documents several of these as existing, so the documented contract, implementation, and Phase 8 scope are currently inconsistent.
* The current configuration list/detail DTOs use backend field names such as `name`, `fieldType`, `validationRule`, `editMode`, and `source`, while the existing lead UI's mock-oriented domain types use `label`, `type`, and top-level `options`. The admin client needs exact API DTOs plus explicit mapping into lead-form view models; it must not assume the older mock shape is the Phase 7 HTTP contract.
* The backend treats `fieldType` as a configurable string and `validationRule` as JSON. There is no documented, validated contract specifying which field types support an `options` array or where options live. The requested Field “type/options” editor therefore has an unresolved contract.
* User creation persists no password and invokes the reset-token email flow. Role deactivation may require `replacementRoleId` when active users depend on the role. Neither behavior should be emulated client-side.

## Proposed approach

### 1. Approve and document the self-capability contract first

Add an authenticated, always-available `GET /api/v1/auth/capabilities` endpoint rather than expanding `/auth/me`.

Proposed response:

```json
{
  "permissions": [
    { "module": "users", "action": "view", "scope": "ORGANIZATION" }
  ],
  "journeyIds": ["synthetic-journey-id"],
  "fieldVisibility": [
    { "fieldId": "synthetic-field-id", "accessLevel": "EDIT" }
  ]
}
```

The endpoint will:

* require only a valid active session, not `roles_permissions:view`;
* derive organization, user, and role from the authenticated context;
* read the same role permission, role Journey access, and Field visibility rows used by the permission engine, with deterministic ordering;
* return only the caller's own role grants and never accept a role/user/organization identifier;
* return raw effective grant tuples, not booleans tied to screens or role labels;
* remain non-authoritative for mutation security—every administration endpoint still performs its existing server-side authorization;
* avoid data-scope expansion or record IDs: `scope` communicates the granted ceiling, while actual record access remains an API decision;
* receive an API contract test proving an ordinary authenticated user without `roles_permissions:view` can read only their own capabilities, plus a test that anonymous/inactive/revoked sessions cannot.

Keep `/auth/me` focused on identity/profile data and fetch the capability resource through the auth context in parallel after authentication. This separation prevents profile contract churn and makes capability cache invalidation/refetch explicit after a role-axis save. Update `docs/api/endpoints.md` with the new response and security semantics. No schema or production dependency is required.

### 2. Resolve the configuration transport gaps as contract completion

Subject to approval of the open questions below, bind the already-implemented configuration service operations through thin authenticated HTTP routes and document their exact request/response schemas:

* `PATCH /api/v1/journeys/:journeyId` for name changes;
* `DELETE /api/v1/journeys/:journeyId` for semantic deactivation;
* `PATCH /api/v1/statuses/:statusId` for name, outcome/behavior, and ordering changes (including the Journey context needed by authorization);
* `PATCH /api/v1/fields/:fieldId` for editable Field definition properties;
* `GET /api/v1/journeys/:journeyId/fields` for the Journey's Field catalog/settings view;
* `PUT /api/v1/journeys/:journeyId/fields/:fieldId` to upsert the complete setting for that Field/Journey pair (`requirement`, nullable `requiredFromStatusId`);
* a documented unmap/deactivate operation only if the existing setting-deactivation behavior is required to represent “not attached”; do not overload `hidden`, because hidden is a configured attachment state.

These adapters will call the existing configuration service/repository transaction and audit paths, enforce the relevant `journeys_statuses:*` or `fields:*` permission and Journey access, add request/response schemas, and receive HTTP contract tests. They do not add a parallel business service. If approval instead keeps backend work strictly limited to `/auth/capabilities`, Journey/Status/Field edit and attachment features must be removed from the Phase 8 acceptance scope rather than mocked as if deployable.

Before Field UI implementation, document and validate a generic Field definition contract: supported engine-level input controls, the location/shape of select options (proposed default: `validationRule.options: string[]` for `fieldType = "select"`), and how unknown future field types are displayed safely. The UI will render the API-provided current value and will not encode any business Field key/name.

### 3. Add typed admin API modules without replacing the shared client

Extend `apps/web/src/types/domain.ts` with exact DTOs for capability data, paginated configuration/admin lists, role axes, permission catalog entries, and write bodies. Extend `apps/web/src/lib/api-client.ts` (or small domain modules imported by it if size warrants) using its existing `request()` function, cookies, query serialization, and flat API errors.

Use stable query keys by resource and filter. Invalidate the affected list/detail queries after mutations. Role-axis editors keep local draft state and issue exactly one complete-array PUT on Save; toggling a checkbox never calls the API.

### 4. Build reusable capability gating

Enhance `AuthProvider` to load identity and capabilities as one authenticated bootstrap state. Provide helpers such as `can(module, action)` that match exact module/action grants; `roleName` remains presentation only. A capability-load failure must not optimistically expose admin navigation or routes.

Add a `PermissionRoute` wrapper layered beneath `ProtectedRoute`. Direct navigation without the required `*:view` grant redirects to the first permitted safe route (proposed default `/sellers`) with an accessible forbidden notice/state. Sidebar groups and action buttons are generated from capability predicates:

* Journey screens: `journeys_statuses:view`; create/edit/deactivate controls require their exact actions.
* Field catalog: `fields:view`; controls require `fields:create/edit/delete`.
* Users and Departments: `users:view`; controls require `users:create/edit/deactivate` as appropriate. Department create/edit follows ADR-0009 (`users:create/edit`).
* Roles: `roles_permissions:view`; controls require `roles_permissions:create/edit`.

Journey allow-list and Field visibility are displayed/edited only inside role management after the caller passes the feature gate. They do not grant access to administration screens by themselves. API 403 responses remain handled even if capability data is stale.

### 5. Add administration routes and navigation in the existing shell

Replace the disabled Settings placeholder with a permission-filtered Administration group. Add nested routes under `/admin` while keeping Seller routes unchanged:

* `/admin/journeys` and `/admin/journeys/:journeyId`;
* `/admin/fields`;
* `/admin/users`;
* `/admin/roles` and `/admin/roles/:roleId`;
* `/admin/departments`.

The group is absent if the user has none of the relevant view grants. Each route is independently guarded so hiding navigation is not treated as access control.

### 6. Journey and Status management

Build a paginated Journey list with active filtering, create/edit/deactivate actions, and dependency-conflict messaging. Journey detail loads the Journey, ordered Statuses, and Field–Journey settings.

Status create/edit forms use engine enums (`outcomeType`, `behaviorType`) and numeric ordering from the API contract, not named statuses. Reordering edits explicit `sortOrder` values and saves through the status edit contract. Deactivation presents the API's dependency conflict and, where needed, an active replacement Status selected by ID from the same Journey.

The Fields section lists the Field catalog by ID and allows attach/update/unmap of the Journey setting. Required-from-Status choices come from that Journey's returned Statuses. It treats `required`, `optional`, and `hidden` as engine configuration values, never Field names.

### 7. Field catalog

Build a paginated Field definition list and create/edit/deactivate forms using the approved Field contract. Stable keys are accepted on creation and shown read-only thereafter. Type-specific settings (including select options after contract approval), validation, section, edit mode, and source are generic configuration values. Deactivation conflicts from attached Journey/visibility mappings are shown without destructive workarounds.

### 8. Users and Departments

Build a server-paginated User list with role, department, and active filters populated from real list APIs. Create/edit forms use active Role, Department, and manager records by ID. Creation copy explicitly states that an invite/password-reset email is sent; no password input, generated password, token, or credential appears in UI state, fixtures, requests, logs, or tests.

User deactivation requires confirmation, calls the semantic deactivate endpoint, and reflects session revocation/conflict errors. Editing honors server validation for hierarchy cycles and tenant-scoped references.

Build a lightweight Department list with create/edit flows. Do not add a Department role check or delete flow. Stable keys are create-only.

### 9. Roles and all three configurable axes

Build Role list/create/edit/deactivate flows. If a role has active users, the deactivate dialog loads active replacement roles and submits `replacementRoleId`; it never hard-deletes.

Role detail uses separate draft panels:

* **Feature permissions:** render modules/actions and display labels from `GET /permissions/catalog`. For each selected module/action, select one API-supported scope. Save the normalized complete `permissions` array with one PUT.
* **Journey access:** render real Journeys fetched from the API, select IDs, then save the complete `journeyIds` array with one PUT. Do not invent an “all Journeys” sentinel.
* **Field visibility:** render real Fields and choose hidden (absence), `VIEW`, or `EDIT`, then save the complete non-hidden `fieldVisibility` array with one PUT.

Each panel has dirty-state indication, Save/Reset controls, loading/error/success feedback, and a warning that saving replaces the complete configured set. After a successful save, invalidate role detail/axis queries and the current user's capability query in case they edited their own role. Last-permission-administrator conflicts are surfaced from the API.

### 10. Accessibility, responsive behavior, and error states

Use semantic headings, labelled form controls, native tables with mobile alternatives, keyboard-operable dialogs, focus placement/restoration, confirmation text, live success/error feedback, loading skeletons, and empty states consistent with the current app. Preserve the existing ink/gold/paper theme and reduced-motion behavior. Do not add a production UI dependency unless a concrete accessibility gap cannot be met with the current stack and approval explains the dependency.

### 11. MSW and integration-style frontend tests

Expand MSW fixtures with synthetic users, roles, departments, permission catalog entries, grants, Journey settings, and mutation handlers matching the real HTTP DTOs. Authorization behavior is driven by permission tuples, Journey IDs, scopes, and Field visibility—not role names. Existing named demo fixtures will be migrated to neutral synthetic role labels where they participate in authorization assertions.

Use route-level integration tests with `AuthProvider`, the real router, TanStack Query, real page components, and MSW network handlers. Cover:

* a user without `roles_permissions:view` cannot see Roles navigation and direct navigation redirects; a user with the grant can reach the page;
* the same denied/allowed pattern independently for `users:view`;
* action-level controls (for example view without edit) are absent/disabled and no mutation request is issued;
* Journey list/create/edit/deactivate, Status create/edit/reorder/deactivate, and Journey Field setting attach/edit/unmap;
* Field list/create/edit/deactivate and type/options validation;
* User pagination/filter/create/edit/deactivate with no password field/body;
* Department list/create/edit;
* Role list/create/edit/deactivate and all three full-replacement panels, including proof that local toggles make no network request before Save and Save sends the complete desired state;
* API errors, empty states, loading states, and stale-capability 403 handling;
* a fixture/static assertion that authorization helpers and tests do not branch on a role name.

Add backend unit/HTTP tests for `/auth/capabilities` and any approved configuration route bindings. Continue to rely on backend integration coverage for authoritative permission enforcement and audit transactions; frontend MSW tests verify UX and contract usage, not security.

## Files to touch

The exact frontend component split may be refined during implementation, but changes are constrained to these areas.

### Documentation

* `docs/planning/phase-8-admin-frontend-plan.md`
* `docs/api/endpoints.md`
* A focused Field-definition contract document or the existing configuration API section, if the Field options decision is approved

### Self-capability backend

* `apps/api/src/routes/auth.ts`
* `apps/api/src/http/routes/auth.ts`
* `apps/api/src/auth/session.ts` and/or a focused capability repository/service module
* `apps/api/src/auth/prisma-auth-repository.ts` or `apps/api/src/permissions/prisma-permission-repository.ts`, reusing the existing permission data boundary rather than adding a parallel representation
* `apps/api/src/__tests__/auth.test.ts`
* `apps/api/src/__tests__/http/auth-http.test.ts`
* Relevant real-Postgres auth/permission integration test files if the existing harness supports this query

### Approved configuration transport completion

* `apps/api/src/routes/configuration.ts`
* `apps/api/src/http/routes/configuration.ts`
* `apps/api/src/configuration/service.ts`
* `apps/api/src/configuration/prisma-configuration-repository.ts` only where an existing read/unmap method must be exposed
* `apps/api/src/__tests__/configuration.test.ts`
* `apps/api/src/__tests__/configuration.integration.test.ts`
* `apps/api/src/__tests__/http/configuration-http.test.ts`

### Frontend application

* `apps/web/src/App.tsx`
* `apps/web/src/app/AuthContext.tsx`
* `apps/web/src/app/PermissionRoute.tsx`
* `apps/web/src/components/layout/Sidebar.tsx`
* Existing `apps/web/src/components/ui/*` only when extending the established system
* `apps/web/src/lib/api-client.ts`
* `apps/web/src/lib/permissions.ts`
* `apps/web/src/types/domain.ts`
* New page/component files under `apps/web/src/pages/admin/`
* New co-located `*.test.tsx` files for admin pages, routing, and capability helpers
* `apps/web/src/mocks/fixtures.ts`
* `apps/web/src/mocks/handlers.ts`
* `apps/web/src/mocks/permissions.ts`

No Prisma schema/migration, new production package, or unrelated Seller/Lead redesign is planned.

## Out of scope

* Rebuilding or redesigning Seller List, Seller 360, or the dynamic Lead form except for narrowly required contract/type compatibility.
* Treating admin as a named role, seeding a privileged role name, or introducing role-name checks.
* Client-side security enforcement or duplicating the backend permission evaluator.
* Multiple roles per user, direct-record-grant administration, designation management, service administration, custom reports, or reporting hierarchy visualization.
* Public signup, plaintext/generated passwords, showing reset tokens, or changing the invite/reset business flow.
* Incremental per-checkbox role-axis writes or an “all Journeys” pseudo-grant.
* Hard deletion of Users, Roles, Departments, Journeys, Statuses, or Fields.
* New backend business rules beyond the self-capability read and approved transport/contract completion needed to expose already-implemented configuration behavior.

## Risks / open questions

Approved on 2026-08-01. The following defaults are binding implementation decisions:

1. **Self-capability shape:** approve `GET /auth/capabilities` as a separate always-available authenticated resource with the three arrays above. Proposed default: keep `/auth/me` unchanged and fetch both resources during auth bootstrap.
2. **Missing configuration HTTP routes:** the requested Journey/Status/Field edit and Field attachment flows cannot use the current running API even though several routes are documented. Proposed default: include thin route binding, schemas, docs correction, and tests in Phase 8 because the underlying audited business methods already exist. If rejected, those UI flows must be deferred explicitly.
3. **Field options contract:** no authoritative API rule currently defines supported Field types or select options. Proposed default: decision-gate a generic supported-control list and store select choices in `validationRule.options`; do not infer it silently from the old MSW `options` property.
4. **Field–Journey unmapping:** the repository can deactivate a mapping, but no transport contract exists and “hidden” is semantically different from unattached. Proposed default: document and bind an explicit semantic unmap/deactivate route rather than treating hidden as deletion.
5. **Status ordering write semantics:** no bulk ordering endpoint exists. Proposed default: submit audited Status edits sequentially only if partial completion is acceptable; preferred alternative is a small transactional full-order endpoint. Approval should select one before drag/drop or multi-row ordering is implemented.
6. **Permission-route denial UX:** proposed default redirects unauthorized direct navigation to `/sellers` with a transient accessible forbidden notice. A dedicated 403 page is an acceptable alternative.
7. **Department inactive filtering:** the backend query parser currently recognizes boolean values but raw HTTP query strings arrive as strings, so `?active=false` may not filter Admin lists as intended. Proposed default: fix shared parsing and cover it with HTTP tests rather than compensate in the frontend.
8. **Role/User reference list size:** admin selectors need all active roles/departments/managers, while list endpoints cap pages at 100. Proposed default: paginated searchable selectors that can fetch subsequent pages, not an assumption that the organization stays below 100 records.
9. **Mock data naming:** current dev fixtures contain realistic role labels and credentials. Proposed default: replace authorization-relevant role fixtures with neutral synthetic labels and tuple grants in the Phase 8 changes; retain business examples only where they are plainly display seed data and never branching inputs.

## Test plan

After implementation and dependency setup, run:

* `pnpm --filter @falcon/web test`
* `pnpm --filter @falcon/web lint`
* `pnpm --filter @falcon/web typecheck`
* `pnpm --filter @falcon/web build`
* targeted API unit and HTTP tests for self-capabilities and approved configuration bindings
* targeted real-Postgres integration tests where the repository harness is available
* `pnpm lint`
* `pnpm typecheck`
* `pnpm test`
* `pnpm build`

Manually verify at desktop and mobile widths with at least two synthetic grant sets. Capture screenshots of the perceptible web changes after implementation. Run an accessibility pass covering keyboard navigation, focus management, labels, dialogs, status messages, and reduced motion. Do not claim a real-Postgres, browser, accessibility, or performance result unless it actually ran.

## Rollback plan

No database migration is planned. Roll back by reverting the Phase 8 backend contract, frontend, mock, test, and documentation commits together. The new capability endpoint is additive; removing it together with the frontend consumer restores the prior auth contract. Configuration transport bindings call existing service operations and can be removed without data conversion.

Any configuration changes made by administrators before rollback remain valid database configuration and audit history; rollback must never delete or rewrite them. If implementation discovers a schema change is unavoidable, stop and amend this plan with a reversible migration and explicit deployment/rollback ordering before proceeding.
