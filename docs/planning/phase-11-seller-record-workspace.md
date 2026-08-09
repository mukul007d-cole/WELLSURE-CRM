# Phase 11 — The seller record, and one design system

## Context

Phase 10 shipped four surfaces and a Freshsales-inspired shell. Two things it
left behind now dominate the gap list, and they turn out to be the same problem
seen from two sides.

**The record page never got built.** `Seller360Page` is a 198-line stack of two
cards. Meanwhile the database has been recording a full audit trail this whole
time — `activity_logs` is written on **ten** code paths, is append-only enforced
by a DB trigger, and carries an index (`activity_logs_timeline_idx` on
`organizationId, leadId, timestamp DESC`) built for exactly one query: a lead
timeline. No route reads it. Three more capabilities are fully implemented
server-side and have **no front door at all** — `POST /leads/:id/comments`,
`PATCH /leads/:id/reassign`, `POST /leads/:id/deactivate`. The web client has no
method for any of them. `docs/requirements/v1-scope.md:15` names the activity
timeline a V1 must-have; `:17` names the append-only lead activity log.

**The design-system pass is skin-deep.** Only **2 of 17** pages actually use
`PageFrame`/`DataTable`. A parallel design system lives in
`pages/admin/shared.tsx` (`AdminHeader`, `AdminTable`, `PageControls`), and five
admin pages still hand-render `<tr>/<td>` into it. `SettingsPage` and
`DashboardPage` import the *admin module's* header. `usePageChrome` is called by
5 of 17 pages, so twelve pages show no topbar title and a permanently dead
refresh button.

Both are "the app is less finished than it looks." This phase closes them.

Research also surfaced five verified pre-existing defects, folded in below
rather than deferred again — each is small, and two are user-visible today.

---

## Goal

Make Seller 360 the record workspace — summary panel plus a real activity
timeline, with comment, reassign and deactivate wired to the endpoints that
already exist — and retire the second design system so all 17 pages share one.

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/v1-scope.md`,
`docs/testing/quality-gates.md`, `docs/api/endpoints.md`,
`docs/planning/phase-10-demo-ready-workspace-ui.md`,
`docs/architecture/decisions/` (0001–0010).

## Current state

### The activity log is written but unreadable

`apps/api/src/leads/activity.ts` is **types only** — `LeadActivityInput` and a
`LeadActivityWriter` interface, no implementation. `actionType` is a closed union
of six literals: `comment | field_edit | status_change | reassignment |
share_changed | lead_deactivated`.

Ten write sites, all transactional:

| Site | actionType | payload |
|---|---|---|
| `leads/service.ts:171-185` (create) | `field_edit` | `newValue: {name, phone, email, fieldValues}` |
| `leads/service.ts:236-245` (edit) | `field_edit` | `oldValue`/`newValue`: **whole lead records** |
| `leads/service.ts:248-257` | `status_change` | `{statusId}` both sides |
| `configuration/service.ts:358-371` | `status_change` | one row per affected process |
| `leads/sharing.ts` ×6 (`:83, :119, :155, :177, :228, :273`) | `share_changed`, `comment`, `reassignment`, `lead_deactivated` | `:187` is the only writer of `commentText` |

`recording_reference_url` is written by nothing. The real writer is
`prisma-lead-repository.ts:297-353`, which also drives notification evaluation.

**No read route exists** — zero `activit` matches across `apps/api/src/http/`,
`apps/api/src/routes/` and `packages/contracts/`. `GET /leads/:id/activity` is
documented at `docs/api/endpoints.md:89` and unimplemented.

### Three built capabilities with no client

`apps/api/src/http/routes/leads.ts` registers 11 routes. `sellersApi`
(`apps/web/src/lib/api-client.ts:168-211`) covers eight. Missing entirely:
`POST /leads/:id/comments` (`:210`), `PATCH /leads/:id/reassign` (`:231`),
`POST /leads/:id/deactivate` (`:249`). `leads:comment` and `leads:delete` are
already in the permission catalogue (`packages/permission-engine/src/catalog.ts:14-23`).

### No status history anywhere

`process_instances` stores **current state only** — no `enteredAt`, no
`previousStatusId`, no history child table; `updateProcessInstanceStatus`
mutates in place (`leads/service.ts:231-233`). `system_audit_logs` is indexed by
entity, covers configuration entities only, never leads. `Assignment` keeps
history via `isCurrent: false`, but `findSeller360` filters to `isCurrent: true`.
So `activity_logs` is the *only* source for a chronological record view.

### Design-system split

| | Uses PageFrame | Uses DataTable |
|---|---|---|
| Fully migrated | `RoleDetailPage`, `UserManagementPage` | — |
| Partial | `SellerListPage`, `BoardPage`, `Journeys`/`Fields`/`Departments`/`Roles`/`Users` (PageBody or Toolbar only) | `SellerListPage` only |
| Not at all | `Seller360Page`, `LeadFormPage`, `SettingsPage`, `DashboardPage`, `JourneyDetailPage`, `NotificationRulesPage`, `OrgChartPage`, `LoginPage` | everything else |

One `<table>` exists outside `DataTable`: `pages/admin/shared.tsx:72`. Five pages
render raw rows into it (`UsersPage:176`, `FieldsPage:102`, `JourneysPage:82`,
`DepartmentsPage:103`, `RolesPage:157`) — no sticky header, no recessed header
tone, no hover row tone, permanently-visible action buttons, `p-4` cells instead
of density-aware `--data-row-py`.

Heading styles have drifted three ways: `SectionCard` uses `text-base font-bold
text-ink`; `Seller360Page:132,170` and `LeadFormPage:186,218,311` use
`text-sm uppercase tracking-wide text-ink-soft`; `JourneyDetailPage:151,275` uses
`text-lg font-semibold`. The back-link with inline SVG chevron is duplicated
verbatim in `Seller360Page:77-91` and `LeadFormPage:151-165`.

### Five verified defects

1. **Every Seller 360 status renders open-blue.** `findSeller360`
   (`prisma-lead-repository.ts:363`) selects `currentStatus: {id, key, name}` —
   no `outcomeType`, no `behaviorType`. `Seller360Page:157-161` passes both to
   `StatusPill`; `statusTone` (`status-tone.ts:14-21`) falls through every branch
   on `undefined` and returns `'open'`. A closed-won seller looks open in
   production. Invisible in tests because MSW fixtures supply what the real API
   omits — the fifth instance of this exact drift pattern.
2. **Capabilities never refresh.** `RoleDetailPage.tsx:85` invalidates
   `['auth-capabilities']`, which matches zero queries. Capabilities are plain
   `useState` in `AuthContext.tsx:23`, loaded by a mount-only effect (`:25-45`),
   never in React Query — so **renaming the key fixes nothing**. Bites when an
   admin edits their own role.
3. **`text-danger` orphan.** `SearchableSelect.tsx:95` — no `--color-danger` in
   `theme.css`; confirmed 0 matches in the built stylesheet.
4. **Fixtures carry real Wellsure names.** `fixtures.ts:12-16` (Overlapping,
   Private Label, SPN & BD) and `:50-60` (service names). `AGENTS.md:7` names
   "Overlapping" as the example of what not to depend on, and `fixtures.ts` is
   application source imported by `handlers.ts`.
5. **`docs/api/endpoints.md` documents ~20 absent endpoints**, including the
   phantom `GET /journeys/:id/statuses` the client already works around in a
   comment at `api-client.ts:277-285`.

---

## Proposed approach

### 1. `GET /leads/:id/activity` — the one new endpoint

Additive, read-only, gated on **`leads:view`** — no new catalogue entry, no
permission-engine change. Follows the repo's hexagonal split: use case in
`apps/api/src/routes/leads.ts`, transport in `apps/api/src/http/routes/leads.ts`.

It reuses `getSeller360`'s authorization loop verbatim (`routes/leads.ts:290-316`)
— resolve per active process instance, collect `visibleProcesses` and the union
of `visibleFieldIds`, 403 when nothing is visible. That loop is already tested;
this endpoint inherits journey access, record scope and field visibility for free.

**The crux, and the reason this needs care: `oldValue`/`newValue` are unfiltered
whole-lead snapshots.** `service.ts:243-244` writes the entire lead record on
edit. Nothing filters them today because nothing reads them. Serving them raw
would leak field values the viewer is explicitly denied — a permission
regression, not a cosmetic one. So:

- Only `field_edit` rows carry field data. Filter `oldValue.fieldValues` and
  `newValue.fieldValues` through the same `visibleFieldIds` set `serializeLead`
  (`routes/leads.ts:323-341`) already uses. Extract that filter as a named
  helper so both call sites share one implementation.
- `status_change` (`{statusId}`), `reassignment` (`{assignmentType, userId}`),
  `share_changed`, `lead_deactivated` and `comment` carry no field data — pass
  through unchanged.
- **Drop rows whose `processInstanceId` is not in `visibleProcesses`.** A lead
  can sit in two journeys and the viewer may be entitled to only one. Rows with
  a null `processInstanceId` are lead-level and included once any process is
  visible.
- Resolve `actorUserId` → display name; it is nullable, so system-authored rows
  render as "System" rather than a blank or a UUID.

Repository method `findLeadActivity(organizationId, leadId, {page, pageSize})`
ordered `timestamp desc` — this is precisely what `activity_logs_timeline_idx`
serves. Paginated `{ total, items }`, `pageSize` capped at 100 like the config
routes. No new dependency.

### 2. Seller 360 → record workspace

Freshsales' record layout: a **sticky left summary panel** (identity, phone,
email, current status per journey, assignments, share state) beside a **main
column with tabs** — Timeline / Details / Journeys. Below `lg` it collapses to
one column, summary first.

Built from existing primitives — `PageHeader` with `breadcrumb` for the
back-link (retiring the duplicated inline SVG), `SectionCard`, `StatusPill`,
`RingAvatar`, `Dialog`, `DataTable` where tabular. No new component library, no
new palette, no new heading variant; the `text-sm uppercase text-ink-soft`
headings on this page converge onto `SectionCard`.

**Timeline entries key off the `actionType` enum**, never off a status, journey
or role name — the same discipline `statusTone` follows for color. A
`components/activity/entry-copy.ts` maps each of the six enum values to an icon
and a phrasing template; field and status *names* inside an entry are resolved
at runtime from `configApi.fields()` / the journey's statuses, exactly as the
board's rejected-move dialog does. A viewer without `fields:view` gets the
no-label variant already established there, never a raw UUID.

`usePageChrome` registers the title and refresh keys, which this page currently
lacks.

### 3. Wire the three orphaned capabilities

Add `comment`, `reassign` and `deactivate` to `sellersApi` and surface them on
the record page, each gated by the permission it already requires server-side:

- **Comment composer** at the head of the timeline — `leads:comment`. Optimistic
  append, rollback on error, invalidate the activity key on settle.
- **Reassign** — `leads:edit`. A `Dialog` picking an assignment type and a user,
  reusing `SearchableSelect` and the `share-users` query.
- **Deactivate** — `leads:delete`. Confirmation `Dialog`; the record then renders
  read-only with a banner.

All three call endpoints that already exist. **No mutation semantics change** —
the Phase 10 constraint holds.

### 4. The five fold-in defects

Add `outcomeType`/`behaviorType` to the `findSeller360` select (one line, fixes
status color on the record page). Expose `refreshCapabilities` from
`AuthContext` — a `useCallback` re-running `authApi.capabilities()` plus
`setCapabilities`, added to the interface and the `useMemo` deps, replacing the
no-op invalidate at `RoleDetailPage.tsx:85`; the narrow fix, not a React Query
migration of the auth state machine. Define `--color-danger` in `theme.css`
aliased to the existing lost-status red that `Button.tsx:17` already uses.
Rename the four real journey/service names in `fixtures.ts` to synthetic ones
(zero test references — verified). Correct `docs/api/endpoints.md` and write
**ADR-0011** recording the doc-vs-code resolution, as `PLANS.md:41` requires.

### 5. One design system

Mechanical, low-risk, independently shippable:

- `AdminTable` → `DataTable` across the five CRUD pages; `AdminHeader` →
  `PageHeader`; `PageControls` → the existing `components/ui/Pagination`.
  Delete the dead exports from `pages/admin/shared.tsx`.
- Onboard `SettingsPage`, `DashboardPage`, `JourneyDetailPage`,
  `NotificationRulesPage`, `OrgChartPage` and `LeadFormPage` onto
  `PageBody`/`PageHeader`/`SectionCard`, retiring their local near-copies
  (`SettingsCard`, `SummaryCard`, the hand-built tab-header card at
  `DashboardPage:146`). `LoginPage` stays bespoke — it renders outside the shell.
- `usePageChrome` on all remaining pages, so every route has a topbar title and
  a live refresh button.

### 6. Not in this phase, deliberately

**Permission-degradation hardening** is the strongest candidate for Phase 12 and
I am flagging it rather than folding it in, because it is its own milestone:
`LeadFormPage` **dead-ends** on a `journeys_statuses:view` 403 — the journey
select renders empty, `journeyId` is required by the schema, so the form cannot
be submitted and displays no error whatsoever. `SellerListPage` and
`Seller360Page` fail silently the same way. Separately,
`grantJourneyAccessToConfigRoles` (`prisma-configuration-repository.ts:156-172`)
only grants access to roles that *already* hold `journeys_statuses:view`, and
granting it later is not retroactive — an admin can grant the permission and
still see nothing.

---

## Files to touch

**API — new:** `apps/api/src/leads/activity-read.ts` (visible-field filter +
serializer).

**API — modified:** `apps/api/src/routes/leads.ts` (`getLeadActivity` use case;
extract the field filter out of `serializeLead`),
`apps/api/src/http/routes/leads.ts` (`GET /api/v1/leads/:id/activity`),
`apps/api/src/leads/prisma-lead-repository.ts` (`findLeadActivity`; add
`outcomeType`/`behaviorType` to the `findSeller360` select),
`apps/api/src/routes/leads.ts` type exports.

**Web — new:** `pages/seller-detail/{RecordSummaryPanel,ActivityTimeline,TimelineEntry,CommentComposer,ReassignDialog,DeactivateDialog}.tsx`,
`components/activity/entry-copy.ts`.

**Web — modified:** `pages/seller-detail/Seller360Page.tsx` (the restructure),
`lib/api-client.ts` (`activity`, `comment`, `reassign`, `deactivate`),
`lib/query-keys.ts` (`['activity', leadId]`), `types/domain.ts`
(`ActivityEntry`, `ActivityActionType`), `app/AuthContext.tsx`
(`refreshCapabilities`), `pages/admin/RoleDetailPage.tsx:85`,
`styles/theme.css` (`--color-danger`), `mocks/{handlers,fixtures}.ts`.

**Web — design-system convergence:** `pages/admin/{UsersPage,FieldsPage,JourneysPage,DepartmentsPage,RolesPage}.tsx`
(same `AdminTable` → `DataTable` pattern in each; `UsersPage` is the
representative case), `pages/admin/shared.tsx` (delete `AdminHeader`,
`AdminTable`, `PageControls`), `pages/{settings/SettingsPage,dashboard/DashboardPage,admin/JourneyDetailPage,admin/NotificationRulesPage,admin/OrgChartPage,lead-form/LeadFormPage}.tsx`.

**Docs:** `docs/planning/phase-11-seller-record-workspace.md`,
`docs/api/endpoints.md`, `docs/architecture/decisions/0011-*.md`.

## Out of scope

- The permission engine, the Lead service, and existing mutation semantics —
  untouched, as in Phase 10.
- Any schema change or migration. No `enteredAt`, no status-history table.
- Tasks, Finance, Reports, attachments, services, linked leads, import/export.
  Tasks and Finance stay disabled labels; `packages/workflow-engine` stays a
  placeholder.
- Bulk actions and saved views on the seller list.
- The permission-degradation work described in §6.
- `LoginPage`'s bespoke styling; dark mode.

## Risks / open questions

1. **Field-visibility filtering of the JSON snapshots is the one place this
   phase can cause a security regression.** Whole-lead blobs have never been
   served before. Mitigated by reusing one shared filter helper and by an
   explicit test asserting a denied field's value never appears in the response
   body — but it deserves review attention over everything else here.
2. **Whole-record snapshots make a noisy diff.** `service.ts:243-244` stores the
   entire lead on every edit, so a naive renderer would show every field on
   every entry. The timeline diffs old vs new and renders only *changed* visible
   keys. When every changed key is invisible to the viewer, the entry says a
   change occurred without naming it, rather than rendering an empty diff.
3. **`GET /leads/:id/activity` is documented but was never built** — the
   endpoint's shape is my design, not a contract I am implementing. Recorded in
   ADR-0011 alongside the other ~20 doc-vs-code divergences.
4. **Pagination semantics.** `activity_logs` is append-only, so offset
   pagination is stable — new rows only ever prepend. "Load more" rather than
   numbered pages fits the surface and matches the board's per-column paging.
5. **The convergence step touches many files at once**, against `AGENTS.md:44`
   ("do not edit files unrelated to the task's stated scope"). It is in scope
   *because it is stated here*, but it lands as its own commits, separate from
   the record work, so either half can be reverted alone.
6. **`text-danger` → `--color-danger` aliases the lost-status red.** That
   deliberately reuses a status-palette color for a non-status purpose. The
   alternative is a genuinely new token, which the design-system constraint
   discourages. Flagging rather than deciding silently.
7. **Renaming fixture journey names will change what the dev demo shows.** Zero
   test references, but the demo will no longer read "Overlapping".

## Test plan

Per `docs/testing/quality-gates.md`. Harness is the existing `renderPage()` shape;
`globals: false`, so imports are explicit.

**API:**
- `getLeadActivity` — **field-visibility leak test is the priority**: a viewer
  denied field X gets entries whose `oldValue`/`newValue` contain no X, while a
  viewer allowed X does. Non-`field_edit` payloads pass through untouched.
- Rows for a process instance the viewer cannot see are excluded; null-process
  rows are included when any process is visible; 403 when none is.
- Pagination ordering is `timestamp desc`; `pageSize` over 100 → 400.
- `findSeller360` now returns `outcomeType`/`behaviorType` — a regression test
  against the exact drift that hid this bug.

**Web:**
- Timeline renders one entry per `actionType`, keyed off the enum; a `fields`
  403 asserts no raw UUID appears.
- Edit entries show only changed *visible* keys; an all-invisible change still
  renders an entry.
- Comment composer: optimistic append, rollback and error banner on failure.
- Reassign and deactivate dialogs; each action hidden without its permission
  (`leads:comment` / `leads:edit` / `leads:delete`).
- `refreshCapabilities` — saving a role's permissions updates `can()` without a
  reload; a test that would have caught the no-op invalidate.
- Migrated admin pages keep their existing behaviour: the current tests for all
  five must pass unmodified except for selector changes forced by the markup.
- Accessibility (`quality-gates.md:12`): the timeline is a real `<ol>`, tabs use
  `role="tablist"`/`aria-selected`, the summary panel is a labelled `<aside>`.

**MSW:** synthetic only. Add an `activity` handler generating all six
`actionType`s including a `field_edit` pair whose diff spans a visible and a
hidden field. Rename the four real journey/service names.

**Gates to run and report actual results:** `pnpm format`, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build`. Anything implemented but unverified
will be stated plainly.

## Rollback plan

No schema changes, no migrations. The endpoint is purely additive — deleting the
route and its use case removes it with nothing depending on it, since no
existing caller changes. The `findSeller360` select addition is additive and
safe to keep regardless. Frontend reverts as a unit per commit; the record-page
work and the design-system convergence are separate commits, independently
revertible. No new dependency, so no lockfile change.

## Sequencing

1. Activity endpoint + field filter + API tests (the security-critical piece,
   landed and reviewed on its own).
2. Five fold-in defects — small, unblocks nothing, ships immediately.
3. Seller 360 restructure onto the endpoint.
4. Comment / reassign / deactivate.
5. Design-system convergence: admin tables, then PageFrame onboarding, then
   `usePageChrome` everywhere.

Steps 1–4 are the phase's spine. Step 5 is mechanical and can slip to Phase 12
without blocking anything.
