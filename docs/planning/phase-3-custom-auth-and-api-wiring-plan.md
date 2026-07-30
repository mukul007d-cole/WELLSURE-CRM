# Phase 3 Plan — Custom Auth + API Permission-Engine Wiring

## Goal

Implement Falcon V1 custom, self-hosted session authentication and prove real API
authorization by resolving an authenticated session into a permission-engine
`UserSnapshot` and enforcing `resolveAuthorization` on one protected lead read
route.

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
- `docs/architecture/decisions/0006-team-scope-from-reporting-hierarchy.md`
- `docs/architecture/decisions/0007-custom-session-auth.md`
- `docs/permissions/access-model.md`
- `docs/permissions/permission-engine-schema.md`
- `docs/data-model/schema.md`
- `docs/data-model/prisma-translation-notes.md`
- `docs/testing/quality-gates.md`
- `PLANS.md`
- `packages/permission-engine/package.json`
- `packages/permission-engine/src/audit-hooks.ts`
- `packages/permission-engine/src/decision.ts`
- `packages/permission-engine/src/fields.ts`
- `packages/permission-engine/src/grants.ts`
- `packages/permission-engine/src/index.ts`
- `packages/permission-engine/src/scope.ts`
- `packages/permission-engine/src/types.ts`
- `packages/permission-engine/src/__tests__/direct-grants.test.ts`
- `packages/permission-engine/src/__tests__/field-visibility.test.ts`
- `packages/permission-engine/src/__tests__/fixtures.ts`
- `packages/permission-engine/src/__tests__/permission-matrix.test.ts`
- `packages/permission-engine/src/__tests__/scope.integration.test.ts`
- `packages/permission-engine/src/index.test.ts`

## Current state

- OD-001 is resolved by ADR-0007: Falcon V1 uses custom, self-hosted,
  server-side session authentication. OAuth, SSO, MFA, social login, Keycloak,
  Cognito, public signup, magic links, and JWT auth are not V1 paths.
- The logical schema currently lists `users` without credential columns and notes
  that auth-specific columns were deferred until the auth decision. Phase 3 is
  therefore a real schema/API phase, not package-only work.
- The database translation notes intentionally kept `users` provider-neutral in
  Phase 1 and allowed nullable actor columns only for bootstrap-cycle handling.
  Phase 3 should mirror that explicit documentation style for nullable
  `users.password_hash` on pre-password/bootstrap users.
- `packages/permission-engine` already exposes provider-independent
  authorization primitives, including the `PermissionRepository` interface,
  `UserSnapshot`, field decisions, direct-grant checks, hierarchy scope
  expansion, and `resolveAuthorization`. Phase 3 must consume these interfaces;
  it must not fork or re-implement authorization logic inside the API.
- The permission engine has unit tests and a Testcontainers-backed Postgres
  integration test pattern in `scope.integration.test.ts` that Phase 3 should
  reuse for auth/API integration tests.
- API authentication, Prisma-backed permission repository, concrete session
  storage, password reset tokens, brute-force lockout, and protected real API
  routes are not yet documented as implemented in the current baseline.

## Proposed approach

1. Keep auth provider-specific choices narrow and aligned with ADR-0007.
   Implement only custom email/password login, logout, session validation, and
   password reset by emailed token. Public registration stays absent; admins
   create users.
2. Add database support through a reviewed Prisma migration plus matching
   rollback script:
   - Add `users.password_hash` as nullable. Document that null exists only for
     bootstrap or admin-created users who have not completed password issuance;
     ordinary login must reject null hashes and invite/reset flows must set an
     argon2id hash before the user can authenticate.
   - Add tenant-scoped `sessions` with `id`, `user_id`, `organization_id`,
     `created_at`, `expires_at`, `revoked_at`, `last_seen_at`, `ip_address`, and
     `user_agent`. Use `ON DELETE RESTRICT`, expiry validation, and indexes for
     active session lookup by tenant/user/expiry/revocation. Revoke by writing
     `revoked_at`; do not hard-delete.
   - Add a password reset token store with tenant and user references, a hashed
     token value, `created_at`, `expires_at`, `used_at`, and request metadata
     such as `ip_address` and `user_agent`. Enforce single-use by setting
     `used_at`; reject expired, used, revoked, cross-tenant, or inactive-user
     tokens.
   - Add a simple failed-login/lockout persistence mechanism, preferably a
     tenant-scoped table keyed by normalized email and organization or fields on
     users if the migration review finds that simpler. Store counters/timestamps,
     not plaintext passwords. Keep thresholds and windows configurable through
     settings or environment-backed config, not buried constants.
   - Write `system_audit_logs` rows in the same transaction as security-relevant
     events where possible: failed login, lockout, password-reset request,
     password-reset completion, logout/session revocation, and administrative
     session revocation.
3. Implement an API auth module:
   - Hash and verify passwords with argon2id.
   - Normalize emails consistently for lookups while preserving existing user
     email display semantics.
   - Issue opaque, high-entropy session IDs or tokens, store only a safe session
     identifier/hash if the implementation uses bearer-like cookie material, and
     set an httpOnly, secure, sameSite cookie.
   - Validate every protected request by loading the session from the database,
     requiring same organization, active user, non-expired session, and
     `revoked_at IS NULL`, then update `last_seen_at` conservatively.
   - Clear the cookie and set `sessions.revoked_at` on logout.
4. Implement password reset without adding public signup:
   - Endpoint to request reset for an existing admin-created user. Return a
     generic response regardless of whether the email exists to prevent account
     enumeration.
   - Generate an expiring, single-use reset token, store only its hash, and send
     through the existing or planned email boundary with synthetic test fixtures.
   - Endpoint to consume reset token, set `users.password_hash` to a new argon2id
     hash, mark the token used, optionally revoke existing sessions for that
     user, and audit the event.
5. Implement the API-side `PermissionRepository` adapter using real Prisma
   queries against `users`, `roles`, `role_permissions`, `role_journey_access`,
   `field_visibility`, `assignments`, and `user_access_grants`. Preserve the
   engine's tenant-scoped semantics and ADR-0006 TEAM traversal rules.
6. Protect one real read route as the end-to-end proof, preferably
   `GET /leads/:id`:
   - Session middleware resolves the cookie into authenticated user context.
   - The route loads the target lead's process instance/journey context, calls
     `resolveAuthorization` with module/action identifiers owned by the API
     contract, and denies unauthorized requests server-side.
   - The response includes only fields allowed by the permission decision;
     denied field IDs are stripped in the API serializer, not hidden in the UI.
   - Cross-organization access must fail even when IDs are guessed.
7. Keep configuration and business data generic. Do not hardcode Wellsure seed
   role, journey, status, department, or field names in auth or authorization
   logic. Any module/action constants introduced for API permissions should be
   engine-level action identifiers, not Wellsure-specific labels.

## Files to touch

- `docs/architecture/decisions/0007-custom-session-auth.md`
- `docs/requirements/open-decisions.md`
- `PLANS.md`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/<phase3-auth-migration>/migration.sql`
- `packages/database/prisma/migrations/<phase3-auth-migration>/rollback.sql`
- `packages/database/prisma/prisma.config.ts` if migration command wiring needs
  an explicit rollback-script reference
- `packages/database/src/index.ts` if Prisma model/client exports need updating
- `apps/api/package.json`
- `apps/api/src/auth/config.ts`
- `apps/api/src/auth/password.ts`
- `apps/api/src/auth/session.ts`
- `apps/api/src/auth/password-reset.ts`
- `apps/api/src/auth/audit.ts`
- `apps/api/src/auth/middleware.ts`
- `apps/api/src/permissions/prisma-permission-repository.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/leads.ts`
- `apps/api/src/server.ts` or the existing API route registration entrypoint
- `apps/api/src/__tests__/auth.unit.test.ts`
- `apps/api/src/__tests__/session.unit.test.ts`
- `apps/api/src/__tests__/password-reset.unit.test.ts`
- `apps/api/src/__tests__/auth-flow.integration.test.ts`
- `apps/api/src/__tests__/audit.integration.test.ts`
- `apps/api/src/__tests__/fixtures/synthetic-auth.ts`
- `docs/data-model/schema.md`
- `docs/data-model/prisma-translation-notes.md`
- `docs/api/auth.md` if API docs exist or are created for the auth contract

## Out of scope

- OAuth, social login, SSO, MFA, magic links, Cognito, Keycloak, or any parallel
  provider abstraction for V1.
- JWT access tokens, refresh-token rotation, or stateless auth scaling.
- Public self-service signup or registration screens; users are admin-created.
- Full CRM API buildout. Only one protected read route is required to prove the
  auth + permission-engine wiring pattern.
- Frontend design work for login/reset screens beyond minimal API-testability
  contracts.
- Distributed rate limiting, WAF configuration, CAPTCHA, or other ops-layer
  brute-force infrastructure beyond the simple persisted attempt-count/lockout
  mechanism.
- Hardcoded Wellsure seed business values in API authorization logic.

## Risks / open questions

- Session lifetime is not yet product-approved. Proposed default for review: 8
  hours absolute expiry with `last_seen_at` tracked for observability but no
  “remember me” or sliding long-lived session in V1.
- Password-reset token expiry is not yet product-approved. Proposed default for
  review: 30 minutes, single-use, with existing sessions revoked after successful
  reset.
- Lockout policy is not yet product-approved. Proposed default for review: 5
  failed attempts in 15 minutes locks the account/email for 15 minutes. The
  values must live in typed config/settings, not inline literals scattered
  through handlers.
- Email delivery provider/configuration may not exist yet. If missing, Phase 3
  should define an injectable email-sender boundary and use a test fake without
  adding provider-specific production code unless separately approved.
- Cookie `secure` is required for production, but local development and tests may
  need an explicit non-production override. The implementation must fail closed
  in production configuration.
- Existing duplicate ADR-0006 filenames should not be changed in this auth phase
  unless separately approved; both were read and they agree on TEAM semantics.
- Any new production dependency, such as an argon2 package or cookie utility,
  must be justified in the PR description because project rules forbid adding one
  silently.

## Test plan

- Unit tests for argon2id password hashing and verification, including rejecting
  incorrect passwords and null `password_hash` users.
- Unit tests for session creation, cookie issuance metadata, validation, expiry,
  revocation, and logout behavior.
- Unit tests for password-reset token hashing, expiry, single-use behavior,
  inactive-user rejection, and generic request responses that avoid account
  enumeration.
- Unit tests for failed-login attempt counting, lockout threshold/window behavior,
  and configuration overrides.
- Integration tests against real Postgres/Testcontainers, following the standard
  used by `packages/permission-engine/src/__tests__/scope.integration.test.ts`,
  for login -> session cookie -> authorized `GET /leads/:id` -> logout.
- Integration test that a revoked session is rejected by protected routes.
- Integration test that a session from one organization cannot authorize another
  organization's lead, even if the lead ID is known.
- Integration tests confirming failed logins, lockouts, password-reset request
  and completion, logout/session revocation, and admin revocation write
  append-only `system_audit_logs` rows with actor, organization, action, and
  old/new values as applicable.
- Permission/wiring tests confirming the API route uses the real
  `PermissionRepository` adapter and `resolveAuthorization`, and that denied
  fields are stripped server-side.
- Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and migration apply/rollback
  checks before review.
- Use only synthetic fixtures: no real Wellsure emails, phone numbers,
  credentials, tokens, or personal data.

## Rollback plan

- Provide `rollback.sql` next to the Phase 3 migration.
- Rollback first disables or removes auth routes/middleware from deployment so no
  new sessions or reset tokens are being written.
- Revoke active sessions in the forward schema before rollback if the environment
  has live data, then execute the rollback in a maintenance window.
- Drop password-reset/lockout/session tables and indexes in reverse dependency
  order.
- Drop `users.password_hash` only after confirming no rollback target depends on
  local-password login; for production, take a database backup before dropping
  credential hashes because the rollback is intentionally destructive for newly
  issued passwords.
- Preserve append-only `system_audit_logs` unless the reviewed migration creates
  auth-specific auxiliary audit constraints that must be reversed; audit history
  should not be edited or hard-deleted as part of normal rollback.
