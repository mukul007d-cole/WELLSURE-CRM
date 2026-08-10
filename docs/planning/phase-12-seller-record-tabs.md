# Phase 12 — The seller record, finished

Status: approved 2026-08-10. **Delivered.**

Shipped: the shared Tabs component, section-grouped details, the document
locker on MinIO, journey move and add, repeat-lead matching, PDF export, named
reassignment parties, the enriched header, and the user-search fix.

Two deviations from the plan, both smaller than expected. The rate-limit
`keyGenerator` needed no change — its optional chaining already tolerates a
multipart body. And the MSW users handler already implemented `search`, which
is exactly why the server-side gap went unnoticed.

## Context

Phase 11 made Seller 360 a record workspace with a summary rail, an activity
timeline and three previously unreachable actions. A reference screenshot from
another CRM set the target for what the record should carry: a header card of
at-a-glance facts, a row of record actions, and tabs for Timeline, Follow-up &
Notes, Document Locker, Communication Logs, Repeat Lead and Call History — with
the details themselves split into configured sections.

This phase closes that gap. Most of it is wiring things the schema already
models and nothing reads: `Field.section`, `Attachment`, the phone and email
indexes on `Lead`, and the reassignment payload's user ids. The one genuinely
new capability is moving a lead between journeys.

Four decisions were taken with the user before work started, recorded here
because each rules out a cheaper alternative:

1. **Documents go to S3/MinIO**, not Postgres bytes or pasted links. The bucket,
   credentials and `pnpm infra:up` wiring already exist and were built for this.
2. **Both move and add** for journeys, not one or the other. Field values shared
   between journeys must survive either.
3. **Repeat leads match on phone/email** via the existing scoped search, rather
   than waking the dormant `lead_links` table.
4. **jsPDF**, producing a real downloadable file rather than a print stylesheet.

## Goal

Ship the reference record layout on real data: config-driven detail sections, a
working document locker, journey move and add, repeat-lead matching, PDF export,
and honest placeholders for the two surfaces with no backend.

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/v1-scope.md`,
`docs/testing/quality-gates.md`, `docs/api/endpoints.md`,
`docs/permissions/access-model.md`, `docs/data-model/schema.md`,
`docs/migration/cronberry-mapping.md`, `docs/workflows/journey-definitions.md`,
`docs/architecture/decisions/` (0001–0011).

## Current state

**Already modelled, nothing reads it.**

- `Field.section` (`schema.prisma:397`) exists and **is already serialized** by
  `apps/api/src/http/routes/configuration.ts:150,163`. The web's
  `FieldDefinition` (`types/domain.ts:66-73`) simply doesn't declare it, so the
  reference's Business/Plan/Payment sub-tabs are one type change away.
- `Attachment` (`schema.prisma:653-671`) has `s3Key`, `uploadedById`, `version`,
  `active` — but **no file name, mime type or size**, and **no index on
  `lead_id`**. Zero attachment code exists anywhere; `pnpm-lock.yaml` has no S3
  client and no multipart parser. `attachments:upload|download|delete` are
  already in the permission catalogue (`catalog.ts:47`) — note there is no
  `view` action, so listing is gated on `download`.
- `Lead` carries `@@index([organizationId, phone])` and
  `@@index([organizationId, email])` (`schema.prisma:485-486`) — purpose-built
  for duplicate lookup, used by nothing.
- The reassignment activity payload (`leads/sharing.ts:228-239`) is
  `{assignmentType, userId}` on both sides — **ids only, no names** — and
  `entry-copy.ts:17` currently renders it as the flat string "reassigned this
  seller", so those ids are never shown.
- `Assignment` history rows survive (`isCurrent: false`) but **no query reads
  them**; `assignedAt` is set by DB default and dropped by every mapper.

**Journeys.** A lead can hold concurrent process instances in several journeys;
a partial unique index allows one *active* instance per `(lead, journey)`
(`migration.sql:177`). `POST /leads` with `existingLeadId` adds one
(`leads/service.ts:135-155`), returning 409 if already active there. There is
**no API to move** an instance — `journeyId` is write-once, and the only
mutations touch `currentStatusId` or `active`. Critically, `attachExistingLead`
(`service.ts:263-284`) **overwrites** the lead's `name` and merges
`fieldValues`, so any caller must send current values or silently clobber them.

**Absent, confirmed.** No telephony code of any kind; `recording_reference_url`
is written by nothing. No `source` column on `Lead` — the reference's "Lead
Source" has nothing behind it. No tasks API, so "Recent Followup" has nothing
behind it either. `call_later` and `follow_up` behaviour types affect colour and
nothing else; `packages/workflow-engine` is a two-line placeholder.

**UI.** Three separate hand-rolled tablists exist — `JourneyTabs.tsx:22`,
`SubNav` in `PageFrame.tsx:100`, and the inline one at `Seller360Page.tsx:205` —
sharing a visual recipe but no code. None wires `role="tabpanel"`,
`aria-controls`, or arrow-key navigation. The web `api-client.ts:33-57` hardcodes
`content-type: application/json` and always calls `response.json()`, so it can
express neither a multipart upload nor a binary download.

**One live defect found.** `GET /users` ignores the `search` parameter
(`admin/service.ts:13-20` reads only page/pageSize/roleId/departmentId/active),
but `UsersPage` sends it from a debounced search box — so typing in that box
refetches and filters nothing.

## Proposed approach

### 1. A shared `Tabs`, and the record's tab set

Extract `components/ui/Tabs.tsx` from the three copies: `role="tablist"`,
`role="tabpanel"`, `aria-controls`/`aria-labelledby`, and Left/Right/Home/End
key handling, which none of the three has today. `JourneyTabs` and the Seller 360
tablist adopt it; `SubNav` stays route-driven and separate.

Record tabs: **Activity · Details · Documents · Repeat Lead · Call History.**
Follow-up & Notes and Communication Logs are deliberately absent per the user —
comments already live on the Activity timeline, and nothing backs comms logs.

### 2. Details, grouped by configured section

Add `section?: string | null` to `FieldDefinition` and group the Details tab by
it, ordering sections by first appearance and putting unsectioned fields last
under a neutral heading. Section *names* come from configuration; none is
hardcoded. With one section configured this renders as one list, so it degrades
to today's behaviour rather than demanding configuration.

### 3. Header card

Real facts only: lead owner (from current assignments), lead stage, repeat count,
added on, updated on, and mobile with copy / `tel:` / `wa.me` actions.
`createdAt`/`updatedAt` are added to `serializeLead` — the columns exist and the
serializer just drops them.

**Communication Status, Recent Followup and Lead Source are omitted, not stubbed
with "N/A".** No column, table or endpoint backs any of the three; rendering
permanent placeholders would advertise capability that doesn't exist.

Action row: add-to-journey, move-journey (the double arrow), share, PDF.

### 4. Journey move and add

**Move** is new: `PATCH /leads/:id/journey` taking
`{processInstanceId, targetJourneyId, statusId?}`. It updates `journeyId` on the
existing instance rather than deactivating and recreating, so assignments and the
instance's own history stay attached to one row. It resolves a target status
(the target journey's default when omitted), re-validates the lead's existing
`fieldValues` against the **target** journey's field settings, returns 409 when
an active instance already exists there, and writes a `journey_change` activity
row. `actionType` is a plain text column, so this needs no migration.

**Add** uses the existing `existingLeadId` path, sending the lead's current
name/phone/email so the built-in overwrite is a no-op.

Both preserve shared field values by construction: `fieldValues`, `name`, `phone`
and `email` live on the `Lead` row, not the process instance, so a lead in two
journeys has one set of values. The only thing move must get right is
re-validating them against the target's rules.

### 5. Document Locker

Migration adds `file_name`, `mime_type`, `size_bytes` and
`@@index([organizationId, leadId, uploadedAt(sort: Desc)])` — the table has no
index on `lead_id` today, so listing a lead's documents currently has no access
path.

`apps/api/src/env.ts` gains an **optional** `storage` block, populated only when
all five `S3_*` vars are present. Absent them the attachment routes return
`503 storage_not_configured` and the tab renders an explicit empty state — so the
API still boots, CI still passes, and a developer without MinIO sees a clear
reason rather than a crash.

`apps/api/src/attachments/` holds a `AttachmentStorage` port with an S3 adapter,
a service and a Prisma repository. Four routes, each gated on the permission that
already exists: `POST /leads/:id/attachments` (`attachments:upload`),
`GET /leads/:id/attachments` and `GET /attachments/:id` (`attachments:download`),
`DELETE /attachments/:id` (`attachments:delete`, soft via `active:false`).
Lead visibility is enforced by reusing `resolveLeadAccess`.

Two hazards to handle explicitly: Fastify's default 1 MiB `bodyLimit` is raised
on the upload route only, and the rate-limit `keyGenerator`
(`plugins/rate-limit.ts:8-18`) reads `request.body.email`, which assumes a parsed
JSON object — it must tolerate a multipart body rather than throwing.

The web client gains `requestMultipart` and `requestBlob` helpers alongside the
JSON `request`, since the existing one can express neither.

### 6. Repeat Lead and Call History

Repeat Lead reuses `sellersApi.list({ search: phone })` — server-side scoped, so
it cannot surface a lead the viewer may not see — excludes the current record and
feeds the header count. Two caveats are stated in the UI copy: the search is a
substring match, and it only covers active leads.

Call History is an `EmptyState` naming the Android app as the source. No mock
rows, no fake counts.

### 7. PDF

`jspdf` generates the record: identity block, journeys with their statuses, and
every visible field grouped by section. It renders only what the viewer can
see — the same filtered `fieldValues` the page uses — so exporting can't become
a field-visibility bypass.

### 8. Fold-in

Wire `search` through `listUsers` to the repository as a case-insensitive
`contains` on name and email, so the existing search box works.

## Files to touch

**New — API:** `apps/api/src/attachments/{service,storage,s3-storage,prisma-attachment-repository}.ts`,
`apps/api/src/http/routes/attachments.ts`.

**Modified — API:** `env.ts` (optional storage block), `http/build-server.ts`
(register attachment routes, multipart), `http/types.ts`,
`http/plugins/rate-limit.ts` (tolerate non-JSON bodies),
`routes/leads.ts` (`moveLeadJourney`, `createdAt`/`updatedAt` in `serializeLead`),
`http/routes/leads.ts` (the move route), `leads/service.ts` (move),
`leads/prisma-lead-repository.ts`, `leads/activity.ts` (`journey_change`),
`admin/{service,prisma-admin-repository}.ts` (user search).

**New — migration:** `packages/database/prisma/migrations/*_attachment_metadata/`.

**New — web:** `components/ui/Tabs.tsx`,
`pages/seller-detail/{DetailsTab,DocumentLockerTab,RepeatLeadTab,CallHistoryTab,MoveJourneyDialog,AddToJourneyDialog}.tsx`,
`pages/seller-detail/record-pdf.ts`.

**Modified — web:** `Seller360Page.tsx`, `RecordSummaryPanel.tsx`,
`components/activity/entry-copy.ts` (reassignment parties),
`components/journeys/JourneyTabs.tsx` (adopt `Tabs`), `lib/api-client.ts`
(multipart + blob helpers, attachment and move methods), `lib/query-keys.ts`,
`types/domain.ts`, `mocks/{handlers,fixtures}.ts`.

**Docs:** this plan, `docs/api/endpoints.md`, `docs/architecture/decisions/0012-*.md`.

## Out of scope

- The permission engine and existing mutation semantics.
- Tasks, telephony, communication logs, `lead_links`, the workflow engine.
- Attachment versioning UI — the `version` column exists and stays at 1.
- Virus scanning and thumbnailing; the worker has no job harness.
- Terraform for a real S3 bucket — the `object-storage` module is still a stub,
  so this is local/MinIO only until infrastructure lands.
- The `journeys_statuses:view` 403 dead-ends flagged in Phase 11 §6.

## Risks / open questions

1. **Three new production dependencies** — `@fastify/multipart`,
   `@aws-sdk/client-s3`, `jspdf`. AGENTS.md requires the justification in the
   diff description. All three are installed and the lockfile is updated.
2. **The locker needs MinIO running.** `pnpm infra:up` starts it, but a developer
   who skips it gets the not-configured empty state. That is the intended
   degradation, not a bug.
3. **No production bucket exists.** The Terraform object-storage module has zero
   resources, so this ships local-only. Flagged rather than silently assumed.
4. **Move re-validates against the target journey and can legitimately fail** —
   a lead satisfying journey A's required fields may not satisfy journey B's. The
   dialog surfaces the failing field rather than moving into an invalid state.
5. **Repeat matching is a substring search over active leads.** It can
   over-match a short phone fragment and cannot see deactivated duplicates. Both
   are stated in the UI, and the precise version is `lead_links`, deferred.
6. **`attachExistingLead` overwrites lead core fields.** Handled by sending
   current values, but it remains a sharp edge for any future caller.
7. **Reassignment names need `users:view`.** Without it the timeline says
   "another user" rather than a name — never a raw UUID.

## Test plan

Per `docs/testing/quality-gates.md`.

**API:** attachment upload rejects when storage is unconfigured (503) and when
the caller lacks `attachments:upload` (403); download enforces lead visibility
through `resolveLeadAccess`; delete is soft and the row stops listing.
`moveLeadJourney` — happy path moves the instance and keeps its assignments; 409
when already active in the target; a required field missing for the target
journey returns the failing `fieldId`; the activity row records the change;
field values are unchanged by the move. User search filters by name and email.

**Web:** tabs expose `role="tab"`/`role="tabpanel"` with arrow-key movement;
Details groups by configured section and puts unsectioned fields last; the header
omits rather than stubs the three unbacked stats; reassignment entries name both
parties and degrade to "another user" without `users:view`; the locker lists,
uploads and deletes against MSW and shows the not-configured state on 503; repeat
lead excludes the current record; call history renders its placeholder.

**MSW:** synthetic only — an in-memory attachment store, a `journey_change`
activity row, and section values on the field fixtures.

**Gates:** `pnpm format`, `lint`, `typecheck`, `test`, `build`, all reported with
real numbers.

## Rollback plan

The migration is additive — three nullable columns and one index — and reverses
with a `DROP COLUMN`/`DROP INDEX` without data loss for existing rows, of which
there are none. Attachment routes register only when storage is configured, so
unsetting the S3 env vars disables the feature without a deploy. The move
endpoint is additive; nothing existing calls it. Removing the three dependencies
requires a lockfile revert alongside. Frontend changes revert per commit.

## Sequencing

1. Tabs component + tab scaffold + section-grouped details.
2. Header card, repeat lead, call history placeholder.
3. Reassignment names on the timeline.
4. PDF export.
5. Journey move endpoint + both dialogs.
6. Document locker (migration → env → storage → routes → client → tab).
7. User-search fix, docs, ADR-0012, gates.

Steps 1–4 are frontend-only and individually shippable. Step 6 is the only one
carrying a migration.
