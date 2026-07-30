# ADR-0007: Custom Session Authentication for V1

**Status:** Accepted

## Context

OD-001 required Falcon to choose between AWS Cognito, self-hosted Keycloak, and
custom-built authentication before implementing the auth module. Wellsure has now
chosen custom, self-hosted authentication for V1.

Falcon V1 is a single-tenant deployment for a small internal team. The product
needs controlled user lifecycle management, server-side authorization, audit
logs, and straightforward credential/session revocation, but it does not need
public signup, OAuth/social login, SSO, MFA, or stateless identity scaling in V1.

## Decision

Falcon V1 will implement custom, self-hosted authentication in the API:

- Users are created by admins; there is no public self-service registration in
  V1.
- Login uses email plus password.
- Passwords are stored only as argon2id hashes; plaintext credentials and the
  legacy Cronberry `pass` field are never stored or migrated.
- Auth uses server-side sessions stored in a tenant-scoped `sessions` table and
  referenced by an httpOnly, secure, sameSite cookie.
- Sessions are revocable by setting `revoked_at`; they are not hard-deleted.
- Password reset uses an emailed, expiring, single-use token.
- OAuth, social login, SSO, MFA, magic links, and external identity providers are
  explicitly out of scope for V1.

## Rationale

Custom auth is acceptable for V1 because the deployment is single-tenant and the
team size is small. It avoids per-user identity-provider cost and avoids the
implementation and operations complexity of OAuth/OIDC integration before those
capabilities are needed.

Server-side sessions are chosen over JWTs because V1 has no stateless-scaling
requirement, and database-backed sessions are trivially revocable: logout,
account deactivation, password reset, and suspected compromise can invalidate a
session immediately by setting `revoked_at`. With JWTs, immediate revocation
would require additional deny-list infrastructure or short token lifetimes plus
refresh-token complexity.

## Consequences

Falcon owns the credential, session, password-reset, lockout, and audit
implementation. The auth module must therefore be implemented with explicit
security tests, tenant scoping, append-only audit logging for security-relevant
events, and conservative defaults for session lifetime, reset-token expiry, and
failed-login lockout.

The database schema must add credential/session/reset-token structures in a real,
reversible migration. The API must validate sessions server-side before
constructing the `UserSnapshot` consumed by the permission engine.

If Wellsure later requires SSO, OAuth/social login, MFA, or a managed identity
provider, that change must be recorded in a new ADR that supersedes this V1
decision.
