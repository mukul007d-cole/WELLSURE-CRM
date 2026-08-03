# ADR-0009: Administration Permission Catalog and Bootstrap

**Status:** Accepted

## Context

The permission engine persisted module/action identifiers as strings without an authoritative runtime catalog. The access matrix also omitted read actions for configuration and administration, did not name Department administration, and the custom-auth decision did not provide a secure first-user path.

## Decision

`packages/permission-engine/src/catalog.ts` is the single source of truth for stable permission identifiers, labels, and supported data scopes. The access matrix documents that catalog rather than maintaining an independent list. Configuration modules and `users` and `roles_permissions` include explicit `view` actions.

Department administration uses `users:view`, `users:create`, and `users:edit`; V1 does not introduce a Department permission module.

The first administrator is provisioned only by the out-of-band `bootstrapFirstAdmin` command operation. It takes an explicit organization and administrator identity, serializes attempts with an organization-scoped transaction lock, requires zero existing users, provisions a generic role with the complete catalog at organization scope, all active Journeys, and edit visibility for all active Fields, creates a passwordless user and reset token, and writes nullable-actor bootstrap audits atomically. It permanently rejects the organization after any user exists. There is no HTTP bootstrap or general authorization bypass.

Permission replacement uses a transactional role row lock. Role version is incremented for authorization cache invalidation, but is not a client optimistic-lock token in V1. A replacement that would leave the organization with no active user whose role grants `roles_permissions:edit` is rejected in the transaction.

## Consequences

API validation, tests, bootstrap, and the catalog endpoint import one immutable catalog. Product labels in the catalog are vocabulary, not configurable role, Journey, Field, Status, or Department instances. New permission identifiers require updating the catalog and this documented access matrix together.

The opaque initial-password token is sent through the password-reset delivery abstraction and is never returned or stored in plaintext. Local development defaults to an explicit console delivery transport, which logs the token and a password-completion request so first-run bootstrap is usable before a real transport exists. Console output must be treated as a credential; explicitly selecting an unimplemented transport fails loudly.
