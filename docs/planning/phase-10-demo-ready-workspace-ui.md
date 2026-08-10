# Phase 10 — Demo-ready workspace UI

Status: approved 2026-08-05. **Delivered and closed out.**

Follow-on work continued in phases 11 and 12, which finished the seller record
this phase left as a two-card stack.

All five sections are built: foundations (config-transport fixes, status-tone
extraction, query-key factory, shared JourneyTabs, Dialog), shell polish
(collapsible sidebar, scoped Topbar refresh, nav reshuffle), Settings,
Dashboard, the Org chart, and the Board with its optimistic move and
rejected-drag revert.

Gates at completion: format, lint (0 errors), typecheck, test (94 web tests
across 21 files, 43 API tests), and build all pass.

The one backend change in this phase is additive and read-only:
`GET /journeys/:journeyId` now also returns `assignmentTypes`, the distinct
types currently in use across that Journey's process instances. Nothing else
enumerated them — `assignments.assignment_type` is configurable free text with
no enum, and `docs/api/endpoints.md` states the API "does not invent or require
any canonical owner type string" — so the Lead form had no honest source and
was hardcoding `'owner'`.

Two deviations from the plan as written, both noted in Risks below:

- The route is `/board`, labelled **Board** rather than "Kanban".
- `@dnd-kit/core`'s shipped types reference the global `JSX` namespace that
  React 19 removed, so `src/types/jsx-global-shim.d.ts` aliases it to
  `React.JSX`. Remove that file once dnd-kit ships React 19-compatible types.

Real dragging is not covered by the automated tests — jsdom has no layout, so
dnd-kit's collision detection can never resolve a drop target. The tests drive
the identical mutation through each card's Move menu; verifying the drag gesture
itself is a Playwright/manual task, consistent with quality-gates assigning
end-to-end flows to Playwright.

## Context

Falcon CRM today is one working list screen (`/sellers`) plus a complete Phase 8 admin
section. The Sidebar advertises Dashboard, Tasks, Finance and Settings as permanently
disabled "Coming soon" labels with no routes behind them. That is an honest state of the
world, but it demos badly: the engine's most interesting properties — configurable
journeys/statuses, the permission engine, per-status required fields — are invisible
unless you already know where to look.

Phase 10 makes the workspace demo-ready **without inventing capability that doesn't
exist**. It adds four real surfaces (Board, Dashboard, Org chart, Settings) built strictly
on endpoints that are actually implemented, and polishes the shell. The single most
important behavior is the Board's rejected-move path: dragging a card to a status that
would leave a required field empty must optimistically move, then visibly revert and
explain itself. A demo that silently drops a card there is worse than no board.

Research turned up four defects that this phase must confront rather than build on top of.
They are recorded in **Current state** and **Risks** because AGENTS.md requires flagging
doc/code conflicts rather than quietly resolving them.

---

## Goal

Ship Board, Dashboard, Org chart and Settings as real routes in `apps/web`, plus a
collapsible sidebar and scoped refresh — reusing the existing design system and driving
every label from runtime configuration, with the Board's rejected-move revert as the
centerpiece.

## Docs read

- `AGENTS.md`, `PLANS.md`
- `docs/planning/phase-8-admin-frontend-plan.md` (frontend precedent)
- `docs/permissions/access-model.md`
- `docs/testing/quality-gates.md`
- `docs/api/endpoints.md` (source of three of the four contradictions below)
- `docs/data-model/schema.md` (field/status requirement modelling)

## Current state

**Frontend.** React 19 + Vite 8 + Tailwind v4 (CSS-first `@theme`, no config file) +
TanStack Query 5 + React Router 7 + MSW 2 + Vitest/RTL. `theme.css` defines brand
ink/gold/paper, a deliberately separate 6-tone status palette, Archivo/Inter, and
radius/shadow tokens — light mode only. `components/ui/*` holds 14 primitives. Auth and
permissions come from `useAuth()` → `can(module, action)`; routes are gated by
`PermissionRoute`. `AppShell` owns one piece of state (`mobileNavOpen`) and renders a fixed
`w-64` Sidebar that has no collapse concept. `JourneyTabs` is page-local to `pages/sellers/`.

**Verified API surface.** `GET /leads` returns `{ total, rows }` where `total` is a
`prisma.lead.count` using the *same* scoped predicate as the list — so per-status counts
derived from it are automatically scope-correct. `PATCH /leads/:id` targets
`processInstanceId` from the body and takes `journeyId` + `assignmentTypes` for the
authorization decision.

**Confirmed absent — do not build against these.** No Tasks API (zero `task` matches in
`apps/api/src`, despite a `Task` Prisma model and documented `GET /tasks`). No
aggregate/reports endpoints. No activity-log API (`activity_logs` is written by
`apps/api/src/leads/activity.ts` but exposed on no route). No self-profile-update endpoint.

### Four defects found, all verified in source

1. **`configApi.journeys()` and `configApi.fields()` resolve to `undefined` under MSW.**
   `handlers.ts:285` returns a bare array unless the request carries `pageSize`, and
   neither client method sends one — so `.items` is `undefined`. **JourneyTabs renders
   zero journeys, and the Lead form renders zero dynamic fields, in dev and in every test
   today.** Nothing catches it. Fixing this is a *prerequisite* for Phase 10, since the
   Board's journey switcher and the field-label lookup both depend on these calls.
2. **`configApi.statuses()` calls a route that doesn't exist.**
   `GET /journeys/:id/statuses` is registered only for `POST`
   (`apps/api/src/http/routes/configuration.ts`). It is mocked and documented, so it works
   in dev/test and 404s in production, silently emptying the Seller List status filter.
   `GET /journeys/:id` *is* registered and returns nested `statuses[]` already filtered to
   active and ordered by `[sortOrder asc, id asc]`.
3. **`assignmentTypes` is load-bearing and `LeadFormPage` omits it.**
   `assignmentScopeAllowsLead` (`packages/permission-engine/src/scope.ts:95`) returns
   `true` immediately only for `ALL_ORGANIZATION_USERS`; otherwise an empty
   `assignmentTypes` fails the check. So `LeadFormPage.tsx:71` works for the
   ORGANIZATION-scoped demo admin and silently 403s for SELF/TEAM/DEPARTMENT users.
4. **`Status` DTO drift.** `types/domain.ts` declares `isActive`; Prisma and the real API
   emit `active`; the MSW fixture emits `isActive`. Needs a normalizer.

---

## Proposed approach

### 0. Foundations (build first, nothing user-visible)

- **Fix the MSW Page-vs-array bug** (defect 1) — always return `pageResponse(...)` for
  `GET /journeys` and `GET /fields`; delete the bare-array branch. Expect journey tabs and
  lead-form fields to start rendering, which may require updating a couple of existing tests.
- **Re-point `configApi.statuses`** at `GET /journeys/:id`, mapping `(j.statuses ?? [])`
  through a `normalizeStatus` that tolerates `active`/`isActive` and re-sorts by
  `sortOrder`. Query key `['statuses', journeyId]` is unchanged, so the Board shares a
  cache entry with the Seller List filter. Delete the phantom `/statuses` MSW handler so a
  regression can't pass silently. Update `docs/api/endpoints.md` to match the implemented
  routes, and open an ADR in `docs/architecture/decisions/` recording the doc-vs-code
  resolution (PLANS.md requires this rather than a silent edit).
- **Extract `components/ui/status-tone.ts`** — move `toneFor` + the tone table out of
  `StatusPill.tsx` verbatim, adding `STATUS_TONE_VAR` / `STATUS_TONE_BG_VAR` maps to
  `var(--color-status-*)` for SVG fills. `StatusPill` imports them and is visually
  unchanged; the chart and column headers now derive color from the *same* function, keyed
  only off `outcomeType`/`behaviorType`. Gold stays unreachable by construction.
- **`lib/query-keys.ts`** — one `qk` factory. Existing keys keep their exact shape;
  new roots are `['board', journeyId, statusId]`, `['dashboard', ...]`, `['directory', ...]`,
  chosen as strict prefixes so invalidation can target a whole surface or one column.
- **`components/journeys/JourneyTabs.tsx`** — promote the page-local component, adding an
  `allowAll` prop (the Board requires a journey; the Dashboard doesn't).
- **`components/ui/Dialog.tsx`** — modal shell (backdrop, `role="dialog" aria-modal`,
  Esc-to-close, initial focus) generalised from the existing `LeadShareDialog`.

### 1. Shell polish

- **Sidebar** gains `{ collapsed, onToggleCollapse }`. Root transitions `w-64 → w-16` with
  `motion-reduce:transition-none`. Labels become `sr-only` when collapsed while the link
  keeps `title` + `aria-label`, so every item stays reachable by accessible name. Toggle
  button carries `aria-expanded`/`aria-controls`.
- **Mobile safety:** `AppShell` passes `collapsed={false}` *literally* to the drawer
  instance — only the desktop instance reads the preference — and the toggle is
  `hidden lg:flex`. This is the requirement most likely to regress, so it gets its own test.
- **Nav:** `Dashboard → /dashboard`, `Sellers → /sellers`, `Board → /board` as primary;
  `Org chart → /admin/org-chart` joins Administration under `can('users','view')`;
  `Settings → /settings` at the bottom. "Coming soon" shrinks to **Tasks and Finance only**,
  still non-interactive `aria-disabled` spans — not faked.
- **Scoped refresh** via a new `app/page-chrome.tsx` context: a route declares
  `usePageChrome(title, refreshKeys)`; `RefreshButton` awaits
  `Promise.all(refreshKeys.map(k => invalidateQueries({ queryKey: k })))` and spins until
  it settles. Default `refetchType: 'active'` means only mounted queries refetch — that is
  precisely "the active route's keys", not the whole cache. Disabled when a route declares none.
- **`app/preferences.tsx`** — `sidebarCollapsed` + `tableDensity` in localStorage via a
  guarded `useLocalPreference` (Safari private mode throws on write).

Route naming: path `/board`, nav label **"Board"** — every other nav item is a product
noun, and "Kanban" is implementation jargon. Say the word and it becomes `/kanban`.

### 2. Board

**Dependency: `@dnd-kit/core`** (the only new production dep; AGENTS.md requires the
justification in the PR description). Keyboard dragging is a hard requirement and HTML5
DnD cannot satisfy it — `dragstart`/`dragover` are pointer-only and jsdom implements no
`DataTransfer`, making a hand-rolled version untestable here. dnd-kit ships a
`KeyboardSensor` and an `accessibility={{announcements}}` API. It is *not* a component
library: zero styles, zero DOM, just hooks — our markup and tokens stay ours. One package
only (no `@dnd-kit/sortable`; column order is server-side `updatedAt desc`). Rejected:
`react-beautiful-dnd` (unmaintained, no React 19), `pragmatic-drag-and-drop` (no keyboard
layer), hand-rolled (more code than the dep, and we'd own the whole a11y story).
A ~30-line custom `KeyboardCoordinateGetter` snaps ←/→ to adjacent columns.

**Columns** = `configApi.statuses(journeyId)`, active only, `sortOrder` order.
**Cards** = one `useInfiniteQuery` per column on `['board', journeyId, statusId]` calling
`sellersApi.list({ journeyId, statusId, page, pageSize: 10, sortBy: 'updatedAt' })`, with a
per-column "Load more". Never fetch all leads and group client-side. **The header count is
`pages[0].total`** — the server's scoped count — never `rows.length`.

**Read-only when `!can('leads','edit')`:** `DndContext` stays mounted with `sensors={[]}`
and every draggable `disabled` (so hooks stay unconditional), `MoveStatusMenu` is not
rendered, and an info `Banner` explains why. The board is **not** hidden.

**The rejected-move flow (the centerpiece).**

`mutationFn` sources the payload correctly — `SellerListRow.processInstances[]` carries
`processInstanceId`/`journeyId` but **not** `assignmentTypes`, which decides authorization
for non-ORGANIZATION scopes (defect 3). So it `ensureQueryData`s the lead detail on the
existing `['seller', id]` key (prefetched on drag start, so usually a cache hit) and reads
real assignment types from it. No `fieldValues` key is sent, so `requestedEditFieldIds` is
empty and the required-field check is what we surface.

- `onMutate`: cancel both column queries, snapshot both, then `removeRow` from source and
  `insertRowAtHead` into destination **only if the destination has already been fetched**
  (an unfetched column must show server truth on first load, not a synthetic insert).
  `total` is duplicated on every page object, so the pure helpers in `board/board-cache.ts`
  adjust it uniformly on every page.
- `onError`: restore both snapshots wholesale — this reverts rows *and* totals in one step,
  with no arithmetic and no drift if the same card moved twice. Then classify, trusting the
  server rather than re-deriving requirement rules:

  ```ts
  const missingFieldId =
    error instanceof ApiError && error.status === 400 &&
    error.code === 'validation_error' && typeof error.details?.fieldId === 'string'
      ? error.details.fieldId : null;
  ```

  | Case | UI |
  |---|---|
  | `missingFieldId` | `MoveRejectedDialog`: names the field, links to `/sellers/:id/edit` |
  | `403 forbidden` | error `Banner` via `friendlyErrorMessage` |
  | `400`, no `fieldId` | banner + invalidate `['statuses', journeyId]` |
  | `409` / `404` | banner + invalidate `['board']` |

  Every branch also writes to an `aria-live="polite"` region, so a keyboard user learns the
  card snapped back.
- `onSettled`: invalidate both columns, `['seller', id]`, and — marked stale only, since
  they're inactive — `['sellers']` and `['dashboard']`.

Because the API reports **only the first** failing `fieldId`, the dialog says "needs *X*
filled in first" and never claims to be exhaustive. `requiredFromStatusId` is exact-match;
we never re-implement a `sortOrder` heuristic.

**Field label** resolves via `configApi.fields()` then `adminApi.journeyFields(journeyId)`
(both need `fields:view`). A lead-only user gets a **first-class no-label copy variant** —
"needs a required field filled in first" — never a raw UUID.

**`MoveStatusMenu` is not optional.** Every card carries a "Move…" button opening a listbox
of the journey's other active statuses, calling the identical mutation. It's the guaranteed
path for touch and keyboard, and it's what the tests drive (jsdom has no layout, so
dnd-kit's collision detection can't resolve a target — a known jsdom limitation).

### 3. Dashboard

Counts come from `sellersApi.list({ journeyId, statusId, pageSize: 1 })` read off `total`,
one `useQueries` entry per status — reusing the server-side scoped predicate so numbers
respect each viewer's scope automatically. Client-side summation of fetched rows would be
both wrong and a scope leak. The "Sellers in your view" figure is its **own** `pageSize: 1`
request with no `statusId`, because summing per-status totals breaks the moment a lead has
two process instances.

Cost control: `statuses.length + 3` parallel requests per journey, `staleTime: 60_000` on
counts (so navigating back within a minute is free), and a `MAX_CHARTED_STATUSES = 24`
guard with a muted "showing the first 24 of N" note.

**Charts are hand-rolled SVG** — percentage-width `<rect>`s, no `viewBox` (sidesteps
aspect-ratio distortion and needs no measurement), grouped by the three `OutcomeType`
values. Fills are `var(--color-status-*)` via `statusTone(...)` only. The `<svg>` is
`aria-hidden`; labels and numbers are real HTML beside it, so the data is both
screen-reader accessible and assertable with `getByText`.

**"Recently updated"**, not "Recent activity" — titled honestly with a caption noting there
is no activity-log API, backed by `sellersApi.list({ sortBy: 'updatedAt', pageSize: 8 })`.
A second panel shows the **real** notifications feed on the key `NotificationBell` already
uses. **No tasks card at all**, with a code comment recording why.

### 4. Org hierarchy tree

Pages through *all* users with the existing `loadAllPages` helper
(`pages/admin/shared.tsx:130`, already loops at the API's max `pageSize: 100`) and renders
nothing but a `role="status"` skeleton until complete — no partial tree.

`buildHierarchy()` in `pages/admin/org-hierarchy.ts` is pure and O(n), colouring the graph
**iteratively** (`visiting`/`safe`/`cyclic`) — a recursive walk would blow the stack before
any guard fired. Cycle members become flat roots carrying `cycleWith`, and their
non-cyclic reports still attach beneath them so nobody disappears. Also handles multiple
roots, self-managers, and managers outside the returned set (`rootReason:
'manager_missing'`). A `MAX_DEPTH = 64` render guard exists as belt-and-braces. Warnings
render in an info `Banner` naming **people**, never UUIDs.

Markup is `role="tree"`/`treeitem`/`group` with `aria-expanded`/`aria-level`; search
computes matches ∪ ancestors, auto-expands to them, and wraps hits in `<mark>`. Reuses
`RingAvatar`. Role names need `roles_permissions:view`, so that query is `enabled`-guarded
and degrades to a muted "Role hidden" rather than failing the page. Gated behind the
existing `<PermissionRoute module="users" />` block — no new guard code.

Inactive users get a plain pill, **not** `StatusPill`, whose semantics belong to lead statuses.

### 5. Settings

Four `Card` sections, all genuinely backed: **read-only profile** (no self-update endpoint
exists), **your access** (journey count + modules/actions from `capabilities` — the honest
way to show the permission engine in a demo), **appearance** (sidebar + density, localStorage,
no API), and **session** (sign out). One muted line: *"Organisation and notification settings
aren't available in this release."* No screens for them.

Density touches **row padding only, on the `sm:`-and-up table** (`py-3` → `py-1.5`); the
mobile card list keeps its padding. It must never change which layout renders, any
breakpoint, font size, or column visibility.

---

## Files to touch

**New — foundations:** `app/page-chrome.tsx`, `app/preferences.tsx`, `app/use-sign-out.ts`,
`lib/use-local-preference.ts`, `lib/query-keys.ts`, `components/ui/status-tone.ts`,
`components/ui/Dialog.tsx`, `components/journeys/JourneyTabs.tsx`,
`components/layout/RefreshButton.tsx`

**New — Board:** `pages/board/{BoardPage,BoardColumn,BoardCard,MoveStatusMenu,MoveRejectedDialog}.tsx`,
`pages/board/{useMoveLeadStatus.ts,board-cache.ts,keyboard-coordinates.ts}`

**New — Dashboard:** `pages/dashboard/{DashboardPage,StatusDistributionChart,RecentlyUpdatedPanel}.tsx`

**New — Org chart:** `pages/admin/{OrgChartPage,OrgNode}.tsx`, `pages/admin/org-hierarchy.ts`

**New — Settings:** `pages/settings/SettingsPage.tsx`

**New — tests:** `pages/board/{board-cache.test.ts,BoardPage.test.tsx}`,
`pages/admin/{org-hierarchy.test.ts,OrgChartPage.test.tsx}`,
`pages/dashboard/DashboardPage.test.tsx`, `pages/settings/SettingsPage.test.tsx`,
`components/layout/AppShell.test.tsx`

**Modified:** `apps/web/package.json` (add `@dnd-kit/core`), `src/App.tsx` (4 routes +
`PreferencesProvider`), `components/layout/{AppShell,Sidebar,Topbar}.tsx`,
`components/ui/StatusPill.tsx` (import extracted tone module), `lib/api-client.ts`
(re-point `statuses`, normalize DTOs), `lib/constants.ts`, `types/domain.ts`
(`JourneyStatusDto`), `pages/sellers/SellerListPage.tsx` (new import, density, page chrome),
`mocks/handlers.ts` (Page fix, `active` on statuses, required-field rejection path),
`mocks/fixtures.ts` (synthetic directory users)

**Deleted:** `pages/sellers/JourneyTabs.tsx` (moved)

**Docs:** `docs/planning/phase-10-demo-ready-workspace-ui.md` (this plan),
`docs/api/endpoints.md` (correct the phantom routes),
`docs/architecture/decisions/ADR-00NN-*.md` (doc-vs-code resolution)

## Out of scope

- The permission engine, the Lead service, and existing mutation semantics — untouched.
- Any Tasks, Finance, Reports, or activity-log UI. Tasks and Finance stay disabled labels.
- Org/notification settings screens (no API behind them).
- Backend implementation of anything. The one endpoint proposed below is **proposed only**
  and awaits explicit approval.
- Seller List / Seller 360 redesign; intra-column card ordering; dark mode.
- Fixing `LeadFormPage`'s missing `assignmentTypes` (defect 3) — see Risks.

## Risks / open questions

1. **`journeys_statuses:view` gating is the biggest open question.** `readConfiguration`
   requires it for both `GET /journeys` and `GET /journeys/:id`, so a user holding only
   `leads:view` cannot read journeys or statuses at all — no board columns, no journey
   tabs, no dashboard breakdown, even though they can see the leads themselves. Per your
   direction I am **proposing, not implementing**, an additive read-only endpoint exposing
   active statuses for journeys the viewer can access, gated on `leads:view` rather than
   `journeys_statuses:view`. **This needs your approval before any backend work.** Until
   then the frontend degrades gracefully: a 403 renders an explicit `EmptyState`
   ("Your role can see sellers but not the journey configuration this board is built
   from") — never a crash or an infinite spinner. Note the cheaper non-code alternative:
   grant `journeys_statuses:view` to the rep role as configuration.
2. **The same gate hits field labels.** `fields:view` is required to name the missing field
   in the rejected-move dialog. The no-label copy variant ships regardless, but the *good*
   version of that dialog depends on the same decision as (1).
3. **`docs/api/endpoints.md` documents `GET /tasks`, `PATCH /tasks/:id/complete` and five
   `/reports/*` endpoints that do not exist.** Flagged per AGENTS.md rather than resolved
   silently; recommend marking those sections "not implemented" in the docs PR.
4. **~~`LeadFormPage` omits `assignmentTypes` (defect 3)~~ — fixed.** Both halves were
   wrong in different ways, and only one of them 403s:
   - **Edit** omitted `assignmentTypes` entirely, sending `[]`. That is the actual 403:
     `assignmentScopeAllowsLead` only matches a record through a current assignment whose
     type is in the caller's set, so any scope narrower than ORGANIZATION was denied. It
     now sends the lead's real assignment types.
   - **Create** hardcoded `'owner'`. This never 403s — `decision.ts:114` sets
     `recordAllowed = leadId === undefined`, so the record-scope check is skipped
     entirely on create and `assignmentTypes` never reaches it. The defect there is
     hardcoded business data, plus the downstream effect that a lead created with a type
     the org doesn't use can't later be edited by a scoped user. It now uses the
     Journey's configured types.

   A Journey with no leads yet exposes no types; rather than invent one, the form offers
   a free-text box to name the first, which matches `assignment_type` being a
   configurable string by design.
5. **Pre-existing fixtures conflict with the synthetic-names constraint.** `fixtures.ts`
   uses real Wellsure journey names and plausible company names. All fixtures I *add* are
   synthetic; changing the existing ones would churn several tests. Flagging rather than
   silently extending — your call.
6. **New dependency.** `@dnd-kit/core` needs a lockfile update and network in CI. If policy
   blocks it, the fallback is to ship `MoveStatusMenu` alone — keyboard-, touch- and
   test-accessible, with identical mutation and rollback semantics. The entire
   optimistic/rollback/rejection story is dependency-free by design; only literal dragging
   rests on dnd-kit.
7. **jsdom cannot exercise dnd-kit's pointer/keyboard pipeline** (no layout ⇒ zero rects).
   Tests drive the same mutation through `MoveStatusMenu`; real dragging is a
   Playwright/manual concern, consistent with quality-gates assigning E2E flows to Playwright.
8. **Smaller pre-existing items, listed so they aren't mistaken for Phase 10 regressions:**
   `text-accent`/`bg-accent` are used in two files but `--color-accent` doesn't exist;
   `RoleDetailPage` invalidates `['auth-capabilities']`, a key no query uses (so a
   permission change never refreshes the current session).

## Test plan

Per `docs/testing/quality-gates.md`. Harness is the existing `renderPage()` shape from
`AdminFlows.test.tsx` (session cookie + `QueryClientProvider` + `MemoryRouter` +
`AuthProvider`), with per-case `server.use(...)` overrides. `globals: false`, so
`describe/it/expect/vi` are imported explicitly.

**Required minimum coverage, all three included:**

- **Kanban rejected-drag revert** (`BoardPage.test.tsx`) — override `PATCH /leads/:id` to
  return `400 {error:'validation_error', details:{fieldId}}`. Assert: card moves
  optimistically; then returns to the **source** column and leaves the destination; **both
  column counts return to their pre-move values** (guards the `total` arithmetic); the
  dialog names the configured field and status names; its link is `/sellers/:id/edit`; the
  live region carries the failure. Siblings: success path, `403` (reverts, banner, **no**
  field dialog), `400` *without* `details.fieldId` (proves we key off `fieldId`, not the
  status code), and a `fields` 403 asserting the raw UUID never appears.
- **Hierarchy cycle handling** (`org-hierarchy.test.ts`, pure) — two-node cycle, three-node
  cycle with a clean subtree hanging off it, self-manager, dangling manager, multiple
  roots. Strongest invariant: flattened output id count equals input length (nobody
  disappears, nobody duplicates). A hang surfaces as a Vitest timeout.
- **Permission-gated rendering** — Board as `user-rep`: columns render, no "Move…", no
  draggable attributes, read-only banner present. Org chart as `user-rep`: redirected by
  `PermissionRoute`.

**Also:** `board-cache.test.ts` (pure `total` arithmetic, no-op removes, de-dupe inserts);
org chart renders nothing until *all* user pages resolve; dashboard issues exactly one
`pageSize=1` request per status and none with `pageSize > 1` except the recent panel, and
contains no `/task/i` text; settings profile has no textboxes and density persists;
`AppShell.test.tsx` covers collapse persistence, accessible names while collapsed, **the
mobile drawer rendering expanded while collapsed**, and refresh invalidating only the
declared keys.

**MSW work (synthetic only):** fix the Page-vs-array bug; emit `active` on statuses; delete
the phantom `/statuses` handler; add a required-field rejection path driven by a mutable
rules array mirroring exact-match `requiredFromStatusId` semantics, so the **dev demo** can
show a rejected drag, not just the tests. Add ~12 synthetic directory users (3-level chain,
second root, one dangling manager, one inactive). Cycles are injected per-test via
`server.use`, never baked into the shared fixture.

**Gates to run and report actual results:** `pnpm format`, `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build`. Anything implemented but unverified will be stated plainly.

## Rollback plan

No schema changes, no migrations, no backend code — nothing to roll back at the data layer.
Frontend changes revert as a unit by reverting the phase's commits. The two edits touching
existing behavior are independently revertible: the `configApi.statuses` re-point (revert
restores the *broken* production call, so prefer keeping it) and the MSW Page fix
(dev/test only). Removing `@dnd-kit/core` requires a lockfile revert alongside. The
proposed backend endpoint is not implemented, so there is nothing to undo there.

## Sequencing

1. Foundations + MSW fix → 2. Shell → 3. Settings → 4. Dashboard → 5. Org chart →
6. Board (last: only step adding a dependency and mutation semantics; land `board-cache.ts`
and its unit tests before wiring UI) → 7. Density.

Steps 1–5 are individually shippable and carry no new dependency.
