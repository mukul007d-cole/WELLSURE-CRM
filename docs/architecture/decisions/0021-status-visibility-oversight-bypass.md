# ADR-0021: A narrow, explicit backstop against Status Visibility's lockout risk

**Status:** Accepted and implemented.

## Context

ADR-0020 united Status Routing and Status Visibility: once a Status has an
active routing rule, a lead sitting in it is visible only to its current
assignee and that assignee's reporting-hierarchy ancestors
(`users.manager_id`, any depth) — no Role, and no other permission grant,
plays any part in the check. This is unconditional: it narrows every
caller regardless of their configured `DataScope`, including
`ORGANIZATION`, and regardless of any other access mechanism, including an
explicit Lead Share (`user_access_grants`).

A full-app review conducted before a staging deployment (recorded in this
session's own history rather than a numbered plan doc — the task was an
audit, not a phase) surfaced the consequence plainly: **an admin or
oversight Role is not automatically part of anyone's `manager_id` chain.**
`bootstrapFirstAdmin` creates the first administrator with `managerId:
null` and wires nothing to place them above anyone else in the reporting
hierarchy — that placement, if it happens at all, is a fact about how an
organization fills in its own user records, not something this system
establishes on its own. Concretely:

- The moment *any* Status in an organization gets an active routing rule,
  every Role whose scope would otherwise reach that lead — including a
  full administrator's `ORGANIZATION` scope — loses visibility into it
  unless that Role's user happens to sit above the assignee in the
  `manager_id` tree.
- An organization that has not deliberately built out its reporting
  hierarchy (common for a flat team, or for an admin/support account that
  was never placed in the sales chain at all) gets the most severe form of
  this: only the literal assignee can see the lead, full stop — not even
  the administrator who just configured the routing rule.
- Lead Sharing (`user_access_grants`, an existing, separate, explicit
  "share this lead with someone" feature) is silently overridden for any
  lead in a routed Status: the share record can still be created, but the
  recipient is refused unless they also happen to be a hierarchy ancestor,
  with no error or warning at share time.

This is not a bug in ADR-0020's own logic — it is exactly what "no need to
give explicit visibility to anyone; routing decides for visibility" (the
literal design instruction Phase 20 was built from) says should happen.
But it is a real operational risk precisely because an org's `manager_id`
hierarchy is data the organization controls and can easily leave
incomplete, and because the persona most likely to be structurally outside
it — platform/support/oversight admins — is also the persona most likely
to need to reach any lead, for troubleshooting, compliance, or dispute
handling, regardless of who it is currently assigned to.

Three options were put to the person who owns this decision:

1. **Keep it as specified.** Correct to the letter of the original
   instruction; the operational risk is managed entirely outside this
   codebase, by making sure `manager_id` is fully and correctly populated
   (including establishing designated admin accounts as top-of-tree
   ancestors) before any routing rule is turned on.
2. **A narrow backstop permission** for specifically-designated
   admin/oversight Roles, so Status Visibility's narrowing can be turned
   off for them deliberately, without weakening the default for everyone
   else.
3. **Surface the risk instead of silently enforcing it** — warn in the
   routing configuration UI when turning on a rule would remove access
   from users who currently have it (current viewers, active shares), so
   an admin makes the call knowingly.

**Option 2 was chosen.**

## Decision

A new permission, `leads:bypass_status_visibility`, in the existing
`leads` module (not a new module — the axis it turns off is fundamentally
about lead-record visibility, not about routing configuration, which lives
in `lead_routing`).

**What it does, precisely: nothing beyond turning off one narrowing.** A
Role holding it is exempted from the `STATUS_VISIBILITY_DENIED` check
(`packages/permission-engine/src/decision.ts`) entirely, on every request,
regardless of which module's action triggered the check — as if no Status
that Role ever asks about had an active routing rule. It grants **no new
reach**: a Role's ordinary `DataScope` for the action in question still
applies in full, unmodified. A `SELF`-scoped Role that has the bypass and
was never a lead's assignee still cannot see that lead — the bypass
removes an *additional* restriction layered on top of scope; it does not
substitute for scope, exactly the inverse of how the narrowing it turns
off was itself only ever additive (ADR-0020's own "AND, never OR").

**Checked once per `resolveAuthorization` call, and consulted in two
places that must agree:**

- The single-record path (`decision.ts`'s `statusVisible` computation) —
  skipped entirely when the caller's Role holds the bypass, before ever
  querying whether the Status has an active routing rule at all.
- The list/SQL path (`RecordPredicate.bypassesStatusVisibility`, consumed
  by `filter-sql.ts`'s `statusVisibilityClause` and
  `prisma-lead-repository.ts`'s `statusVisibleOr`) — short-circuits to an
  unconditional `TRUE`/`[{}]` for every row a scoped query (the Seller
  List, export, campaign-recipient matching, bulk-import duplicate
  visibility) would otherwise narrow.

**Granted by `bootstrapFirstAdmin`, unlike `purge`.** Every other
deliberately-sensitive action in this catalog (`purge` on five modules) is
*withheld* from bootstrap so that turning it on is a conscious, audited
act. This one is the opposite case: withholding it by default would leave
the very first administrator of every new organization open to exactly
the lockout this ADR exists to prevent, the instant they configure their
first routing rule. An admin who wants to remove it from their own Role
after establishing a proper `manager_id` hierarchy remains free to.

**Not implied by anything else.** Holding `ORGANIZATION` scope on
`leads:view`/`edit`, holding `roles_permissions:edit`, or being a system
administrator by any other measure confers nothing here — the bypass is a
distinct, explicit grant an admin makes (or, for the first Role, that
bootstrap makes) deliberately, matching how the self-escalation rule
`field_visibility`/`status_routing_permissions` already follow works in
the other direction (an elevated capability is never implied by an
adjacent one).

## Consequences

**Real reach for the personas that need it, real narrowing for everyone
else — the intended shape, not a compromise between the two.** An org that
never grants this to any Role beyond the bootstrap administrator gets
ADR-0020's design exactly as specified: routing alone decides visibility.
An org that deliberately grants it to a small, named set of
admin/oversight Roles keeps those Roles able to do their job — audit,
support, compliance, dispute resolution — regardless of routing state,
without reopening Status Visibility for anyone else, and without
resurrecting the Role-based allow-list ADR-0020 retired.

**Lead Sharing's interaction with a routed Status is unchanged by this
ADR** — a share to a Role without the bypass, into a routed Status, still
does not reach anyone outside the assignee's hierarchy. That remains a
known, accepted consequence of ADR-0020 (a share is "explicit visibility
to someone else," which routing now decides instead); this ADR's backstop
is for a Role-level exemption, not a per-share one, and does not attempt
to resurrect Lead Sharing's old reach into a routed Status. An admin who
needs to hand a specific lead to a specific non-ancestor colleague, in a
routed Status, still has no first-class way to do that other than granting
that person's Role the bypass outright (a Role-wide, not lead-specific,
grant) — named here as a real, out-of-scope gap rather than hidden by
this ADR's own more limited claim.

**Performance:** the bypass check is one additional indexed lookup per
`resolveAuthorization` call (`hasStatusVisibilityBypass`,
`role_permissions` on its existing unique key) — bounded and cheap, unlike
the hierarchy walk it can make unnecessary. For a Role that holds it, the
single-record path now *skips* both the routing-rule lookup and the
hierarchy walk entirely, a small but real saving for exactly the
`ORGANIZATION`-scoped oversight Roles most likely to pay that cost on
every request (see the "real cost" the Phase 20 plan doc already accepted
and flagged as worth watching).

**Options 1 and 3 remain available, not foreclosed.** Nothing here
prevents also warning in the routing configuration UI (Option 3) if that
is wanted later, and an organization that prefers Option 1's discipline
can simply never grant this permission to any Role beyond the bootstrap
default, and remove it from that Role once its own hierarchy is
established.
