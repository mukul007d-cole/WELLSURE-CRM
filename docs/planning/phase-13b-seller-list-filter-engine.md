# Phase 13b — Advanced filtering engine for Seller List

Status: **proposed, awaiting approval.** Sub-phase 2 of 3 in Phase 13.
13a is delivered; 13c (campaigns) gets its own plan and approval and depends on
the filter model defined here.

## Goal

Replace the Seller List's four ad-hoc query parameters with a real filter
engine: an ordered list of AND-combined conditions whose operators come from
each Field's configured `field_type`, evaluated server-side on top of the
existing scoped predicate, with every condition re-validated against the
permission engine on every request.

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/source-of-truth.md`,
`docs/requirements/v1-scope.md`, `docs/data-model/schema.md`,
`docs/permissions/access-model.md`, `docs/api/endpoints.md`,
`docs/testing/quality-gates.md`,
`docs/planning/phase-13a-field-role-visibility-at-creation.md`,
`docs/architecture/decisions/0001` (exact-match status semantics), `0011`.

## Current state

Verified against the tree at `e33f0c9`. Two facts carry over from 13a's
research and are cited rather than re-derived, as instructed: **Saved Views
exist nowhere in the codebase** (the term appears only in `v1-scope.md:14`,
`access-model.md:72` and prior plans as deferred scope), and **the GIN index on
`leads.field_values` is declared** —
`leads_field_values_gin_idx ON leads USING GIN (field_values)`,
`migrations/00000000000000_initial/migration.sql:166`, default `jsonb_ops`.
Whether the planner actually chooses it is answered below, by measurement.

### Filtering today is four fixed parameters

`SellerListInput` (`apps/api/src/routes/leads.ts:96-108`) carries `search`,
`journeyId`, `statusId`, `ownerUserId`, sort, paging, `accessMode`. `search` is
a fixed OR across `name`/`phone`/`email`
(`prisma-lead-repository.ts:528-536`). **No custom Field is filterable at all
today.** The query is assembled with Prisma's query builder — `sellerWhere` and
`processWhere` (`:521-607`) produce a `where` object consumed by
`lead.findMany` + `lead.count` (`:478-509`).

`listSellers` (`routes/leads.ts:313-348`) already resolves the permission
decision and holds `decision.fields.visibleFieldIds` and
`decision.recordPredicate`. Note `blockingReasons` (`:334`) deliberately drops
`FIELD_VIEW_DENIED`: a denied *requested* field is stripped from the response
rather than 403ing the list. Filters must not inherit that leniency — see
§Security.

### Field types are a closed set at write time and an open set at create time

`validateValue` (`leads/validation.ts:80-105`) accepts exactly
`text`, `textarea`, `email`, `phone`, `date`, `select` (strings), `number`
(JSON number), `boolean` (JSON boolean), `json` (anything), and throws
`unsupported field type` for everything else. But `createField`
(`configuration/service.ts:488`) stores `fieldType` as
`requireNonBlank(...)` — **any non-blank string is accepted**.

Two consequences the operator catalog has to face:

1. **There is no `currency` field type in this system.** The task description
   groups "number/currency"; only `number` exists. An admin *can* create a
   Field with `fieldType: 'currency'`, and every attempt to write a value to it
   will then fail validation — the Field is permanently unfillable. That is a
   pre-existing defect, not something 13b introduces. This plan treats currency
   as `number` and does not invent a type. The one-line fix — validate
   `fieldType` against the supported list on create — is offered as an option
   below rather than smuggled in.
2. The catalog must key off the nine real types and **degrade safely for an
   unknown type** rather than guessing from the value, matching
   `endpoints.md:191`'s rule that clients must not branch on a Field key.

**Dates are stored as strings.** A `date` Field holds whatever string passes
its optional `validationRule.pattern`; nothing enforces ISO-8601. Range
comparison is therefore lexicographic, which is correct for `YYYY-MM-DD` and
silently wrong otherwise. Addressed in §Operator catalog.

### The Seller List page already keeps state in the URL

`SellerListPage.tsx` reads `journeyId`, `statusId`, `search`, `accessMode` from
`useSearchParams` (`:30-59`). URL-persisted filter state — a stated
nice-to-have — is therefore nearly free, and this plan includes it.

## Measured: does the GIN index actually get used?

Run against **200,000 synthetic leads** (the `quality-gates.md` volume target)
with 200,000 matching `process_instances` and `assignments`, on PostgreSQL 16,
schema built from the real migrations, `ANALYZE`d. Table 140 MB, GIN index
13 MB. Every number below is from `EXPLAIN (ANALYZE)` output, not an estimate.

**Prisma's JSON filters cannot use the index.** Captured from the generated
client with query logging:

| Prisma filter | Generated SQL |
|---|---|
| `path + equals` | `(field_values #> ARRAY[$2]::text[])::jsonb = $3` |
| `path + string_contains` | `(field_values #>> ARRAY[...]) LIKE ('%'‖$3‖'%')` |
| `path + gt` | `(field_values #> ARRAY[...])::jsonb > $3` |
| `path + array_contains` | `(field_values #> ARRAY[...])::jsonb @> $3` |

The last one is the trap: it applies `@>` to the *extracted sub-document*, not
to the indexed `field_values` column, so it is no more indexable than the
others. **No Prisma `where` shape emits column-level containment.**

The consequences, measured:

| # | Query shape | Plan | Time |
|---|---|---|---|
| A2 | `field_values @> '{fid:"v"}'`, selective (40/200k) | Bitmap Index Scan, `leads_field_values_gin_idx` | **0.9 ms** |
| B2 | same via `#>` equality (Prisma's form) | Parallel Seq Scan | 32.5 ms |
| D | `->> LIKE 'x%'` (starts-with) | Parallel Seq Scan | 19.4 ms |
| E | `(->>)::numeric > n` | Seq Scan | 46.9 ms |
| F2 | `field_values ? 'fid'`, rare key | Bitmap Index Scan | **0.05 ms** |
| G | IN as `@>` OR `@>` | BitmapOr of two GIN scans | **1.1 ms** |
| H4 | two AND-ed containments | one GIN scan, both in `Index Cond` | **2.8 ms** |
| H2 | containment + scope join | GIN + nested loop | **4.9 ms** |
| H3 | same via `->>` | Parallel Seq Scan | 30.8 ms |

And the shape the Seller List actually issues — selective filter, `ORDER BY
updated_at DESC`, `LIMIT 25`:

| # | Query shape | Plan | Time |
|---|---|---|---|
| P4 | containment | Bitmap Index Scan on GIN | **1.1 ms** |
| P5 | Prisma `#>` | Index Scan Backward on `leads_updated_idx`, **115,974 rows removed by filter** | **116.5 ms** |

**105×.** That is the finding this sub-phase turns on, and it gets worse as the
table grows or as matching rows sit further down the sort order.

Two honest counter-observations, so the case isn't overstated:

- For a *low-selectivity* filter (25% of rows) with `ORDER BY … LIMIT 25`, the
  planner walks `leads_updated_idx` and finishes in 1.8 ms without the GIN.
  Containment only wins decisively when the filter is selective — which is the
  normal case for a filter builder.
- **Counts are dominated by the scope join, not the JSONB predicate**: 138 ms
  (containment) vs 164 ms (`#>`) for the same count at 200k. Count parity with
  the list is required by `access-model.md:71`, so both paths pay it. Reducing
  count cost is out of scope here and noted as follow-up work.

Reproduction SQL is in §Test plan so this is re-runnable rather than a claim.

## Proposed approach

### 1. Filter model

```ts
type FilterCondition = { target: FilterTarget; operator: Operator; values: unknown[] };
type FilterTarget = { kind: 'field'; fieldId: string } | { kind: 'core'; column: CoreColumn };
type Filter = { conditions: FilterCondition[] };   // AND only
```

Ordered array, AND-combined. **OR and grouping are explicitly not built** and
not half-built: no `logic` discriminator, no nesting, no placeholder column.
When OR arrives it will be a new plan with its own model change, and pretending
otherwise now would cost more than it saves. Recorded as deferred follow-up.

Transport: `GET /leads?filter=<url-encoded JSON>`. A GET keeps the list
cacheable and bookmarkable and keeps the existing route; the JSON is parsed and
validated server-side like any body. Size-capped (20 conditions) to bound
parsing and query cost.

### 2. Operator catalog, derived from `field_type`

| Configured type | Operators |
|---|---|
| `text`, `textarea`, `email`, `phone` | `equals`, `contains`, `starts_with`, `is_empty`, `is_not_empty` |
| `number` | `equals`, `greater_than`, `less_than`, `between`, `is_empty` |
| `date` | `before`, `after`, `between`, `is_empty` |
| `select` | `in`, `not_in` |
| `boolean` | `is_true`, `is_false` |
| `json` | `is_empty`, `is_not_empty` only |
| unknown//future | none — the Field is not filterable, and the API says so rather than guessing |

Core columns get the same catalog by equivalent type: `name`/`phone`/`email` as
text, `createdAt` as date, `status` and `journey` as select (`in`/`not_in` over
ids). Deriving from the configured type — never from the runtime value — is what
keeps this engine-shaped: renaming or retyping a Field changes its operators
with no code change.

`currency` is deliberately absent, per §Current state. Values for `select` come
from `validationRule.options`, which is already the only source of truth for
them.

**Date handling.** Comparisons on `date` Fields are string comparisons on JSONB
text, correct for ISO-8601 and wrong for anything else. This plan validates
filter *inputs* as `YYYY-MM-DD` and documents the storage assumption; it does
**not** retroactively normalize stored values, which would be a data migration
belonging to its own plan. Flagged as a known limitation rather than left to be
discovered.

### 3. Query building

Compile each condition into SQL, choosing the index-friendly form wherever one
exists:

| Operator | Custom field SQL | Indexed |
|---|---|---|
| `equals` | `field_values @> jsonb_build_object($fid, $v)` | ✅ GIN |
| `in` | `@>` OR-ed per value | ✅ GIN (BitmapOr) |
| `is_true`/`is_false` | `@>` with a JSON boolean | ✅ GIN |
| `is_not_empty` | `field_values ? $fid` | ✅ GIN |
| `is_empty` | `NOT (field_values ? $fid) OR field_values->>$fid = ''` | ✗ negation |
| `not_in` | `NOT (…@> …)` per value | ✗ negation |
| `contains`/`starts_with` | `field_values->>$fid ILIKE …` | ✗ |
| `greater_than`/`less_than`/`between` | `(field_values->>$fid)::numeric` / text compare | ✗ |

Core columns compile to ordinary WHERE clauses against real columns.
Everything is parameterized — no value or identifier is ever interpolated into
SQL text; field ids are bound as parameters, not spliced.

**This requires leaving Prisma's query builder for the filtered query**, since
no Prisma shape emits column-level containment (measured above). The design
that contains the blast radius:

- One new module compiles `RecordPredicate` + `Filter` into a single
  parameterized `WHERE`, used by **both** the id-page query and the count
  query, so list/count parity is structural rather than maintained by hand.
- The raw query returns **only lead ids plus the total**. The existing Prisma
  `findMany` then hydrates that page of ≤100 ids with the current `include`
  tree, so serialization, field redaction, process-instance filtering and the
  `shared` flag are all untouched.
- The scope half of that WHERE is a second implementation of scope, which is
  exactly the kind of duplication that produces silent authorization bugs. It
  is guarded by a **scope-parity test** over the full matrix
  (SELF/TEAM/DEPARTMENT/ORGANIZATION × mine/shared_with_me/all), asserting the
  new path returns the same id set as the existing Prisma path with an empty
  filter. Divergence becomes a test failure instead of a leak.

Non-indexable operators are implemented and measured, and their ceiling is
documented rather than hidden. `pg_trgm` for `contains`/`starts_with` and
per-field expression indexes are named as follow-ups; **no new extension is
added in this sub-phase.**

### 4. Security — non-negotiable

Every request re-derives what the caller may filter on, from the permission
engine, ignoring anything the client asserts:

1. Collect the filter's custom-field ids.
2. Resolve authorization with `requestedFieldIds` = client-requested ∪
   filter field ids.
3. Any filter field id not in `decision.fields.visibleFieldIds` → **`403
   forbidden`**. Not stripped, not ignored, not matched-as-empty. This is the
   one place `listSellers` must *not* reuse its existing lenient treatment of
   `FIELD_VIEW_DENIED`, which is right for a requested column and wrong for a
   filter — a silently-dropped filter condition returns a *wider* result set
   than asked for, and a silently-false one returns zero rows; both are worse
   than an error.
4. The 403 body carries no `fieldId`, so the response cannot be used to probe
   which Field ids exist.
5. `kind: 'core'` targets are checked against a fixed allow-list of six column
   names, so a caller cannot smuggle an arbitrary column through the core path.
6. Filter conditions are ANDed **into** the scoped WHERE, never replacing or
   widening it. Data scope is applied to the same query in the same clause.

### 5. Frontend

A filter builder above the Seller List: add condition → pick field (core
columns and visible custom Fields, from the existing catalogue) → pick operator
(options derive from that field's type) → enter value(s) → remove condition.
Built from existing `Select`/`Input`/`Button` primitives. Filter state is
encoded into the URL alongside the existing params, so a filtered list is
shareable — cheap here because the page already round-trips its state through
`useSearchParams`.

### 6. Saved Views — assessed, and deferred

Assessed as instructed rather than waved off. A Saved View needs a new table
(name, owner, shared flag, filter JSON, sort, column set), a migration, CRUD
endpoints with their own permission story (who may share a view org-wide?),
`access-model.md:72`'s "saved views never bypass the permission engine" rule
made real for a *stored* filter whose author's visibility may since have been
revoked, and its own UI. That last point is the one that makes it not-small:
a stored filter must be re-validated against the *reader's* visibility at read
time, not the author's — the same distinction 13c has to make for campaign
variables. **Deferred explicitly**, and it is the natural next sub-phase after
13c.

## Files to touch

**API**

- `apps/api/src/leads/filter-model.ts` *(new)* — types, operator catalog per
  field type, core-column allow-list.
- `apps/api/src/leads/filter-validation.ts` *(new)* — parse/validate the filter
  payload, arity and type-coercion per operator.
- `apps/api/src/leads/filter-sql.ts` *(new)* — compile predicate + filter into
  parameterized SQL.
- `apps/api/src/leads/prisma-lead-repository.ts` — raw id-page + count, Prisma
  hydration of the page.
- `apps/api/src/routes/leads.ts` — accept `filter`, union field ids into the
  decision, reject denied fields.
- `apps/api/src/http/routes/leads.ts` — parse the `filter` query parameter.

**Web**

- `apps/web/src/pages/sellers/FilterBuilder.tsx` *(new)*.
- `apps/web/src/pages/sellers/filter-state.ts` *(new)* — URL encode/decode,
  operator options by field type.
- `apps/web/src/pages/sellers/SellerListPage.tsx` — mount the builder, pass the
  filter through.
- `apps/web/src/lib/api-client.ts`, `apps/web/src/types/domain.ts`,
  `apps/web/src/mocks/handlers.ts`.

**Tests** — `filter-model.test.ts`, `filter-sql.test.ts`,
`phase13b.postgres.integration.test.ts` (new), `SellerListPage.test.tsx`,
`filter-state.test.ts`.

**Docs** — `docs/api/endpoints.md`, this plan.

No schema change and **no migration**: the GIN index this relies on already
exists and is already chosen by the planner for containment.

## Out of scope

- **OR / grouping** — deferred, not partially built.
- **Saved Views** — assessed above, deferred.
- `pg_trgm`, expression indexes, any new extension or index.
- Making counts cheaper; the scope join dominates them and that predates 13b.
- Normalizing stored `date` values to ISO-8601 (data migration).
- Fixing `createField`'s acceptance of unsupported `fieldType` values — see
  Risks; offered as an option, not smuggled in.
- Filtering on the activity timeline, board, or export.
- 13c campaigns, which will consume this filter model.

## Risks / open questions

1. **A second implementation of data scope.** The real risk of this plan.
   Mitigated by one shared WHERE builder for list and count, and a scope-parity
   test over the full matrix. If that mitigation looks insufficient at review,
   the fallback is the Prisma-only build — correct, simpler, and 105× slower on
   selective filters.
2. **Decision requested: the unfillable-Field defect.** `createField` accepts
   `fieldType: 'currency'` (or any string) and `validateValue` then rejects
   every write to it. Options: (a) leave it, note it, file it as its own fix;
   (b) add the one-line allow-list check to `configuration/validation.ts` in
   this sub-phase. I recommend (a) — it is a configuration-engine bug, not a
   filtering bug, and it deserves its own diff and its own audit-visible
   behavior change. Say which you want.
3. **Non-indexed operators.** `contains`, ranges and negations are seq scans:
   19–47 ms standalone at 200k, and the P5 pathology (116 ms) is reachable when
   a selective non-indexable filter meets `ORDER BY … LIMIT`. Within the 2 s
   p95 target today; documented with the trigram follow-up named.
4. **Lexicographic date comparison** on non-ISO stored values, per §2.
5. **Deep pagination** with `OFFSET` degrades as offset grows; unchanged from
   today, not worsened by filtering, and keyset pagination is a separate change.
6. No conflict found between `docs/` and the implementation for this sub-phase,
   so no new ADR is proposed. The filter model's AND-only shape and the
   403-on-denied-field rule will be documented in `endpoints.md`.

## Test plan

Per `docs/testing/quality-gates.md`; synthetic fixtures only, no Wellsure
names.

**Unit**

- Operator catalog: every supported type yields exactly its documented
  operators; an unknown type yields none and is reported unfilterable.
- Validation: unknown operator, operator/type mismatch (`greater_than` on
  `select`), wrong arity (`between` with one value), non-ISO date input,
  over-long condition list — each a `validation_error`.
- SQL compiler: `equals`/`in`/`is_not_empty`/booleans emit `@>` / `?` against
  the column; values and field ids appear only as bind parameters, never in SQL
  text — asserted on the generated string.

**Real-Postgres integration** (`phase13b.postgres.integration.test.ts`, on the
13a harness so it runs in CI via testcontainers)

- One case per operator per type, asserting exact matching id sets.
- **Denied-field filter → 403.** Following 13a's whole-response style: the
  response body contains neither the field id nor any lead value, and the
  status is 403 — proving it is rejected rather than silently ignored (which
  would return a wider set) or silently false (which would return zero rows).
  Both wrong behaviors are asserted against explicitly by comparing with the
  unfiltered result.
- **Scope containment:** a SELF-scoped user filtering on a value held only by
  an out-of-scope lead gets zero rows, and the same filter as an
  ORGANIZATION-scoped user returns it — filtering never widens scope.
- **Scope parity matrix:** new path vs existing Prisma path, empty filter, all
  four scopes × three access modes, identical id sets.
- **Count/list parity** under filters, per `access-model.md:71`.
- **Index-usage regression guard:** run `EXPLAIN` on a generated equality query
  inside the test and assert the plan names `leads_field_values_gin_idx`. This
  is what stops a future refactor from quietly reverting to the 116 ms path;
  it is also the re-runnable form of this plan's measurements.

**Frontend** — add/remove conditions; operator options change when the chosen
field's type changes; value input shape follows the operator (two inputs for
`between`, none for `is_empty`); filter survives a URL round-trip.

**Gates** — `pnpm format:check`, `lint`, `typecheck`, `test`, `build`, plus the
Postgres suite, all run and observed before the PR, same standard as 13a.

## Rollback plan

No schema change, so rollback is `git revert`. The filter parameter is
additive: an absent `filter` produces exactly today's query, and the hydration
path is unchanged, so reverting restores the current behavior with no data
implications. The GIN index predates this work and is untouched.
