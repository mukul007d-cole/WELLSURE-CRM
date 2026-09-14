# Phase 21 — Time-Bounded Sharing + Post-Reassignment Grace Visibility

Status: **proposed — awaiting approval. Nothing in this plan is implemented.**

## Goal

Part 1: require every Lead share to carry a caller-chosen 7/30/60-day duration,
computed into `expiresAt` server-side, with the UI showing remaining time and
the audit trail recording what was chosen.

Part 2: let a user opt in, on their own account, to keep 30 days of view-only
access to a lead after they stop being its assignee (manual reassignment or
Status-Routing-driven), gated on an admin-controlled eligibility switch —
reusing Part 1's exact `UserAccessGrant`/`expiresAt` mechanism rather than a
second parallel one.

## Sequencing note — Phase 20's status, checked directly rather than assumed

`docs/planning/phase-20-reconcile-status-routing-and-visibility.md` itself
reads `Status: **implemented.**`, and `git log` on this exact branch
(`claude/dazzling-fermi-eecsrw`) shows both of Phase 20's parts, plus three
follow-up fix commits, already committed:

```
5327606 Add leads:bypass_status_visibility, a narrow backstop for oversight Roles
984e5dc Fix two audit findings: hierarchy traversal, and status-deactivation triggers
47d7f05 Fix status_routing_permissions' unreachable default state
ce7947d Phase 20 Part 2: unite Status Routing and Status Visibility
732c0ce Phase 20 Part 1: investigate Status Routing grantability, add regression test; plan Part 2
```

But checked against GitHub directly (`list_pull_requests`, both scoped to this
head branch and scoped to `base: main`): **there is no open or merged pull
request for this branch, or any other, against `main`.** `origin/main` is 28
commits behind this branch and does not contain any Phase 20 code —
`status_visibility` still exists there as a live table, not yet retired. So
"implemented" in Phase 20's own doc means implemented-and-committed on this
branch, not reviewed-and-merged. The task's framing is correct: **Phase 20 is
still awaiting approval**, and it governs the exact mechanism Part 2 needs
("the previous owner loses access on reassignment").

**Resolution: build Part 2 against this branch's current code (which already
contains Phase 20 in full), not against `main`, and flag the dependency
explicitly rather than silently assuming it is settled** — waiting is not
practical here since Phase 21 is developed on this same branch and Phase 20's
code is already the ground truth in this working tree; there is nothing
external left to wait for locally. What Part 2 actually depends on from
Phase 20, precisely, so a reviewer knows what to re-check if Phase 20's design
changes before merge:

1. **The mechanism "previous owner loses access" itself does not depend on
   Phase 20 at all.** It is `assignments.is_current` flipping to `false` in
   `LeadSharingService.reassign()` and `StatusRoutingService.assign()` — both
   predate Phase 20 (Phase 9 and Phase 14b respectively) and are untouched by
   it. Part 2's two hook points are safe regardless of Phase 20's outcome.
2. **What "losing access" *means* once the assignment flips does depend on
   Phase 20.** Pre-Phase-20 (today's `main`), Status Visibility is a
   Role-level allow-list (`status_visibility` table); post-Phase-20 (this
   branch), it is derived from the routing assignment plus the reporting
   hierarchy, and — per `docs/permissions/access-model.md`'s Phase-20-era
   text — **a direct grant (`user_access_grants`) does not bypass it**: "A
   share ... is equally subject to this check ... nothing bypasses it,
   including a deliberately-granted share, once the Status the lead sits in
   has active routing." This plan's Risk section below depends on that exact
   sentence being Phase 20's final shape. If Phase 20's review changes
   whether direct grants bypass Status Visibility, or reverts to the
   Role-allow-list mechanism, that Risk and its accompanying integration test
   need re-checking against whatever ships — the grace grant's *creation* logic
   in this plan does not change, but what it actually accomplishes once
   created might.
3. Part 1 has no dependency on Phase 20 at all — it touches only
   `LeadSharingService.create()`, `filter-sql.ts`'s already-Phase-20-shaped
   `grantExists()`, and the share UI.

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/source-of-truth.md`,
`docs/requirements/glossary.md`, `docs/permissions/access-model.md`,
`docs/testing/quality-gates.md`,
`docs/planning/phase-9-lead-sharing-and-notifications-plan.md` (in full),
`docs/planning/phase-14b-per-status-assignment-routing.md` (routing/reassignment
sections), `docs/planning/phase-20-reconcile-status-routing-and-visibility.md`
(in full, including its amendments and bookkeeping sections).

Code read: `apps/api/src/leads/sharing.ts` (in full),
`apps/api/src/leads/filter-sql.ts` (in full), `apps/api/src/routing/service.ts`
(in full), `apps/api/src/http/routes/leads.ts` (shares/reassign routes),
`apps/api/src/http/routes/auth.ts`, `apps/api/src/http/routes/admin.ts`,
`apps/api/src/admin/service.ts` and `apps/api/src/admin/prisma-admin-repository.ts`
(`replacePermissions`), `apps/api/src/permissions/prisma-permission-repository.ts`
(direct-grant expiry filter), `apps/api/src/routes/auth.ts`
(`capabilitiesRoute`), `packages/permission-engine/src/catalog.ts`,
`packages/database/prisma/schema.prisma` (`UserAccessGrant`, `User`, `Role`,
`Department`, `RolePermission`, `Setting`, `SystemAuditLog`),
`apps/web/src/pages/seller-detail/LeadShareDialog.tsx`,
`apps/web/src/pages/settings/SettingsPage.tsx`,
`apps/web/src/pages/admin/{DepartmentsPage,RoleDetailPage}.tsx`,
`apps/web/src/app/AuthContext.tsx`, `apps/web/src/lib/api-client.ts`,
`apps/web/src/types/domain.ts`,
`apps/api/src/__tests__/{phase9,phase14b}.postgres.integration.test.ts` (for
existing coverage and fixture conventions).

## Current state

### Part 1 — confirmed accurate, verified directly rather than trusted

- `UserAccessGrant.expiresAt` is a nullable `Timestamptz` column
  (`schema.prisma:609`) already in production shape — **no migration needed
  for Part 1.**
- The read path already enforces it everywhere a grant is consulted, not just
  in one place: `LeadSharingService.list()` (`sharing.ts:31`,
  `OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]`),
  `filter-sql.ts`'s `grantExists()` (`expires_at IS NULL OR expires_at >
  $now`), and the single-record direct-grant lookup in
  `prisma-permission-repository.ts:313` (`OR: [{ expiresAt: null }, {
  expiresAt: { gt: input.now } }]`). All three of list, count/filter, and
  single-record decision already honor expiry independently. This is also
  already proven by an existing test:
  `phase9.postgres.integration.test.ts` creates a grant with
  `expiresAt: new Date('2000-01-01')` and asserts it is excluded.
- `LeadSharingService.create()` (`sharing.ts:48-97`) takes no duration input
  at all. The `tx.userAccessGrant.create()` call never sets `expiresAt`, so
  every share created today is permanent by omission — confirmed by reading
  the method, not assumed from the task description.
- The frontend (`LeadShareDialog.tsx`) has no duration control and does not
  render `expiresAt` anywhere; `LeadShare` (`domain.ts:218`) has no
  `expiresAt` field to render even if it wanted to.
- **Conclusion: Part 1 is a validation + wiring change on an
  already-built, already-passively-enforced mechanism, not new
  infrastructure.** No schema migration, no cron job.

### Part 2 — where "previous owner loses access" actually happens

Exactly two places flip an assignment's `isCurrent` to `false` and create a
replacement (verified by grepping every `isCurrent: false` write in
non-test code):

1. **Manual reassignment** — `LeadSharingService.reassign()`
   (`sharing.ts:194-268`). Always has a genuine previous holder (`old`, looked
   up by `{processInstanceId, assignmentType, isCurrent: true}`; throws
   `not_found` if absent) — but does **not** currently guard against
   reassigning to the same user, so `old.userId === input.userId` is possible
   today and must be excluded from "genuine reassignment."
2. **Automatic Status Routing** — `StatusRoutingService.assign()`
   (`routing/service.ts:223-306`), called from `route()` on a `status_changed`
   trigger (Phase 14b) or a manual override
   (`operate`/`routing-assign`, which calls `route()` with `overrideUserId`
   set). Already excludes the same-user case itself: when
   `previous.userId === input.userId` it advances the cursor and returns
   early (`routing/service.ts:241-247`) without writing a new assignment or a
   `reassignment` activity — so nothing to hook there. When `previous` is
   `null` (first-ever assignment into a routed Status — e.g. `createLead`'s
   initial process instance later routed) there is likewise no previous owner
   to grant anything to.

A third writer, `prisma-lead-repository.ts:356`
(`assignment.create()` for `createLead`'s first, non-superseding assignment),
is not a reassignment at all — no prior holder exists — and is correctly out
of scope.

Both real hook points already run inside one transaction with the
reassignment write and the `reassignment` activity log entry, and both
already share a dispatcher (`TriggerDispatcher`) for downstream notification
fan-out — the same seam Part 2's grant creation rides on.

### The permission/admin-gating landscape (for the Department-vs-Role question)

- `packages/permission-engine/src/catalog.ts` is the only place capability
  gates are defined; every gate is `module:action` on a `Role`, replaced
  wholesale via `AdminService.replacePermissions()` →
  `PrismaAdminRepository.replacePermissions()`
  (`prisma-admin-repository.ts:301-339`), which **already**: validates every
  pair against `isPermissionPair`, enforces the self-escalation rule (never
  leave zero permission administrators), bumps the Role's version, and writes
  a `system_audit_logs` row (`audit(tx, org, actor, 'role_permission', roleId,
  'replace', old, rows)`) with full old/new sets — for free, for any new
  catalog entry.
- The Role editor UI (`RoleDetailPage.tsx:227-247`) renders every action in
  every module generically (`module.actions.map(...)`, label =
  `action.replaceAll('_', ' ')`) — a new catalog action needs **zero** new
  admin UI code, just a catalog entry.
- `Department`, by contrast, has never been a permission-scoping or
  capability-gating dimension anywhere in this codebase. Direct evidence,
  not inference:
  - `access-model.md`: "Department administration is part of the User scope
    and uses `users:view/create/edit`; V1 has no separate Department
    permission module."
  - `catalog.ts`'s `users` module is literally labeled `'Users & Departments'`
    — Department administration rides on `users:*`, the same way Team
    administration does (ADR-0014).
  - `DEPARTMENT` *does* exist as a `DataScope` value — but that is "whose
    Lead is this" (a record-ownership question for `leads:view/edit/...`),
    never "which capabilities can this org unit's users even see." Those are
    different axes; conflating them would be new, not a reuse of something
    established.
  - The glossary lists Department only as "org unit ... admin-editable"
    seed data, alongside Journey/Status/Field/Role — a configuration entity
    to be renamed/restructured freely, not a policy-scoping dimension.
  - Building a Department-level allow-list means a **new** table, a **new**
    pair of admin repository methods, a **new** audit call, and a **new**
    admin UI section — none of which exist to reuse, unlike the Role path.

## Proposed approach

### Part 1 — time-bounded lead sharing

**Decision: no permanent option. Every share must specify one of 7 / 30 / 60
days; the field is required end to end.**

Presented as an explicit decision per the task's framing, not silently
picked: the alternative (offer 7/30/60 *or* "permanent," defaulting to
permanent) would leave today's unbounded-by-default behavior reachable by
omission — the exact gap this phase exists to close — for zero cost saved,
since the current UI and API contract don't promise permanence to anyone
today (Phase 9 explicitly scoped "share expiry UI" as future work, never as a
committed permanent-sharing contract). If a genuinely permanent share is
wanted later, it is a fourth enum value (`null`), a small, additive, and
easily-reversible change to the same validation function — not a reason to
keep the gap open now.

1. **`sharing.ts`.** Add
   ```ts
   export const shareDurationsDays = [7, 30, 60] as const;
   export type ShareDurationDays = (typeof shareDurationsDays)[number];
   ```
   `LeadSharingService.create()` gains a required `durationDays:
   ShareDurationDays` input field, validated by a new `validateDuration()`
   (mirroring `validateCapabilities()`'s throw-on-invalid shape — invalid
   value throws `invalid_duration`). Extract the grant-row construction
   (currently inline at `sharing.ts:76-84`) into an exported
   `createTimedAccessGrant(tx, { organizationId, leadId, userId,
   grantedByUserId, actions, durationDays })` that computes
   `expiresAt = new Date(now.getTime() + durationDays * 86_400_000)`
   **server-side, from the validated enum value only** — the route layer
   never accepts or forwards a client-supplied timestamp. `create()` becomes
   a thin wrapper: validate inputs, look up lead/user/existing exactly as
   today, call the helper, write the `share_changed` activity with
   `durationDays` and `expiresAt` added to `newValue`. This same helper is
   what Part 2 reuses (see below) — one function constructs every timed
   grant in the system, Part 1's and Part 2's alike.
2. **Route** (`http/routes/leads.ts`, `POST /leads/:id/shares`). Require
   `durationDays` in the body; pass through unchanged to the service (which
   does the real validation) rather than duplicating the enum check at the
   route layer.
3. **List response.** `LeadShare` (`sharing.ts:9-16`) gains `expiresAt: Date
   | null` (kept nullable at the type level even though creation no longer
   produces `null`, since historical/pre-migration rows and any future
   permanent-share enum value both need it); `list()`'s mapping passes it
   through.
4. **Frontend.**
   - `LeadShare` (`domain.ts:218`) gains `expiresAt: string | null`.
   - `sellersApi.share()` (`api-client.ts`) body gains `durationDays: 7 | 30 |
     60`.
   - `LeadShareDialog.tsx`: add a required duration `<Select>` (7/30/60
     days), disable "Share" until one is chosen (mirrors the existing
     `disabled={!userId || ...}` pattern), and render each existing share's
     expiry — "Expires in N days" computed from `expiresAt` and `Date.now()`,
     or the literal date, next to its capability list. Since `list()` already
     excludes expired/revoked rows server-side, there is no "expired" state
     to render in this dialog — only "how long is left."
5. **No scheduled job.** Confirmed above: list, filter-sql, and the
   single-record lookup already independently filter on `expires_at`. The
   task's own carve-out — add a job only if the UI needs "expired 3 days ago"
   rather than just not showing the row — does not apply: the approved UI
   (§4) only ever shows *active* shares with remaining time, matching
   `list()`'s existing filter exactly. No cleanup job is added.

### Part 2 — reassignment grace visibility

#### The Department-vs-Role decision

**Recommendation: (b) — gate eligibility by Role via the existing permission
catalog, not by Department.**

New catalog entry:
```ts
{
  module: 'leads',
  // ...
  actions: [..., 'retain_view_after_reassignment'],
}
```
— `retain_view_after_reassignment` added to `leads`' existing action list,
**not** in `scopedActions` (it is a Role-level boolean with no per-record
meaning, the identical shape as `bypass_status_visibility` — see
`catalog.ts`'s own comment on why that action is absent from
`scopedActions`), and **not** in `withheldFromBootstrap` (unlike `purge`,
enabling it carries no irreversible/destructive risk that would justify
forcing a deliberate first grant; a fresh organization not having it on by
default for every Role is enough — see Risk 3 below for the one case this
needs re-examining).

Why (b) over the literal ask (a):

- **Every other capability gate in this system is Role-based; none is
  Department-based**, confirmed directly above (`access-model.md`,
  `catalog.ts`'s `users`-module comment, the glossary) — not inferred, not
  "probably." Building (a) would introduce Department as a capability-gating
  dimension for the first time in the app's history, alongside — not
  replacing — its existing, unrelated role as a `DataScope` value and as an
  org-unit configuration entity. Two independent things would then share the
  word "Department": an org unit users belong to, and (newly) a policy
  allow-list dimension. That is a real, lasting conceptual cost, not just an
  implementation-effort one.
- **(b) is nearly free to build; (a) is not.** `replacePermissions()` already
  validates, self-escalation-guards, versions, and audits any new catalog
  pair; the Role editor already renders any new catalog action with no
  bespoke code. (a) needs a new table (`department_capability_grants` or
  similar), new repository methods, new audit wiring, a new admin route, and
  a new admin UI section — real, unshared surface area for a single
  yes/no switch.
- **A genuine tradeoff exists and is worth naming, not dismissed by (b)'s
  convenience alone.** Department *is* an organizational-unit concept, and
  "which parts of the org may even see this feature" reads, in isolation, like
  an organizational-policy question rather than a job-function one — the
  same instinct that makes "which Departments can approve expense reports"
  sound natural in other systems. If this organization's actual intent is
  "Sales may do this, Support may not" as an org-chart fact independent of
  any one person's job title, Role modeling still expresses it: Roles here
  are Role-per-Department-function in practice already (the seed roles table
  in `access-model.md` — Sales Executive, Team Leader, Manager, Ops Rep — are
  already department-flavored), and nothing prevents an admin from creating
  a Role "granted to everyone in Sales" if that's genuinely the intended
  shape; the underlying assignment of *people* to that Role is an admin
  decision either way, Department-gated or Role-gated. What (a) would add
  that (b) structurally cannot is a *single* boolean that follows an entire
  Department automatically as people move between Roles inside it — if that
  auto-following behavior is specifically wanted (not just "Sales generally
  gets this"), that is a real, distinct requirement (a) uniquely satisfies
  and worth surfacing before ruling it out.
- **(c), a genuine alternative surfaced by this investigation:** don't add a
  new gate at all — treat opting in as always available to anyone with
  ordinary `leads:view`, on the theory that seeing continued progress on a
  lead you used to own is a strict narrowing (view-only, 30 days, already
  reassigned away) rather than a new privilege. Rejected for this plan
  because the task is explicit that an admin-controlled allow-list is
  wanted ("the admin account will have an option ... to select what all
  ... should have this settings") — this is recorded as the option
  investigation surfaced and set aside, not silently dropped.

**If Department-level gating is confirmed as the actual intent** (the
auto-following behavior above, specifically), the schema change is a new
`Department.allowsReassignmentGraceOptIn: Boolean @default(false)` column,
gated on `users:edit` exactly like every other Department field
(`PUT /departments/:departmentId`), with the eligibility check reading
`outgoingUser.department.allowsReassignmentGraceOptIn` instead of a
`role_permissions` row — a small, isolated change to §"Reassignment hook"
below if this recommendation is rejected. Flagging this now so approval can
pick either path without re-deriving the design.

#### Schema

- `User.retainViewAfterReassignment Boolean @default(false)` — the personal
  opt-in. New migration `00000000000005_reassignment_grace_preference`
  (additive column, trivially reversible — see Rollback).
- No new table for eligibility (Role-based, per the recommendation above —
  `role_permissions` already generic).

#### Self-service opt-in

- `GET /api/v1/auth/me` response gains `retainViewAfterReassignment:
  boolean` (the stored value) — extends the existing self-profile fetch
  already used by `AuthContext`/`SettingsPage` rather than adding a second
  GET. Eligibility itself needs no new field: the frontend already has
  `can('leads', 'retain_view_after_reassignment')` from the existing
  `/auth/capabilities` payload.
- New `PATCH /api/v1/auth/preferences` (`routes/auth.ts` +
  `http/routes/auth.ts`), authenticated, self-only (no `userId` param — always
  the caller's own row). Body: `{ retainViewAfterReassignment: boolean }`.
  Setting `true` re-checks the caller's *current* Role for the permission
  server-side (never trusts the frontend's hidden-toggle enforcement alone —
  same "authorization enforced in the API" rule as everything else);
  rejected with `validation_error` if the Role does not currently hold it.
  Setting `false` is always allowed. Writes `system_audit_logs`
  (`entityType: 'user'`, `entityId: <self>`, `action:
  'reassignment_grace_preference_changed'`, actor = the user themselves,
  old/new booleans) — a personal-account change with lasting effect on
  future reassignments, so it gets the same audit trail as any other material
  mutation, even though it isn't a `leads:*` or `users:*` action.
- **Settings page.** New toggle in `SettingsPage.tsx`, visible only when
  `can('leads', 'retain_view_after_reassignment')` — plain yes/no, matching
  the task's "plain yes/no" framing exactly, with one line of copy explaining
  the consequence ("If a lead is reassigned away from you, you'll keep
  view-only access to it for 30 days").
- **Admin side.** No new admin surface at all — enabling/disabling this per
  Role is already the existing Role Permissions screen
  (`RoleDetailPage.tsx`), which renders the new catalog action automatically.

#### Reassignment hook (shared code, two call sites)

New module `apps/api/src/leads/reassignment-grace.ts`:

```ts
export const reassignmentGraceDays = 30 as const;

export async function maybeGrantReassignmentGrace(
  tx: Tx,
  input: {
    organizationId: string;
    leadId: string;
    actorUserId: string;
    previousUserId: string | null;
    newUserId: string;
  },
): Promise<void> {
  if (input.previousUserId === null || input.previousUserId === input.newUserId) return; // no genuine reassignment
  const previous = await tx.user.findFirst({
    where: { organizationId: input.organizationId, id: input.previousUserId, active: true },
    select: { id: true, retainViewAfterReassignment: true, roleId: true, role: { select: { active: true } } },
  });
  if (!previous?.retainViewAfterReassignment || !previous.role.active) return;
  const eligible = await tx.rolePermission.findFirst({
    where: {
      organizationId: input.organizationId,
      roleId: previous.roleId,
      module: 'leads',
      action: 'retain_view_after_reassignment',
    },
  });
  if (!eligible) return;
  const existing = await tx.userAccessGrant.findFirst({
    where: {
      organizationId: input.organizationId,
      leadId: input.leadId,
      userId: previous.id,
      revokedAt: null,
      actions: { has: 'view' },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (existing) return; // already has standing view access; no duplicate/renewal
  await createTimedAccessGrant(tx, {
    organizationId: input.organizationId,
    leadId: input.leadId,
    userId: previous.id,
    grantedByUserId: input.actorUserId,
    actions: ['view'],
    durationDays: reassignmentGraceDays,
  });
}
```

Called from both hook points, inside their existing transactions:

- `LeadSharingService.reassign()` — after the new assignment is created,
  before/alongside the existing `reassignment` activity write. `old.userId`
  is always non-null here (the method already requires an existing current
  assignment), so the only new guard needed is `old.userId !== input.userId`
  (§"Current state" above — not previously excluded).
- `StatusRoutingService.assign()` — in the branch that creates a genuinely
  new assignment (the early-return "already held" branch needs no change,
  since it never reaches this point). `previous?.userId ?? null` is already
  computed there for the activity's `oldValue`; passed straight through.

Both call sites reuse `createTimedAccessGrant` from Part 1's `sharing.ts` —
**the literal reuse the task asks for**, not a parallel re-implementation:
Part 2's grant is created by the exact same function Part 1's human-initiated
share creation calls, with `durationDays` fixed at 30 and `actions` fixed at
`['view']` instead of caller-chosen.

**Decisions made explicit, as instructed:**

1. **Applies to every assignment type uniformly, not a designated "owner"
   type.** The system has no magic owner assignment type (Phase 9's own
   decision #4, reaffirmed by Phase 20's amendments) — "any current
   assignment matching ..." is how `SELF` scope itself already treats
   "assigned to me." Scoping this feature to one designated type would be new
   product surface (a "primary assignment type" configuration concept that
   doesn't exist yet), not a narrower reading of what exists. Flagged for
   confirmation — if the intent is genuinely narrower (e.g., only the
   `owner`-labeled type in organizations that use one), that is a one-line
   change (an added `assignmentType` filter) once such a configuration
   concept exists, but does not exist today.
2. **Existing standing access short-circuits grant creation, with no
   renewal.** If the outgoing owner already holds any active, non-expired
   grant on this lead with `view` in its actions — whether from a prior
   grace grant or an unrelated manual share — nothing new is created and
   nothing is extended. Renewing someone else's manually-configured share's
   expiry as a side effect of an unrelated reassignment would be a surprising
   action-at-a-distance; not renewing means a lead that bounces between
   owners quickly could let an earlier grace grant's clock run out sooner
   than a naive re-reassignment might suggest, which is judged the lesser
   surprise.
3. **Eligibility revoked after grants already exist: honored to natural
   expiry, never retroactively revoked.** Reassignment-time eligibility is
   evaluated live, once, at grant-creation time, exactly like every other
   fresh-per-request check in this system (Status Visibility itself is
   re-evaluated "on every request... with no transition-specific
   invalidation" per `access-model.md`, but that describes ongoing checks —
   this grant, once created, is a historical fact about one specific
   completed event, not an ongoing entitlement re-derived from current Role
   state). No code in this codebase retroactively invalidates a
   `user_access_grants` row because the granting condition later changed —
   a Lead Share isn't stripped if the sharer's own permissions are later
   reduced, either. Building a sweep that revokes grants when a Role loses
   this permission would be new, one-off infrastructure solely for this
   feature, and would also have to answer "revoke immediately, or from
   audit-log replay, or with what grace of its own" — real complexity for a
   scenario (admin turns the feature off shortly after someone's grant fires)
   that is a narrow window by construction (grants are 30 days; revocation
   would only matter for grants created inside whatever gap exists before an
   admin disables the Role permission). The personal opt-in boolean itself is
   also not force-cleared when eligibility is revoked — it simply becomes
   dormant, re-evaluated fresh (and re-becomes live) if eligibility is
   restored later.

## Files to touch

**Part 1**
- `apps/api/src/leads/sharing.ts`
- `apps/api/src/http/routes/leads.ts`
- `apps/web/src/types/domain.ts`
- `apps/web/src/lib/api-client.ts`
- `apps/web/src/pages/seller-detail/LeadShareDialog.tsx`
- `apps/web/src/pages/seller-detail/LeadShareDialog.test.tsx`
- `apps/web/src/mocks/handlers.ts`, `apps/web/src/mocks/fixtures.ts`
- `apps/api/src/__tests__/phase9.postgres.integration.test.ts`
- `docs/api/endpoints.md`, `docs/permissions/access-model.md` (mention of
  required duration on shares)

**Part 2**
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/00000000000005_reassignment_grace_preference/{migration.sql,rollback.sql}`
- `packages/permission-engine/src/catalog.ts`
- `apps/api/src/leads/reassignment-grace.ts` (new)
- `apps/api/src/leads/sharing.ts` (export `createTimedAccessGrant`; call the
  new hook from `reassign()`)
- `apps/api/src/routing/service.ts` (call the new hook from `assign()`)
- `apps/api/src/routes/auth.ts`, `apps/api/src/http/routes/auth.ts`
  (`/auth/me` field, new `PATCH /auth/preferences`)
- `apps/web/src/pages/settings/SettingsPage.tsx`,
  `apps/web/src/pages/settings/SettingsPage.test.tsx`
- `apps/web/src/app/AuthContext.tsx` (surface the new `/auth/me` field)
- `apps/web/src/lib/api-client.ts`, `apps/web/src/types/domain.ts`
- `apps/web/src/mocks/handlers.ts`, `apps/web/src/mocks/fixtures.ts`
- `apps/api/src/__tests__/phase14b.postgres.integration.test.ts` (routing
  path)
- `apps/api/src/__tests__/phase9.postgres.integration.test.ts` (manual
  reassignment path — same file Part 1 already extends)
- New `apps/api/src/__tests__/phase21.postgres.integration.test.ts` for the
  eligibility-gate and cross-organization-isolation cases that don't belong
  naturally in either existing file
- `docs/permissions/access-model.md`, `docs/api/endpoints.md`,
  `docs/requirements/glossary.md` (if Department's role changes — it
  shouldn't, per the recommendation)
- New ADR `docs/architecture/decisions/0023-reassignment-grace-visibility-gating.md`
  recording the Role-vs-Department decision, written once approved and
  implemented, per this project's practice of not writing ADRs pre-approval

## Out of scope

- Any change to `main` or to Phase 20 itself — this phase only consumes
  Phase 20's mechanism as it exists on this branch today.
- A "permanent" share option (§Part 1 decision above) — revisit only on
  explicit request.
- Extending or renewing an existing share's/grant's expiry from the UI
  (Part 1's `update()` stays capability-replacement-only, unchanged).
- Making the automatic 30-day grant bypass Status Visibility's routing-based
  narrowing (see Risk 1) — no per-grant bypass mechanism exists, and building
  one is materially bigger than this phase.
- A configurable grace-period length for Part 2 (fixed at 30 days, per the
  task) or a configurable "primary assignment type" concept (§Part 2 decision
  1).
- Retroactive revocation of grants on eligibility change (§Part 2 decision 3).
- A Department-level capability-gating mechanism in general — only sketched
  as the fallback if recommendation (b) is rejected for this one feature.

## Risks / open questions

1. **The 30-day grace grant can be silently neutralized by Status
   Visibility.** Per `access-model.md`: once a lead's current Status has an
   active routing rule, visibility narrows to the assignee plus their
   manager chain, and "nothing bypasses it, including a
   deliberately-granted share." If the previous owner is not in the new
   assignee's manager chain and the lead later sits in (or already sits in)
   a routed Status, their grace grant exists in the database and satisfies
   `leads:view`'s record-scope check, but the request still gets denied by
   the separate, unconditional Status Visibility check. "Retain view access
   for 30 days" is therefore a slightly weaker guarantee than a literal
   reading suggests under the currently-approved (but not yet merged)
   Phase 20 mechanism — flagged per the sequencing note, and worth
   confirming this is acceptable before implementation, since fixing it
   would mean inventing a per-grant Status-Visibility-bypass concept that
   does not exist anywhere in the system today (`bypass_status_visibility`
   is Role-level, not attachable to one grant).
2. **Reassignment-type genericity (§Part 2 decision 1)** — confirm the
   intent is "any assignment type," not a specific "owner" type this task's
   wording (`their former lead`) might have had in mind without realizing no
   such type is distinguished in the data model.
3. **Bootstrap default for the new catalog action.** Proposed as
   bootstrap-granted (like most of the catalog, unlike `purge`) since it
   carries no destructive risk — but it does expand exposure of Lead data
   after reassignment, which some organizations may want off by default even
   for a fresh admin. Confirm before implementing; flipping it to
   `withheldFromBootstrap` is a one-line change in `catalog.ts` either way.
4. **Existing-standing-access short circuit (§Part 2 decision 2)** — confirm
   "don't renew a pre-existing unrelated share" is the right call over
   "always ensure at least 30 days remain."

## Test plan

Per `docs/testing/quality-gates.md`; real Postgres, synthetic fixtures only.

**Part 1** (`phase9.postgres.integration.test.ts`):
- `create()` rejects a missing/out-of-range `durationDays` (`invalid_duration`).
- `create()` with each of 7/30/60 produces `expiresAt` within a small
  tolerance window of `now + N days`, never trusting a supplied timestamp —
  assert by calling the service with a forged `expiresAt`-shaped extra field
  and confirming it has no effect (the computed value only depends on
  `durationDays`).
- `share_changed` activity's `newValue` includes `durationDays` and
  `expiresAt`.
- HTTP contract test: `POST /leads/:id/shares` 400s without `durationDays`.
- Existing expiry-enforcement coverage (list/filter-sql/single-record) is
  already proven by the current suite (`sharing.ts:322-326`-style rows) and
  is re-run unmodified, not re-derived, confirming Part 1 didn't regress it.
- Web: `LeadShareDialog.test.tsx` — Share disabled until a duration is
  picked; expiry text renders from `expiresAt`.

**Part 2:**
- `phase9.postgres.integration.test.ts` (manual path): a synthetic user with
  `retainViewAfterReassignment: true` and an eligible Role, reassigned away
  from a lead, gains a `view`-only grant expiring ~30 days out; the same
  scenario with the preference `false`, or an ineligible Role, or the
  "reassigned to the same user" case, creates no grant. A pre-existing active
  `view` grant is not duplicated or renewed.
- `phase14b.postgres.integration.test.ts` (automatic path): the identical
  matrix, driven through a routing rule's automatic reassignment rather than
  the manual endpoint — proving both trigger points produce identical
  outcomes through the same shared helper. Include the "already held by
  chosen candidate" branch producing no grant (nothing changed).
- New `phase21.postgres.integration.test.ts`:
  - Eligibility gate: granting/revoking `leads:retain_view_after_reassignment`
    on a Role changes whether that Role's users' opt-in takes effect at the
    next reassignment, without needing to touch anything already granted.
  - `PATCH /auth/preferences` rejects setting `true` when the caller's Role
    lacks the permission; allows setting `false` regardless; audits both.
  - **Expiry actually stops access, not just the field being set**: create a
    grace grant through a real reassignment, then directly update its row's
    `expiresAt` into the past (the same technique `phase9`'s existing tests
    already use) and prove the former owner is denied on list, detail, and
    `authorize()` afterward — not merely that the column holds a past date.
  - Cross-organization isolation: a same-named Role/permission pair in a
    second synthetic organization does not make an unrelated org's user
    eligible; a grant never leaks across `organizationId`.
  - Confirms Risk 1 empirically: a grace-period grant on a lead whose current
    Status has an active routing rule, held by someone outside the new
    assignee's manager chain, is still denied — documenting the interaction
    with a passing test rather than leaving it as a paper risk.
- Run `pnpm --filter @falcon/permission-engine test` (catalog/pairs unaffected
  but re-run for safety), targeted API integration tests, `pnpm --filter
  @falcon/web test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm
  format:check`.

## Rollback plan

- Part 1 has no schema change — a plain `git revert` of the service/route/UI
  diff is fully sufficient; already-created shares with a real `expiresAt`
  stay exactly as they are (still enforced by the read paths, which are
  untouched).
- Part 2's migration adds one nullable-with-default boolean column
  (`User.retainViewAfterReassignment`, default `false`) — reversible by a
  straightforward `DROP COLUMN` `rollback.sql`, since no other write path
  depends on its presence and no data would be silently lost that isn't
  already recoverable from `system_audit_logs` (every preference change is
  audited). Grants already created by the reassignment hook are ordinary
  `user_access_grants` rows and are unaffected by rolling back the column —
  they simply become grants with no corresponding toggle to have produced
  them, which is fine since they are self-contained, already-issued,
  time-bounded records.
- Application rollback (service/route/UI/catalog changes) is a coordinated
  revert; the new catalog action disappearing mid-flight only means
  `isPermissionPair` stops recognizing it — any `role_permissions` rows for
  it become inert (matching how a retired catalog pair already behaves
  elsewhere in this codebase, e.g. the recent
  `leads:bulk_reassign`/`leads:bulk_status_change` retirement), not an error.
