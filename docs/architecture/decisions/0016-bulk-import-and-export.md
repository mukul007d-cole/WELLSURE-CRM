# ADR-0016: Bulk lead import and permission-safe export

**Status:** Accepted (phase 15)

## Context

`import_jobs` has existed since phase 1 with no reader and no writer.
`leads:export` has been grantable since phase 2 and honoured by no route.
`docs/api/endpoints.md` records both as reserved paths. Phase 15 builds them.

Four things the investigation established, each of which shaped the design:

- **There was no duplicate-detection mechanism to reuse.** `RepeatLeadTab` is a
  client-side substring search over the already-scoped Seller List — its own
  comment says the server has no duplicate concept — and
  `findActiveProcessInstanceByLeadJourney` answers "is this lead already in this
  journey", which is a different question.
- **`import_jobs` fits as a run header and not as a run record.** It carries
  actor, timestamp, mapping and state, and carries no row counts and no link to
  what a run created. Its `file_key` predates ADR-0012 making object storage
  optional.
- **`PrismaLeadRepository.transaction` already flattens a nested transaction**,
  so a repository built over someone else's transaction runs `createLead`
  inline on it.
- **Data scope is stored per (role, module, action)**, so `leads:export` carries
  its own scope, which need not match `leads:view`'s.

## Decision

### A preview and a commit are one code path

One transaction for the whole file, a `SAVEPOINT` per row, the ordinary
`LeadService.createLead` through the repository the single-lead route uses. A
preview then throws a sentinel so the transaction aborts. `mode` changes exactly
one thing: whether the transaction is kept.

Rejected: a "validate-only" path that checks rows without creating them. It is
the obvious implementation and it is wrong, because it is a second opinion about
validity that can disagree with the real one — silently, and only for the rows
nobody tested.

Four properties follow, none of which need to be maintained by review:

- A dry run writes nothing, including its own `ImportJob` row and everything the
  trigger fan-out wrote.
- It uses the real validation path, because it *is* the real path. A new Field
  type or a change to required-field semantics is picked up with no import-side
  change.
- **Rows see each other**, so two rows in one file that duplicate each other are
  predicted correctly. A transaction-per-row implementation reports "create,
  create" and then commits "create, skip" — the likeliest bug in this feature,
  excluded structurally.
- Partial success is per row, because a rolled-back savepoint does not abort the
  enclosing transaction.

The costs are accepted and stated: one transaction is held open for the file's
duration, Prisma's interactive-transaction timeout is raised explicitly for it,
and a row cap (5,000 rows / 5 MB) is what keeps that bounded.

**Constraint this places on future work:** the trigger consumers
(`NotificationService`, `CampaignTriggerService`, `StatusRoutingService`) all
write inside the transaction and none sends anything. A fourth consumer that
acted outside the transaction would make a *preview* send real email. Any new
consumer must keep its effects inside the transaction.

### Duplicate detection is a per-import match key

The admin chooses zero or more mapped targets — core `name`/`phone`/`email`, or
any mapped Field. A row matches an existing active lead when every chosen key
has a non-blank value and is equal. Email compares case-insensitively, which
needs `leads_email_lower_idx`; everything else is served by the existing
indexes.

ADR-0004's Cronberry ladder (`audience_id`, the marketplace token, GST+phone,
phone) is expressible as a *choice of keys at import time*. None of those column
names appears in application code, which is what `source-of-truth.md` requires.

Zero keys means matching is off and every row creates — chosen explicitly, never
defaulted into. A key whose cell is blank makes that row unmatchable rather than
matching every lead that is also blank there.

**Matching runs organization-wide; reporting is scope-aware.** Restricting the
match to leads the importer can see would silently create real duplicates of
records they cannot see. So the match is org-wide, and the matched lead is named
in the response only when it falls inside the importer's own Seller List
predicate; otherwise the row reports a match without disclosing which record.
The stored audit row keeps the true id either way — the audit trail records what
happened, the response respects the reader's scope.

Duplicates are **skipped**, not attached to the matched lead. `createLead`
already supports `existingLeadId`, so attaching is a small extension, but it is
a second product behaviour and belongs to its own decision.

### `leads:import` is an additional gate, and authorization is per file

A new `leads:import` action, required **alongside** `leads:create` — the same
"additional gate, never a replacement" shape ADR-0015 established for
`lead_routing:operate`. Holding `import` never lets someone create a lead they
could not create singly, in a journey they cannot access, or with a Field they
cannot edit.

Rejected: reusing `leads:create`. Creating one lead you are looking at and
creating thousands from a file are different levels of trust, and the catalog
already draws that distinction twice (`campaigns:send` against `campaigns:edit`,
`lead_routing:configure` against `operate`).

The mapping is per file, so one decision covers every row: the union of mapped
Field ids is checked once as `requestedEditFieldIds`. This is strictly no weaker
than per-row checking — a Field mapped but left blank in some row still requires
edit rights — it turns a would-be row-4000 403 into a mapping error naming the
column, and it makes the permission dimension of preview/commit fidelity true by
construction.

### Export is the Seller List, paged

`GET /leads/export` calls the same `listSellers` with the same record predicate
and the same visible-field set as `GET /leads`, one page at a time. Export is
not a query resembling the list; it is the list, run to completion. A future
change to scope, filtering or redaction lands on both at once and cannot land on
only one.

**The gate is `leads:export`. The record predicate and field visibility come
from `leads:view`.** Because scope is per (role, module, action), authorizing the
data against `leads:export` would let a role configured `export` at
`ORGANIZATION` while `view` is `SELF` export records it cannot list.

Accepted consequence, stated plainly: a deliberately *narrower* scope configured
on `leads:export` is not honoured. `export` is a capability, not a scope. The
alternative — intersecting both predicates — is more faithful and doubles the
SQL surface that has to stay correct.

A Field the caller cannot see is absent from the CSV header rather than blank in
every row, so the file does not disclose that the Field exists. One row per
(lead × visible active process instance), re-filtered through the predicate's
journeys, so an export round-trips through the importer.

### `import_jobs` is extended, and `file_key` becomes a content hash

Counts on the header (reconciling source = created + skipped + rejected, as
`cronberry-mapping.md` §4 requires of any importer) and an `import_job_rows`
child recording what each row did and why. Written on commit only; a preview's
rows live inside the aborted transaction.

`file_key` now holds `sha256:<hex>` of the uploaded bytes rather than an
object-storage key. Object storage is optional (ADR-0012), so a run that stored
the file server-side would have no import at all on a deployment without S3,
including CI. The hash also buys a real guarantee: the preview returns it, the
commit echoes it, and a commit whose bytes hash differently is refused — so "the
dry run predicts what the commit does" cannot be defeated by swapping the file
between steps.

### Partial success is the default

Valid rows are created, duplicate and invalid rows are reported individually,
nothing is silently dropped, and `created + skipped + rejected == row_count`.
A `stopOnError` flag keeps nothing when any row fails — and still evaluates
every row first, so the admin sees the whole problem list rather than the first
failure.

A genuine fault (a database error) is not a row outcome: it propagates and the
whole file rolls back.

## Consequences

- `leads:import` appears on every role editor screen, as `campaigns` did in 13c
  and `lead_routing` in 14b.
- `filter-sql.ts` gains an optional `leadIds` restriction, used to answer "which
  of these matches may this importer be told about" through the audited
  predicate rather than a second scoping rule.
- File-level import failures return their message alongside the error code,
  unlike the rest of the API. The failure is about the admin's own upload and
  their own configuration, and a bare code cannot be turned into the
  plain-language guidance this flow requires. Authorization failures are
  unaffected and still return `forbidden`.
- The 100,000-row resumable importer required by
  `docs/testing/quality-gates.md` and `docs/migration/cronberry-mapping.md` §4
  is **not** this feature. Both are scoped to the actual Cronberry migration
  run; this is the general product feature that migration will be mapped
  through. Both documents now say so. Recorded as a decision because the phase
  plan surfaced it as a conflict rather than resolving it silently.
