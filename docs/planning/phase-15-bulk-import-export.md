# Phase 15 — Bulk lead import / export

Status: approved 2026-08-13. **Delivered.** Recorded as ADR-0016.

All ten decisions were taken as recommended, including §D9 reading (a): the
100,000-row resumable requirement in `quality-gates.md` and
`cronberry-mapping.md` §4 is scoped to the Cronberry migration run, not to this
general feature. Both documents now say so.

Seven things the implementation found that the plan did not anticipate:

- **`PrismaLeadRepository.transaction` needed no change to be borrowed, but it
  did need extracting.** `forTransaction` is the body of `transaction` lifted
  out, so bulk import opens its own transaction — with a timeout no single-lead
  path has any business choosing — and still gets the identical repository,
  trigger consumers and all. An imported lead reaches Notifications, Campaigns
  and Routing because it is the same object doing the work, not a parallel one.
- **The savepoint design produced a *better* `stopOnError` than the plan
  proposed.** §6 offered "stop at the first failure"; the rollback mechanism was
  already there, so the implementation evaluates every row and *then* keeps
  nothing. The admin gets the whole error list instead of one failure per
  upload, and it is the same `DryRunRollback` a preview throws.
- **File-level import errors had to start carrying their message.** The rest of
  the API returns a bare `{error: <code>}`, which is right when the code is all
  a client may safely learn. "Two columns are mapped to the same target" is
  about the admin's own upload, and the phase's plain-language requirement
  cannot be met from a code alone. Authorization failures still return
  `forbidden` with nothing else.
- **The first vacuity check failed for the wrong reason, and had to be redone.**
  Making a preview roll back each row as it went broke the run with a 500
  (rolled-back leads leaving dangling audit references) rather than failing the
  fidelity assertion. The faithful mutation — hiding the run's own creations
  from the duplicate lookup — fails the deep-equal on exactly the two rows that
  duplicate each other, which is the claim.
- **The export vacuity check exposed a vacuous assertion.** Swapping the
  predicate source to `leads:export` leaked 19 leads where the list showed 1 —
  but in the *passing* case the wide-export role owned nothing, so the test had
  been comparing two empty sets. It now owns exactly one lead, and asserts the
  listed set is non-empty before asserting equality.
- **jsdom cannot carry a `File` through `fetch`.** Its `File` is not undici's,
  and undici's multipart parser asserts on the difference, so a `FormData` file
  arrives stringified under test. The mock handlers answer with fixtures rather
  than parsing the upload; parsing is covered by the CSV unit tests and the
  engine by the Postgres suite.
- **A one-column CSV cannot represent a row whose only value is empty.** `\n` is
  both "a record of one empty field" and a blank line, and dropping blank lines
  is what stops every spreadsheet export's trailing newline reporting a spurious
  row. Pinned by a test rather than left to be discovered, because it bounds
  what round-tripping guarantees.

The two security-critical tests were checked for vacuity by mutation before the
PR, as 14a and 14b were. Full gate — `format:check`, `lint`, `typecheck`,
`test`, `build` — run and observed green, with the Postgres suite against a real
Postgres 16 (CI runs 17.5).

---

## The plan as approved

Ten decisions were requested below (§D1–§D10) and one **conflict between `docs/`
and this phase's brief** was surfaced rather than resolved (§D9, per the
`source-of-truth.md` precedence rule and `PLANS.md`'s "stop and surface it").

Four things the investigation found that the brief assumed differently. They are
not objections — they change the design, so they lead:

- **There is no duplicate-detection mechanism to integrate with.** The brief
  says to reuse the one backing `RepeatLeadTab`. That component's own comment
  says the opposite: *"The server has no duplicate concept — phone and email are
  nullable, unnormalized and non-unique"* (`RepeatLeadTab.tsx:14-25`). It is a
  client-side substring search over the scoped Seller List. The only server-side
  "duplicate" is `findActiveProcessInstanceByLeadJourney` — one active instance
  per (lead, journey) — which is a different question. §4 designs the missing
  mechanism explicitly instead of pretending to reuse one.
- **`ImportJob` fits as the run header and does not fit as the run record.** It
  has actor, timestamp, mapping and status, but **no row counts and no link to
  what it created** — both of which the brief requires. And `file_key` is
  `NOT NULL`, designed for object storage that ADR-0012 makes **optional**. §5.
- **Dry-run/commit fidelity is achievable exactly, not approximately** — because
  `PrismaLeadRepository.transaction` already flattens a nested transaction
  (`prisma-lead-repository.ts:161-162`). One outer transaction plus per-row
  `SAVEPOINT`s makes dry-run and commit *the same code path with one boolean at
  the end*. §3. This is the design's centre.
- **Export can be made structurally identical to the list**, rather than a
  parallel query that has to be kept honest by review, by paging the existing
  `listSellers` repository call. §7.

## Goal

Let an admin upload a CSV of leads, map each source column to a Lead core field
or an existing configured Field, preview exactly what would happen per row
without writing anything, then commit — with every created lead going through
the same `LeadService.createLead` transaction, validation and audit path as a
single-lead creation — and let a permitted user export the current Seller List
to CSV containing no row and no field they could not already see in the list.

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/source-of-truth.md`,
`docs/requirements/v1-scope.md`, `docs/requirements/open-decisions.md`,
`docs/permissions/access-model.md`, `docs/data-model/schema.md`,
`docs/api/endpoints.md`, `docs/migration/cronberry-mapping.md`,
`docs/testing/quality-gates.md`, `docs/workflows/journey-definitions.md`,
ADR-0001, ADR-0002, ADR-0003, ADR-0004, ADR-0009, ADR-0010, ADR-0011, ADR-0012,
ADR-0013, ADR-0014, ADR-0015, and the Phase 5, 9, 13a, 13b, 13c, 14a and 14b
plans.

---

## Current state

Verified against `91cd33b`. Everything below was read, not assumed.

### `ImportJob` exists, is wired to nothing, and is a partial fit

`schema.prisma:702-719`, DDL at `migrations/00000000000000_initial/migration.sql:279-286`.
A repo-wide search finds it only in the schema, that DDL, the rollback script and
`docs/data-model/schema.md:201` — **no reader, no writer, no route, no seed.**

```
import_jobs
  id, organization_id, source, file_key, status, mapping_json,
  created_by, created_at, updated_at
  PRIMARY KEY (organization_id, id)
  INDEX (organization_id, status, created_at)
```

| Brief requires | `ImportJob` today |
|---|---|
| actor | ✅ `created_by` FK to users |
| timestamp | ✅ `created_at` / `updated_at` |
| the mapping | ✅ `mapping_json` jsonb |
| run state | ✅ `status` (free text) |
| **row counts** | ❌ **absent** |
| **trace back what was created** | ❌ **absent** — nothing links a lead to a job |
| the file | ⚠️ `file_key` `NOT NULL`, and object storage is **optional** (ADR-0012) |

**Verdict: use it, extend it.** It is the right header record and inventing a
parallel one would be worse. But it needs counts and a per-row child, and
`file_key` needs an honest meaning on a deployment with no S3. §5.

### `leads:export` is grantable and honoured by nothing

`catalog.ts:20` lists `export` under `leads`. A repo-wide search for the pair
finds **exactly one hit — the catalog entry itself.** No route, no service, no
test. `docs/api/endpoints.md:179-180` already records both gaps as reserved
paths:

```
GET    /leads/export   -- NOT IMPLEMENTED (leads:export is grantable but honoured by no route)
POST   /leads/import   -- NOT IMPLEMENTED
```

There is no `import` action in the catalog. §D1.

### The single-lead creation path, in full

`LeadService.createLead` (`leads/service.ts:110-193`), one transaction:

1. `validateAssignments` — **at least one assignment is required**
   (`leads/validation.ts:28-30`), each with a non-blank free-text
   `assignmentType` and a `userId`. No canonical owner string exists anywhere,
   per `docs/api/endpoints.md:274`.
2. `validateAssignmentUsers` — every assignment user must exist in the org.
3. Journey must exist and be active.
4. Status: `statusId` if given, else `findDefaultStatus` — `is_default_on_create`
   within that journey (`prisma-lead-repository.ts:189-195`). **No hardcoded
   default.**
5. `validateFieldValues` — rejects a value whose Field is not actively assigned
   to the journey, or is `hidden`; enforces `requirement: required` with exact
   `required_from_status_id` matching; type-checks against `field_type` and
   applies `validation_rule` (`pattern`/`minLength`/`maxLength`).
6. Create the lead (or attach to `existingLeadId`).
7. `findActiveProcessInstanceByLeadJourney` → `dependency_conflict` if the lead
   already has an active instance in that journey.
8. Create the process instance, then one assignment row per entry.
9. `writeActivity` `action_type: 'field_edit'`, `source: 'lead_api'`.

Authorization sits **outside** the service, in `routes/leads.ts:134-183`:
`resolveAuthorization({module: 'leads', action: 'create', journeyId,
requestedEditFieldIds: Object.keys(fieldValues), assignmentTypes})`. Because
`allowed = deniedReasons.length === 0` (`decision.ts:196`), **`FIELD_EDIT_DENIED`
blocks the whole create.** An import that ignored this would have a dry run that
predicts "create" and a commit that 403s. §2 handles it by authorizing the
mapping once per file.

### `writeActivity` fans out to three trigger consumers, all inside the transaction

`prisma-lead-repository.ts:352-380` → `triggerTypeFor` → `TriggerDispatcher` over
Notifications, Campaign triggers and Status Routing (ADR-0013, ADR-0015).

This matters for a dry run that rolls back. Checked, all three:

- `NotificationService` writes `notifications` rows only — no email sender is
  imported anywhere in `notifications/service.ts`.
- `CampaignTriggerService` writes a `pending` `campaign_sends` row and
  explicitly does **not** send; delivery is `CampaignSendService`, after commit
  (`campaigns/trigger-service.ts:5-16`). It also ignores everything except
  `status_changed`, and creation writes `field_edit`.
- `StatusRoutingService` writes assignments and activities in the same
  transaction.

**So a rolled-back dry run has no out-of-transaction side effect.** That is a
claim §Test plan pins with a test rather than leaving as an argument.

### `PrismaLeadRepository.transaction` already flattens nesting

```ts
async transaction<T>(work) {
  if (this.prisma.$transaction === undefined) return work(this);   // :162
  return this.prisma.$transaction((tx) => work(new PrismaLeadRepository(tx, …)));
}
```

A Prisma transaction client has no `$transaction`, so a repository built over one
runs `createLead` **inline on the caller's transaction**. This was written for
composition; it is what makes §3 possible without touching `LeadService` at all.
`$executeRawUnsafe` is available on that same client — `admin/bootstrap.ts:23`
already uses it for an advisory lock — so `SAVEPOINT` works.

### The Seller List read path, and where scope and field visibility are applied

`routes/leads.ts:333-406`:

1. `resolveAuthorization({module: 'leads', action: 'view', journeyId?,
   requestedFieldIds, assignmentTypes})`.
2. `FIELD_VIEW_DENIED` is deliberately **non-blocking** — a requested column the
   caller cannot see is stripped, not a 403 (`:363-373`). A *filter* on such a
   Field **is** blocking.
3. `decision.recordPredicate` → `buildSellerListQuery` (`filter-sql.ts`), whose
   `accessClause` ANDs data scope with every filter so no filter can widen it.
4. `serializeLead(row, decision.fields.visibleFieldIds)` →
   `pickVisibleFieldValues` strips every other Field from every row.

Two details the export design turns on:

- **Scope is per (role, module, action)**, not per role: `effectiveScope =
  permission?.scope` (`decision.ts:113`), and `buildRecordPredicate` is passed
  `action: request.action`, which becomes `directGrantAction` in the shared-lead
  branch (`filter-sql.ts:117, 162-167`). So authorizing an export as
  `leads:export` would use the *export* scope and the *export* direct-grant
  action — which can be **wider** than the list's. §D6.
- `listSellers` already hydrates, redacts and flags `shared` per page
  (`prisma-lead-repository.ts:531+`). Paging it *is* the list. §7.

`leads` has `leads_phone_idx` and `leads_email_idx` on `(organization_id, <col>)`
and `leads_field_values_gin_idx` (initial migration `:163-166`) — exact-match
lookups on phone, email and Field values are index-served; a `lower()` match is
not. §4.

### The web app's permission gating and download precedent

`can(module, action)` from `AuthContext`; `PermissionRoute` for routes; the
Sidebar builds each group's items behind `can(...)` (`Sidebar.tsx:116-165`).
`api-client.ts:94` already has `requestBlob`, and `DocumentLockerTab.tsx:60-70`
is the one existing anchor-download. Nothing generates CSV anywhere; `jspdf`
exists for the single-record PDF only.

### `@fastify/multipart` is already registered globally

`build-server.ts:33`, with the comment that attachments are currently the only
multipart route and set their limits per-route. Import can register its own
limits the same way. **No new production dependency is needed for uploads.** A
CSV *parser* is a separate question — §D8.

---

## Proposed approach

### 1. Shape of the flow

Three endpoints, one shared engine, no server-side file storage:

```
POST /api/v1/leads/import/analyze   multipart  → columns + samples + fill rates
POST /api/v1/leads/import/preview   multipart  → per-row outcomes, writes NOTHING
POST /api/v1/leads/import/commit    multipart  → creates leads, same outcomes
GET  /api/v1/leads/export           query      → text/csv
GET  /api/v1/leads/import/jobs      query      → this org's import history
```

The client holds the file across the three steps and re-sends it. That is what
lets the feature work on a deployment with no object storage (ADR-0012 makes S3
optional and CI has none), and §5 explains how "the commit ran on the same bytes
the preview ran on" is *proved* rather than assumed.

### 2. Authorization happens once per file, not once per row

The mapping is per-file, so every row writes the same set of Field ids. One
decision covers the file:

```ts
resolveAuthorization({ module: 'leads', action: 'import', journeyId,
                       requestedEditFieldIds: <every mapped Field id>,
                       assignmentTypes: <every assignment type in the mapping> })
```

plus a second call for `leads:create` (§D1). Consequences, all deliberate:

- A mapped Field the importer cannot **edit** rejects the **file at the mapping
  step**, naming the column — not row 4,000 with a 403. Strictly no weaker than
  per-row: it requires edit rights on every mapped Field even where a row leaves
  it blank.
- Journey access and record scope are decided once, so the permission dimension
  of "dry run matches commit" is true by construction rather than by test.
- N rows cost one authorization instead of N.

### 3. Dry-run and commit are one code path

```
prisma.$transaction(async (tx) => {
  const repo = new PrismaLeadRepository(tx, …)      // flattens: :161-162
  for (const row of rows) {
    await tx.$executeRawUnsafe(`SAVEPOINT r`)
    try   { const r = await new LeadService(repo).createLead({…row}); record(created, r.lead.id)
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT r`) }
    catch (e) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT r`); record(rejected, reason(e)) }
  }
  writeImportJob(tx, outcomes)
  if (mode === 'preview') throw new DryRunRollback(outcomes)   // ← the only difference
})
```

`DryRunRollback` is caught immediately outside and its payload returned. Every
other line is shared. This gives four properties that a parallel "validate-only"
implementation could not:

- **The dry run genuinely writes nothing** — one aborted transaction, including
  the `ImportJob` row itself and everything the trigger fan-out wrote.
- **It uses the real validation path**, because it *is* `LeadService.createLead`.
  A new Field type, a new `validation_rule`, a change to required-field
  semantics — all are picked up with no import-side change.
- **In-file duplicates are seen.** Rows run in one transaction, so row 500 sees
  row 12's insert. A per-row-transaction dry run would report "create, create"
  where commit reports "create, skip" — the single most likely fidelity bug in
  this feature, structurally excluded.
- **Partial failure is per row**, because a rolled-back savepoint does not abort
  the enclosing transaction. Postgres semantics, not application bookkeeping.

Costs, stated rather than discovered later: one transaction is held open for the
whole file (§D9's row cap is the mitigation, and Prisma's interactive-transaction
`timeout` must be raised explicitly for it); and a savepoint per row is a real
per-row cost, measured before the PR against the cap.

`LeadService` is **not modified**. No `dryRun` flag reaches it.

### 4. Duplicate detection — the mechanism does not exist, so define it (§D3)

Not reusable as-is: `RepeatLeadTab` is a client-side substring search
(`RepeatLeadTab.tsx:26-42`), and `findActiveProcessInstanceByLeadJourney`
answers "is this lead already in this journey", not "is this row this person".
ADR-0004's priority ladder is a **Cronberry migration configuration**
(`audience_id`, `seller_merchant_token`, `gst_number`) — baking any of it into
this feature is precisely the hardcoded-business-data bug `source-of-truth.md`
forbids.

**Proposal: a per-import match key chosen by the admin.**

- The mapping step includes a *Duplicate matching* control: pick zero or more
  mapped targets — core `phone` / `email` / `name`, or any mapped Field.
- A row matches an existing active lead when **every** selected key has a
  non-blank value in the row and equals the lead's stored value. Phone and Field
  values match exactly on the trimmed string (index-served); email matches
  case-insensitively (§D4 — needs one new expression index).
- Zero keys selected = matching off, every row creates. Chosen explicitly, never
  defaulted into.
- A matched row is reported `skipped_duplicate` and creates nothing.

ADR-0004 then becomes what it always was: the *configuration* the migration run
uses, applied through this feature, with no Cronberry name in application code.

**Matching runs org-wide; reporting is scope-aware.** Restricting the match to
leads the importer can see would silently create real duplicates of records they
cannot see — worse than the alternative. But naming the matched lead would leak
its existence. So the preview reports the matched lead's id and name only when
that lead is inside the importer's record predicate, and otherwise says *"matches
an existing record you do not have access to."* Tested both ways.

### 5. `ImportJob` — extend it; make `file_key` honest (§D5)

```text
import_jobs                              -- existing, ALTERed
  … existing columns …
  file_name          text     NOT NULL DEFAULT ''    -- what the admin uploaded
  content_hash       text     NOT NULL DEFAULT ''    -- sha256 of the bytes
  row_count          integer  NOT NULL DEFAULT 0
  created_count      integer  NOT NULL DEFAULT 0
  skipped_count      integer  NOT NULL DEFAULT 0
  rejected_count     integer  NOT NULL DEFAULT 0
  status: 'preview' | 'committed' | 'failed'

import_job_rows                          -- new
  id, organization_id, import_job_id, row_number,
  outcome ('created'|'skipped_duplicate'|'rejected'),
  lead_id uuid NULL,          -- FK (organization_id, lead_id) -> leads
  process_instance_id uuid NULL,
  matched_lead_id uuid NULL,  -- for skipped_duplicate
  reason text NULL,           -- for rejected: the LeadError code + message
  UNIQUE (organization_id, import_job_id, row_number)
```

`import_job_rows` is what "trace back what was created" actually means: for any
lead, which import made it, from which row; for any import, exactly what it did.
The counts on the header are the reconciliation `cronberry-mapping.md:§4`
requires (source / created / duplicate / rejected). It is only written on
**commit** — a preview's rows exist inside the aborted transaction and vanish
with it.

**`file_key` is repurposed to `sha256:<hash>` rather than an object key**, and
its meaning is documented in `docs/data-model/schema.md`. This is the honest
option given ADR-0012 makes storage optional, and it buys a real guarantee: the
preview response carries the hash, the commit request echoes it, and **a commit
whose bytes hash differently from its preview is refused with `409
file_changed`.** "Whatever the dry-run predicts, the real commit must match"
therefore cannot be defeated by swapping the file between steps.

The rejected `reason` text is written from `LeadError.code`/`message`, which are
generated from configuration ids, never from source column names — and the
uploaded file's cells are never copied into it. Relevant because
`cronberry-mapping.md:§2` requires excluded columns to stay out of error
payloads.

### 6. Partial success is the default (§D2)

**Recommended: a file partially succeeds.** Valid rows are created; duplicate and
invalid rows are reported individually with a reason; nothing is silently
dropped, and `created + skipped + rejected == row_count` is asserted by test.

Rationale: a 4,000-row migration file with nine bad phone numbers should not
require nine round trips of "fix one, re-upload everything." The preview means
the admin has already *seen* the failures and confirmed anyway, which is the
consent all-or-nothing would otherwise be protecting.

All-or-nothing remains available as an explicit `"stopOnError": true` flag on the
commit request — one `if` in the loop, since the outer transaction is already
there — but it is off by default.

A genuine fault (database error, storage error) is not a rejected row: it
propagates, the outer transaction rolls back, and the whole file fails. Only
`LeadError` becomes a row outcome.

### 7. Export is the Seller List, paged (§D6, §D7)

```
GET /api/v1/leads/export?<every parameter GET /leads already accepts>
```

The handler takes the same `SellerListInput` the list takes, then calls the
**same** `sellerRepository.listSellers` with the **same** `recordPredicate` and
the **same** `serializeLead(row, decision.fields.visibleFieldIds)` — page by
page, pageSize 500, until the cap or the end. Export is not a query that
resembles the list; it is the list, run to completion. A future change to scope,
to filters or to redaction lands on both at once, and cannot land on one only.

- **Gate: `leads:export`.** Denied → 403 before anything is read.
- **Predicate and field visibility: from `leads:view`** (§D6). Two
  `resolveAuthorization` calls. This is what makes "never a row or field the
  same user couldn't see in the list view" structurally true instead of
  dependent on an admin having configured two scopes consistently.
- `requestedFieldIds` = every active Field in the org, so the engine — not the
  client — decides the column set. `FIELD_VIEW_DENIED` stays non-blocking
  exactly as in the list; the invisible columns are simply absent from the CSV
  header. A role with restricted visibility gets a **narrower header**, not
  blank cells, so the CSV does not even disclose which Fields exist.
- Columns: `id, name, phone, email, journey, status, owner, created_at,
  updated_at`, then one column per visible Field, headed by the Field's
  configured **name** with its id in the mapping metadata — never a hardcoded
  key.
- **One row per (lead × visible active process instance)** (§D7), re-filtered
  through `predicate.journeyIds` so an instance in an inaccessible journey never
  appears. This is a superset of the list's display (which renders
  `processInstances[0]` only, `SellerListPage.tsx:275`) and it is the shape the
  importer consumes, so an export round-trips.
- Audit: one `system_audit_logs` row, `entity_type: 'lead_export'`, `entity_id`
  a generated run uuid, `new_value` carrying the filters, the row count and the
  exported Field ids. Required by `access-model.md:97`.

### 8. Frontend

**Route** `/import` behind `PermissionRoute module="leads" action="import"`; a
Sidebar entry in the existing configuration group behind the same `can(...)`,
following `Sidebar.tsx:116-165` exactly. **Export** is a button in the Seller
List toolbar, rendered only under `can('leads', 'export')`, posting the toolbar's
current filter state verbatim so what downloads is what is on screen.

The import flow is four steps against a persistent step rail — see §10 for the
design intent, which is a requirement of this phase and not decoration.

1. **Upload.** Drop zone; on drop, `analyze` returns the header, three sample
   values per column and a fill rate.
2. **Map.** Per-file Journey (required), optional per-file Status, assignment
   configuration, duplicate match key — then the column mapper.
3. **Preview.** `preview` runs the real thing and rolls it back.
4. **Confirm → Commit → Result.**

### 9. Journey, Status and assignment follow the single-lead rule exactly (§D10)

The rule established in Phase 5 and restated at `docs/api/endpoints.md:274` is:
an explicit journey, a valid status or the journey's `is_default_on_create`, at
least one assignment, and **no invented canonical owner**. Bulk changes none of
it.

| | Where it comes from | If it cannot be resolved |
|---|---|---|
| **Journey** | per-file, required, chosen from the journeys the importer can access | file rejected at mapping |
| **Status** | per-file default, or a mapped column resolved **by name or key within the chosen journey**; absent → `findDefaultStatus`, the same call `createLead` makes | **row rejected**, naming the unmatched value |
| **Assignment** | per-file explicit `{assignmentType, userId}` entries, and/or a column mapped to an assignment of a named type resolved to a user **by email** | **row rejected** |

The last cell is the one that matters: a row whose owner column names someone
who is not a user in this org is **rejected**, never quietly assigned to the
importer or to any default. `validateAssignments` would reject an empty list
anyway (`validation.ts:28-30`) — this makes the failure legible instead of
letting it arrive as a generic validation error 4,000 times.

Assignment types stay free text with the journey's observed types offered as
suggestions, per ADR-0015's finding that the set is discovered from data.

### 10. Design — the import flow

Time-boxed, and specified because "a plain table of dropdowns" is the default
this is meant to avoid.

**Step rail.** A persistent horizontal rail — Upload · Map · Preview · Commit —
showing done / current / upcoming, with the file name and row count pinned beside
it once known, so context never has to be remembered between steps. Steps are
back-navigable up to Preview; after commit the rail resolves to a result state.

**Mapping.** Not paired dropdowns in a table. One card per source column:

```
┌──────────────────────────────────┐        ┌────────────────────────────┐
│ mobile                    97% ▓▓ │  ──→   │ ▾ Phone         (core)     │
│ 9812…  ·  9822…  ·  9833…        │        │                            │
└──────────────────────────────────┘        └────────────────────────────┘
```

The source side shows the column name, its fill rate as a small meter, and three
real sample values — so the admin maps from evidence rather than from a header
they are guessing at. The target side is a grouped picker (Core fields · Fields ·
Assignment · Status · Skip). **The default is `Skip`, always, shown explicitly**
— no column is ever pre-guessed into a target, and "35 columns skipped" is
displayed as a deliberate count, not an absence. A running "12 of 47 mapped"
meter and inline conflict warnings (two columns to one target; a required Field
unmapped) sit above the list. Mapped cards visually connect across the gap;
skipped ones recede.

**Preview leads with the numbers.** Three large counts — **Create / Skip /
Error** — in the tone of their meaning (won / open / lost, from the existing
status palette; gold is never a status meaning per `theme.css:11`). Each is a
toggle that filters the row list below. Errors are grouped by reason with a
count each (*"Required field missing: Company name — 34 rows"*), expandable to
the actual rows with row numbers, so the fix is obvious. A row-level list, never
a wall of text, and never only a count.

**Commit** shows the confirmed counts and what is being written, not a bare
spinner. **The result** names what happened — created, skipped, rejected — links
to the Seller List, and states plainly that the rejected rows were not created
and the file can be corrected and re-uploaded.

**Empty and error states say what happened and what to do**: "That file has no
data rows — only a header." / "Row 1 has 47 columns but row 12 has 45; the file
may not be valid CSV." / "You do not have permission to write to the Field
*Company name*, so this column cannot be mapped." Never "An error occurred."

### 11. Design system audit — what is actually there

Investigated first, per the brief. The honest finding is that **the palette is
designed and the typography is not.**

**Genuinely considered, leave alone.** `theme.css` is a deliberate system with
its reasoning written down: a warm working-surface ramp with four steps
(`surface-sunken`/`surface-hover`/`line-soft`/`ink-muted`) added precisely
because "every boundary drawn at the same weight is most of what makes a table
look flat and dated" (`:26-37`); a status palette kept separate from brand gold
on purpose; radius deliberately tightened from 14px with the reason recorded;
restrained shadows. The primitives have real craft too — `DataTable`'s sticky
recessed header and hover-revealed `RowActions`, `Dialog`'s focus management and
Esc handling, `Tabs`' full arrow-key/Home/End tablist. This is not generic.

**The generic-AI tells that are actually present**, counted across all `.tsx`:

| Finding | Evidence |
|---|---|
| **No type scale.** 190 of 200 size usages are `text-sm` or `text-xs`. Everything is 14px or 12px. | `text-sm` ×123, `text-xs` ×49, `text-lg` ×7, `text-base` ×5, `text-2xl` ×3, `text-xl` ×2, `text-3xl` ×1 |
| **The ramp has no floor, so sites invent one.** 14 arbitrary escapes below `xs`. | `text-[11px]` ×9, `text-[10px]` ×5 |
| **The eyebrow/section-label is re-invented ~10 times in 4 sizes and 4 trackings.** | `DataTable.tsx:45` and `RecordSummaryPanel.tsx:41,107,137` use `text-[11px] … tracking-[0.06em]`; `Sidebar.tsx:100` uses `tracking-[0.1em]`; `Sidebar.tsx:208` uses `text-[10px] … tracking-[0.14em]`; `LeadFormPage.tsx:188,220,313` use `text-sm … tracking-wide` |
| **Four unrelated heading treatments, no primitive.** | `PageFrame.tsx:27` `text-2xl font-bold tracking-tight`; `LoginPage.tsx:53` `text-xl font-bold tracking-wide`; `Dialog.tsx` `text-lg font-bold`; `EmptyState.tsx` `text-lg font-semibold` |
| **No card padding decision.** Four values across ~30 call sites. | `p-4` ×28, `p-6` ×13, `p-5` ×13, `p-3` ×13 |

**Proposed change — shared primitives only, no page redesign.**

1. **A type scale in `@theme`**, documented in the same voice as the colour ramp:
   an `--text-eyebrow` (11px / 0.06em / semibold / uppercase) that ends the four
   competing versions, and named display steps so a heading is a decision, not a
   size guess.
2. **`Heading` and `Eyebrow` primitives** in `components/ui/`. `PageFrame`,
   `Dialog`, `EmptyState`, `DataTable`, `Sidebar` and `Card` adopt them — which
   lifts **every page at once**, because every page already renders through those
   six.
3. **`CardHeader` / `CardBody` / `CardFooter`** carrying one padding rhythm, so
   new surfaces stop choosing between `p-3` and `p-6`. Existing `<Card
   className="p-4">` call sites keep working untouched and migrate
   opportunistically — not in this phase.
4. **One `Stepper` primitive** for the import rail, built as a general primitive
   because it is the sort of thing the next multi-step flow will otherwise
   re-invent inline.

The three inline eyebrow sites in `RecordSummaryPanel` and
`LeadFormPage` are swapped to `<Eyebrow>` as a same-treatment substitution — no
layout change, ~8 lines — because leaving them is leaving the exact
inconsistency this section exists to remove. That is the full extent of the
page-level edits.

Explicitly **not** in scope: a new palette, a new font, motion/animation tokens,
a dark mode, an icon system, or touching any page's layout.

---

## Decisions requested

Each names a recommendation. I will build the recommendation unless told
otherwise, except **§D9, which is a documentation conflict and should not be
resolved by me at all.**

### D1 — `leads:import`, or reuse `leads:create`?

**Recommended: add `leads:import` to the catalog, and require `leads:create` as
well.**

Creating one lead you are looking at and creating four thousand from a file are
different levels of trust with different blast radii. The catalog already makes
exactly this distinction twice, with the reasoning written in comments:
`campaigns:send` separate from `campaigns:edit` (`catalog.ts:51-53`) and
`lead_routing:operate` separate from `configure` (`:58-62`). `leads:export`
already exists as a peer for the read direction; import having no counterpart is
an omission, not a decision.

Requiring **both** follows ADR-0015's "additional gate, never a replacement":
`leads:import` never lets someone create a lead they could not create singly, in
a journey they cannot access, with a Field they cannot edit.

Cost: `leads:import` appears on every role editor screen, as `campaigns` did in
13c and `lead_routing` did in 14b. Alternative: reuse `leads:create`, which makes
the feature free to grant and impossible to withhold from anyone who can create a
lead at all.

### D2 — Partial success or all-or-nothing?

**Recommended: partial success by default** (§6), with an explicit
`stopOnError` flag for callers who want the other behaviour. Nothing is ever
silently dropped; every row appears in exactly one of the three counts and in
`import_job_rows`.

### D3 — Duplicate detection: build the configurable match key?

**Recommended: yes, as specified in §4.** The alternative is to ship import with
no duplicate detection at all, since — contrary to the brief's premise — there is
nothing to integrate with. The third option, hardcoding ADR-0004's ladder, is
ruled out by `source-of-truth.md`.

Sub-decision: **duplicates are skipped, not attached.** `createLead` already
supports `existingLeadId` (the repeat-lead path), so "attach this row's journey
to the matched lead" is a small extension — but it is a second product behaviour,
it is not what the brief asks for, and it should be its own decision later.

### D4 — Case-insensitive email matching, and one new index?

**Recommended: yes.** Email dedup that misses `A@x.com` vs `a@x.com` is not
useful. `leads_email_idx` is on the raw column, so this needs
`CREATE INDEX leads_email_lower_idx ON leads (organization_id, lower(email))`.
One index, reversible by dropping it. Say so if you would rather match exactly
and add no index.

### D5 — Extend `ImportJob` and add `import_job_rows`?

**Recommended: yes** (§5), including repurposing `file_key` as a content hash
with the meaning documented. Alternative: counts on the header only, with
traceability left to `activity_logs.source = 'import'`. That is one less table,
but it cannot answer "which rows were rejected and why" after the response is
gone, and it cannot support the `409 file_changed` guarantee.

### D6 — Which permission supplies the export's scope?

**Recommended: gate on `leads:export`, take the record predicate and field
visibility from `leads:view`.**

Because scope is per (role, module, action) (`decision.ts:113`), authorizing the
export as `leads:export` would let a role configured `leads:export` at
`ORGANIZATION` while `leads:view` is `SELF` export records it cannot list —
violating the phase's own invariant through configuration alone.

Accepted consequence, stated plainly: **a deliberately narrower scope configured
on `leads:export` is not honoured** — `export` becomes a capability flag, not a
scope. The alternative is intersecting both predicates, which is more faithful
but doubles the SQL surface that has to stay correct.

### D7 — One CSV row per lead, or per process instance?

**Recommended: per (lead × visible active process instance)** (§7) — round-trips
through the importer, and loses nothing for a lead in one journey. Alternative:
one row per lead matching the list's display, which drops every journey after the
first from the export without saying so.

### D8 — Hand-rolled CSV, or a dependency?

**Recommended: hand-rolled, in `packages/validation`.** RFC 4180 parsing —
quoted fields, embedded commas, escaped `""`, CRLF, a BOM — is roughly 80 lines
and fully unit-testable, and generation is shorter. `AGENTS.md:43` requires
justifying any new production dependency, and this one would sit on the path
where uploaded bytes are first interpreted.

Say so if you would rather take `csv-parse`/`papaparse`; the justification would
be malformed-input hardening, which is a fair argument.

### D9 — **Conflict between `docs/` and this phase's brief. Not mine to resolve.**

Two documents state a requirement this phase's brief puts out of scope:

- `docs/testing/quality-gates.md:25` — *"A 100,000-row import is resumable and
  doesn't block normal interactive use."*
- `docs/migration/cronberry-mapping.md:§4` — the importer must provide
  *"resumable, idempotent batches"* and *"load validation for a resumable
  100,000-row import."*

The brief says: *"Scheduled/recurring imports, multi-file batch jobs, background
job queue infrastructure — keep this to a synchronous … single-file flow."*
`source-of-truth.md:20-24` puts `docs/` above raw source material, and `PLANS.md`
requires surfacing a conflict rather than picking a side.

**My reading, offered as a reading and not a resolution:** both documents scope
that requirement to *the Cronberry migration run*, which the brief explicitly
separates from this general feature. `cronberry-mapping.md:§4` is headed "Before
implementation, the importer must provide" inside a migration ledger, and the
same section requires ADR-0004 dedup evidence that §4 above deliberately does not
hardcode. If that reading is accepted, Phase 15 ships the general feature
synchronously with a documented cap, and the 100k/resumable requirement is a
named follow-up attached to the migration.

**What I need from you:** either (a) confirm that reading, and I will add the
scoping sentence to `quality-gates.md` and `cronberry-mapping.md` and record it
in the new ADR; or (b) tell me the requirement applies to this feature, in which
case background-job infrastructure is back in scope and this plan needs
rewriting, not amending.

**Contingent on (a): the cap.** I propose **5,000 rows and 5 MB per file**,
matching `maxManualRecipients = 5000` (`routes/campaigns.ts:138`), with a clear
message naming the limit and telling the admin to split the file. Export I
propose capping at **50,000 rows**, with the response stating when a cap
truncated it rather than silently returning a short file.

### D10 — Per-row Status and per-row assignment resolution?

**Recommended: support both as mappable targets** (§9), with unresolvable values
rejecting the row. Dropping per-row status would mean every imported lead lands
in one status, which no real migration survives. Dropping per-row assignment
would leave a per-file owner as the only option — workable, but it discards the
`Lead Owner` column that `cronberry-mapping.md:§3.2` expects to map.

---

## Files to touch

**Database** — `packages/database/prisma/schema.prisma`; new migration
`00000000000007_bulk_import` (ALTER `import_jobs` with six columns; CREATE
`import_job_rows`; CREATE `leads_email_lower_idx` per §D4) plus its
`rollback.sql`.

**Validation package** — `packages/validation/src/csv.ts` *(new)*, `index.ts`.

**Permission engine** — `packages/permission-engine/src/catalog.ts` (add
`import` to the `leads` module, per §D1). No change to `decision.ts`, `scope.ts`
or `fields.ts`.

**API**
- `apps/api/src/import/{service,mapping,matching,validation,errors,types}.ts` *(new)*
- `apps/api/src/import/prisma-import-repository.ts` *(new)* — `ImportJob` /
  `import_job_rows` writes
- `apps/api/src/export/{service,csv}.ts` *(new)*
- `apps/api/src/routes/{import,export}.ts` *(new)* — permission gating
- `apps/api/src/http/routes/{import,export}.ts` *(new)*
- `apps/api/src/http/build-server.ts`, `http/types.ts`, `main.ts` — wiring
- `apps/api/src/leads/prisma-lead-repository.ts` — expose `$executeRawUnsafe` on
  the client interface for savepoints. **No change to `leads/service.ts` or
  `leads/validation.ts`.**

**Web**
- `apps/web/src/pages/import/ImportPage.tsx`, `UploadStep.tsx`,
  `ColumnMappingStep.tsx`, `PreviewStep.tsx`, `ResultStep.tsx`,
  `import-state.ts` *(new)*
- `apps/web/src/components/ui/{Heading,Eyebrow,Stepper}.tsx` *(new)*;
  `Card.tsx` (add `CardHeader`/`CardBody`/`CardFooter`)
- `apps/web/src/components/ui/{DataTable,Dialog,EmptyState}.tsx`,
  `components/layout/{PageFrame,Sidebar}.tsx` — adopt the new primitives
- `apps/web/src/pages/seller-detail/RecordSummaryPanel.tsx`,
  `pages/lead-form/LeadFormPage.tsx` — eyebrow substitution only
- `apps/web/src/pages/sellers/SellerListPage.tsx` — Export button
- `apps/web/src/styles/theme.css` — type scale tokens
- `apps/web/src/App.tsx`, `lib/api-client.ts`, `lib/query-keys.ts`,
  `types/domain.ts`, `mocks/handlers.ts`

**Tests** — `apps/api/src/__tests__/phase15.postgres.integration.test.ts`,
`import-mapping.test.ts`, `csv.test.ts` (in `packages/validation`),
`export-csv.test.ts`; `apps/web/src/pages/import/ImportFlow.test.tsx`;
additions to `SellerListPage.test.tsx`.

**Docs** — new **ADR-0016** (import as the real creation path under savepoints;
`leads:import` as an additional gate; export's scope taken from `leads:view`;
whatever §D9 resolves to), `docs/api/endpoints.md`, `docs/data-model/schema.md`,
`docs/permissions/access-model.md`, `docs/migration/cronberry-mapping.md`,
`docs/testing/quality-gates.md` (§D9 only), and this plan.

## Out of scope

- **Cronberry-specific parsing** — the `<br/>`-delimited Remarks activity log,
  the `pcid`/`seller_merchant_token` ambiguity, `seller_status` vs `lead_status`,
  and every other row in `cronberry-mapping.md:§3.8`. Separate, later, and gated
  on Wellsure's data team. Nothing source-specific enters this feature.
- **The `pass` column and any credential data.** Not referenced, not designed
  around, not mentioned in code. `AGENTS.md:42`.
- **Background jobs, queues, resumability, scheduled or multi-file imports** —
  subject to §D9.
- **Creating Fields from the import flow.** A mapping target must already exist.
- **Attaching a duplicate row to its matched lead** (§D3 sub-decision).
- **Updating existing leads from a file.** Import creates; it never edits. An
  upsert mode is a genuinely different feature with a different audit story.
- **Excel/`.xlsx` input.** CSV only. `v1-scope.md:19` says "Excel/CSV"; XLSX
  parsing is a real dependency and a separate decision.
- **Export to anything but CSV**, saved export presets, and scheduled exports.
- **Redesigning any page.** §11 changes shared primitives and eight lines of two
  pages; nothing else.
- **`leads:bulk_reassign` / `leads:bulk_status_change`**, still honoured by no
  route (`endpoints.md:177-178`). Not this phase.

## Risks / open questions

1. **§D9 is a live conflict between `docs/` and the brief**, surfaced
   unresolved. It is the one item that can change this plan's shape rather than
   its details.
2. **The brief's premise about duplicate detection is not accurate** (§4). Named
   here because the plan departs from an explicit instruction — "integrate with
   the existing mechanism rather than reimplementing" — on the grounds that the
   existing mechanism is a client-side substring search that cannot serve this.
   If that departure is not wanted, §D3's "ship without duplicate detection"
   alternative is the honest fallback.
3. **One transaction per file holds locks for its duration.** Inherent to the
   §3 guarantee: dry-run fidelity for in-file duplicates *requires* the rows to
   see each other, and partial success requires savepoints inside one
   transaction. The cap is the mitigation and Prisma's transaction `timeout`
   must be raised explicitly. Measured against the cap before the PR.
4. **A dry run evaluates the trigger fan-out and rolls it back.** Verified to
   have no out-of-transaction effect (§Current state) and tested — but it means
   a preview does real work, and a future consumer that sends something outside
   the transaction would break this silently. ADR-0016 will state the constraint
   for whoever adds the fourth consumer.
5. **Org-wide duplicate matching sees leads the importer cannot** (§4). Handled
   by scope-aware reporting, but it is a deliberate widening of what a
   restricted user can *infer*: they learn that some record matching their row
   exists. The alternative creates real duplicates. Stated so the trade is
   visible rather than discovered.
6. **`leads:import` appears on every role editor screen**, as `campaigns` and
   `lead_routing` did. Intended, but it changes an existing screen.
7. **`file_key` changes meaning without changing name.** Documented in the
   schema doc and the ADR; renaming the column is available if preferred, at the
   cost of a rename migration on a column with no data.
8. **Export at the cap is a long single response.** No streaming; the response
   is assembled then sent. Adequate at 50,000 rows, and named as the ceiling.
9. **§11 touches primitives every page renders through.** The lift is the point,
   but it means the visual regression surface is the whole app. Mitigated by
   keeping every change to type treatment and padding rhythm, with no layout,
   colour or structural change, and by the existing page test suites.

## Test plan

Per `docs/testing/quality-gates.md`. **Synthetic fixtures only** — no Wellsure
journey, status, field, role, department or person name, and no real Cronberry
file, which would also violate `AGENTS.md:45`. (`quality-gates.md:10` asks for
tests "against the real Cronberry sample"; that sample is not in the repository
and must not be added. Flagged as a fourth doc tension, resolved the way every
phase since Phase 2 has resolved it.)

### Real-Postgres integration (`phase15.postgres.integration.test.ts`)

**Dry run writes nothing.** Snapshot `leads`, `process_instances`,
`assignments`, `activity_logs`, `notifications`, `campaign_sends`,
`import_jobs`, `import_job_rows` counts before and after a preview of a file
containing valid, duplicate and invalid rows. Every count identical. Asserted for
the whole set, not just `leads` — the trigger fan-out is exactly where a dry run
would leak.

**Dry run predicts commit exactly.** The load-bearing test. Preview a file, then
commit *the same bytes*, and assert the two per-row outcome lists are deeply
equal — outcome, reason and row number for every row. The file is built to
exercise every branch: valid rows, a row duplicating an existing lead, **two rows
duplicating each other**, a row missing a required Field, a row with a value
failing a `validation_rule` pattern, a row whose status name does not resolve, a
row whose owner email is not a user, a row for a lead already active in the
target journey.

The in-file duplicate pair is checked for vacuity by mutating §3 to a
transaction-per-row and confirming the test fails on exactly that pair.

**Commit goes through the real path.** Each created lead has a `process_instance`
in the chosen journey, at the resolved status, with its assignment rows, and one
`activity_logs` row `action_type: 'field_edit'`, `source: 'lead_api'` — identical
in shape to a `POST /leads` creation performed in the same test, compared field
by field rather than asserted loosely.

**Partial failure.** `created + skipped + rejected == row_count`; valid rows
exist; invalid rows created nothing; every row has an `import_job_rows` entry;
`stopOnError: true` over the same file creates nothing at all.

**`409 file_changed`.** Commit with a different file body than the preview's hash
is refused and writes nothing.

**Duplicate detection.** Match on phone; on email differing only by case (pins
§D4); on a Field value; on a two-key composite where one key is blank (no match);
with matching off (all create). A duplicate **outside the importer's record
predicate** is reported as a duplicate *without* the matched lead's id or name,
and one inside it is reported with them.

**Permissions.**
- No `leads:import` → 403 on analyze, preview and commit, and nothing written.
- `leads:import` but not `leads:create` → 403 (§D1's "additional gate").
- A mapped Field the role cannot **edit** → the file is refused at mapping,
  naming the column, and no row is attempted.
- A journey the role cannot access → 403.
- No `leads:export` → 403 on export.
- Tenant isolation: a journey, status, Field or user id from another
  organization is rejected on every endpoint.

**Export respects scope and field visibility exactly.** The security-critical
one, asserted as an equality rather than a spot check:

- Three roles — `ORGANIZATION` with full field visibility, `DEPARTMENT` with
  partial, `SELF` with one Field — export the same filtered list.
- For each: **the CSV's lead id set equals the id set the same role gets from
  `GET /leads` with the same filters**, paged to exhaustion. Not a subset — equal.
- **The CSV's header contains exactly the Field names that role can see**, and
  the invisible Field's name appears nowhere in the file. Checked against the
  whole file body, so a leak in a data cell fails too.
- A role granted `leads:export` at `ORGANIZATION` while `leads:view` is `SELF`
  gets the **SELF** row set — §D6 asserted, since this is the case that makes
  the choice load-bearing.
- A filter on a Field the role cannot see is refused (403), matching the list's
  existing behaviour rather than silently widening.
- Export writes one `system_audit_logs` row with the actor, the filters and the
  row count.

### Unit

- **CSV parser**: quoted fields, embedded commas and newlines, escaped `""`,
  CRLF and LF, a UTF-8 BOM, a trailing newline, ragged rows, an empty file, a
  header-only file, and a cell large enough to hit the limit.
- **Mapping validation**: two columns mapped to one target; an unmapped required
  Field; a Field not assigned to the chosen journey; a `hidden` Field; a Field
  that does not exist; an unknown core target; an empty mapping.
- **Matching**: key normalization, blank-key handling, multi-key AND semantics,
  and that a match key is never inferred when none is chosen.
- **Export CSV generation**: a value containing a comma, a quote, a newline; a
  `null`; a `boolean`; a JSON Field value; the header ordering rule.

### Frontend

- The four steps advance and go back; the rail reflects state.
- A column defaults to **Skip** and is never pre-mapped — asserted directly,
  since "no column gets silently guessed into a target" is a stated requirement.
- The preview renders the three counts, filters the row list by clicking one,
  and expands an error group to its rows.
- Commit is reachable only after an explicit confirm.
- The Import nav entry and the Export button are absent without their grants,
  and present with them.
- `Heading`, `Eyebrow` and `Stepper` render their variants; existing
  `AdminFlows`, `SellerListPage` and `NotificationRules` suites still pass,
  covering the §11 primitive changes.

### Gates

`format:check`, `lint`, `typecheck`, `test`, `build` and the Postgres suite, all
run and observed before the PR. The two security-critical tests — export scope
equality and dry-run/commit equality — checked for vacuity by mutation, as 14a
and 14b did: swapping the export's predicate source to `leads:export` must fail
the SELF assertion, and reverting §3 to a transaction-per-row must fail the
in-file duplicate assertion.

## Rollback plan

The migration does three things:

1. **`ALTER TABLE import_jobs ADD COLUMN` ×6**, all `NOT NULL DEFAULT`. Rollback
   is `DROP COLUMN` ×6. Safe in both directions: the table has never had a
   writer, so no data can be lost.
2. **`CREATE TABLE import_job_rows`.** Rollback is `DROP TABLE`. It holds only
   this feature's own audit rows; dropping it destroys import history and
   nothing else. Recorded in `rollback.sql` with that consequence stated.
3. **`CREATE INDEX leads_email_lower_idx`** (§D4). Rollback is `DROP INDEX`. No
   data implication.

No existing column changes type or nullability, and no table is dropped or
renamed. `file_key`'s meaning changes but its type and constraints do not, so a
rollback leaves it holding hashes that nothing reads.

The permission-engine change is one string added to `catalog.ts`; reverting it
leaves any granted `leads:import` rows unreferenced and inert, exactly as
`leads:export` rows are inert today. **No authorization behaviour changes in
either direction** — `decision.ts`, `scope.ts` and `fields.ts` are untouched, and
`LeadService` is untouched, so every existing lead path behaves identically
whether or not this phase is present.
