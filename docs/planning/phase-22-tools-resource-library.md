# Phase 22 — Tools (company resource library)

Status: **proposed.** Investigation complete. Nothing in this phase is implemented — this
document is the plan, submitted for approval per the task's explicit instruction to stop
before writing code.

## Goal

A new, top-level "Tools" section: a company resource library. Admins add resources
(internal tool links, files, spreadsheets, install/usage instructions), each individually
gated to specific Roles. Regular users browse and access only what their Role permits.
Adding/editing resources is a separate, admin-only capability from viewing them.

## Docs read

`AGENTS.md`, `docs/requirements/source-of-truth.md`, `docs/requirements/glossary.md`,
`docs/requirements/v1-scope.md`, `docs/permissions/access-model.md`,
`docs/architecture/decisions/0012-object-storage-and-journey-moves.md`,
`docs/architecture/decisions/0017-bounded-configuration-purge.md`, `docs/operations/deployment.md`,
`docs/operations/runbook.md`, `docs/planning/phase-13a-field-role-visibility-at-creation.md`,
`docs/planning/phase-19-status-scoped-role-visibility.md`, `docs/api/endpoints.md`,
`docs/testing/quality-gates.md`. `docs/architecture/decisions/0020` and `0022` read for the
status-visibility-superseded-by-routing history and the scoped-action rule.

## Code read (not assumed from docs)

`apps/api/src/attachments/{storage,s3-storage,service,prisma-attachment-repository}.ts`,
`apps/api/src/http/routes/attachments.ts`, `apps/api/src/env.ts` (`storageKeys`), `apps/api/src/main.ts`
(conditional wiring), `docker-compose.yml`/`.env.example` (local MinIO), `apps/api/src/campaigns/document.ts`,
`apps/api/src/http/routes/admin.ts` (the `bind()` DSL and the field-visibility route pair),
`apps/api/src/routes/auth.ts` (`capabilitiesRoute`), `packages/permission-engine/src/catalog.ts`,
`packages/database/prisma/schema.prisma` (`Field`, `FieldVisibility`, `Role`, `SystemAuditLog`,
`Attachment` models), `packages/database/prisma/migrations/` (directory listing),
`apps/web/src/pages/admin/FieldsPage.tsx`, `apps/web/src/pages/admin/campaigns/CampaignsPage.tsx`,
`apps/web/src/pages/seller-detail/DocumentLockerTab.tsx`, `apps/web/src/components/layout/Sidebar.tsx`,
`apps/web/src/App.tsx`.

---

## THE DECISIONS THIS PLAN NEEDS FIRST

### 1. Does real file storage already exist? — Yes, verified directly, not assumed

ADR-0012's title talks about a decision; the file itself is written entirely in the past
tense ("Three production dependencies **were added**", "A migration **adds**..."), so it
reads as already implemented rather than merely decided. That reading is correct — confirmed
by reading the code, not the prose:

- `apps/api/src/attachments/storage.ts` defines an `AttachmentStorage` port (`put`/`get`/`remove`)
  and `apps/api/src/attachments/s3-storage.ts` implements it against a real `@aws-sdk/client-s3`
  client, `forcePathStyle: true` for MinIO compatibility.
- `apps/api/src/attachments/service.ts` and `prisma-attachment-repository.ts` implement
  object-before-row upload ordering and soft-delete-row/best-effort-remove-object deletion,
  exactly as ADR-0012 describes.
- `apps/api/src/http/routes/attachments.ts` is a real, working set of routes: list, upload
  (multipart, `@fastify/multipart`), download (streamed through the API, see §3 below), delete.
- `apps/web/src/pages/seller-detail/DocumentLockerTab.tsx` is a real, working frontend consumer
  of all four.
- `packages/database/prisma/schema.prisma:698-720`'s `Attachment` model has `fileName`,
  `mimeType`, `sizeBytes`, and the index ADR-0012 describes.

So the premise "was this ever actually built?" resolves to **yes** — this is not a dormant
table with no code path, the way ADR-0012 describes the *original* phase-1 state. It is live,
exercised code.

What ADR-0012 also says, and what still holds after checking each claim in the running system:

- **Optional/env-gated.** `apps/api/src/env.ts:113` requires all five `S3_ENDPOINT`,
  `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` or none; `main.ts:30-33` only
  constructs `attachmentService` when `env.storage` is present. Without it, `attachments.ts:26-36`
  answers `503 storage_not_configured` rather than 404, and `DocumentLockerTab.tsx:74-84` renders
  a distinct "not configured" empty state for exactly that response.
- **Not deployed anywhere real yet.** `docs/operations/deployment.md:46-48`: "object storage
  (optional by ADR-0012; the locker answers `503` without it)" is explicitly in staging's **not
  deployed** list, and ADR-0012 itself says the Terraform `object-storage` module has zero
  resources. Local dev only, via `docker-compose.yml`'s MinIO service.
- **No malware scanning, ever** — "the worker package has no job harness" (ADR-0012), confirmed:
  `apps/worker` is, per `deployment.md:46`, "a one-line stub."
- **No file-type validation today, contrary to the runbook.** `docs/operations/runbook.md:25`
  lists "File type/size validation **and malware scanning** on uploads" under Security baseline.
  Reading `attachments.ts`/`service.ts` end to end: size is enforced (`MAX_ATTACHMENT_BYTES`,
  25 MiB, checked via Fastify's `bodyLimit` and `file.file.truncated`), but **no MIME or
  extension allow-list exists anywhere** — `file.mimetype` is whatever the client's multipart
  request declares, stored and later served back as the `Content-Type`, unchecked. This is a
  real, pre-existing gap against the project's own documented baseline, not a hypothetical one.

**Conclusion:** this plan does not need to build a storage mechanism from nothing. It needs to
**reuse** the `AttachmentStorage` port and its S3 adapter (§3), while (a) not inheriting the
missing file-type validation silently — closing it for the new upload path (§7) — and (b)
being explicit that malware scanning stays an out-of-scope, flagged gap, because nothing in
this codebase can run it today (§7).

### 2. What does "no grant yet" mean for a brand-new Resource? — Hidden, matching Field, not Status

This is Phase 19's own central question, transposed, and it has a definite answer here for a
reason Phase 19 spelled out but that doesn't transfer symmetrically to both of its precedents.

Two existing allow-lists disagree about what an empty row-set means:

- **`field_visibility` (Phase 13a, unchanged): absence means hidden.** A brand-new Field is
  invisible to every Role, including its creator's, until someone grants it
  (`docs/permissions/access-model.md:135`, confirmed at `configuration/service.ts:472-499`
  writing only the `fields` row and an audit entry, per Phase 13a's own read of it).
- **Status Visibility (Phase 19, later superseded by Phase 20's routing-based mechanism, but
  the *default* survives unchanged): absence means unrestricted.** Phase 19's stated reason,
  quoted directly because it's the load-bearing part: *"every Status this feature would apply
  to **already exists**, in every organization, with leads actively sitting in it, visible
  today... If 'absence denies' is copied literally: the moment this ships,
  every Status in every organization has zero rows... denies every role, for every lead, in
  every Status, everywhere — not a rough edge, a total outage."*

The two precedents don't disagree arbitrarily — they disagree because they answer different
questions. Field's "hidden by default" costs nothing because a brand-new Field was never visible
to anyone before it existed. Status's "unrestricted by default" was necessary specifically
because *Statuses, and the leads sitting in them, already existed and were already visible*
before the feature shipped — hiding by default would have been a retroactive, org-wide outage
with no migration able to prevent it.

**Resources have zero prior existence.** This feature introduces the entity. On the day this
ships, every organization has zero rows in the new `resources` table — there is no lead sitting
in a Resource the way there's a lead sitting in a Status, and no one has ever seen a Resource
before because none exist yet. This is exactly Field's situation, not Status's — the "would
retroactively hide something already visible" risk that justified Status's opposite default
simply does not apply.

**Decision: a brand-new Resource is invisible to every Role, including its creator's, until an
admin explicitly grants it — the `field_visibility` default, not the (superseded) `status_visibility`
one.** Section §Proposed approach 5 below states the resulting table shape and the reasoning
for keeping it a plain membership row (no VIEW/EDIT tri-state), unlike `field_visibility`.

This also means the "grant to all" one-click affordance `FieldEditor` already has
(`FieldsPage.tsx:884-913`, "Grant view to all" / "Clear all") is not a nicety here — it's the
practical way an admin avoids creating a Resource nobody, including themselves, can see. This
plan proposes the same affordance (§Proposed approach 12).

---

## Current state — other precedents this plan follows or deliberately departs from

### The two permissions this feature needs are already separated elsewhere

`docs/permissions/access-model.md:100` on `campaigns:send` vs `campaigns:edit`: "composing a
marketing email and actually mailing customers are different levels of trust." `lead_routing:configure`
vs `lead_routing:operate` (`catalog.ts:120-129`) is the same split for a different pair. Phase 13a's
own gate decision (`roles_permissions:edit`, not `fields:edit`, for the field-side visibility write —
`phase-13a...md:163-171`) is the same idea applied to a grant rather than an action: **whoever can
create/edit a thing must not automatically be able to decide who sees it**, because that's a
self-escalation path (an admin holding only `fields:edit` could otherwise grant their own Role
visibility of a Field their Role is denied). All three read the same way: this project consistently
keeps "manage the thing" and "grant access to the thing" as two separately-gated actions, never
one action implying the other. Requirement 4's "two separate permissions" is not a new idea to
introduce — it's this project's standing rule, applied to a fourth case.

### Server-side re-derivation is the load-bearing lesson from Phase 19, and it's already fixed once in this exact code

Phase 19's biggest amendment (`phase-19...md`, "Amendments found during implementation") was
discovering that `http/routes/attachments.ts` trusted a **client-supplied** `journeyId` to decide
lead access, rather than resolving the lead's real process instances server-side. Reading the
*current* `attachments.ts` (`:50-76`), that fix is already in place: `allowedOnLead` calls
`deps.leadRepository.findSeller360(...)` and loops the lead's own active process instances,
never trusting anything the client asserts about which journey/status applies. The comment at
`:38-49` explains why this matters specifically for a permissive-by-default axis: a client that
simply omits a context field bypasses a real restriction rather than getting a spurious denial.

This is directly relevant here because Resources' per-item visibility is the same shape of risk:
whatever route serves a Resource (list, detail, download) must look the Resource up **by id,
server-side**, and check the caller's Role against its stored `resource_visibility` rows itself
— never accept a client-asserted "roleId" or "grant" in a query param or body. §Proposed approach 6
states this as a named rule with a concrete test for it (§Test plan).

### The download mechanism is server-proxied bytes, not a signed URL — already built, and it's the stronger property

The task brief's framing (§What must be investigated, decision 5) names "expiring signed download
URLs" as the baseline. Reading the actual, working attachment download path shows this project
already built something different and, for this codebase's own stated non-negotiable ("re-derives
what the caller may [access]... ignoring anything the client asserts," `phase-13b...md:265-268`),
stronger:

- `attachments.ts:142-162` (`GET /api/v1/attachments/:attachmentId`) re-authenticates and
  re-authorizes the request, then calls `attachments.download(record)`, which calls
  `storage.get(record.s3Key)` **from the API server** and streams the bytes back
  (`reply.header(...).send(object.body)`), `Content-Disposition: attachment` so a malicious
  upload never renders on the app's own origin.
- `DocumentLockerTab.tsx:60-71` confirms the client side: `attachmentsApi.download(...)` returns
  a `blob` from an authenticated fetch, and the component builds a short-lived
  `URL.createObjectURL()` purely to trigger a save-as dialog, then immediately revokes it. There
  is no persistent or shareable link anywhere in this flow — never a signed URL, expiring or not.

A signed URL is valid, unauthenticated bearer access for its whole window once issued — anyone who
obtains it (a shared screen, a browser history entry, a proxy log) can use it without the app
re-checking anything. The server-proxy pattern re-derives authorization on the literal byte-serving
request, every time, with no window at all. That is a strictly stronger version of the property the
task brief is asking for, and it's already the precedent this codebase chose and tested.

**Decision: Resource file downloads reuse the server-proxy pattern, not pre-signed URLs.** Flagged
explicitly because the task brief's own wording assumes the other shape — if there's a specific
reason to want offloaded bandwidth (large files, high volume) that argues for presigned URLs instead,
say so at approval; the tradeoff is real (proxying costs the API process bandwidth/memory per
download) but at the same file-size ceiling this project already accepts for attachments (25 MiB),
it is very unlikely to matter, and consistency with the one download path this codebase has already
built and tested is worth more than a bandwidth optimization nothing here currently needs.

### The reverse allow-list shape (Phase 13a) is the right precedent, and it's simpler here than for Fields

Phase 13a's shape: `GET`/`PUT /fields/:fieldId/visibility`, gated on `roles_permissions:view/edit`
(never `fields:*` — see self-escalation above), full-replace `PUT`, "no row = hidden." Verified live
in `http/routes/admin.ts:150-155` and `packages/database/prisma/schema.prisma:480-496`
(`FieldVisibility`). This is confirmed as the pattern to copy for per-resource role-gating
(requirement 3) — with one simplification: `field_visibility` carries a two-value `accessLevel`
(`VIEW`/`EDIT`, `EDIT` implies `VIEW`) because a Role's relationship to a Field's *value* on a lead
record has two real levels (see it, or see and change it). A Role's relationship to a Resource has
only one: **can access it, or can't** — there's no "can see this Tool exists but can't open it"
state the product needs. So the new table is a plain `(organizationId, resourceId, roleId)`
membership row with **no access-level column**, matching `StatusVisibility`'s original shape
(`phase-19...md:358-380`, "No `accessLevel` column — this is membership, not a VIEW/EDIT tri-state")
more closely than `FieldVisibility`'s.

### The safe-document renderer (campaigns/document.ts) has no campaign-specific core

Read in full (`apps/api/src/campaigns/document.ts`). Of its ~160 lines, exactly two functions are
campaign-specific: `interpolate` (mail-merge `{{token}}` substitution against send-time variables)
and `documentTokens` (authoring-time token extraction for the composer). Everything else —
`blockTypes`, `markTypes`, `TextSpan`, `DocumentBlock`, `CampaignDocument`, `parseDocument`,
`parseBlock`, `parseSpans`, `escapeHtml`, `renderDocument`, `renderBlock`, `renderSpans`, and the
`allowedHref` scheme allow-list — is a generic, closed-vocabulary structured-document model with
no reference to leads, campaigns, or mail-merge. "Steps to use this tool" needs exactly this:
paragraphs/headings/lists, bold/italic/underline, safe links, escaped rendering, **no
interpolation** (there's no per-viewer variable to substitute into usage instructions).

Building a second copy of the parse/escape/render core to avoid importing across the `campaigns`
module would be exactly the "third rich-text mechanism" the task brief warns against, just
disguised as two modules instead of one. Reusing `campaigns/document.ts` directly, unmodified,
would work today (nothing in it actually requires a campaign), but leaves a permanent, confusing
cross-module dependency ("why does `tools` import from `campaigns`?") for a decision nobody
made on purpose.

**Proposed: extract the generic core** (everything except `interpolate`/`documentTokens`) into
`packages/validation/src/document.ts` — that package already holds cross-cutting, dependency-free
validation logic (`calculation.ts`, `csv.ts`, `slug.ts`), and a structured-document parser/validator
is exactly that kind of code. `campaigns/document.ts` re-exports the shared primitives (renamed
`CampaignDocument` → a generic `StructuredDocument` alias kept as `CampaignDocument` for
call-site compatibility) and keeps `interpolate`/`documentTokens` as its own, campaign-specific
layer on top. The new `tools` module imports the shared primitives directly and needs no
interpolation layer at all. This is a small, mechanical, behavior-preserving move — confirmed as
the right shape now (§Test plan re-runs the existing campaign document tests unchanged against
the relocated code as the correctness check), with the exact target package a implementation-time
call if `packages/validation` turns out to be the wrong fit versus a new `apps/api/src/shared/`.

### Categorization: Fields' own answer is already the lightweight one this needs

`FieldsPage.tsx`'s `section` is a free-text `Input` with a `<datalist>` of distinct existing
values (`:839-855`, `sectionOptions` derived at `:215-221` from every active Field) — **not** a
managed Category entity, no separate CRUD, no foreign key. There is no separate "ongoing Fields
cleanup work" in progress beyond this — the pattern already reads as finished, not mid-refactor.
This is directly reusable: a free-text `category` column on `Resource`, the identical
datalist-autocomplete pattern in the resource editor, and the browse view groups resources by
`category` (falling back to an "Uncategorized" bucket) the same way the Fields list already
groups by Section for ordering purposes. No new grouping mechanism needed (requirement 7).

### Nav gating: today's pattern doesn't cover this feature's actual requirement, and needs one small addition

Every conditional entry in `Sidebar.tsx` (`:112-177`) is gated purely on a module-level
`can(module, action)` boolean — `can('fields','view')`, `can('campaigns','view')`, etc. None of
them today ask "does this role have at least one row of X" — there's no existing precedent for
gating nav-item visibility on a per-item allow-list, because no earlier feature needed it (Journey
access and Field visibility both gate *content within* an already-visible page, never the nav
entry itself).

The task brief is explicit that Tools' nav entry should only appear if the viewer has access to
at least one resource. That needs a cheap, per-request-fresh signal beyond the plain module gate.
`GET /api/v1/auth/capabilities` (`routes/auth.ts:39-60`) already resolves exactly this class of
thing once per session/role and is already the mechanism `can()` and every other capability-driven
UI decision in this app is built on (`permissions`, `journeyIds`, `fieldVisibility`). Extending it
with one cheap boolean — `hasAccessibleTools` — computed as a single `EXISTS` query joining
`resource_visibility` against the caller's Role and active Resources, reuses a request that already
fires rather than adding a new one. See §Proposed approach 9.

### Page structure: one page, gated affordances — not two pages

Both `FieldsPage.tsx` and `CampaignsPage.tsx` are single files combining a list and an inline
editor, with admin affordances (`Create`, `Edit`, `Deactivate`) individually gated by `can(...)`
checks rather than split into a separate admin route. Requirement's own "investigate whether these
should be one page... or two" is answered by precedent: **one page.** The one genuine complication
Tools introduces that Fields never had (worked out in §Proposed approach 8) is that the *same* list
endpoint has to serve two different audiences — a permission-filtered browse list for ordinary
viewers, and a full (including-inactive, including-not-granted-to-me) list for admins managing the
library — which Fields never needed because `field_visibility` never hides a Field *definition*
from the Field Builder, only a Field's *value* from a lead record.

---

## Proposed approach

### 1. Resource types — two, not three (requirement 2)

Proposed model: `type: 'link' | 'file'`. **"Package" is not a third type** — nothing in the
product description implies a package needs different storage or a different access-control
shape from a file. A "package" is a file (very plausibly an installer or a `.zip`) paired with
unusually thorough usage instructions; both of those are already first-class on every Resource
regardless of type (the file upload path, and the shared structured-document instructions field).
Introducing a third enum value would mean either a redundant code path that behaves identically to
`file`, or, worse, special-casing that has no actual technical justification — exactly the kind of
speculative branching this project's own practice avoids (e.g., `services` deliberately has no
`delete` action rather than growing an unneeded catalog entry, `access-model.md:79-83`). If
"package" later turns out to mean **multiple bundled files** rather than one archive, that's a
materially different, larger feature (a one-to-many file list per Resource) and should be raised
as its own decision rather than assumed here — flagged in §Risks.

`type: 'link'` stores a `url` (same scheme allow-list as `campaigns/document.ts`'s link
validation — `https?://` or `mailto:`; reject anything else, most importantly `javascript:`/`data:`).
`type: 'file'` stores the uploaded object's metadata. Both types share every other field: name,
description, category, instructions, visibility, active state.

### 2. Data model

New Prisma models, additive migration `00000000000006_tools_resource_library` (next after the
existing `00000000000005_reassignment_grace_preference`):

```prisma
enum ResourceType {
  link
  file
}

model Resource {
  id             String       @default(uuid()) @db.Uuid
  organizationId String       @map("organization_id") @db.Uuid
  name           String
  description    String?
  category       String?
  type           ResourceType
  url            String?      // set when type = link; null when type = file
  s3Key          String?      @map("s3_key")        // set when type = file; null when type = link
  fileName       String?      @map("file_name")
  mimeType       String?      @map("mime_type")
  sizeBytes      BigInt?      @map("size_bytes")
  instructions   Json?        @db.JsonB              // StructuredDocument, or null
  sortOrder      Int          @default(0) @map("sort_order")
  active         Boolean      @default(true)
  version        Int          @default(1)
  createdById    String?      @map("created_by") @db.Uuid
  updatedById    String?      @map("updated_by") @db.Uuid
  createdAt      DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime     @updatedAt @map("updated_at") @db.Timestamptz(6)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  createdBy    User?        @relation("ResourceCreatedBy", fields: [organizationId, createdById], references: [organizationId, id], onDelete: Restrict)
  updatedBy    User?        @relation("ResourceUpdatedBy", fields: [organizationId, updatedById], references: [organizationId, id], onDelete: Restrict)
  visibility   ResourceVisibility[]

  @@id([organizationId, id])
  @@index([organizationId, active, sortOrder])
  @@map("resources")
}

// Reverse allow-list, mirroring `field_visibility`'s write direction but
// `status_visibility`'s plain-membership shape: a Role either may access this
// Resource, or the row is absent and it's hidden. No accessLevel column — see
// "THE DECISIONS THIS PLAN NEEDS FIRST" §2 for why a new Resource starts
// granted to nobody, unlike (superseded) Status Visibility's default.
model ResourceVisibility {
  id             String   @default(uuid()) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  resourceId     String   @map("resource_id") @db.Uuid
  roleId         String   @map("role_id") @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  resource Resource @relation(fields: [organizationId, resourceId], references: [organizationId, id], onDelete: Restrict)
  role     Role     @relation(fields: [organizationId, roleId], references: [organizationId, id], onDelete: Restrict)

  @@id([organizationId, id])
  @@unique([organizationId, resourceId, roleId])
  @@index([organizationId, roleId])
  @@map("resource_visibility")
}
```

`Role` gains `resourceVisibility ResourceVisibility[]`, matching its existing `fieldVisibility`/
`journeyAccess`/`routingGrants` relations (`schema.prisma:116-136`).

**Naming**, stated explicitly since it's a real, if small, inconsistency worth calling out rather
than leaving implicit: the permission-catalog **module** is `tools` (matches the nav tab and every
other module name matching its nav label), but the **entity/table** is `Resource`/`resources`
(matches the task's own vocabulary throughout — "admins add resources," "per-resource role-gating").
This mirrors an existing precedent exactly: the `lead_routing` module governs `status_routing_rules`/
`status_routing_permissions` tables, not a `lead_routing` table. Module name and entity name
diverging on purpose is not new here.

Single-file-per-Resource cardinality (not a child table like `Attachment`, which is deliberately
one-to-many per lead): a Resource *is* one logical document or link, so its file metadata lives
directly on the row. This also directly shapes the answer to requirement 8 (§9 below).

### 3. Storage: reuse the port, add one small key function, no new S3 client or config contract

Reused as-is, unmodified: `AttachmentStorage` (the interface), `S3AttachmentStorage` (the
implementation), `StorageConfig`/`env.storage`'s all-or-nothing `S3_*` contract, the local MinIO
setup, and the "put the object, then write the row" / "deactivate the row, best-effort remove the
object" ordering discipline (`storage.ts`, `s3-storage.ts`, `service.ts`'s doc comments explain why
each ordering is chosen — the same reasons apply unchanged to Resources).

**Not reused as-is:** `objectKey()` (`storage.ts:32-39`) is deliberately lead-shaped
(`org/{orgId}/leads/{leadId}/{attachmentId}/{fileName}`) and the `Attachment` Prisma model has a
hard FK to `leadId`. Building a parallel key function is the right amount of new code — reusing
`objectKey()` itself would either force a fake `leadId` into the key or require loosening its
signature for one caller, which is a worse coupling than a five-line sibling function:

```ts
// apps/api/src/tools/storage.ts
export function resourceObjectKey(input: {
  organizationId: string;
  resourceId: string;
  fileName: string;
}): string {
  return `org/${input.organizationId}/tools/${input.resourceId}/${sanitizeFileName(input.fileName)}`;
}
```

`sanitizeFileName` is imported from `attachments/storage.ts` unchanged (it has no lead-specific
logic at all).

**Relocation, not duplication, for the shared port.** Since a second, unrelated module now
constructs an `AttachmentStorage`, leaving the interface and its S3 implementation inside
`apps/api/src/attachments/` is a naming lie waiting to confuse the next reader. Propose moving
`storage.ts`'s `AttachmentStorage`/`StorageConfig` interfaces and `s3-storage.ts`'s
`S3AttachmentStorage` class to a neutral `apps/api/src/storage/object-storage.ts`
(`attachments/storage.ts` keeps `objectKey`/`sanitizeFileName`, which *are* lead-specific, and
imports the port from the new location). This is a pure rename-and-move with no behavior change —
flagged as a call the implementer can make either way (relocate vs. import cross-module) since it
changes nothing observable, but relocating is the more honest name once a second, structurally
unrelated consumer exists.

**Wiring** mirrors `main.ts:30-33`/`68` exactly: one `attachmentService`-shaped optional
dependency becomes two (`attachmentService`, `toolStorageService`), both constructed from the same
`env.storage` when present, both `undefined` together when it's absent — there is no scenario where
one exists and the other doesn't, since they share one `S3_*` configuration. The Tools routes
follow `attachments.ts:22-36`'s exact "answer `503 storage_not_configured` when unset" shape for
any route that needs the object store (upload, download); **link-type Resources and the browse/list/
metadata routes work with no storage configured at all**, since a link has nothing to store.

**Not a new production dependency.** `@aws-sdk/client-s3` and `@fastify/multipart` are already
dependencies for attachments; nothing new is added to satisfy `AGENTS.md`'s "explain new
dependencies" rule because there isn't one.

### 4. Permission catalog: two actions, not one (requirement 4)

New module in `packages/permission-engine/src/catalog.ts`, positioned beside `campaigns` (a
comparable "content library with a view/manage split"):

```ts
{
  module: 'tools',
  label: 'Tools',
  // `view` is the floor gate for the whole Tools tab; which *specific*
  // Resources a viewer actually sees is additionally narrowed by
  // `resource_visibility` (§5) — the same two-layer shape leads:view + the
  // permission engine's other axes already use. `create`/`edit`/`delete` are
  // the admin capability and are deliberately independent of `view` — a
  // Role can browse Tools without managing them, or vice versa in principle
  // (though bootstrap grants all four, matching every other module).
  actions: ['view', 'create', 'edit', 'delete'],
},
```

No `scopedActions` entry — like `fields`, `journeys_statuses`, `services`, and `campaigns`,
none of `tools`'s actions are checked against a `DataScope` (there's no "whose Resource is this"
question the way there's a "whose Lead is this" one; per-Resource gating is `resource_visibility`,
a structurally different mechanism from `SELF`/`TEAM`/`DEPARTMENT`/`ORGANIZATION`, exactly as
`field_visibility` is). The Role editor shows "Always organization-wide" for all four actions,
matching the existing rule at `catalog.ts:154-184` with no code change to that function.

`delete` deactivates, never hard-deletes, matching every configuration module
(`access-model.md:76-84`). No `purge` action proposed for v1 — flagged as a deliberate, easy-to-add
follow-up (§Out of scope), not because Resources are exempt from ADR-0017's pattern, but because
nothing in the task's stated scope asks for it and this phase is already large.

`docs/permissions/access-model.md`'s module table (`:22-33`) gains a `Tools` row: `view, create,
edit`. A new lettered item **F** (after Status Visibility's **E**) states the `resource_visibility`
allow-list, its "no row = hidden" default, and that it's gated on `roles_permissions`, mirroring
item D's own wording for `field_visibility`.

### 5. Per-resource visibility: the reverse allow-list

```
GET  /api/v1/tools/:resourceId/visibility   roles_permissions:view
PUT  /api/v1/tools/:resourceId/visibility   roles_permissions:edit
```

Gated on `roles_permissions`, **never** `tools:edit` — the identical self-escalation argument as
Phase 13a's field-side gate (§Current state above): an admin holding only `tools:edit` must not be
able to grant their own Role (or anyone's) access to a Resource their Role is otherwise denied.

`GET` response: `{ "roleIds": ["…"] }` — plain membership, no access level (§Current state). `PUT`
body: `{ "roleIds": ["…"] }`, full replace; `{ "roleIds": [] }` clears every row, returning the
Resource to **fully hidden** (the opposite of Status Visibility's "clearing returns to
unrestricted" — worth stating explicitly since it's the mirror image of a recent precedent in this
same codebase, and getting it backwards would be an easy, silent mistake).

Write path (`RoutingRuleService.replaceGrants`/`replaceRoleVisibilityForField` is the direct
template — `phase-13a...md:181-207`):

1. Lock the Resource row (`SELECT … FOR UPDATE`), 404 if absent/wrong organization.
2. Resolve the affected Role set (payload roleIds ∪ existing rows' roleIds), lock those Role rows
   in **sorted id order** — the same deadlock-avoidance discipline Phase 13a and Phase 19 both use.
3. Validate every payload `roleId` exists in the organization; inactive Roles are accepted, not
   rejected (a deactivated Role keeps its row so a round-trip GET/PUT stays lossless — same
   reasoning as Phase 13a §2).
4. Read old rows, `deleteMany`, `createMany` the new set.
5. Bump **every affected Role's** `version` — gaining and losing alike (feeds
   `AuthorizationDecision.roleVersion`; nothing caches on it today, but every other allow-list
   write in this codebase bumps it defensively, and this one should agree).
6. One `system_audit_logs` row: `entity_type = 'resource_visibility'`, `entity_id = resourceId`,
   `action = 'replace'`, `old_value`/`new_value` = the role-id arrays.

**Only the resource-side direction is proposed for v1** — no symmetric "this Role's granted Tools"
tab added to `RoleDetailPage.tsx`. Phase 13a built *both* directions because the role-side endpoint
already existed and needed a Field-side complement; here, *neither* direction exists yet, so this
plan builds only the one the product actually needs (managing access while editing a specific
Resource). A role-side view is a natural, low-cost follow-up, flagged rather than built, since
nothing in the task's scope asks for it.

### 6. Server-side re-derivation on every surface — the rule, stated once, applied everywhere

Every route that returns a Resource's existence, metadata, or bytes must look the Resource up
**by id from the database** and check `resource_visibility` for the **authenticated caller's own
Role**, resolved server-side from the session — never from a client-supplied role id, header, or
query param. This is the Phase 19 lesson (§Current state above) applied up front instead of
discovered as an amendment. Concretely: `listResources`, `getResource`, `downloadResource` all
call one shared `hasResourceVisibility({ organizationId, resourceId, roleId })` helper (a repository
method structurally identical to `hasJourneyAccess`/`hasStatusVisibility`'s shape, but living in
the new `apps/api/src/tools/` module rather than `packages/permission-engine`, per §Current state's
reasoning: Resources have no relationship to the lead/journey/status decision the core engine
resolves, so this doesn't belong inside `decision.ts` any more than `field_visibility`'s own
enforcement does — that also lives in `routes/leads.ts`, not the engine).

### 7. File security baseline (requirement 5)

- **Private bucket by default: already true, no new work.** `docker-compose.yml:68`,
  `mc anonymous set none "local/$S3_BUCKET"` — the existing local bucket already has no anonymous
  access, and nothing anywhere in this codebase ever calls S3 `ListObjects` or exposes a bucket
  listing to a client. Confirmed structurally satisfied by the same reasoning that makes it true
  for attachments today.
- **No permanent public link: already true by construction** — see §Current state's download
  analysis. There is no link at all, signed or otherwise; every byte requires a live, re-authorized
  request.
- **Size limit, server-enforced:** a new `MAX_RESOURCE_FILE_BYTES` constant (proposed: the same
  25 MiB as `MAX_ATTACHMENT_BYTES`, kept as a separate named constant so the two can diverge later
  without coupling), enforced identically — Fastify `bodyLimit` plus the `file.file.truncated`
  check `attachments.ts:112-116` already demonstrates.
- **File-type validation, server-enforced — new, closing a real gap (§THE DECISIONS above).**
  Propose a conservative extension **and** declared-MIME allow-list, checked before the object is
  written: PDF, Office formats (doc/docx/xls/xlsx/ppt/pptx), CSV, TXT, PNG/JPG/GIF, ZIP. Explicitly
  excluded: HTML, SVG (XSS-capable even served as an "image" in some browsers), and anything
  executable/script-like. The exact list is a product/security call, flagged for approval rather
  than assumed — reject with `400 validation_error` before any S3 `put`, so a rejected upload never
  touches the bucket. Declared MIME alone is client-asserted and spoofable; propose also sniffing
  the first bytes against a small set of known magic numbers for the allow-listed types as a second,
  server-side check — cheap, no new dependency required (a short hand-written table of signatures,
  matching this project's general preference for small hand-rolled checks over pulling in a library
  for something this bounded).
- **Malware scanning: explicit, flagged, out of scope — not silently skipped.** Confirmed above
  that nothing in this codebase can run this today: no job harness (`apps/worker` is a stub), no
  scanning dependency, no precedent anywhere. Building it would mean either a synchronous scan in
  the request path (a new dependency, real virus-definition infrastructure, and added upload
  latency) or a real worker/queue that doesn't exist yet — either is a substantially larger piece
  of infrastructure than this phase's stated scope. Recorded here as a **known, accepted gap**,
  mitigated only by the file-type allow-list above and by downloads always being served
  `Content-Disposition: attachment` (never `inline`, matching `attachments.ts:151-160` exactly) so
  a stored file can never execute on this app's own origin even unscanned. If this gap is
  unacceptable for launch, say so at approval — it changes this phase's scope materially (a real
  worker/job harness would likely be its own phase, not a line item inside this one).

### 8. Routes

```
GET    /api/v1/tools                        tools:view      -- list; filtered to the caller's Role by resource_visibility, unless ?admin=true (see below)
GET    /api/v1/tools/:id                     tools:view      -- detail; 403/404 if not visible to the caller's Role
GET    /api/v1/tools/:id/download            tools:view      -- file types only; streamed, server-proxied (§3/§Current state)
POST   /api/v1/tools                         tools:create    -- multipart (file) or JSON (link)
PUT    /api/v1/tools/:id                     tools:edit      -- metadata/instructions/category; optional file or url replacement
POST   /api/v1/tools/:id/deactivate          tools:delete
GET    /api/v1/tools/:id/visibility          roles_permissions:view
PUT    /api/v1/tools/:id/visibility          roles_permissions:edit
```

**The `?admin=true` list mode is new territory for this codebase, not a copy of an existing
pattern — stated plainly rather than implied.** Every existing per-item allow-list
(`field_visibility`, the old `status_visibility`) hides *content within* an already-visible admin
list (a Field's value on a lead; nothing ever hides a Field's own definition from the Field
Builder). Resources are the first case where the *same* list has to serve two genuinely different
audiences: an ordinary viewer (sees only Resources their Role is granted, via `resource_visibility`)
and an admin managing the library (needs to see and edit every active *and inactive* Resource,
including ones their own Role isn't granted, in order to grant others). Proposed resolution:
`GET /api/v1/tools?admin=true` is honored only when the server re-checks the caller actually holds
`tools:create`, `tools:edit`, or `tools:delete` — any one of the admin actions; a `tools:view`-only
caller passing `admin=true` is silently served the ordinary filtered list, not an error and not the
full one, per §Proposed approach 6's re-derivation rule. Pagination follows the existing
`page`/`pageSize`/`ADMIN_PAGE_SIZE` convention for the admin-mode list; the ordinary browse list is
fetched unpaginated via the existing `loadAllPages` helper (`FieldsPage.tsx` already uses this for
its own "every active Field, unpaginated" picker need), since a Role's accessible-resource count is
expected to be small and the browse UI groups by category rather than paging.

Route registration mirrors `http/routes/admin.ts`'s `bind()` DSL shape (module/action-gated,
delegating to a service method) for the CRUD/visibility routes, and `attachments.ts`'s hand-written
style (for the conditional-on-storage upload/download routes, since those need the
`storage_not_configured` 503 branch `bind()` doesn't model).

### 9. Navigation placement (requirement 6)

`Sidebar.tsx` gains a `Tools` entry, gated on `can('tools','view') && hasAccessibleTools` (the
latter from the extended capabilities response, §Current state). Proposed placement: inside the
`PRIMARY`/"Workspace" group, after Sellers (`:34-43`) — Tools is a regular-user browsing
destination, not an admin configuration screen, so it belongs with Dashboard/Sellers rather than
under Configuration/People & access, which are exclusively admin-audience groups today. Route
`/tools` (top-level, matching `/dashboard`/`/sellers`'s flat style, not nested under `/admin/...`),
wrapped in `<Route element={<PermissionRoute module="tools" />}>` exactly like every other gated
route in `App.tsx:49-79`. Page file `apps/web/src/pages/tools/ToolsPage.tsx`, matching the
`dashboard/`, `sellers/`, `board/` per-feature-subdirectory convention.

`capabilitiesRoute` (`routes/auth.ts:39-60`) gains one more parallel query:

```ts
hasAccessibleTools: await input.repository.hasAnyResourceVisibility(identity),
```

— a single `EXISTS` query, computed fresh on every call like everything else this route returns
(no caching, matching the "immediately after creation" property Phase 13a established and Phase 19
leaned on directly for its own test plan).

### 10. Categorization (requirement 7)

Direct reuse of the Fields `section` pattern (§Current state): `category` is a free-text column
with a `<datalist>` of existing distinct values in the editor, no separate management entity. The
browse view groups Resources by `category`, with an "Uncategorized" bucket for `null`. No new
mechanism — this is the one requirement where the answer is "do exactly what Fields already does,"
not "adapt a pattern."

### 11. Update-to-an-existing-resource semantics (requirement 8)

Two things are being asked, and they get different answers:

**The Resource entity itself: never hard-deleted, only deactivated** — matching every
configuration entity in this system without exception (`AGENTS.md`'s non-negotiable rule). A
`POST /tools/:id/deactivate` sets `active = false`; the row, its full audit history, and its
`resource_visibility` rows all persist untouched.

**Replacing the underlying file on an existing Resource: a straightforward overwrite, not a
version history — deliberately, matching this codebase's own accepted precedent for the *only*
other file-versioning question it has ever faced.** `Attachment.version` exists as a column
(`schema.prisma:710`) specifically because ADR-0012 scoped real versioning and then didn't build
it: *"Attachment `version` stays at 1... nothing groups versions of one logical document, so that
needs a `document_id` before it can be built"* (ADR-0012, Consequences). Building real version
history for Resource files here — something the one prior attempt at exactly this problem
explicitly deferred — would be new scope this task didn't ask for and this codebase has never
delivered once. Proposed instead:

- `PUT /tools/:id` with a new file: write the new object first (new `s3Key`), then update the row's
  `s3Key`/`fileName`/`mimeType`/`sizeBytes` columns, then best-effort-remove the **old** object —
  the identical put-before-row-update / best-effort-remove discipline `AttachmentService` already
  uses, just applied to a replace instead of a fresh create-then-delete pair. A crash between steps
  leaves at worst an orphaned old object, never a row pointing at nothing.
- The **audit log is the historical record of the change**, not a byte-content archive:
  `system_audit_logs`'s existing `old_value`/`new_value` JSON columns capture the prior and new
  metadata (file name, size, mime type — not the bytes themselves) on every edit, exactly like every
  other configuration entity's edit history in this system. "What changed and when and by whom" is
  fully answerable forever; "give me back the exact old bytes" is not, and this plan does not
  propose making it so.
- **Prior download/access history is unaffected by a later file replacement**, because nothing this
  plan proposes records a byte-content reference in an audit row — only facts ("user X, Resource Y,
  timestamp Z"). A download recorded before a file was replaced remains a true historical fact after
  the replacement; it just can no longer be re-fetched, which is consistent with the row/object
  relationship everywhere else in this codebase (a deactivated Attachment's row survives with its
  object best-effort removed; nobody can re-download it either).

Flagged explicitly since it's a real product tradeoff, not just a technical default: if this
project specifically wants "see what this Tool's spreadsheet looked like last quarter,"
that is the `document_id`-grouping feature ADR-0012 already named and deferred, and should be
raised as its own decision rather than folded in here.

### 12. Frontend: one page, gated affordances (requirement, page-structure question)

`ToolsPage.tsx`, structurally mirroring `FieldsPage.tsx`/`CampaignsPage.tsx`:

- **Everyone with `tools:view`** sees the browse list — grouped by category, each entry showing
  name/description/type; a `link` entry opens the URL directly, a `file` entry triggers the
  server-proxied download (§3, identical client pattern to `DocumentLockerTab.tsx:60-71`'s
  blob-and-revoke approach). Empty states distinguish `503` (storage not configured — only relevant
  if the caller's visible set includes a `file`-type resource) from an ordinary empty/no-access
  list, matching `DocumentLockerTab.tsx:74-92`'s existing 503-vs-403 split.
- **Callers also holding any of `tools:create`/`edit`/`delete`** additionally see: a management
  toggle that switches the list to `?admin=true` mode (every active + inactive Resource, not just
  ones granted to their own Role), Create/Edit/Deactivate row actions, and — inside the
  create/edit form — a "Role visibility" section gated the same two-permission way `FieldEditor`
  already gates its own: rendered only if the caller holds `roles_permissions:view`, editable only
  if they hold `roles_permissions:edit`, with the identical "Grant to all Roles" / "Clear all"
  bulk affordance (`FieldsPage.tsx:884-913`) — load-bearing here, not cosmetic, since it's the
  practical way an admin avoids creating a Resource nobody (including themselves) can see (§THE
  DECISIONS above).
- **Save flow: two requests, never one, for the identical reason Phase 13a chose this** —
  `POST`/`PUT /tools` (gated on `tools:create`/`edit`) and `PUT /tools/:id/visibility` (gated on
  `roles_permissions:edit`) sit behind two different permission gates that must not be merged into
  one. If the second call fails, the Resource exists granted to nobody — the documented default
  (§THE DECISIONS above), not a half-open Resource — and the UI reports it exactly as
  `FieldsPage.tsx:159-177`'s save mutation already does, including the "don't full-replace grants
  the client never actually read" discipline (`syncedVisibilityFieldId`, `:135-157`) that Phase
  13a's own delivered-plan amendments called out as a real regression it caught.
- Usage instructions render through the shared `StructuredDocument` primitives (§Current state),
  reusing whatever composer component the `campaigns` frontend already has
  (`apps/web/src/pages/admin/campaigns/RichTextComposer.tsx`, presumed generic enough to reuse
  directly or via a thin wrapper — confirmed at implementation time) rather than a new editor.

---

## Out of scope

- **A `tools:purge` action.** Trivial to add later matching ADR-0017's exact pattern
  (`withheldFromBootstrap`, deactivated + zero blocking dependents); omitted here to keep an
  already-large phase bounded, not because Resources are structurally exempt from the bounded-purge
  philosophy.
- **A role-side "this Role's granted Tools" view on `RoleDetailPage.tsx`.** Only the resource-side
  reverse endpoint is built (§5) — see the reasoning there.
- **Multi-file "packages."** This plan treats `type: 'file'` as exactly one object per Resource. If
  a "package" specifically needs to mean *several* bundled files rather than one archive, that's a
  materially different, larger data model (§1) and should be its own decision.
- **File version history / retrievable prior versions.** Deliberately not built — matches
  ADR-0012's own deferred, never-completed `document_id`-grouping scope for Attachments (§11).
- **Malware scanning.** Explicit, flagged, accepted gap (§7) — no job harness exists anywhere in
  this codebase to run it on.
- **Writing the real cloud `object-storage` Terraform module.** Pre-existing gap named by ADR-0012
  itself, not introduced or worsened by this plan; Tools works the same optional, local-MinIO-only
  way Attachments already does, and becomes real in any environment the moment that module and the
  `S3_*` secrets exist — no new infrastructure work is a prerequisite for this phase, though the
  gap now blocks two features' production readiness instead of one, which raises its priority
  without being this phase's job to close.
- **Presigned/expiring S3 URLs.** Deliberately not the chosen mechanism (§Current state) — flagged
  for override at approval if there's a specific reason to want them instead.
- **Per-download audit logging.** Matches the existing Attachments precedent exactly: uploads/edits/
  deactivations/visibility changes are audited (`system_audit_logs`), individual downloads are not
  (`AttachmentService.download()` writes nothing). If "who accessed this Tool and when" is actually
  wanted, that's a new capability neither this feature nor Attachments has today, and should be
  raised explicitly rather than assumed.

## Risks / open questions

1. **The default-visibility decision (§THE DECISIONS 2) is the one this plan cannot proceed
   without**, exactly as Phase 19 flagged its own equivalent question. Recommended: hidden by
   default, matching Field. Say so explicitly at approval if the opposite is wanted.
2. **The exact file-type allow-list (§7) is a product/security call**, not a purely technical one —
   the list proposed here is a reasonable starting set, not a claim that it's the only correct one.
3. **Malware scanning's absence (§7)** may or may not be acceptable for this project's actual launch
   bar — flagged rather than silently shipped.
4. **The `?admin=true` list-mode split (§8)** is new territory this codebase hasn't needed before;
   worth explicit sign-off since it's the one place this plan invents a pattern rather than copying
   one.
5. **`packages/validation` vs. a new `apps/api/src/shared/`** for the extracted document primitives
   (§Current state) is an implementation-time call with no behavioral consequence either way.
6. **Relocating `AttachmentStorage`/`S3AttachmentStorage` out of `apps/api/src/attachments/`**
   (§3) is proposed for naming honesty, not required for correctness — importing them
   cross-module from their current location would work identically if relocation is unwanted.
7. **Resource count assumptions.** §8's "browse list is unpaginated, expected to be small" is an
   assumption about real-world scale (tens of resources per organization, not thousands) — if
   that's wrong, the browse view needs pagination or search, not just grouping.

## Test plan

Real-Postgres integration tests with Phase 13a/19's rigor, synthetic fixtures only
(`AGENTS.md` — no Wellsure-specific names anywhere), in a new
`phase22.postgres.integration.test.ts` built on the existing Phase 9/13a harness.

**The core security assertion** — whole-response, matching ADR-0011's fixed style: a synthetic
Role A (granted) and Role B (not granted) for a synthetic file-type Resource. As Role B: `GET
/tools` (list) body does not contain the resource id anywhere (`JSON.stringify` of the whole
response); `GET /tools/:id` 403/404s; `GET /tools/:id/download` 403s without ever calling into
storage (asserted by the storage mock recording zero `get` calls); `admin=true` on the list request
is silently ignored (Role B holds only `tools:view`) and the filtered list is returned unchanged.
As Role A: all three surfaces succeed — proving step one isn't vacuous.

**Default-state regression, pinning §THE DECISIONS 2 explicitly**: a freshly created Resource with
zero `resource_visibility` rows is invisible to **every** Role, including the creator's own admin
Role — the opposite assertion from Phase 19's "unconfigured Status is unrestricted" test, deliberately
checked here so the two phases' opposite defaults are each pinned by a test that would fail if
someone copied the wrong precedent during implementation.

**Round-trip and full-replace**: `PUT` then `GET /tools/:id/visibility` returns exactly the rows
written; a second `PUT` full-replaces rather than merges; `{ roleIds: [] }` returns the Resource to
fully hidden (not fully open); an inactive Role's row round-trips losslessly.

**Self-escalation gate**: a caller holding `tools:edit` but not `roles_permissions:edit` gets 403
from the visibility `PUT` even though they can edit the Resource's own metadata; a caller holding
`roles_permissions:edit` but not `tools:edit` can edit visibility but 403s on `PUT /tools/:id` —
proving the two permissions are genuinely independent (requirement 4, checked directly rather than
inferred).

**Version bump**: both a Role gaining and a Role losing a grant have `version` incremented.

**Audit**: create/edit/deactivate/visibility-replace each write exactly one `system_audit_logs` row
with the correct `entity_type`/`action`/`entity_id`/old-new values.

**File-type/size validation**: an oversized upload is rejected before being fully buffered; a
disallowed MIME/extension is rejected with `400` before any S3 `put` call (asserted via the storage
mock recording zero `put` calls); an allowed type with a **mismatched magic-byte signature** (a
`.pdf`-named, PDF-declared-MIME file whose actual bytes are something else) is rejected.

**Update-file overwrite semantics (requirement 8, checked concretely, not just asserted in prose)**:
replacing a `file`-type Resource's file updates the row's metadata, best-effort-removes the old S3
object (asserted via the storage mock), leaves the Resource's `id` and creation audit trail intact,
and a subsequent download serves the **new** bytes; the audit row for the edit carries both old and
new file metadata.

**Capabilities/nav**: `GET /auth/capabilities` for a Role holding `tools:view` with zero granted
Resources returns `hasAccessibleTools: false`; granting one flips it to `true` on the very next
call, no caching — the same "immediately after creation" property Phase 13a established, checked
fresh for this feature rather than assumed to carry over.

**Tenant isolation**: a `resourceId` or `roleId` from another organization is rejected on every
route — create/edit/visibility/download alike.

**Unit tests**: the relocated `packages/validation/src/document.ts` primitives keep every existing
test from `campaigns/document.ts`'s current suite passing unchanged (proving the extraction is
behavior-preserving); new validation-module tests for Resource input (name required; `url` required
and scheme-checked for `type: link`; file required for `type: file`; malformed `instructions`
document rejected the same way `parseDocument` already rejects one today).

**Frontend (MSW, `AdminFlows.test.tsx`-style)**: creating a link Resource; creating a file Resource
(mocked multipart); the two-request save issuing exactly one visibility `PUT` carrying the full set
(counting intercepted requests, matching Phase 13a's own test for the identical regression;
`FieldsPage.tsx`'s save mutation is the direct template); the nav item absent when
`hasAccessibleTools` is `false`; a `tools:view`-only session sees the browse list with no
Create/Edit/Deactivate/visibility affordances anywhere.

**Gates**: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, plus the
Postgres suite via `FALCON_POSTGRES_URL` — all run and their actual results reported, per every
prior phase's stated practice.

## Files to touch (implementation-time reference, not committed to yet)

**Database**
- `packages/database/prisma/schema.prisma` — `Resource`, `ResourceVisibility`, `ResourceType`;
  `Role.resourceVisibility` relation.
- New migration `00000000000006_tools_resource_library`.

**Shared**
- `packages/validation/src/document.ts` (new) — extracted generic core of
  `campaigns/document.ts`.
- `apps/api/src/campaigns/document.ts` — re-exports the shared primitives, keeps
  `interpolate`/`documentTokens`.
- `apps/api/src/storage/object-storage.ts` (new, or left in place — §Risks 6) —
  `AttachmentStorage`/`S3AttachmentStorage` relocated.

**API**
- `apps/api/src/tools/` (new module) — `storage.ts` (`resourceObjectKey`), `service.ts`,
  `repository.ts`/`prisma-resource-repository.ts`, `validation.ts`.
- `apps/api/src/http/routes/tools.ts` (new) — the eight routes in §8.
- `apps/api/src/routes/auth.ts` — `capabilitiesRoute` gains `hasAccessibleTools`.
- `apps/api/src/main.ts` — `toolStorageService` wiring beside `attachmentService`.
- `apps/api/src/http/types.ts` — `ServerDependencies` gains the new optional service + repository.
- `packages/permission-engine/src/catalog.ts` — the `tools` module.

**Web**
- `apps/web/src/pages/tools/ToolsPage.tsx` (new).
- `apps/web/src/components/layout/Sidebar.tsx` — the new nav entry.
- `apps/web/src/App.tsx` — the new route.
- `apps/web/src/lib/api-client.ts`, `apps/web/src/types/domain.ts` — `toolsApi`, `Resource`/
  `ResourceVisibility` types.
- `apps/web/src/mocks/handlers.ts` — MSW handlers for every new route.

**Tests** — see §Test plan.

**Docs**
- `docs/permissions/access-model.md` — the `Tools` catalog row, and item **F**.
- `docs/api/endpoints.md` — the new `/tools*` section.
- `docs/data-model/schema.md` — `resources`/`resource_visibility`.
- New ADR-0024, written **after** approval and implementation (matching Phase 19's own stated
  practice: "recorded once approved and implemented... not written before approval"), covering: the
  hidden-by-default decision and its reasoning versus Status Visibility's opposite default; the
  storage-reuse decision; the server-proxy-not-signed-URL decision.
- This plan, amended with whatever implementation finds, matching every prior phase's practice.

## Rollback plan

Two new tables, fully additive — no existing table is altered. `DROP TABLE resource_visibility,
resources` returns the system to exactly its pre-Phase-22 state. The permission catalog addition,
the `capabilitiesRoute` extension, and the storage-port relocation are all additive/mechanical;
reverting the implementation commit removes them with no data migration in either direction. Object
storage itself is unaffected either way — Attachments' own use of it is untouched by every change
proposed here.

---

## Summary of the 8 required decisions, for quick reference at approval

1. **Real file storage exists and works today** (S3-compatible, optional/env-gated, local-MinIO-only
   in infra terms) — reuse its storage port; do not build a second one.
2. **Two types, not three**: `link` | `file`. "Package" = a `file` with thorough instructions, no
   new code path.
3. **Per-resource role-gating follows Phase 13a's reverse allow-list shape** exactly (`GET`/`PUT`,
   full-replace, gated on `roles_permissions`), with a plain membership row (no VIEW/EDIT tri-state)
   and a **hidden-by-default** default — matching Field, explicitly not matching Status Visibility's
   later, differently-justified default.
4. **Two independent catalog actions**: `tools:view` (browse/access, further narrowed by the
   allow-list) vs. `tools:create/edit/delete` (admin capability) — never gated on each other, and
   the allow-list itself gated on `roles_permissions`, not `tools`, to prevent self-escalation.
5. **File security baseline**: private bucket (already true), server-proxied downloads (stronger
   than signed URLs, already precedented), server-enforced size **and** type validation (closing a
   real, pre-existing gap), malware scanning explicitly out of scope and flagged as a known gap.
6. **New top-level "Tools" nav entry**, gated on the module permission **and** a new
   `hasAccessibleTools` capabilities signal — a genuinely new nav-gating pattern for this codebase,
   flagged as such.
7. **Categorization**: free-text `category` + datalist autocomplete, directly reusing Fields'
   `section` pattern verbatim — no new mechanism.
8. **Updating a resource's file is a plain overwrite**, not a version history — matching this
   project's own prior, deliberate non-completion of Attachment versioning. The Resource entity
   itself is only ever deactivated, never hard-deleted.

**Nothing in this phase is implemented. Awaiting approval before any code is written.**

---

## Amendments found during implementation

Approved in full; implemented as planned with the following findings, per
every prior phase's practice of recording what implementation surfaced
rather than silently absorbing it.

- **Phase 16's own purge-coverage test caught a real omission.**
  `resource_visibility.role_id` is a foreign key onto `roles`, a purgeable
  entity (ADR-0017), and `phase16.postgres.integration.test.ts`'s
  "classifies every foreign key that points at a purgeable table" test
  failed the moment the new table existed, exactly as designed. Fixed by
  adding `resourceVisibility` as a **cascade** (not a blocker) under the
  `role` purge descriptor in `apps/api/src/configuration/purge.ts` — a
  pure grant row naming only the Role's own participation, the identical
  treatment `fieldVisibility` already gets there. Not called out as a
  distinct decision in the plan because it is mechanical once the general
  rule ("per-item grant rows are cascades, entities-with-their-own-identity
  are blockers") is applied — but flagged here since it is a real file this
  plan's own "Files to touch" list did not name in advance.
- **The `?admin=true` list/detail duality (§8) needed one clarification
  beyond the plan's text**: whether admin mode bypasses `resource_visibility`
  for **detail** fetches the same way it does for the list. It does —
  `GET /tools/:id?admin=true`, re-derived server-side exactly like the list,
  returns the raw row regardless of the caller's own grant, which is what
  lets an admin open the editor for a Resource their own Role cannot access.
  Download never gets this bypass, per §Proposed approach 6/ADR-0024
  Decision 3 — confirmed by a dedicated test.
- **Local environment note, not a code decision**: this implementation ran
  without Docker available, so the real-Postgres integration suite ran
  against a locally-installed PostgreSQL 16 server (`falcon`/`falcon_test`
  databases) rather than the MinIO-backed dev stack `pnpm infra:up`
  normally provides. Object storage in the integration test suite is
  therefore a Map-backed in-memory fake implementing the exact
  `AttachmentStorage` port (`InMemoryStorage` in
  `phase22.postgres.integration.test.ts`), not real MinIO/S3 — the database
  is real, the object store is faithfully faked. This does not weaken the
  security assertions (which are about authorization, not S3 behavior) and
  matches this project's own precedent of treating storage as swappable
  behind the port.
- **Frontend file-upload testing hit a genuine jsdom/Node interop gap**,
  recorded here rather than worked around silently: Node's native `fetch`
  validates a `FormData`-appended `File` against its own WebIDL brand check
  once a request handler calls `request.formData()`, and a jsdom-
  constructed `File` fails that check — a limitation this codebase had
  simply never hit before (no prior test combined a real `File` with a
  mock handler that parses the body; `importApi`'s own upload paths are
  only ever exercised against handlers that don't parse it either). The
  Tools frontend test for file creation therefore verifies the React
  layer only (the file input gates Save; a successful response is
  reflected in the UI) without a mock handler that inspects the multipart
  body — the actual multipart parsing, field ordering, and file-content
  validation are already covered end-to-end against a real Fastify server
  in `phase22.postgres.integration.test.ts`.
- All 12 subsections of §Proposed approach, the full §Files to touch list,
  and every item in §Test plan were implemented as written. `pnpm lint`,
  `pnpm typecheck` (both apps and all packages), the full `apps/api` and
  `apps/web` Vitest suites (including the real-Postgres suite), and
  `pnpm build` all ran and passed — see the PR for the actual command
  output, not asserted here in advance.
- ADR-0024 records the three decisions this document flagged as most
  consequential (hidden-by-default, storage-port reuse, server-proxied
  downloads), written after implementation per this project's own stated
  practice.
