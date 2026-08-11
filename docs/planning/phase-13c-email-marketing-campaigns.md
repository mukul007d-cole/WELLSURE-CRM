# Phase 13c — Email marketing campaigns

Status: **proposed, awaiting approval.** Sub-phase 3 of 3 in Phase 13.
13a and 13b are delivered; this one consumes 13b's filter model for manual
targeting and Phase 9's trigger detection for automated sends.

## Goal

Let an admin compose a formatted email once and send it to Leads — either
immediately to everyone matching a stored 13b filter, or automatically to a
single Lead whose process instance enters a configured Journey/Status — with
per-recipient variable interpolation, a send record per recipient, and no
duplicate sends.

## Docs read

`AGENTS.md`, `PLANS.md`, `docs/requirements/source-of-truth.md`,
`docs/requirements/v1-scope.md`, `docs/data-model/schema.md`,
`docs/permissions/access-model.md`, `docs/api/endpoints.md`,
`docs/testing/quality-gates.md`,
`docs/planning/phase-9-lead-sharing-and-notifications-plan.md`,
`docs/planning/phase-13a-…`, `docs/planning/phase-13b-…`,
ADR-0001 (single status field), ADR-0009, ADR-0010 (closed engine catalogs),
ADR-0011.

## Current state

Verified against `e345272`. **No campaign concept exists anywhere** — no model,
no table, no route, no UI. The only `campaign` string in the tree is
`cr_campaign_name` in the Cronberry migration mapping, which is unrelated
historical call-log data.

### The EmailSender abstraction is password-reset-shaped, not generic

This is the correction the task description needs. `EmailSender`
(`apps/api/src/auth/password-reset.ts:39-41`) is, in full:

```ts
export interface EmailSender {
  sendPasswordReset(input: { to: string; token: string; expiresAt: Date }): Promise<void>;
}
```

One method, and its payload is a reset token, not a message. The pluggable part
is `createEmailSender` (`auth/email-sender.ts`): it selects a transport by name,
implements `console` for local development and first-run bootstrap, and returns
`deliveryNotConfigured` — which rejects every call — for anything else. So
**there is no configured transport at all today, and no generic send method to
build against.** Its three call sites all send password resets
(`admin/service.ts:46`, `admin/bootstrap.ts:114`, `auth/password-reset.ts`).

"Build against the existing EmailSender abstraction, do not build a new email
pipeline" is still the right instruction; it just has to mean *extend this
abstraction and keep one transport selection*, not *call an existing generic
method*. §3 proposes how.

### Phase 9's trigger detection is shared, but its rule model is not reusable

`writeActivity` (`leads/prisma-lead-repository.ts:341-400`) is the single place
where a persisted activity becomes a trigger: it maps `action_type` →
`trigger_type` (`status_change` → `status_changed`, and three others) and calls
`NotificationService.evaluate`. Two properties matter for this phase:

1. **It runs inside the mutation transaction.** `transaction()` (`:155-165`)
   constructs `new NotificationService(tx)`, and ADR-0010 states rules "consume
   persisted Lead activities in the mutation transaction". Phase 9 has a test
   asserting a notification failure rolls the mutation back.
2. **It passes `oldValue` but not `newValue`** (`:366-377`). A campaign keyed on
   *entering* a status needs the new status id, which lives in the activity
   row's `newValue`. Extending the dispatch to carry `newValue` is a
   prerequisite, not an optional nicety.

The rule model itself does **not** fit campaigns:

- `NotificationRule.triggerType` is a closed catalog and `scope` is rejected for
  every trigger except `field_edited` (`notifications/service.ts:299-301`).
  **A Phase 9 rule cannot target a specific status today** — `status_changed`
  fires on every status change. Journey/Status targeting is new work regardless
  of where it lives.
- `notification_rule_recipients` resolves **users** — six resolvers, all
  returning user ids, and `validateRule` requires at least one. A campaign's
  recipient is the Lead. Making recipients optional-and-ignored for one rule
  kind is precisely the conflation the task warns against.

### 13b's filter model is ready to be stored

`Filter` / `FilterCondition` (`leads/filter-model.ts`) is already a plain
JSON-serializable shape, validated by `parseFilter`/`resolveFilter` and compiled
by `buildSellerListQuery`. A manual campaign's target set is a stored `Filter`,
evaluated at send time through the same compiler — no second query path.

### No rich-text or sanitization dependency exists

`apps/web` has no editor library, and nothing in the app renders raw HTML:
`dangerouslySetInnerHTML` appears nowhere. (`jspdf` pulls DOMPurify in
transitively, but depending on a transitive dependency would be its own
mistake.) So the composer decision in §4 starts from zero.

## Proposed approach

### 1. Extend the trigger dispatch; do not extend the rule model

**Recommended: a separate Campaign model that subscribes to the same trigger
detection.** Justification, as required:

The thing worth sharing is the *detection* — one place that decides a persisted
activity means "a lead entered status X", inside the mutation transaction. The
thing not worth sharing is the *rule row*, because Notification Rules answer
"which **users** to notify" through user-returning resolvers, and campaigns
answer "which **lead** to email". Merging them would mean: an action
discriminator on `notification_rules`; `recipients` required by validation but
meaningless for one branch; `scope` semantics forked per action; the Notification
Rules admin page rendering two unrelated shapes; and an amendment to ADR-0010,
whose whole point is that these are closed, stable catalogs. That is a lot of
model damage to avoid one new table.

So `writeActivity`'s trigger classification moves into one small module that
fans out to both consumers:

```
writeActivity → triggerTypeFor(actionType) → dispatch({ …, oldValue, newValue })
                                              ├→ NotificationService.evaluate   (unchanged behaviour)
                                              └→ CampaignTriggerService.evaluate (new)
```

Detection code is written once. Neither consumer knows about the other. Adding
`newValue` to the dispatch payload is the only change Phase 9's path sees, and
its existing rollback test still applies.

**Status matching reuses Phase 9's exact-match semantics per ADR-0001**: a
triggered campaign stores `journey_id` + `status_id` and fires when the
activity's `newValue.statusId` equals that status id. No ordering, no
`sort_order` comparison, no "at or beyond" logic.

### 2. Sending happens after commit, never inside the transaction

An email cannot be rolled back. The trigger evaluation runs inside the mutation
transaction, so it must not call the transport there. Instead:

- **Inside** the transaction, `CampaignTriggerService` inserts a
  `campaign_sends` row with `status = 'pending'`. This is cheap, transactional,
  and rolls back with the mutation.
- **After** commit, a `CampaignSendService` drains pending rows, interpolates,
  calls the transport, and marks each row `sent` or `failed` with the error
  recorded. A failed row stays a row — the send is reportable, not lost.

Manual campaigns use the same two steps: `POST /campaigns/:id/send` evaluates the
filter, inserts pending rows for every matching lead in one transaction, then
drains. Leads with no email address are recorded `skipped_no_email` rather than
silently dropped, so the reported counts add up.

`apps/worker` is still a two-line placeholder; draining from the API process is
what this phase does, and moving it to the worker is named as follow-up rather
than pretended.

### 3. One email abstraction, two role interfaces

`EmailSender` keeps its password-reset method. A second, narrow interface
carries generic delivery, and `createEmailSender` — the single transport
selection — returns both:

```ts
export interface EmailMessage { to: string; subject: string; html: string }
export interface CampaignEmailSender { sendEmail(message: EmailMessage): Promise<void> }
export function createEmailSender(…): EmailSender & CampaignEmailSender
```

Campaigns depend on `CampaignEmailSender` only. Rationale: adding `sendEmail` to
`EmailSender` itself would break every existing test double that implements the
one method (there are several), for no gain — this is interface segregation over
one implementation, not a second pipeline. The console transport grows a
matching branch, and `deliveryNotConfigured` keeps rejecting, so **a campaign
send fails loudly on an unconfigured transport rather than silently reporting
success.**

### 4. Composer: a structured document, not stored HTML

Recommended, and this is a decision worth your explicit approval because it
deviates from the task's "HTML body" wording.

The composer is `contentEditable` with a small toolbar (bold, italic,
underline, link, bullet/numbered list) driven by `document.execCommand` — zero
new dependencies. On save the client walks the DOM and serializes to a small
closed-vocabulary JSON document (blocks: paragraph, heading, list; inline marks:
bold, italic, underline, link). The server validates that vocabulary and
**renders the HTML itself at send time, escaping every text node**.

Why not store HTML: storing client-supplied HTML means sanitizing it, and
hand-rolled HTML sanitizers are a well-known footgun — the alternative is adding
`sanitize-html` or DOMPurify+jsdom as a production dependency, which AGENTS.md
asks me to justify rather than assume. Storing a structured document removes the
problem instead of mitigating it: we only ever emit markup we constructed, and
interpolated variable values are escaped as text, so a lead whose name contains
`<script>` cannot inject anything.

The trade-off, stated plainly: the stored column is `body_document` (JSONB), not
an HTML string, so importing externally-authored HTML templates is not possible
in this phase. If you would rather store HTML and accept a sanitizer
dependency, say so at approval and §4 becomes: store `body_html`, add
`sanitize-html`, sanitize on write *and* on render.

### 5. Dynamic variables, and whose visibility governs them

Tokens are `{{name}}`, `{{email}}`, `{{phone}}` for core columns and
`{{field:<fieldId>}}` for custom Fields. At send time each token is replaced
with that recipient's value, escaped, with an empty string for a missing value.

**Availability is checked against the campaign creator's field visibility at
create/edit time, and that is the model** — documented here as the decision
rather than left implicit. One template serves a whole batch, so there is no
"the recipient's visibility" to consult; per-recipient visibility-gated
interpolation is incoherent for a shared template. The consequence, accepted and
recorded: a token remains in the template if the author later loses access to
that Field, and the value still interpolates at send time. Mitigation is
ordinary review, not a runtime check — a runtime check against the *sender's*
visibility would make sends non-deterministic, which is worse.

The variable picker offers only Fields the creator can view, resolved through
the real permission decision, the same re-validation 13b does for filters.

### 6. Data model

```text
campaigns
  id, organization_id, key, name, subject, body_document (JSONB),
  type (manual | triggered), filter (JSONB, nullable — manual only),
  journey_id / status_id (nullable — triggered only),
  active, version, created_by, updated_by, created_at, updated_at

campaign_sends
  id, organization_id, campaign_id, lead_id,
  status (pending | sent | failed | skipped_no_email),
  error (nullable), sent_at (nullable), created_at
  UNIQUE (organization_id, campaign_id, lead_id)
```

A `CHECK` enforces the shape per type: manual carries a filter and no
journey/status; triggered carries both ids and no filter.

**Idempotency default, proposed for approval:** the unique constraint is
`(organization_id, campaign_id, lead_id)`, so a lead receives a given campaign
**at most once, ever** — re-entering the same status does not re-send. Rationale:
for outbound marketing the harmful direction is duplicates, and a structural
constraint is stronger than a code path. The alternative — re-send on each
entry, keyed by the triggering activity id like Phase 9's notification
constraint — is a per-campaign toggle I am explicitly *not* building now; say if
you want the opposite default.

### 7. Permissions

A new `campaigns` module in the permission catalog with `view`, `create`,
`edit`, `send`. Adding catalog entries is the established path (ADR-0009), and
`bootstrapFirstAdmin` grants every catalog pair, so the first admin gets them
automatically. `send` is separate from `edit` deliberately: authoring an email
and actually mailing customers are different levels of trust.

### 8. Frontend

A Campaigns admin tab: list, create/edit (composer + variable picker + type
selector + targeting), and per-campaign send stats (sent / failed / skipped).
Manual targeting reuses 13b's `FilterBuilder` component directly. Triggered
targeting is a Journey picker plus a Status picker from that Journey.

## Files to touch

**Database** — `packages/database/prisma/schema.prisma`, new migration
`00000000000004_campaigns`.

**API**
- `apps/api/src/campaigns/{model,validation,service,send-service,render}.ts` *(new)*
- `apps/api/src/campaigns/trigger-service.ts` *(new)*
- `apps/api/src/leads/trigger-dispatch.ts` *(new)* — extracted classification
- `apps/api/src/leads/prisma-lead-repository.ts` — use the dispatch, pass `newValue`
- `apps/api/src/auth/password-reset.ts`, `apps/api/src/auth/email-sender.ts` — `CampaignEmailSender`
- `apps/api/src/http/routes/campaigns.ts` *(new)*, `http/build-server.ts`, `http/types.ts`
- `packages/permission-engine/src/catalog.ts` — `campaigns` module

**Web** — `pages/admin/campaigns/{CampaignsPage,CampaignEditor,RichTextComposer,VariablePicker,campaign-document}.tsx|ts` *(new)*, `App.tsx`, `Sidebar.tsx`, `lib/api-client.ts`, `types/domain.ts`, `mocks/handlers.ts`.

**Tests** — `campaign-document.test.ts`, `campaign-render.test.ts`,
`phase13c.postgres.integration.test.ts`, `CampaignFlows.test.tsx`.

**Docs** — `docs/api/endpoints.md`, `docs/data-model/schema.md`,
`docs/permissions/access-model.md`, a new ADR for the trigger-fan-out decision,
this plan.

## Out of scope

- **Unsubscribe, consent, and compliance tooling — the most important omission
  here, and it is deliberate.** There is no unsubscribe link, no suppression
  list, no consent record, no per-recipient opt-out state, and no CAN-SPAM /
  GDPR / India DPDP handling of any kind. What this phase builds is safe against
  the console transport, which prints to a log. **It is not safe to point at a
  real transport and mail real people**: doing so without at least a suppression
  list and an unsubscribe mechanism is a legal and reputational exposure, not a
  missing nicety. This needs real product and legal input before any transport
  other than `console` is configured, and that gate belongs in the runbook.
- Scheduled/recurring sends, A/B tests, open/click tracking, bounce handling.
- A real transport implementation (SES/SMTP). `deliveryNotConfigured` still
  rejects; wiring a transport is its own change with its own review.
- Draining sends from `apps/worker`; the API process does it for now.
- Attachments, per-recipient send-time field-visibility gating, Saved Views.
- Editing a campaign's body after sends exist (allowed, but no re-send).

## Risks / open questions

1. **Decision requested — structured document vs. stored HTML** (§4). I
   recommend the structured document; the alternative costs a sanitizer
   dependency.
2. **Decision requested — once-ever idempotency** (§6). I recommend at most one
   send per (campaign, lead).
3. **Emails escape the transaction boundary by design.** Pending rows inside,
   delivery outside. A crash between commit and drain leaves rows `pending`,
   which the next drain picks up — at-least-once delivery with a
   once-ever constraint, so the failure mode is a delayed send, not a duplicate.
4. **A large manual campaign is unbounded work in a request.** Send inserts one
   row per matching lead; at 200k leads that is a long transaction. This phase
   caps a manual send at a configurable maximum (proposed: 5,000 recipients) and
   reports refusal above it, rather than pretending to scale. Batching belongs
   with the worker follow-up.
5. **The `campaigns` catalog addition is visible everywhere** the permission
   matrix renders. Intended, but it does change an existing admin screen.
6. No conflict found between `docs/` and the implementation. The trigger
   fan-out does warrant a new ADR, since ADR-0010 currently reads as though
   activity-driven rules and notifications are the same thing.

## Test plan

Per `quality-gates.md`; synthetic fixtures only.

**Unit**
- Document vocabulary: unknown block/mark types rejected; nesting depth capped.
- Rendering: every text node escaped; a variable value containing `<script>` or
  `"` emerges inert; unknown token left untouched; missing value → empty string.
- Variable availability filtered to the creator's visible Fields.
- Campaign validation: manual requires a filter and rejects journey/status;
  triggered requires both and rejects a filter; unknown type rejected.

**Real-Postgres integration** (`phase13c.postgres.integration.test.ts`, on the
13a/13b harness so it runs in CI)
- **Triggered send fires on exact status match only**: a transition into the
  configured status creates exactly one `campaign_sends` row; a transition into
  a *different* status in the same journey creates none — the ADR-0001
  exact-match rule, asserted rather than assumed.
- **Idempotency**: leaving and re-entering the configured status produces no
  second row and no second email.
- **Rollback**: a mutation that fails after the trigger evaluation leaves no
  `campaign_sends` row and sends nothing — the transaction-boundary claim in §2,
  tested the way Phase 9 tests its own.
- **No email inside the transaction**: the transport records call timestamps;
  the test asserts no call occurred before commit.
- **Manual send** evaluates the 13b filter through the same compiler, honours
  the sender's data scope, records `skipped_no_email` for leads without an
  address, and reports counts that add up to the recipient set.
- **Interpolation** uses each recipient's own values across a batch of three
  leads — the failure this catches is a template rendered once and reused.
- **Permissions**: `campaigns:send` is required to send and is not implied by
  `campaigns:edit`; every mutation writes a `system_audit_logs` row.
- **Unconfigured transport fails loudly**: sends are recorded `failed` with the
  error, not `sent`.

**Frontend** — composer applies bold/italic to a selection and round-trips
through the document format; variable picker inserts a token and offers only
visible Fields; type selector swaps filter targeting for journey/status
targeting; stats render sent/failed/skipped.

**Gates** — `format:check`, `lint`, `typecheck`, `test`, `build`, plus the
Postgres suite, all run and observed before the PR.

## Rollback plan

One additive migration creating two new tables and touching nothing existing;
rollback is `DROP TABLE campaign_sends; DROP TABLE campaigns;` plus a revert of
the code. The only change to an existing path is the trigger dispatch carrying
`newValue` and fanning out to a second consumer — reverting restores the
previous single call, and no notification behaviour changes in either direction.
Sends already delivered cannot be rolled back, which is the nature of email and
another reason the transport stays unconfigured until §Out-of-scope's compliance
gate is met.
