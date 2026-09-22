# Phase 23 — Seller List inline status change

Status: proposed. Addresses GitHub issue #46.

## Goal

Add a per-row status dropdown + Save affordance to the Seller List table so a
user can change one seller's status without opening the Board or the full
edit form, going through the exact same `editLead` write path (and every one
of its side effects: required-field validation, routing reassignment,
activity logging, notification/campaign triggers) as both existing surfaces
already do.

## Docs read

- `AGENTS.md`, `PLANS.md`
- `docs/planning/phase-10-demo-ready-workspace-ui.md` (Board's Move menu,
  rejected-move dialog, aria-live pattern)
- `docs/planning/phase-14b-per-status-assignment-routing.md` (routing as a
  trigger consumer, the "previous holder loses visibility on every surface"
  test)
- `docs/architecture/decisions/0020-status-routing-visibility-reconciliation.md`,
  `0021-status-visibility-oversight-bypass.md` (current, reconciled
  visibility model — routing decides visibility, not a Role allow-list)
- `docs/permissions/access-model.md`

## Current state

### The Board already has everything issue #46 asks for, minus the two-step Save

`apps/web/src/pages/board/`:

- **`MoveStatusMenu.tsx`** — a button that opens a listbox of the journey's
  *other* active statuses and commits the mutation **immediately** on
  selection. No pending/Save step; it exists so touch and keyboard users have
  a working alternative to dragging a card.
- **`useMoveLeadStatus.ts`** — the mutation. `mutationFn` calls
  `queryClient.ensureQueryData(qk.seller(row.id), () => sellersApi.detail(row.id))`
  to read the lead's real `assignmentTypes` (load-bearing for the
  authorization record-predicate on any scope narrower than `ORGANIZATION`
  — `SellerListRow.processInstances[]` doesn't carry it), then calls
  `sellersApi.edit(row.id, { leadId, processInstanceId, journeyId, statusId,
  assignmentTypes })` — **no `fieldValues` key**, so this is a pure status
  move and the server's required-field check is what comes back. A
  `classify()` function turns the API's error shape into a
  `MoveRejection` union: `missing_field` (400 + `details.fieldId`),
  `forbidden` (403), `stale_status` (400, no `fieldId`), `other`. Onward
  cache handling (`onMutate`/`onError`) is Board-column-specific: it patches
  two `InfiniteData` column caches (`qk.boardColumn(journeyId, statusId)`)
  for the optimistic move-and-revert.
- **`MoveRejectedDialog.tsx`** — shown only for `missing_field`: names the
  field (or a no-label copy variant if the viewer can't read the field
  catalogue), states the lead stayed in its original status, and links to
  `/sellers/:id/edit` to fix it. The other rejection kinds (`forbidden`,
  `stale_status`, `other`) surface as a page-level error `Banner` in
  `BoardPage.tsx`, and every branch also writes to a `<p aria-live="polite">`
  region.

**Conclusion: this is a genuine, partial reuse, not a rebuild — but
`MoveStatusMenu` itself is the one piece that does not transfer.** The issue
explicitly asks for a dropdown that holds a pending value plus a Save
button, i.e. a two-step commit — not `MoveStatusMenu`'s one-click popover,
which was built for a keyboard/touch fallback to *dragging*, a different
interaction entirely. The codebase's own precedent for a plain, always-
visible status `<select>` is the full edit form
(`apps/web/src/pages/lead-form/LeadFormPage.tsx:311`,
`<Select {...register('statusId')}>`), not the Board's card popover. So:

| Piece | Reused as-is | Notes |
|---|---|---|
| `classify()` / rejection classification | **Yes** | Relocated to a shared module (see below); logic untouched |
| `mutationFn` shape (assignmentTypes fetch + `sellersApi.edit`) | **Yes** | Identical call; same `qk.seller(id)` cache key |
| `MoveRejectedDialog` | **Yes** | Relocated; used verbatim, same props |
| aria-live announcement pattern | **Yes** | Same copy conventions, new `<p aria-live>` at `SellerListPage` level |
| `MoveStatusMenu` (popover UI) | **No** | Wrong interaction model for a Select+Save affordance |
| Board's optimistic column-cache patch (`onMutate`/`onError`) | **No** | See "What happens after a successful change" below — doesn't fit a paginated, filterable, sortable, possibly-cross-journey list |

### The exact write path, and what a status change through it triggers

`apps/api/src/leads/service.ts`'s `editLead` (`:302-377`) is the one and only
path this feature is allowed to use, matching what `MoveStatusMenu` and the
full edit form both already call through `sellersApi.edit`:

- `statusId` is looked up against `findStatus(organizationId, journeyId,
  statusId)`, then `validateFieldValues` checks the target status's
  required-field rules (`requiredFromStatusId === null || === statusId`,
  **exact match**, per ADR-0001 — never a `sortOrder` heuristic). A failure
  throws `validation_error` with `details.fieldId`, which is exactly what
  `classify()` already keys off.
- If `statusId !== oldStatusId`, it writes a `status_change` activity via
  `writeActivity`, which is the one writer that fans out through
  `TriggerDispatcher` to `NotificationService`, `CampaignTriggerService`,
  and — per Phase 14b — `StatusRoutingService`. **All of this happens inside
  the same transaction as the status write**, before the API responds. If
  the destination status has an active routing rule, the previous assignment
  is superseded and a new one created before `editLead` returns.
- Nothing here is new-path or simplified: the inline control calls the same
  `sellersApi.edit(...)` with only `statusId` (+ `assignmentTypes`) set, no
  `fieldValues`, identical to `useMoveLeadStatus`'s payload.

### Visibility after a routing reassignment is already handled server-side, on every request — the frontend only has to refetch

Per ADR-0020/0021 (superseding Phase 19's Role-allow-list design): a status
with no active routing rule imposes no visibility restriction; once one is
active, visibility narrows to the lead's current assignee plus their
reporting-hierarchy ancestors, **recomputed fresh on every request** with no
transition-specific invalidation step needed server-side. So if a quick
status change causes a routing reassignment that removes the current viewer
from that chain, the very next `GET /leads` call for that viewer's Seller
List will not return the row — there is no server-side lag to work around.
The frontend's only obligation is to actually **issue** that re-fetch after
a successful change, rather than only patching the row's status column
in place from the response (which would leave a now-invisible row sitting
on screen). See "What happens after a successful change" below.

### Status is a core field with no field-visibility gate of its own

`docs/permissions/access-model.md`'s Feature-permissions table lists `Leads:
view, create, edit, comment, delete, export, import,
bypass_status_visibility, retain_view_after_reassignment` — there is no
separate status-editing action, and axis **D (Field-level visibility)**
governs only dynamic `fields` rows (custom fields like "Deal value"), never
the core `statusId` column, exactly as `name`/`phone`/`email` aren't gated
by `field_visibility` either. **Confirmed explicitly, correcting an
assumption in the issue's framing: there is no "status field-visibility
gate" to reuse — status changes are, and always have been, gated purely by
`leads:edit` (module action) + the caller's data scope + Journey access +
axis E (Status Visibility, which governs whether the lead is visible at
all, not a specific field) + the workflow's required-field check.** This
inline control needs no catalog change: it is gated on `can('leads',
'edit')`, identically to the Board's `MoveStatusMenu` and the existing
per-row "Edit" link in `SellerListPage.tsx:444`.

### `SellerListPage.tsx` structure — where the control fits

`SellerListPage.tsx` renders one `<DataTable>` (desktop) and a card list
(mobile). The Status column today (`:421-433`) is a read-only `StatusPill`
built from `process.statusName/statusOutcomeType/statusBehaviorType` off
`row.processInstances?.[0]` — like the existing Owner column, it only ever
addresses the row's **first** process instance, which this feature follows
rather than relitigating. `DataRow` navigates to the seller on click
(`onClick={() => navigate(...)}`); the existing "Edit" link already stops
that propagation (`onClick={(event) => event.stopPropagation()}`) — the new
control needs the identical guard.

**A structural wrinkle Board doesn't have**: the Seller List can show "All
journeys" (`journeyId` unset), so rows on one page can belong to different
Journeys, each with its own valid status set. The Board is always scoped to
one Journey (its own tab bar), so `BoardPage` fetches one `statuses` array
for the whole page. The Seller List's inline control instead needs a
per-row `useQuery` keyed on that row's own `process.journeyId`
(`qk.journeyStatuses(journeyId)`, the same key `configApi.statuses` already
uses everywhere) — cache-shared across every row that happens to share a
Journey, not one query per row's identity.

### `EditLeadInput` / `sellersApi.edit` already carry everything needed

`apps/web/src/types/domain.ts:311` (`EditLeadInput`) and
`apps/web/src/lib/api-client.ts:364` already support exactly the payload
shape `useMoveLeadStatus` sends. No client type changes needed.

## Proposed approach

### 1. Extract the reusable core out of `pages/board/`, since two features now need it

`MoveRejectedDialog` and `classify()`/`MoveRejection`/`MoveVariables` stop
being Board-only the moment a second surface needs the identical rejection
UX for the identical error shape — leaving them in `pages/board/` and
importing cross-page from `pages/sellers/` would work mechanically but
misplaces ownership. Promote, don't duplicate:

- New `apps/web/src/lib/status-change.ts`: the pure parts —
  `classifyStatusChangeRejection(error, variables)` (renamed from
  `classify`, logic byte-for-byte unchanged) and the
  `StatusChangeRejection`/`StatusChangeVariables` types (renamed from
  `MoveRejection`/`MoveVariables`; same fields: `row, processInstanceId,
  journeyId, fromStatus, toStatus`).
- New `apps/web/src/components/leads/StatusChangeRejectedDialog.tsx`:
  `MoveRejectedDialog.tsx` moved verbatim (same props: `variables,
  fieldLabel, onClose`), renamed for its new, non-Board-specific home.
- `apps/web/src/pages/board/useMoveLeadStatus.ts` keeps its board-column
  optimistic cache logic (`onMutate`/`onError` patching
  `qk.boardColumn(...)`) but imports the classifier and types from
  `lib/status-change.ts` instead of defining its own.
- `BoardPage.tsx`'s one import of `MoveRejectedDialog` is repointed at the
  new path. No behavior change; `BoardPage.test.tsx` continues to exercise
  the same rendered UI and needs no reassertion of Board behavior, only an
  import-path-driven green run.

### 2. New Seller List mutation hook — same write path, different cache strategy

`apps/web/src/pages/sellers/useSellerStatusChange.ts`:

- Identical `mutationFn` to `useMoveLeadStatus`: `ensureQueryData(qk.seller(
  row.id), () => sellersApi.detail(row.id))` for `assignmentTypes`, then
  `sellersApi.edit(row.id, { leadId, processInstanceId, journeyId, statusId,
  assignmentTypes })`.
- **No optimistic cache patch.** Board can patch in place because it knows
  the exact two column caches a move affects. The Seller List's own query
  is a single, arbitrarily filtered/sorted/paginated page
  (`journeyId, statusId, search, page, accessMode, filter, sortBy,
  sortDirection, fieldIds`) that a status change can move a row into or out
  of in ways an optimistic patch cannot correctly predict (a status filter
  is active; the sort is by status-adjacent data; the row's new status no
  longer matches the current filter; a routing reassignment changed who can
  see it at all). A patch-in-place here would either drift or need to
  reimplement the server's own filter/scope logic client-side. Invalidate
  and let the query re-run — see next section.
- `onError`: run `classifyStatusChangeRejection`, hand the result to a
  caller-supplied `onRejected` callback (mirrors `useMoveLeadStatus`'s own
  shape). No cache to revert, since nothing was patched optimistically.
- `onSuccess`/`onSettled`: invalidate `qk.sellers()` (refetches the active
  list), `qk.seller(row.id)`, and `qk.dashboard()` — the same trailing
  invalidations `useMoveLeadStatus.onSettled` already performs, minus the
  two board-column keys that don't apply here.

### 3. New inline control component

`apps/web/src/pages/sellers/SellerStatusCell.tsx`, replacing the Status
`<DataCell>`'s contents when `can('leads', 'edit')` (else the existing
read-only `StatusPill` stays exactly as today):

- `useQuery({ queryKey: qk.journeyStatuses(process.journeyId), queryFn: () =>
  configApi.statuses(process.journeyId), staleTime: 300_000 })` — same
  staleness Board uses, cache-shared across every row in that Journey.
- A plain `<Select>` (the existing `components/ui/Select.tsx` primitive —
  same one the toolbar's own status filter and the full edit form's status
  field already use), populated with every **active** status plus, as a
  fallback, the lead's current status even if it has since been deactivated
  — otherwise a row whose status was deactivated out from under it would
  render a `<select>` whose value matches no `<option>`, which silently
  shows the browser's own fallback rather than the lead's real status. This
  is the one detail where the control can't just filter
  `statuses.filter(s => s.isActive)` the way `BoardPage` does for its whole
  column set.
- Local pending-value state, reset whenever `process.statusId` changes
  underneath it (a successful save, or someone else's change arriving via
  refetch). A **Save** button renders only once the pending value differs
  from `process.statusId` — the issue's explicit ask — and is disabled/shows
  a spinner while the mutation is in flight.
- On the `missing_field` rejection: render `StatusChangeRejectedDialog`
  exactly as `BoardPage` does, resolving `fieldLabel` the same way
  (`configApi.fields()` lookup, tolerating a `fields:view`-less viewer with
  the same no-label copy variant) — reused, not reworded.
- Every other rejection kind (`forbidden`, `stale_status`, `other`) and
  every successful move report up to `SellerListPage` via callback props
  (`onRejected`, `onMoved`) rather than rendering a per-row banner — see
  next point.
- Wrapped in the same `onClick={(event) => event.stopPropagation()}` /
  `onPointerDown` guard the existing Edit link and `MoveStatusMenu` use, so
  interacting with the control never triggers the row's own navigate-on-
  click.

### 4. `SellerListPage.tsx` — page-level plumbing, matching `BoardPage`'s own shape

- One `announcement` state and one `<p aria-live="polite" className="sr-only">`
  at the bottom of the page, updated by each row's `onRejected`/`onMoved`
  callback — identical copy conventions to `BoardPage.tsx` ("Moved X to Y.",
  "Move refused. X stayed in Y because a required field is missing.").
- One `rejection` state for the **non-`missing_field`** kinds, rendered as
  a page-level error `Banner`, positioned the same way the existing
  `exportMutation.error` `Banner` already sits in this page — a pattern
  this page already uses, not a new one.
- Mobile card list: out of scope for this phase (see below) — the mobile
  view stays a read-only `StatusPill`, matching how `MoveStatusMenu` is
  Board-desktop-oriented today and the issue's own framing ("looking at the
  list" — the desktop table is the surface named).

### 5. Consequence handling — the three real product questions, decided

**Required-field rejection**: reuse `StatusChangeRejectedDialog` verbatim
(§1/§3 above) — identical underlying error, identical UX, no new copy.

**Routing-reassignment confirmation — recommendation: no confirmation
step.** Neither existing surface that can trigger a reassignment asks for
confirmation first: the Board applies a move optimistically and only
reacts after the fact (revert + explain, never a before-the-fact "this will
reassign" gate), and the full edit form's Save button commits immediately
too. Inserting a new confirm-before-commit step here would make this
surface **more** cautious than either of the two it's supposed to be a
faster alternative to — directly against the issue's own stated purpose
("I just need to quickly change one seller's status"). The Save button
itself is already the deliberate, explicit commit step the issue asks for;
adding a second confirmation on top of Save specifically for statuses that
happen to have routing configured would be an inconsistent, surprising
carve-out an admin would have to discover by trial. Post-hoc handling
(aria-live announcement, and the row leaving the list on refetch if
visibility narrowed) mirrors exactly how the Board already handles a lead
leaving a column it's been moved out of. If real usage shows this needs
a warning, that is new, additive product scope with its own decision — not
something to build speculatively here.

**Scope boundary**: single-row only. A dropdown belongs to exactly one row;
there is no selection state, no "apply to N rows," and this plan does not
add either. A real multi-select bulk status-change is a separate, larger
feature — the project's earliest Seller List planning explicitly named
"Bulk stage change" as a future affordance, and `leads:bulk_status_change`
even existed as a placeholder permission before being retired (ADR-0022)
for having no route behind it. Worth naming here as the natural follow-up,
not building it now: bulk apply needs its own re-check of every selected
record server-side (`access-model.md`'s own non-negotiable rule), its own
permission action reinstated deliberately, and its own UX for partial
failure across N rows — none of which this single-row feature needs to
solve.

**What happens after a successful change**: full re-fetch via
`invalidateQueries({ queryKey: qk.sellers() })`, not an in-place patch of
the row's status column. Reasoning, stated rather than assumed: (a) the
Seller List's query is arbitrarily filtered/sorted, so a status change can
move a row out of the current view (status filter, sort key) in ways only
the server's own query can resolve correctly; (b) per ADR-0020/0021, a
routing reassignment can also change *who can see the row at all*, computed
fresh server-side on every request — an in-place patch would leave a
now-invisible row on screen, silently wrong. A real re-fetch is the only
approach that is correct for both consequences at once, and it's what the
investigation in "Current state" above confirms is naturally sufficient
(no extra client-side visibility logic needed).

## Files to touch

**New:**
- `apps/web/src/lib/status-change.ts` (classifier + types, promoted out of
  `pages/board/useMoveLeadStatus.ts`)
- `apps/web/src/components/leads/StatusChangeRejectedDialog.tsx` (promoted
  out of `pages/board/MoveRejectedDialog.tsx`, same props)
- `apps/web/src/pages/sellers/useSellerStatusChange.ts`
- `apps/web/src/pages/sellers/SellerStatusCell.tsx`
- `apps/web/src/pages/sellers/SellerStatusCell.test.tsx`

**Modified:**
- `apps/web/src/pages/sellers/SellerListPage.tsx` — swap the Status
  `<DataCell>`'s content for `SellerStatusCell` when `can('leads','edit')`;
  add `announcement`/`rejection` state and the aria-live region and Banner.
- `apps/web/src/pages/board/useMoveLeadStatus.ts` — import the classifier
  and types from `lib/status-change.ts` instead of defining them locally;
  no behavioral change.
- `apps/web/src/pages/board/BoardPage.tsx` — import path update for the
  relocated dialog only.
- `apps/web/src/pages/sellers/SellerListPage.test.tsx` — new cases (below).
- `apps/web/src/mocks/handlers.ts` — extend the `PATCH /leads/:id` handler's
  fixture data so a test can exercise a routing-style reassignment: a
  designated synthetic "routed" status id that, on entry, reassigns the
  lead's assignment to a different synthetic user id (mirroring how
  `MOCK_REQUIRED_FIELD_RULES` already simulates the required-field check).
  This is the smallest change that lets the visibility-loss test exist at
  the MSW level without simulating the entire routing-rule configuration
  surface.
- `apps/web/src/mocks/fixtures.ts` — the small fixture(s) the above needs
  (synthetic only).

**Deleted:**
- `apps/web/src/pages/board/MoveRejectedDialog.tsx` (moved)

**Docs:**
- `docs/planning/phase-23-seller-list-inline-status-change.md` (this plan)

## Out of scope

- Multi-select / bulk status change (see "Scope boundary" above) — a
  separate, larger feature.
- The mobile card list on Seller List — stays read-only for this phase.
- Any change to `packages/permission-engine/src/catalog.ts` — investigation
  found no gap; status changes are already fully covered by `leads:edit` +
  existing scope/visibility checks.
- Any change to `editLead`, `StatusRoutingService`, trigger dispatch, or any
  other backend behavior — this is a frontend-only surface reusing the
  existing API contract exactly.
- A pre-commit "this will reassign the lead" confirmation dialog (see
  "Consequence handling" — explicit recommendation against, not an
  oversight).
- Changing `MoveStatusMenu`'s Board behavior in any way.

## Risks / open questions

1. **The mobile card list gets no quick-change control in this phase.** If
   that's wanted, it's a small, separate follow-up once the desktop version
   is validated — flagging rather than silently expanding scope.
2. **Simulating a routing reassignment in MSW is a test-fixture addition,
   not a real routing engine.** It proves the frontend correctly reacts to
   a row disappearing after refetch; it does not (and cannot, at this
   layer) re-verify the server-side routing/visibility logic itself, which
   is already covered by `phase14b.postgres.integration.test.ts`. Named so
   this test's actual guarantee isn't overstated.
3. **A row's current status can be inactive** (deactivated after the lead
   entered it). Handled per §3 above (always include it as a fallback
   option) — flagging because it's an edge case the Board's own
   `MoveStatusMenu` doesn't have to handle (it never shows the current
   status as an option at all).
4. **No confirmation step for routing-triggered reassignment** is a
   deliberate recommendation, not a default I'm assuming without surfacing
   it — see "Consequence handling." Say so at approval if a confirmation
   step is wanted instead; it's an additive change to `SellerStatusCell`
   only, not a redesign.

## Test plan

Per `docs/testing/quality-gates.md`; synthetic fixtures throughout, no
Wellsure-specific data.

- **Normal status change succeeds**: change a row's status via the new
  control, click Save; assert the mutation payload matches
  `useMoveLeadStatus`'s shape (`statusId`, `assignmentTypes`, no
  `fieldValues`); assert the list re-fetches and the row shows the new
  status after settling.
- **Save only appears once changed**: selecting the current value back
  after changing it hides Save again (no dirty state); selecting a
  different value shows it.
- **Required-field rejection**: override `PATCH /leads/:id` to return
  `400 {code:'validation_error', details:{fieldId}}`; assert
  `StatusChangeRejectedDialog` renders with the correct field/status names,
  the seller's status is unchanged, the link is `/sellers/:id/edit`, and
  the aria-live region carries the failure — reusing the exact assertions
  `BoardPage.test.tsx` already makes against the same dialog, proving it's
  the same component under a new name.
- **`403 forbidden`** and **`400` with no `details.fieldId`**: page-level
  `Banner`, no dialog — siblings to the Board's own coverage.
- **Routing reassignment removes the row from the current viewer's list**:
  as a `SELF`-scoped synthetic user assigned to a lead, change its status
  to the mock-designated "routed" status (§Files to touch); assert the
  save succeeds, the list re-fetches, and the lead's row is no longer
  present — proving the re-fetch-not-patch decision above is load-bearing,
  not cosmetic.
- **Permission gating**: as a role without `leads:edit`, the Status column
  renders the existing read-only `StatusPill` and no `<select>`/Save
  control appears at all — matching exactly how the Board hides
  `MoveStatusMenu` and shows its own read-only banner for the same
  permission gap, proven by a test rather than asserted.
- **Current status stays selectable when deactivated**: a row whose current
  status is inactive still shows that status as the selected option.
- **Row-click guard**: interacting with the select/Save doesn't navigate to
  the seller detail page (`DataRow`'s own `onClick`).
- Board regression: `BoardPage.test.tsx` passes unchanged against the
  relocated `StatusChangeRejectedDialog` and the re-exported classifier,
  proving the extraction in §1 changed no Board behavior.

**Gates to run and report actual results:** `pnpm format`, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build`.

## Rollback plan

No schema or API changes — this is a frontend-only feature reusing the
existing `PATCH /leads/:id` contract exactly, so there is nothing to roll
back at the data layer. The extraction in §1 (moving `MoveRejectedDialog`
and `classify()` out of `pages/board/`) is mechanically reversible by
moving the files back and re-pointing the one import in `BoardPage.tsx`;
nothing about Board's own behavior depends on where those files live. The
MSW fixture addition (§Files to touch) is test-only and reverts with the
rest of the diff.
