# Phase 18 — Account and email lifecycle follow-ups

## Goal

Close the Phase 17 email-deliverability and password-setup gaps, prove the real
administrator-created-user-to-login lifecycle, and add secure authenticated
password changes and administrator invite re-sends without weakening the
permission or audit contracts.

## Docs read

- `AGENTS.md`
- `PLANS.md`
- `docs/requirements/source-of-truth.md`
- `docs/requirements/glossary.md`
- `docs/requirements/v1-scope.md`
- `docs/architecture/decisions/0007-custom-session-auth.md`
- `docs/architecture/decisions/0009-admin-bootstrap-and-permission-catalog.md`
- `docs/architecture/decisions/0013-campaign-trigger-fan-out.md`
- `docs/architecture/decisions/0018-deployment-target-and-email-provider.md`
- `docs/permissions/access-model.md`
- `docs/api/auth.md`
- `docs/api/endpoints.md`
- `docs/operations/environment-variables.md`
- `docs/operations/deployment.md`
- `docs/testing/quality-gates.md`
- `docs/planning/phase-17-deployment.md`

## Current state

1. **Email delivery uses one sender address.** `createEmailSender` creates one
   Resend transport and `createResendEmailSender` closes over one `from` value.
   Both `sendPasswordReset` and the campaign `sendEmail` method call the same
   internal sender, and `CampaignSendService` calls that `sendEmail` method.
   `FALCON_EMAIL_FROM` is therefore the only real sender-address variable today;
   the documented subdomain split is not yet configurable. Terraform likewise
   injects only that address.
2. **The reset API exists, but the web completion route does not.** Reset mail
   links to `/reset-password?token=...`; `App.tsx` has no such public route.
   `POST /auth/password-reset/complete` currently returns `204` on success and
   the same `400 invalid_or_expired_token` for a missing, used, or expired
   token. Completion hashes any supplied password and revokes all active user
   sessions. There is no frontend reset API method.
3. **There is currently no password-strength validator to reuse.** Repository
   search confirms `hashPassword` accepts any string and reset completion calls
   it directly. This contradicts the task's current-state premise. The safe way
   to meet the intended requirement is to introduce one backend-owned validator
   and use it from both reset completion and change-password; the web will
   display the API's reason rather than mirror the rules.
4. **There is no authenticated password-change operation.** Settings contains
   profile, access, appearance, and sign-out sections only. The auth repository
   can verify a login password and revoke every session, but has no atomic
   password-change operation or “all sessions except this one” method.
5. **There is no resend-invite operation.** Admin user creation atomically
   creates a passwordless user, initial reset token, and user audit, then sends
   `sendPasswordReset`. User list payloads deliberately do not expose the
   password hash, but also expose no safe `hasPassword`/invite-applicability
   flag. Existing reset-token creation does not invalidate older unused tokens.
6. Existing PostgreSQL suites exercise auth, administration, HTTP transport,
   and campaign persistence separately, but none proves the complete create →
   captured invitation → real completion endpoint → login endpoint flow.

## Proposed approach

### Commit 1 — Split campaign and transactional sender configuration

- Add optional `FALCON_CAMPAIGN_EMAIL_FROM` parsing to the existing email
  delivery configuration. It will default to `FALCON_EMAIL_FROM` for backwards
  compatibility, while `FALCON_EMAIL_FROM` remains the transactional/password
  sender. Pass both values through `createRuntime`, `createEmailSender`, and
  `createResendEmailSender`; choose the campaign value only in `sendEmail`.
- Add the variable to `.env.example`, the App Runner compute-module input and
  all environment roots/callers that supply compute inputs. Keep it a normal
  configuration value, not a secret. No provider SDK or other production
  dependency is needed.
- Update ADR-0018's consequences/current mitigation wording and the operations
  docs to name both real variables. Replace the stale “shared domain” known gap
  with an accurate statement: distinct subdomains are supported, operators must
  configure and verify them, and the fallback preserves compatibility but does
  not isolate reputation.
- Test both explicit split and fallback at the Resend payload boundary, env
  validation/runtime wiring, Terraform validation, and a real-Postgres campaign
  send path whose persisted send succeeds while the provider stub observes the
  campaign sender (with a transactional send in the same test observing the
  transactional sender).

### Commit 2 — Reset page and end-to-end new-user lifecycle

- Add a public `/reset-password` page and API-client method. The page reads the
  token from the query string, asks for password and confirmation, catches
  confirmation mismatch locally, and delegates password policy entirely to the
  API. On success it clears the form/token from the visible flow and directs the
  user to sign in; it must not assume a session survives because reset completion
  intentionally revokes all sessions.
- Add a single backend password-policy validator, called before hashing by reset
  completion. Return a stable `weak_password` error plus safe structured reasons
  suitable for display. The page will render that backend reason; it will not
  duplicate minimum length/composition rules in Zod or React.
- Make token failure states truthful: expired unused tokens return
  `expired_token`; unknown, already-used, and malformed tokens return
  `invalid_token`. Distinguishing expiry is safe because the caller already
  possesses the opaque secret, while used/unknown remain deliberately merged.
- Retain successful reset's existing all-session revocation and audited
  `auth.password_reset_completed` mutation. Add API, component, routing, and
  accessibility tests for success, missing/invalid token, explicitly expired
  token, backend weak-password detail, and confirmation mismatch.
- Add the required real-Postgres HTTP lifecycle test using production Prisma
  repositories and Fastify routes: seed a synthetic administrator with
  `users:create`, log the administrator in, create a passwordless user through
  the real admin endpoint, capture the opaque token from the injected email
  sender, complete it through the real reset endpoint, then log in through the
  real login endpoint with the new password. Assert token/audit/session database
  effects as well as HTTP results.

### Commit 3 — Authenticated change-password

- Add `POST /auth/password/change`, protected by `authenticate`, accepting
  `currentPassword` and `newPassword`. An authenticated self-service operation
  is authorized by the valid active session plus successful re-entry of that
  same user's current password; it does not use an administrator module grant,
  because requiring `users:edit` would prevent ordinary users changing their
  own credential. This is still an explicit authorization decision in the API,
  never a UI-only check.
- Reuse the same password-policy validator introduced for reset. Verify the
  current password using the existing constant-safe password verification
  helper, update the hash, revoke every *other* active session, retain the
  current session, and write one system audit entry in one transaction.
- **Session decision:** revoke other sessions but keep the current session.
  Re-entering the current password provides recent proof of credential; keeping
  that session avoids an unnecessary sign-in interruption, while revoking other
  sessions removes potentially stolen or forgotten sessions after this
  security-sensitive change. The audit records the count without hashes or
  plaintext credentials.
- Add a Settings password form that requests current/new/confirmation values,
  reports local confirmation mismatch and server-owned policy/current-password
  errors, clears secrets after success, and states that other devices were
  signed out.
- Add real-Postgres route tests for authentication enforcement, wrong current
  password, weak new password, successful audit/hash update, current-session
  survival, and other-session revocation; add API-client and Settings component
  tests.

### Commit 4 — Resend invite

- Add `POST /users/:userId/resend-invite`, behind the existing administration
  route wrapper and `users:edit` permission decision. The target lookup is
  organization-scoped. Reject inactive/missing users appropriately and return a
  conflict if `passwordHash` is non-null: established users must use the public
  forgot-password flow, so invite resend cannot become an administrator-driven
  credential reset.
- In one repository transaction, lock/check the user, mark all of that user's
  unused reset tokens used (invalidating both unexpired and expired leftovers),
  create one fresh hashed token, and write a user/configuration system audit
  naming the target, new token record, and invalidated count but never the opaque
  token. After commit, call the same `EmailSender.sendPasswordReset` delivery
  method used by create-user; factor shared token preparation/delivery rather
  than copy email construction.
- Add a derived `hasPassword` boolean to admin user projections without ever
  exposing `passwordHash`. Show “Resend invite” in `UsersPage` only when the
  caller has `users:edit`, the user is active, and `hasPassword` is false.
  Refresh the list and show success/error feedback after the action.
- Add real-Postgres tests proving permission denial, tenant isolation,
  established/inactive-user rejection, old-token invalidation, fresh-token
  delivery and usability, and the audit row. Add admin API-client and component
  tests for applicability and interaction.

## Files to touch

The implementation is expected to be limited to the following explicit files;
if investigation during implementation requires another file, the plan will be
updated for approval before that file is edited.

- `.env.example`
- `apps/api/src/admin/prisma-admin-repository.ts`
- `apps/api/src/admin/repository.ts`
- `apps/api/src/admin/service.ts`
- `apps/api/src/admin/types.ts`
- `apps/api/src/auth/audit.ts`
- `apps/api/src/auth/email-sender.ts`
- `apps/api/src/auth/password-reset.ts`
- `apps/api/src/auth/password.ts`
- `apps/api/src/auth/prisma-auth-repository.ts`
- `apps/api/src/auth/resend-email-sender.ts`
- `apps/api/src/env.ts`
- `apps/api/src/http/plugins/logging.ts`
- `apps/api/src/http/routes/admin.ts`
- `apps/api/src/http/routes/auth.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/runtime.ts`
- `apps/api/src/__tests__/admin.test.ts`
- `apps/api/src/__tests__/auth.unit.test.ts`
- `apps/api/src/__tests__/env.test.ts`
- `apps/api/src/__tests__/phase13c.postgres.integration.test.ts`
- `apps/api/src/__tests__/resend-email-sender.test.ts`
- `apps/api/src/__tests__/phase18.postgres.integration.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/lib/api-client.ts`
- `apps/web/src/lib/api-client.test.ts`
- `apps/web/src/lib/api-error.ts`
- `apps/web/src/mocks/handlers.ts`
- `apps/web/src/pages/admin/AdminFlows.test.tsx`
- `apps/web/src/pages/admin/UsersPage.tsx`
- `apps/web/src/pages/login/ResetPasswordPage.tsx`
- `apps/web/src/pages/login/ResetPasswordPage.test.tsx`
- `apps/web/src/pages/settings/SettingsPage.tsx`
- `apps/web/src/pages/settings/SettingsPage.test.tsx`
- `apps/web/src/types/domain.ts`
- `docs/api/auth.md`
- `docs/api/endpoints.md`
- `docs/architecture/decisions/0018-deployment-target-and-email-provider.md`
- `docs/operations/deployment.md`
- `docs/operations/environment-variables.md`
- `infra/terraform/environments/dev/main.tf`
- `infra/terraform/environments/dev/terraform.tfvars.example`
- `infra/terraform/environments/dev/variables.tf`
- `infra/terraform/environments/production/main.tf`
- `infra/terraform/environments/production/terraform.tfvars.example`
- `infra/terraform/environments/production/variables.tf`
- `infra/terraform/environments/staging/main.tf`
- `infra/terraform/environments/staging/terraform.tfvars.example`
- `infra/terraform/environments/staging/variables.tf`
- `infra/terraform/modules/compute/main.tf`
- `infra/terraform/modules/compute/variables.tf`

No Prisma schema or migration is planned: password hashes, reset-token usage,
sessions, and audit rows already have the required storage shape.

## Out of scope

- Changing provider away from Resend, adding an email SDK, or creating separate
  API keys/transports for campaign and transactional messages.
- Public registration, administrator-set passwords, or sending plaintext
  credentials.
- Turning resend-invite into forgot-password for established users.
- Changing reset completion's successful all-session-revocation semantics.
- Account email/profile editing, MFA, session-management UI, or password-history
  storage.
- Production deployment, DNS/provider verification, NAT redundancy, restore
  drills, or unrelated Phase 17 known gaps.
- Any Wellsure-specific role, journey, status, field, or fixture data.

## Risks / open questions

- **Approval is needed for the password-policy correction.** Contrary to the
  task premise, no existing strength validation exists. Proceeding requires
  approving creation of one canonical backend validator and applying it to both
  reset and change-password. This closes an existing reset weakness rather than
  reproducing it in the new endpoint.
- Password-policy details must be stable enough for API error contracts but must
  not be duplicated in web validation. Tests will assert backend reasons and UI
  rendering, not parallel rule implementations.
- Email delivery happens after the database transaction, matching create-user's
  current pattern. A provider failure leaves a valid fresh invite token in the
  database and returns failure to the administrator; retrying resend safely
  invalidates it and creates another. Sending inside the transaction would hold
  locks across a network call and still could not make delivery transactional.
- Reset completion currently performs hash update, token use, session
  revocation, and audit as separate repository calls rather than an explicit
  transaction. The implementation will preserve behavior while making each new
  password mutation atomic through repository operations; if making reset itself
  atomic requires a repository-interface expansion beyond the listed files, the
  plan will be amended before proceeding.
- No source-data/document conflict was found. All fixtures will remain synthetic.

## Test plan

Following `docs/testing/quality-gates.md`:

1. Add/extend focused API unit tests for sender selection/fallback, password
   policy and token-state mapping, change-password behavior, and resend-invite
   service/permission behavior.
2. Add web tests for the reset-page state machine, Settings password form, and
   conditional/admin resend action, including keyboard-accessible labels and
   backend error detail presentation.
3. Run the new `phase18.postgres.integration.test.ts` with
   `FALCON_POSTGRES_URL` and observe (not skip) the full admin-create → captured
   email token → HTTP reset → HTTP login lifecycle, change-password session and
   audit behavior, and resend-invite boundary/invalidation/audit behavior.
4. Extend the real-Postgres campaign suite so the configured campaign sender is
   observed through the real campaign send/persistence path; separately assert
   the transactional sender through the same Resend transport.
5. Run the focused API and web tests, then `pnpm test`, `pnpm lint`,
   `pnpm typecheck`, `pnpm build`, and `pnpm format:check`.
6. Run `terraform fmt -check -recursive`, initialize each Terraform environment
   without a backend, and run `terraform validate` for development, staging,
   and production.
7. Run a secrets/fixture review over the final diff, confirm every mutation's
   permission decision and audit assertion, and take screenshots of the reset,
   Settings, and Users UI changes because they are perceptible web changes.

## Rollback plan

No schema migration is planned. Roll back the four implementation commits in
reverse order. Existing deployments remain compatible throughout because
`FALCON_CAMPAIGN_EMAIL_FROM` is optional and falls back to
`FALCON_EMAIL_FROM`; removing the new routes/UI restores the prior behavior
without data conversion. Reset tokens marked used by an invite resend remain
invalid after rollback, which is the security-safe direction; an administrator
can issue a normal reset for an established user, while a passwordless user can
be invited again before rollback if needed.
