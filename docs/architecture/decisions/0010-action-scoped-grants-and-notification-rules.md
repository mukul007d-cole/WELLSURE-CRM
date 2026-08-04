# ADR-0010: Action-scoped direct grants and notification rule catalogs

**Status:** Accepted

## Context

Lead sharing must add selected capabilities without a second record-access
evaluator. Notification rules need stable semantics while remaining configurable.

## Decision

`user_access_grants` carries a non-empty subset of canonical Lead actions `view`,
`edit`, and `comment`. A matching grant is evaluated by the existing decision as
an additive record-scope source only. It never bypasses feature, Journey, Field,
workflow, tenant, role, or active-user checks. The UI labels `comment` as “Add
notes”; there is no `add_notes` action.

Notification trigger and recipient-resolver kinds are closed engine catalogs.
Administrators configure unlimited versioned rules, scopes, parameterized
resolvers, and order. Assignment types and Field sections remain data. New
primitive kinds require an application/schema change.

Lead activities add `share_changed` and `lead_deactivated`; `reassignment`
remains distinct. Rules consume persisted Lead activities in the mutation
transaction.

## Consequences

Single-record decisions and list/count predicates filter grants by action.
Revocation removes capabilities while preserving history. Notifications remain
minimal navigation records; current authorization controls later navigation.
