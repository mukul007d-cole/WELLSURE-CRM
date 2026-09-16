# ADR-0024: Tools resource library — visibility default, storage reuse, and download mechanism

**Status:** Accepted and implemented.

## Context

Phase 22 added a company resource library — the "Tools" tab — where admins
publish links and files, each individually gated to specific Roles, and
regular users browse only what their Role permits. The investigation phase
(`docs/planning/phase-22-tools-resource-library.md`) surfaced three
decisions consequential enough to record here rather than leave implicit
in the plan and the diff.

## Decision 1 — a new Resource starts hidden from every Role, matching Field, not the superseded Status Visibility default

Two existing per-item allow-lists disagree about what an empty row set
means, and the disagreement is principled, not arbitrary:

- **`field_visibility` (Phase 13a): absence means hidden.** A brand-new
  Field is invisible to every Role, including its creator's, until granted.
- **Status Visibility (Phase 19, superseded by Phase 20's routing-based
  mechanism, but the default survives): absence means unrestricted.** Phase
  19's own reasoning: every Status the feature applies to already existed,
  in every organization, with leads already visible in it under ordinary
  scope. "Absence denies" would have meant a total, retroactive,
  org-wide outage the instant the feature shipped, with no migration able
  to prevent it.

Those two defaults protect against different risks because they answer
different questions. Field's "hidden by default" costs nothing because
nothing was visible before the Field existed. Status's "unrestricted by
default" was necessary specifically because Statuses, and the leads
already sitting in them, predated the feature and were already visible.

**A Resource has zero prior existence.** This feature introduces the
entity; on the day it ships, every organization has zero
`resource_visibility` rows, and nobody has ever seen a Resource before,
because none existed. This is Field's situation exactly, not Status's —
the retroactive-outage risk that justified Status's opposite default does
not apply here.

**Decision: a brand-new Resource is invisible to every Role, including its
creator's admin Role, until explicitly granted.** `resource_visibility` is
a plain membership row (`organization_id, resource_id, role_id`) — unlike
`field_visibility`, no `access_level` column, since there is no view/edit
distinction for a Resource grant, matching `status_visibility`'s original
(pre-Phase-20) shape more than `field_visibility`'s tri-state one. The
reverse allow-list (`GET`/`PUT /tools/:id/visibility`) copies Phase 13a's
write shape exactly — full-replace, gated on `roles_permissions:view/edit`,
never `tools:*`, for the same self-escalation reason: an admin holding
only `tools:edit` must not be able to grant their own Role a Resource it
is otherwise denied.

Pinned by tests in both directions, deliberately: `phase22.postgres.integration.test.ts`
asserts a fresh Resource is hidden from every Role including the admin
who created it (the opposite of Phase 19/20's own "unconfigured Status is
unrestricted" assertion, which remains unchanged and still passes in
`phase19.postgres.integration.test.ts`), so a future refactor that copies
the wrong precedent for either feature breaks a test rather than shipping
silently.

## Decision 2 — reuse the existing S3-compatible storage port; do not build a second one

Investigation confirmed real, working object storage already exists
(ADR-0012's Attachments locker): `AttachmentStorage` (a port) and
`S3AttachmentStorage` (its S3-compatible implementation), backed by the
same optional, all-or-five `S3_*` environment contract and local MinIO
setup. It is not hypothetical scaffolding — it is live code, exercised by
the Attachments feature's upload/download/delete routes.

**Reused as-is:** the port and its S3 implementation, relocated from
`apps/api/src/attachments/` to `apps/api/src/storage/object-storage.ts`
now that a second, structurally unrelated feature constructs it — a pure
rename with no behavior change, so the file's location honestly reflects
that it is no longer attachment-specific. `main.ts` constructs one
`S3AttachmentStorage` instance from `env.storage` and passes it to both
`AttachmentService` and `ResourceService`.

**Not reused:** `objectKey()` (lead-shaped:
`org/{orgId}/leads/{leadId}/{attachmentId}/…`) and the `attachments` table
itself (a hard FK to `leadId`). Resources are not lead-scoped, and a
Resource has exactly one current file rather than an unbounded set the
way a lead's attachments are — so file metadata lives directly on the
`resources` row rather than a child table, and a sibling key function,
`resourceObjectKey()`, produces
`org/{orgId}/tools/{resourceId}/{version}/{fileName}`. `version` (already
incremented on every edit, matching Team/Department/Role's own
convention) doubles as the key's uniqueifier: a file replace always lands
at a new key, so a same-named re-upload can never silently overwrite an
object an in-flight download might still be streaming.

**Unlike Attachments, storage is not all-or-nothing for this feature.** A
`link`-type Resource needs no object storage at all, so `ResourceService`
is always constructed, unconditionally, regardless of whether `S3_*` is
configured; only its file-touching operations (create/edit of a `file`
Resource, download) fail with `storage_not_configured` (503) when the
underlying port is absent. Registering the whole `/api/v1/tools*` route
set unconditionally, rather than 503-ing every route the way
`registerAttachmentRoutes` does when storage is unset, follows directly
from that: list, detail, deactivate, and the visibility pair have nothing
to do with storage and must keep working.

**File security baseline, newly built here rather than inherited
silently:** the existing Attachments upload path enforces size
(`MAX_ATTACHMENT_BYTES`) but, contrary to `docs/operations/runbook.md`'s
own "File type/size validation and malware scanning on uploads" baseline,
never validated file *type* — confirmed by reading `attachments.ts`/
`service.ts` end to end, not assumed. Tools' upload path closes that gap
for itself: a conservative MIME/extension allow-list plus a magic-byte
signature check for every binary type in it (declared MIME/extension
alone is client-asserted and trivially spoofable), rejected before any
object is written to storage. Malware scanning remains a known, explicit,
accepted gap — no job harness exists anywhere in this codebase to run
one — mitigated only by the type allow-list and by every download being
served `Content-Disposition: attachment`, never `inline`, so a stored
file can never execute on this app's own origin even unscanned.

## Decision 3 — downloads are server-proxied, not pre-signed URLs

The investigation's own framing assumed "expiring signed download URLs."
Reading the Attachments download path (already built, already tested)
showed this project chose something different, and stronger, instead:
`GET /attachments/:id` re-authenticates and re-authorizes the request,
then streams the object's bytes through the API process itself — there is
no signed, or any other, client-facing URL anywhere in the flow. The
frontend (`DocumentLockerTab.tsx`) confirms this: it fetches an
authenticated blob and builds a short-lived `URL.createObjectURL()`
purely to trigger a save-as dialog, revoked immediately after.

A signed URL, even an expiring one, is valid bearer access for its whole
window once issued — anyone who obtains it (a shared screen, a proxy log,
a browser history entry) can use it without the app re-checking anything.
Server-proxying re-derives authorization on the literal byte-serving
request, every time, with no such window — a strictly stronger instance
of this project's own standing rule that every request re-derives what
the caller may access from the permission engine, never trusting what a
client asserts or previously obtained.

**Decision: Tools file downloads reuse the identical server-proxy
pattern**, `GET /tools/:id/download` re-checking `resource_visibility` for
the caller's Role — never bypassed by admin capability, the same
independence `field_visibility` keeps from `fields:edit` — on every
request, then streaming bytes with `Content-Disposition: attachment`.

## Consequences

- `resource_visibility`'s default is the mirror image of (superseded)
  Status Visibility's, on purpose. A reader who assumes every per-item
  allow-list in this codebase defaults to "open" will get this one
  backwards; the pinned tests in both phases' suites are the guard against
  that mistake recurring in a future refactor.
- Object storage remains exactly as optional as ADR-0012 made it — this
  phase does not deploy the Terraform `object-storage` module, and does
  not need to: link-only Resources work in every environment regardless,
  and file-bearing operations degrade to a clear `storage_not_configured`
  the same way Attachments' own routes already do, rather than the API
  refusing to boot.
- Two features (Attachments, Tools) now depend on the same optional
  storage port, which raises — without itself resolving — the priority of
  eventually writing the `object-storage` Terraform module for a real
  deployment target; that remains open, named, and not newly introduced by
  this phase.
- No signed-URL infrastructure was added. If a future requirement (large
  files, high download volume, bandwidth offload) specifically wants
  presigned URLs after all, that is a deliberate reversal of this
  decision, not a gap in it — the tradeoff (API bandwidth vs. an
  unauthenticated bearer-access window) should be weighed explicitly
  against the file-size ceiling in force at that time.
