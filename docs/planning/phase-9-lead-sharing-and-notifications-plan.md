# Phase 9 Lead Sharing and Notifications Plan

## Goal

Add action-scoped, per-user Lead sharing, close the Lead deactivation and
reassignment-audit gaps, and add an administrator-configurable in-app
notification rule engine with complete API and web experiences, without
creating a second record-access path or hardcoding any business assignment,
Field-section, role, Journey, or Status name.

## Docs read

* `AGENTS.md`
* `PLANS.md`
* `docs/requirements/source-of-truth.md`
* `docs/requirements/glossary.md`
* `docs/requirements/v1-scope.md`
* `docs/data-model/schema.md`
* `docs/permissions/access-model.md`
* `docs/api/endpoints.md`
* `docs/testing/quality-gates.md`
* `docs/architecture/decisions/0001-single-status-field.md`
* `docs/architecture/decisions/0006-team-scope-from-hierarchy.md`
* `docs/architecture/decisions/0008-http-framework.md`
* `docs/architecture/decisions/0009-admin-bootstrap-and-permission-catalog.md`
* `docs/planning/phase-5-lead-seller-core-plan.md`
* `docs/planning/phase-6-http-transport-plan.md`
* `docs/planning/phase-7-admin-management-api-plan.md`
* `docs/planning/phase-8-admin-frontend-plan.md`
* The existing permission-engine grant, scope, decision, catalog, repository,
  and tests under `packages/permission-engine/src/`
* The Prisma schema and reversible migrations under `packages/database/prisma/`
* The existing Lead service, activity writer, Prisma repository, route, HTTP
  adapter, and tests under `apps/api/src/`
* The existing configuration service/repository/routes and system-audit pattern
  under `apps/api/src/configuration/`
* The existing app shell, Seller List, Seller 360, admin pages, API client,
  domain types, mocks, and tests under `apps/web/src/`

## Current state

### Record access and Lead sharing

* `user_access_grants` already represents an additive, tenant-scoped grant for
  one user and one Lead, with issuer, optional expiry, and revocation metadata.
  `resolveAuthorization` evaluates it only after the active-user, active-role,
  feature/action, Journey, and Field checks, and it changes only the record-scope
  result. This is the correct single composition point for sharing.
* A direct grant currently has no action list. Consequently, the same row opens
  record scope for every Leads action that the user's role otherwise grants.
  There is no sharing CRUD API or UI.
* The Leads permission catalog has `view` and `edit`, but no `comment` action,
  even though `POST /leads/:id/comments` is documented as a target endpoint.
  Comment/activity UI and transport are not implemented.
* The list predicate carries `includeDirectGrantsForUserId`, but must be extended
  to filter grants by the requested action so list/count results and individual
  decisions remain identical.
* Assignments belong to Journey process instances and use caller-configured
  `assignmentType` strings. The existing code deliberately does not define a
  magic owner assignment type. Seller summaries call the first matching
  assignment an owner only because the caller supplies the applicable assignment
  types. There is therefore no safe application-wide literal for “Primary
  Owner”; owner-oriented notification resolvers must be parameterized with an
  assignment type and evaluated in a specified process-instance context.

### Lead mutation gaps

* Leads do not have an `active` column or deactivation endpoint. Process
  instances do have `active`, but deactivating one Journey membership is not
  equivalent to deactivating the canonical Lead shared across Journeys.
* `LeadService.editLead` writes distinct `field_edit` and `status_change`
  activities. It does not accept assignment changes. Reassignment is documented
  at the API level but has no service/HTTP implementation, so the required
  `reassignment` activity with old/new holder values cannot currently occur
  through the edit flow.
* `activity_logs.action_type` is stored as text and the logical schema names the
  four current values `comment`, `status_change`, `reassignment`, and
  `field_edit`. Share changes and deactivation are material Lead mutations but
  have no event vocabulary yet.

### Notifications and administration

* The `notifications` table and Prisma model already exist, but there is no
  NotificationRule model, evaluation service, recipient resolver, API, or UI.
  The current notification row can safely carry a short navigation message and
  `reference_lead_id`; it must not become a Lead-detail snapshot.
* The established configuration engine uses organization-scoped repository
  operations, service transactions, server-side permission decisions,
  deactivation instead of hard deletion, and `system_audit_logs` for every
  configuration mutation. Phase 9 will follow that pattern.
* Seller 360 has an Edit action and dynamic detail cards but no sharing or notes
  controls. Seller List already has a URL-backed filter bar and responsive
  table/card rows. `Topbar` has an account popover but no notifications. Admin
  pages share routing, permission guards, forms, tables, dialogs, API-client,
  query-cache, and MSW patterns that can be extended rather than replaced.

## Proposed approach

### 1. Resolve the domain decisions before implementation

Approval of this plan approves the following choices. If any choice is rejected,
amend this plan and, where indicated, record the alternative ADR before changing
code.

1. **Extend `UserAccessGrant`; do not add `LeadShare`.** Add a non-empty array of
   canonical Leads actions to each grant and treat an active action-matching row
   as the one additive record-scope source. The sharing service becomes the
   lifecycle/API around these grants. Both single-record decisions and list/count
   predicates call the same action-aware grant resolution. This avoids two
   inconsistent answers to “does this user have additional access to this Lead?”
   A focused ADR will record the schema/permission semantic change.
2. **Add `leads:comment` to the canonical feature catalog.** Share capabilities
   are exactly `view`, `edit`, and `comment`; the UI labels `comment` as “Add
   notes.” No parallel `add_notes` value is introduced. `view` is required in
   every share because edit/comment without permission to retrieve the record is
   not a useful or supportable UI contract. Role feature permission, Journey
   access, Field access, workflow checks, and active-user checks remain mandatory;
   a share only satisfies record scope for its listed action.
3. **Sharing administration uses `leads:edit` on the target Lead.** The actor
   must pass the complete existing decision for that Lead and cannot grant an
   action outside the supported share set. Self-sharing is rejected. Sharing
   never changes any assignment. Share create, capability replacement, and revoke
   occur transactionally and append Lead activity.
4. **Primary owner remains configuration-driven.** Do not introduce an owner
   string or a duplicate Lead owner column. Each owner/holder notification
   resolver stores its assignment-type parameter, and rules that require a
   single membership also store an optional Journey scope or evaluate the event's
   process instance. The Seller UI continues to use the assignment context
   returned by the API. Seed data may refer to a seed assignment type only in an
   explicit seed operation; runtime code and tests use neutral synthetic values.
5. **Trigger and resolver kinds are closed engine enums; rules are extensible
   data.** Like ADR-0001's fixed status semantics, the supported trigger kinds
   (`field_edited`, `status_changed`, `lead_reassigned`,
   `shared_lead_modified_by_non_owner`, `lead_deactivated`) and recipient
   resolver kinds are stable engine behavior with validated parameter shapes.
   Administrators can create unlimited rules and ordered resolver combinations,
   but adding a new primitive requires code, tests, and a migration/catalog
   update rather than accepting an uninterpreted runtime string. Record this in
   the sharing/notification ADR.
6. **Add explicit Lead event values.** Extend the activity event vocabulary with
   `share_changed` and `lead_deactivated`, retaining `reassignment` as its own
   value. Notification evaluation consumes the event produced by the activity
   writer in the same mutation transaction; it does not infer events by comparing
   arbitrary API payloads in a second mutation path.

### 2. Database model and reversible migration

* Add `active`, `deactivated_at`, and `deactivated_by_user_id` to `leads` so the
  canonical record—not only one Journey membership—can be softly deactivated.
  Default existing rows to active and index tenant/active list reads.
* Add an action array to `user_access_grants`, with a database constraint that it
  is non-empty and contains only the engine's shareable Leads actions. Add a
  partial unique index preventing multiple active share rows for the same
  organization/user/Lead. Preserve revoked rows as history; updating capabilities
  changes the active row and records old/new activity, while revoke timestamps it.
* Add `notification_rules` with tenant, immutable key, editable name, trigger
  kind, optional JSON scope, active/version/audit metadata, and timestamps. Add
  `notification_rule_recipients` with rule FK, resolver kind, validated JSON
  parameters, and unique ordered position. Configuration rows are deactivated or
  versioned, never hard-deleted.
* Keep notifications small, but add `read_at` (instead of relying only on a
  mutable boolean) and optional `notification_rule_id`/`activity_log_id` foreign
  keys for provenance and idempotency. Use a uniqueness constraint on the event,
  rule, and recipient so retries cannot duplicate delivery. Responses expose only
  notification metadata and a Lead URL/reference ID.
* Extend logical schema, permission documentation, and REST endpoint docs in the
  same change. Update Prisma mappings and database package tests.

### 3. One action-aware additive-grant path

* Extend `DirectGrantSnapshot`, repository methods, authorization decisions, and
  record predicates with the requested canonical action. `getActiveDirectGrant`
  becomes an action-aware lookup, and Seller list/count queries include only
  active, non-expired grants containing `view`.
* Keep evaluation ordering unchanged: role feature permission and Journey access
  are prerequisites; a matching share changes only `recordAllowed`. Field
  visibility/editability still strips output and rejects edits independently.
* Add permission-engine table tests for view-only, edit, comment, expiry,
  revocation, tenant isolation, and list predicates. In particular, prove a user
  with the role action and Journey but no hierarchy/assignment scope can view only
  after a `view` share, cannot edit with that share, can edit only after capability
  replacement, and loses access immediately after revocation.

### 4. Lead sharing, comments, reassignment, and deactivation

* Add an organization-scoped Lead sharing service/repository inside the Lead
  module. Expose list, create, capability replacement, and revoke operations. List
  current shares only to an actor authorized to edit the Lead; “shared with me” is
  implemented as the Seller List access-mode filter, not an unscoped user-ID
  endpoint that administrators could misuse.
* Bind authenticated REST endpoints for `GET/POST /leads/:id/shares`,
  `PUT/DELETE /leads/:id/shares/:shareId`, and the existing documented comments,
  reassignment, and deactivation operations. Validate all IDs, capabilities,
  assignment types, and tenant ownership at the boundary and in the transaction.
* Implement comments as `leads:comment` mutations and `activity_logs.comment`, so
  an “Add notes” share is enforceable end to end rather than display-only.
* Implement reassignment as a transactional replacement of the current holder for
  a caller-supplied assignment type on a process instance: mark the previous row
  non-current, create the new current row, and append `reassignment` with stable
  old/new objects containing assignment type and user IDs. Never log names as the
  source of identity and never rewrite assignment history.
* Deactivate the Lead and all active process instances atomically, revoke its
  active shares, and append `lead_deactivated` with old/new active state. Gate it
  on `leads:delete`; subsequent normal list/detail/mutation queries exclude the
  inactive Lead. Preserve the Lead, assignments, activities, notifications, and
  related records.
* Have the Lead activity write return the persisted event and synchronously call
  notification evaluation before the surrounding transaction commits. Sharing,
  comment/edit, status, reassignment, and deactivation therefore have one mutation
  and activity path. A failure creates neither a partial mutation nor partial
  notification set.

### 5. Notification rule configuration and recipient evaluation

* Add a notification configuration service following the existing configuration
  engine: paginated list/detail, create, update, recipient replacement/reorder,
  activate/deactivate, validation, version increment, system audit, and server-side
  authorization. Use the existing `roles_permissions` administration actions for
  rule management rather than a role-name check or speculative new module.
* Validate trigger scope by kind. Only `field_edited` accepts an optional Field
  `section`; it matches the changed configured Field IDs' current section values,
  never a hardcoded section name. Reassignment and assignment-holder resolvers
  require an assignment-type parameter. Feature-permission resolvers require a
  catalog-valid module/action tuple.
* Implement ordered, composable resolver primitives: current holder of a supplied
  assignment type; that holder's direct manager via the existing tenant-scoped
  hierarchy repository used by Phase 2; previous holder from the reassignment
  activity's `old_value`; creator of a specified active share; all active shared
  users except the event actor; and all active organization users whose active
  roles contain a specified feature permission.
* Resolver order determines deterministic presentation/evaluation, not duplicate
  delivery. Union recipient IDs, remove inactive/cross-tenant users and duplicates,
  apply resolver-specific actor exclusion, and insert one notification per final
  recipient. Do not globally suppress the actor unless the resolver contract says
  so. The shared-edit rule thus notifies the configured owner and all other active
  share holders, excluding the shared actor from the all-shares resolver.
* Before delivery, ensure each recipient still has `leads:view` feature and
  Journey access. If a notification points to a Lead they cannot currently open,
  retain the minimal historical notification but the click-through will receive
  the normal forbidden/not-found response; never embed restricted Lead fields.
* Provide an idempotent seed command (not a migration with environment-specific
  IDs) that accepts an organization and configurable assignment-type/permission
  parameters, then creates editable examples for modified, shared-modified,
  reassigned, and deactivated events. It resolves IDs/configuration at execution
  time and contains no runtime branching on Wellsure names.

### 6. Notification inbox API

* Add authenticated, tenant/user-scoped endpoints for paginated current-user
  notifications, unread count, and idempotent mark-read. Mark-read may affect only
  the caller's notification and sets `read_at`; there is no arbitrary user filter.
* Return a stable type, short generic message, timestamps/read state, and
  `referenceLeadId`/navigation target only. Do not serialize Lead fields or use a
  notification as an authorization bypass.

### 7. Web application

* Extend the shared API client and domain types for shares, access-mode filters,
  comments, notification rules, and inbox operations. Update MSW with neutral
  synthetic fixtures and behavior matching capability enforcement.
* On Seller 360, add a permission-aware Share button and accessible dialog/panel
  with a searchable active-user selector, View/Edit/Add notes checkboxes, current
  active shares, capability editing, and revoke confirmation. Add an at-a-glance
  Shared badge and user summary in the header. Add the notes control only when the
  caller has effective `leads:comment` access.
* On Seller List, extend the existing URL-backed filter bar with `mine`,
  `shared_with_me`, and `all` access modes. Preserve all other search/Journey/
  Status filters and pagination. Add a consistent shared indicator to desktop
  rows and mobile cards. The server determines membership and count; the browser
  does not filter an over-broad result set.
* Add an accessible notification bell/popover to `Topbar`, query the unread count,
  show paginated notifications with read state, mark an item read, and navigate to
  the referenced Seller 360 route. Handle empty/error/loading states and keyboard
  focus with the existing shell patterns.
* Add a permission-guarded Notification Rules admin page using the established
  admin list/detail/dialog components. Forms select trigger, optional configured
  scope, ordered resolver rows, and resolver parameters from API-provided users,
  Fields, assignment values, and the canonical permission catalog; they never
  encode example business labels.

### 8. Documentation and verification

* Add the ADR covering action-scoped direct grants, the closed trigger/resolver
  catalog, and the activity-event additions. Update the schema, access model, API
  endpoint contract, catalog documentation, and this plan if implementation
  discovery changes any approved contract.
* Self-review tenant predicates, list/count parity, authorization ordering,
  capability enforcement, deactivation filtering, activity old/new values,
  notification deduplication, recipient visibility, and seed/runtime separation.
* Capture desktop and mobile screenshots of Seller 360 sharing, Seller List
  indicators/filter, notification inbox, and Notification Rules administration
  after implementation because these are perceptible runnable-web changes.

## Files to touch

The implementation is constrained to the following explicit files and new files;
if discovery requires another file, stop and amend the approved plan rather than
quietly widening scope.

### Documentation and migration

* `docs/planning/phase-9-lead-sharing-and-notifications-plan.md`
* `docs/architecture/decisions/0010-action-scoped-grants-and-notification-rules.md`
* `docs/data-model/schema.md`
* `docs/permissions/access-model.md`
* `docs/api/endpoints.md`
* `packages/database/prisma/schema.prisma`
* `packages/database/prisma/migrations/00000000000002_lead_sharing_notifications/migration.sql`
* `packages/database/prisma/migrations/00000000000002_lead_sharing_notifications/rollback.sql`
* `packages/database/src/index.test.ts`

### Permission engine and persistence adapter

* `packages/permission-engine/src/catalog.ts`
* `packages/permission-engine/src/types.ts`
* `packages/permission-engine/src/grants.ts`
* `packages/permission-engine/src/decision.ts`
* `packages/permission-engine/src/scope.ts`
* `packages/permission-engine/src/index.test.ts`
* `packages/permission-engine/src/__tests__/fixtures.ts`
* `packages/permission-engine/src/__tests__/direct-grants.test.ts`
* `packages/permission-engine/src/__tests__/permission-matrix.test.ts`
* `apps/api/src/permissions/prisma-permission-repository.ts`
* `apps/api/src/__tests__/permission-wiring.test.ts`

### API business logic, transport, and seed operation

* `apps/api/src/leads/activity.ts`
* `apps/api/src/leads/errors.ts`
* `apps/api/src/leads/validation.ts`
* `apps/api/src/leads/service.ts`
* `apps/api/src/leads/prisma-lead-repository.ts`
* `apps/api/src/leads/sharing.ts`
* `apps/api/src/notifications/types.ts`
* `apps/api/src/notifications/validation.ts`
* `apps/api/src/notifications/service.ts`
* `apps/api/src/notifications/recipient-resolvers.ts`
* `apps/api/src/notifications/prisma-notification-repository.ts`
* `apps/api/src/notifications/seed-example-rules.ts`
* `apps/api/src/routes/leads.ts`
* `apps/api/src/routes/notifications.ts`
* `apps/api/src/routes/notification-rules.ts`
* `apps/api/src/http/routes/leads.ts`
* `apps/api/src/http/routes/notifications.ts`
* `apps/api/src/http/routes/notification-rules.ts`
* `apps/api/src/http/app.ts`
* `apps/api/src/__tests__/leads.test.ts`
* `apps/api/src/__tests__/leads.integration.test.ts`
* `apps/api/src/__tests__/notifications.test.ts`
* `apps/api/src/__tests__/notifications.integration.test.ts`
* `apps/api/src/__tests__/notification-rules.test.ts`
* `apps/api/src/__tests__/notification-rules.integration.test.ts`
* `apps/api/src/__tests__/http/leads-http.test.ts`
* `apps/api/src/__tests__/http/notifications-http.test.ts`
* `apps/api/src/__tests__/http/notification-rules-http.test.ts`

### Web application

* `apps/web/src/App.tsx`
* `apps/web/src/components/layout/Topbar.tsx`
* `apps/web/src/components/notifications/NotificationBell.tsx`
* `apps/web/src/components/notifications/NotificationList.tsx`
* `apps/web/src/lib/api-client.ts`
* `apps/web/src/lib/permissions.ts`
* `apps/web/src/types/domain.ts`
* `apps/web/src/pages/seller-detail/Seller360Page.tsx`
* `apps/web/src/pages/seller-detail/LeadShareDialog.tsx`
* `apps/web/src/pages/seller-detail/LeadShareDialog.test.tsx`
* `apps/web/src/pages/sellers/SellerListPage.tsx`
* `apps/web/src/pages/sellers/SellerListPage.test.tsx`
* `apps/web/src/pages/admin/NotificationRulesPage.tsx`
* `apps/web/src/pages/admin/NotificationRuleDetailPage.tsx`
* `apps/web/src/pages/admin/NotificationRulesPage.test.tsx`
* `apps/web/src/components/layout/Topbar.test.tsx`
* `apps/web/src/mocks/fixtures.ts`
* `apps/web/src/mocks/handlers.ts`
* `apps/web/src/mocks/permissions.ts`

No new production dependency is planned.

## Out of scope

* Email, SMS, push, webhook, digest, or worker-based notification delivery;
  Phase 9 is in-app only.
* User-authored trigger scripts, arbitrary SQL/expressions, an open plugin
  protocol for trigger kinds, or runtime creation of recipient primitive types.
* A second role, role-name checks, a LeadShare permission evaluator parallel to
  UserAccessGrant, or shares that bypass feature, Journey, Field, workflow, or
  active-user checks.
* Hard deletion, reactivation UX, mass sharing, sharing groups, public links,
  external recipients, share expiry UI, or notifications containing full Lead
  details.
* Hardcoding or introducing administration for a specific “owner” assignment
  type. A general assignment-type configuration master is a separate design task;
  this phase consumes the existing configurable assignment strings.
* Retrofitting notifications onto configuration, authentication, finance,
  attachment, import, task, or email events beyond the listed Lead triggers.
* Redesigning the application shell, admin information architecture, Seller
  forms, or Seller List filter system beyond the additions described above.
* Performance certification against 200,000 Leads or 100 concurrent users; query
  indexes and focused regression checks are included, while the full quality-gate
  load exercise remains a release activity.

## Risks / open questions

1. **Owner terminology conflicts with the current implemented contract.** The
   request says every Lead has one Primary Owner and asks to reuse it, while the
   approved Phase 5 contract explicitly permits arbitrary multiple assignments
   per process instance and states that no canonical owner type is invented. The
   proposed resolution is parameterized holder resolvers plus event process
   context, not a new hardcoded owner. Approval is required; if a global
   one-owner-per-Lead invariant is intended, stop and write a separate data-model
   ADR and migration plan before this phase.
2. **Comment is absent from the feature catalog.** “Reuse the same vocabulary”
   cannot be met end to end without adding the documented comment-equivalent
   action. This plan proposes canonical `leads:comment`, displayed as “Add notes.”
3. **Activity vocabulary currently documents four values.** Share/deactivation
   triggers need durable source events. This plan proposes two closed event values
   rather than disguising them as `field_edit`; approval includes updating the
   logical schema and ADR.
4. **Rule administration permission.** The default is to reuse
   `roles_permissions:view/create/edit`, because notification rules affect
   organization-wide recipient behavior and the existing catalog has no generic
   configuration module. A dedicated `notification_rules` catalog module would be
   cleaner for least privilege but expands the catalog and bootstrap matrix. If
   separate delegation is required, approve that alternative before coding.
5. **Notification delivery versus later access loss.** A recipient may lose a
   share after a notification is created. The plan keeps the minimal notification
   as history and lets current Lead authorization block navigation; it does not
   delete the notification or leak fields.
6. **Seed examples need deployment parameters.** There is no repository seed
   system or assignment-type master today. An idempotent command with explicit
   organization/assignment parameters is safer than migration-time seed rows with
   guessed IDs or names. If automatic environment seeding is required, its
   configuration source must be supplied before implementation.
7. **Synchronous evaluation cost.** Transactional evaluation gives exact audit/
   notification consistency but a broad feature-permission resolver can inspect
   many users. Repository queries must be set-based and indexed; if measured write
   latency approaches the one-second quality target, introduce a transactional
   outbox in an amended plan rather than silently weakening consistency.
8. **Share creator resolver parameter.** “The user who created a specific active
   share” requires the rule/resolver to identify the share recipient or share ID.
   The proposed parameter is the shared-user ID, resolved to that user's current
   active share and its `granted_by_user_id`, because share IDs change across
   revoke/re-share history. Confirm this interpretation during approval.
9. **Scope section renames.** Field section is currently a mutable string. Rules
   scoped to it will follow the current configured string; renaming a section can
   leave a rule unmatched. The admin UI must warn and validation must expose
   configured choices. A stable Section entity is outside this phase.
10. **Actual implementation size is large.** This is a database, permission
    engine, Lead lifecycle, rule engine, three API surfaces, and four frontend
    surfaces with real-Postgres coverage. It should be implemented in reviewable
    commits after approval, but it remains one coherent Phase 9 contract. If code
    discovery reveals a new ownership model, outbox, or assignment-type master is
    necessary, stop and amend the plan instead of narrowing tests or UI.

No conflict was found between raw spreadsheets/example data and the reconciled
documentation because no raw business data was used for this plan.

## Test plan

Per `docs/testing/quality-gates.md`, add and actually run the following after
implementation. Do not report a layer as passing unless its command completed in
this environment.

* Permission-engine unit/matrix tests proving an out-of-scope synthetic user can
  view via a view share, cannot edit or comment beyond granted actions, gains only
  the replaced capability set, and loses list/detail/mutation access on revoke or
  expiry. Cover role feature denial, Journey denial, Field denial, inactive user,
  cross-tenant rows, and list/count predicate parity.
* Real-Postgres Lead integration tests for share create/update/revoke and audit;
  “shared with me” filtering/count parity; view-only edit rejection at the API;
  comments; reassignment row history plus exact `reassignment` old/new values;
  `leads:delete` deactivation, inactive-row exclusion, share revocation, and
  append-only deactivation activity.
* Real-Postgres resolver tests for current assignment holder, holder's direct
  manager through a multi-level/cross-tenant hierarchy fixture, previous holder,
  active-share creator, all active shared users except actor, and feature-
  permission holders. Use only neutral synthetic assignment, Field-section, role,
  Journey, and Status values.
* A full real-Postgres shared-edit flow in which one shared user edits, producing
  exactly the configured owner and other active shared users once each—not the
  actor, revoked/expired shares, inactive users, or cross-tenant users. Verify
  idempotency on retry and transaction rollback on failure.
* Notification-rule configuration integration tests for tenant isolation,
  validation, ordering, versioning, soft deactivation, and system audit old/new
  values. Notification inbox tests cover pagination, unread count parity,
  current-user isolation, idempotent mark-read, and minimal payloads.
* HTTP contract/OpenAPI tests for all new endpoints, invalid capability/trigger/
  resolver shapes, authentication, authorization, tenant isolation, and error
  envelopes.
* Web Testing Library/MSW tests for the share dialog capability controls and
  revoke flow, Shared indicators, access-mode URL/filter behavior, notification
  count/list/read/navigation, admin rule forms/reordering, permission-hidden
  actions/routes, loading/error/empty states, and keyboard/focus accessibility.
* Run `pnpm --filter @falcon/permission-engine test`, targeted API unit/HTTP tests,
  targeted real-Postgres integration tests, `pnpm --filter @falcon/web test`,
  `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and
  `pnpm format:check`.
* Manually exercise synthetic users with no scope, view-only share, edit share,
  comment share, owner/config administrator permissions, and revoked access at
  desktop and mobile widths. Capture screenshots of every requested perceptible
  web surface. Run keyboard and accessible-name/focus checks; report any manual
  or environment-limited check honestly.

## Rollback plan

* Before deployment, take a database backup. Deploy database additions before
  application code that reads them; during rollback, remove application readers
  before applying the SQL rollback.
* The migration rollback drops notification-rule/provenance structures and the
  action-scoped grant constraint/column, and removes Lead deactivation columns
  only after a preflight confirms no post-deployment data would be lost. If any
  rule, notification provenance, non-view capability, or deactivated Lead exists,
  the rollback script must abort with a documented message rather than silently
  discard or reactivate data.
* Existing notifications and grants are preserved where their pre-phase columns
  remain compatible. If action-scoped grants must be mapped back, only grants
  containing `view` may become legacy visibility grants; edit/comment-only data
  cannot be broadened and therefore blocks automated rollback.
* Application rollback is a coordinated revert of permission-engine, API, web,
  docs, and seed-command changes. Never delete Lead activity or system audit rows;
  retain them as append-only history even if the feature is disabled.
* If a safe destructive schema rollback is not possible after production use,
  leave additive columns/tables in place, deactivate all Notification Rules,
  disable new routes/UI, and perform a forward fix. Document that operational
  choice before running rollback.
