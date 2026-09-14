# ADR-0022: Show a scope selector only where scope is enforced; retire unimplemented catalog actions

**Status:** Accepted and implemented.

## Context

A review of the Roles & Permissions editor asked a direct question: every
action in the catalog gets an identical SELF/TEAM/DEPARTMENT/ORGANIZATION
scope selector — does picking a scope actually change anything for every
one of them?

Tracing every `resolveAuthorization` call site by hand answered it: no.
`DataScope` answers one specific question — "which records, based on who
they're currently assigned to, may this role reach" — and that question
only has an answer for an action the server checks against a specific,
existing record (`AuthorizationRequest.leadId`, or the `RecordPredicate` a
list/export/campaign query builds from it). Concretely:

- **Genuinely enforced:** `leads:view/edit/comment/delete`, and
  `attachments:upload/download/delete` (checked against the Lead the
  attachment belongs to, via `http/routes/attachments.ts`'s
  `allowedOnLead`).
- **Structurally cannot mean anything:** `leads:create` — there is no
  existing Lead yet to check "whose is this" against.
- **Deliberately substituted for another action's scope, documented
  (ADR-0016):** `leads:export`, `leads:import`, and `campaigns:send` each
  have their own gate check (a bare "is this granted at all," no record
  named) and separately reuse `leads:view`'s scope for the actual record
  set. Their own stored scope value is never read.
- **Never wired to a record at all, no prior decision recorded:** every
  action in `fields`, `journeys_statuses`, `services`, `users`,
  `roles_permissions`, `campaigns` (`view`/`create`/`edit`),
  `lead_routing` (all three), and `integrations`. None of these routes
  ever pass a record id to `resolveAuthorization`, so `recordAllowed`
  is unconditionally `true` regardless of the stored scope — picking
  `SELF` for `users:deactivate`, say, deactivates every User in the
  organization exactly as `ORGANIZATION` would.
- **Deliberately scope-independent by design (ADR-0021):**
  `leads:bypass_status_visibility` — a role-level boolean, never a
  per-record question.

The second bullet's inverse — the "never wired, no decision recorded"
group — is the one worth calling out plainly: an admin picking `SELF` for
`journeys_statuses:edit` reasonably believes they have restricted that
role to Journeys it created. They haven't, at all. The selector doesn't
lie about what value is stored; it lies about what that value does. That
is a real trust problem in its own right, independent of the wasted
`RecordPredicate` computation the same unconditional-scope-resolution
means every one of these checks performs (including, for `TEAM` scope,
the hierarchy walk) only to have the result thrown away unread.

The same review found two catalog entries that were not merely
inert-scoped but **entirely unimplemented**: `leads:bulk_reassign` and
`leads:bulk_status_change` (grantable since Phase 1, honoured by no
route — `docs/api/endpoints.md` already said so), and the whole `reports`
module (`view_standard`/`view_financial`/`build_custom`, a Phase 2
placeholder with no route file at all). An admin could check these boxes
and observe nothing, ever — a different, more basic version of the same
"the control lies about what it does" problem.

## Decision

**1. The catalog names which of its own actions are scoped.** Each
`permissionCatalog` entry may declare `scopedActions: readonly string[]`
(mirroring the existing `withheldFromBootstrap` convention) — the actions
within that module whose granted `DataScope` a real route consults. An
entry with no `scopedActions` at all means none of its actions are
scoped. `isScopedAction(module, action)` answers the question generically
and is exported alongside the catalog's other predicates
(`isPermissionPair`, `isGrantedOnBootstrap`).

Today that is exactly `leads: [view, edit, comment, delete]` and
`attachments: [upload, download, delete]` — every other module declares
none.

**2. `GET /permissions/catalog` carries it through unchanged** — the route
already serializes the whole catalog wholesale, so `scopedActions` reaches
the web client for free, the same way `withheldFromBootstrap` already
does.

**3. The Role editor shows a real selector only where `isScopedAction` is
true**, and a fixed "Always organization-wide" label otherwise — never an
interactive control that would accept any of four values and honor none
of them. Saving normalizes every unscoped action's stored scope to
`ORGANIZATION` (`permission-matrix.ts`'s `normalizeScopes`, applied once
at the save boundary) — not because it's enforced, but so the stored data
reads as the true, unconditional-everywhere behavior rather than an
arbitrary leftover value. This corrects a role saved before the
distinction existed, or one just bulk-rescoped by "Set all scopes…" (which
applies one value to every granted row without knowing which are
unscoped), the next time it's saved — no separate data migration needed,
because the previously-stored value was never behaviorally wrong, only
cosmetically misleading.

**4. `leads:bulk_reassign`, `leads:bulk_status_change`, and the entire
`reports` module are retired from the catalog outright**, not merely
left alone. A migration deletes any existing `role_permissions` rows for
these pairs — bootstrap granted all of them, since none were
`withheldFromBootstrap`, so live rows exist wherever bootstrap has run.
If a real bulk-lead-action or reporting feature is built later, it adds
its own catalog entry (and, per this ADR, decides `scopedActions` for it
deliberately) rather than reactivating a placeholder that was never wired
to anything.

## Consequences

**No enforcement behavior changes.** This ADR touches only what the Role
editor offers and what the catalog defines — `resolveAuthorization`,
`RecordPredicate`, and every route's actual authorization logic are
unchanged. A role that already had, say, `TEAM` stored for
`journeys_statuses:edit` continues to behave exactly as it always did
(unconditionally unrestricted) until that role is next saved through the
editor, at which point the stored value is corrected to reflect that.

**The catalog is now the single place a scope's real applicability is
decided**, matching the project's own recurring preference for one
source of truth over a second place that could drift (the same reasoning
`bootstrapGrantedPairs`' own doc comment already gives for
`withheldFromBootstrap`). A future module gets scope-selector treatment
by declaring `scopedActions` explicitly, not by inheriting whatever the
UI happened to render for everything else.

**`integrations:configure` was found to be unimplemented by the same
measure** (no route file exists at all, exactly like the retired
`reports` module) but is deliberately left in the catalog by this ADR —
retiring it was not part of what this review's audit was asked to act on,
and is named here as a candidate for the same treatment, not decided by
it.
