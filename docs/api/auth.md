# Auth API Contract — V1

Falcon V1 uses custom, self-hosted authentication per ADR-0007. There is no
public registration endpoint; admins create users and users set credentials via
password issuance/reset.

## Defaults awaiting product confirmation

- Session expiry: 8 hours.
- Password reset token expiry: 30 minutes.
- Lockout: 5 failed attempts within 15 minutes locks the normalized email in the
  organization for 15 minutes.

These values live in typed API auth config and are not hardcoded inside route
handlers.

## Endpoints

- `POST /auth/login`: accepts `organizationId`, `email`, and `password`; returns
  a secure httpOnly sameSite session cookie on success.
- `POST /auth/logout`: revokes the current server-side session and clears the
  cookie.
- `POST /auth/password/change`: requires an authenticated session plus the
  current password, applies the canonical password policy, retains the current
  session, and revokes the user's other active sessions.
- `POST /auth/password-reset/request`: accepts `organizationId` and `email` and
  always returns an accepted response to avoid account enumeration.
- `POST /auth/password-reset/complete`: accepts a reset token and new password;
  successful completion marks the reset token used, updates `users.password_hash`,
  and revokes existing sessions for the user. Failures distinguish
  `expired_token`, `invalid_token` (including used or unknown), and
  `weak_password`; the latter includes policy reason identifiers in `details`.

Security-relevant auth events write `system_audit_logs`: failed login, lockout,
password-reset request, password-reset completion, and session revocation.

Administrators holding `users:edit` may resend an invitation only while the
target user is active and has no password hash. The operation invalidates every
older unused reset token before issuing a fresh one. Users who have established
a password must use the public password-reset flow instead.
