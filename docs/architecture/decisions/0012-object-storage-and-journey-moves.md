# ADR-0012: Object storage for attachments, and moving leads between journeys

**Status:** Accepted

## Context

Two capabilities landed together in phase 12, and each required a decision that
foreclosed a cheaper option.

**Attachments.** The `attachments` table, the `attachments:upload|download|delete`
permission triple, a private MinIO bucket in `docker-compose.yml` and a full set
of `S3_*` variables in `.env.example` have all existed since phase 1. No code
read any of them. Phase 6 recorded the omission deliberately: the API env
contract did not consume the storage variables. Meanwhile the table had no file
name, no content type, no size, and no index on `lead_id` — so even the query the
table exists to serve had no access path.

**Journey membership.** `process_instances.journey_id` is write-once. A lead can
hold concurrent memberships in several journeys, and `POST /leads` with
`existingLeadId` adds one, but nothing could move a lead from one journey to
another. Users asked for both operations.

## Decision

### Attachments go to S3-compatible object storage, through the API

Rejected: bytes in a Postgres column (no dependencies, but it bloats the
database, slows backup and restore, and would have to migrate to S3 later) and
metadata-plus-external-link (no storage at all, but not a document locker).

Three consequences follow.

**Storage configuration is optional.** `parseEnv` accepts all five `S3_*`
variables or none; a partial set is an error, because a half-configured bucket
fails at upload time with a credentials error, which is a worse signal than "not
configured". Without storage the API still boots, the attachment routes answer
`503 storage_not_configured`, and the UI says so. CI and a bare `pnpm dev` are
unaffected.

**The object is written before the row.** A crash between the two strands an
object in the bucket — waste, and invisible. The reverse order strands a row
pointing at nothing, which is a download that 500s and a document the user
believes they have.

**Deletion is soft.** The row is set `active = false` and the object removal is
best-effort. The row is the record that a document existed; removing the object
while losing the row would leave the audit trail describing something nobody can
account for.

Listing is gated on `attachments:download` because the catalogue has no `view`
action: you may enumerate exactly what you may fetch. Downloads are served
`Content-Disposition: attachment`, never `inline`, so an uploaded HTML file
cannot execute on the app's own origin.

A migration adds `file_name`, `mime_type`, `size_bytes` and an index on
`(organization_id, lead_id, uploaded_at DESC)`.

### Moving a journey repoints the instance rather than replacing it

`PATCH /leads/:id/journey` updates `journey_id` and `current_status_id` on the
existing row. Rejected: deactivating the source instance and creating a new one,
which splits a single membership's assignments, attachments and activity across
two rows and records the departure as a deactivation rather than a move.

**It is authorized against both journeys** — `leads:edit` on the source,
`leads:create` on the destination. Checking only the source would let a caller
push a record into a journey they have no rights to; checking only the
destination would let them pull one out of a journey they cannot touch.

**Field values carry over by construction.** `name`, `phone`, `email` and
`field_values` live on the lead, not the process instance, so a lead in two
journeys has exactly one set of values and a move cannot disturb them. What the
move must do is re-validate them against the *destination* journey's field
rules, since a lead complete for one journey may be missing what another
requires. That failure returns the offending `fieldId` and moves nothing.

The move writes an activity row with `action_type: 'journey_change'`. That column
is plain text rather than a database enum, so no migration was needed. Note this
is distinct from the notification trigger catalogue, which ADR-0010 closes —
`journey_change` fires no notification, and adding one would be a separate
decision.

### Adding to a second journey keeps using `existingLeadId`

No new endpoint. The existing path already creates an additional process
instance and already returns 409 when the lead is active in the target. It does,
however, **overwrite** the lead's `name`, `phone` and `email` and merge
`field_values`, so every caller must send the record's current values or
silently blank them. That sharp edge is now documented here and handled in the
one caller; a future change should consider making those fields optional on the
attach path.

## Consequences

Three production dependencies were added — `@fastify/multipart` and
`@aws-sdk/client-s3` for the locker, `jspdf` for record export. AGENTS.md
requires the justification in the diff, which the commits carry.

**Object storage is local-only for now.** The Terraform `object-storage` module
contains zero resources, so no bucket, IAM policy, lifecycle rule or encryption
exists outside `docker-compose`. Deploying the locker to a real environment
requires that module to be written first; until then the optional-config
behaviour means those environments simply run without it.

No virus scanning and no thumbnailing: the worker package has no job harness.
Attachment `version` stays at 1 — the column and its unique constraint support
versioning, but nothing groups versions of one logical document, so that needs a
`document_id` before it can be built.
