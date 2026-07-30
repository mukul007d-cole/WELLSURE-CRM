# ADR-0005: Authentication Provider — Deferred

**Status:** Superseded by ADR-0007 (2026) — see ADR-0007 for the accepted V1 auth decision

**Context:** Three options are on the table:
- AWS Cognito (managed, but within Wellsure's own AWS account)
- Keycloak (fully self-hosted, most control, more to maintain)
- Custom-built auth (maximum control, most implementation/maintenance burden, most security responsibility)

Data ownership is the core driver of this entire project, so this choice matters more than it would in most systems — but it has not been made yet.

**Decision:** Deferred. Do not scaffold or implement the auth module until this is explicitly resolved. All other Phase 1–3 work (repo setup, permission engine design, journey/field builder) can proceed without this decision, since Falcon's own role/permission logic lives in Falcon's database regardless of which identity provider issues the login.

**Action required before Phase 2 (Identity & Permission Engine) begins:** get an explicit answer and update this ADR to Accepted.
