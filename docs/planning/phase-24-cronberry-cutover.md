# Phase 24 — Cronberry cutover: real configuration, engine gaps, migration, admin consolidation

Status: **approved 2026-10-15** (decisions D1–D4 answered by the product owner;
D5–D14 decided in implementation under the instruction to "decide what all
features are important"). Recorded as ADR-0025, ADR-0026 and ADR-0027.

## Goal

Move Wellsure off Cronberry: reproduce its real configuration (6 journeys, 89
statuses, 47 fields, 30 roles, 161 users) in Falcon, close the engine gaps that
configuration exposed, migrate the three supplied exports with an auditable,
re-runnable one-time script, and consolidate the scattered admin screens into
one administration area.

## Docs read

`AGENTS.md`, `PLANS.md`, every file under `docs/requirements/`,
`docs/data-model/schema.md`, `docs/data-model/prisma-translation-notes.md`,
`docs/permissions/*`, `docs/workflows/journey-definitions.md`,
`docs/migration/cronberry-mapping.md`, `docs/api/endpoints.md`, ADR-0001 to
ADR-0024, `docs/guides/*`, `docs/operations/*`, and phase plans 19–23.

## Source material (never committed)

The product owner supplied, out of band:

- `CRON-CONFIGS.zip` — 196 screenshots of every Cronberry journey, status,
  field and role-permission screen, plus `users.txt`, `Roles.txt`,
  `all-attributes.txt`, `field-basic-rules.txt`,
  `field-config-hidden-details.txt` and `handle-repeat-rules.txt`.
- Three exports: Amazon B2B (3,661 rows), Account Management (240 rows),
  Unique (65 rows). Audience, SPN and Business Development New have
  configuration but no export.

They contain real personal data and stay out of git (`AGENTS.md`). Everything
transcribed from them lives in one file, the **cutover config**, which the
operator keeps beside the exports. The repository carries only its schema,
a synthetic example, and the code that applies it.

## What the real data showed (investigation)

1. **Cronberry's hierarchy is role-based.** `Roles.txt` gives every role a
   "Report To" list (a DAG — Operations Executive reports to both Team Leader
   and Operations Manager). A user sees leads owned by users whose role sits
   below theirs. Users carry no manager. Falcon's `TEAM` scope and Status
   Visibility's "manager chain" both read `users.manager_id`, which would be
   empty for every migrated user.
2. **A phone number is not a seller.** In Amazon B2B 225 phone numbers repeat;
   only 60 of those groups share a name, and one number carries 11 different
   GST-registered businesses entered the same day. ADR-0004's "phone alone"
   match would merge different marketplace accounts, contradicting ADR-0002.
3. **Permissions are per journey.** Each role ticks View/Update/Add/Delete/
   Download/Bulk-reassign/Share/Move/Documents separately per journey. Falcon
   has role-wide actions plus a journey allow-list, which is the
   "feature × journey" axis `v1-scope.md` lists as a must-have but never built.
4. **Journeys have member lists.** Each Cronberry category has its own user
   list on top of role permissions.
5. **Statuses carry rules Falcon lacks**: a colour, *Allowed Roles* (who may
   move a lead into it), *Mandatory Attributes* (checked on entry, many
   statuses per field — Falcon allows one `required_from_status_id`), a
   comma-separated *Tag* list of reasons, and a fifth type, *Completed*.
6. **Fields carry rules Falcon lacks**: dropdown values (one field is
   genuinely multi-valued), mandatory-for-specific-roles, hide-for-roles, and
   "Is Editable" (= locked once set).
7. **Follow-ups are central.** 1,313 exported leads carry a follow-up
   date-time; Cronberry's Follow Up / Call Later types exist to drive it.
   Falcon's Tasks module was never built (`packages/workflow-engine` is empty).
8. **About 260 rows are owned by 23 people absent from the user list**
   (former staff), and two current users share a display name — owners must
   resolve by exact name with ambiguity reported, never guessed.
9. Data defects to report, not silently fix: 606 B2B rows sit in a status
   ("1st Order Done") that no longer exists; 343 B2B rows have no name; ~454
   have no phone; dropdown values appear both as `[x]` and `x`; mandatory
   attributes reference 13 fields that were removed from the final list.

## Decisions

### D1 — Role reporting lines and a "Reporting roles" scope (owner: approved)

Roles gain a many-to-many "reports to" relation (`role_reporting_lines`). A new
`DataScope` value, `REPORTING_ROLES`, resolves to the caller plus every user —
active or not — whose role is a descendant of the caller's role. Inactive
users are included deliberately: their leads stay visible to the managers who
must reassign them. Status Visibility's "assignee's hierarchy ancestors"
(ADR-0020) becomes the union of the manager chain and role ancestors, so a
routed lead stays visible to the roles above its assignee. `TEAM` keeps its
ADR-0006 meaning. **ADR-0025.**

### D2 — Safe deduplication (owner: approved)

Every Cronberry record becomes its own Falcon lead (Cronberry's "Override
repeat rule" behaviour, and counts reconcile 1:1). Records in *different*
journeys merge into one multi-journey lead only when the normalized phone
matches **and** at least one of name, email or GST also matches, and the group
has at most one record per journey. Phone-only matches are reported for
manual review. Amends ADR-0004. **ADR-0027.**

### D3 — Former owners become inactive placeholder users (owner: approved)

Each unresolved owner name becomes a deactivated user
(`former+<slug>@<configured placeholder domain>`, no password, cannot log in)
holding a role from the config. Ownership history stays true; the migration
report lists them for bulk reassignment.

### D4 — Build all four engine gaps (owner: approved, "decide what is important")

Journey-limited actions, journey members, status rules, follow-ups. Detailed
in D5–D10.

### D5 — Journey-limited actions

`role_permissions.journey_ids uuid[]`, empty = every journey the role can
access. The engine denies a single-record check whose journey is outside the
list and narrows the list-predicate journeys to it. Export additionally
intersects with the `leads:export` grant's journeys. **ADR-0026.**

### D6 — Journey members

`journeys.restrict_to_members` (default `false`, so existing deployments are
unchanged) and `journey_members`. When restricted, journey access requires
role access **and** membership. Mapped from each category's User List.
**ADR-0026.**

### D7 — Status rules

- `statuses.color` (palette token) and `statuses.reason_options text[]`;
  `process_instances.status_reason` holds the chosen reason, cleared on the
  next status change; the activity row records it.
- `status_allowed_roles` — an allow-list with the Status/routing default
  ("no rows = unrestricted", ADR-0019/0015). Enforced when a request
  *chooses* a status: a status change, an explicit create/move/import status.
  Landing in a journey's default status on create is never blocked (a
  Cronberry role that may add leads but not pick "Interested" must still be
  able to add). System moves (routing, status consolidation) are exempt.
  New catalog action `leads:bypass_status_rules` (bootstrap-granted, like
  `bypass_status_visibility`) skips the allow-list for oversight roles.
- `status_required_fields` — Fields that must hold a value to **enter** the
  status. Checked on transition only, never on later edits of a lead already
  sitting there: Cronberry's semantics, and the only rule migrated leads can
  live with (thousands sit in statuses whose mandatory fields are empty).
  Requirements naming removed fields are dropped and reported.
- Cronberry's fifth type, *Completed*, has no behaviour of its own: it maps
  to `behavior_type = default` plus a closed `outcome_type`. **ADR-0026.**

### D8 — Field rules

- Field types are validated against the supported list on create (closes
  OD-020) and gain `multi_select` (array of option strings) and `datetime`
  (ISO-8601 with time). Both get filter operators.
- `field_journey_settings` gains requirement `required_on_create` and
  `required_role_ids uuid[]` (empty = every role): Cronberry's
  "Is mandatory (for roles)". Enforced when the acting user's role matches,
  on lead creation only — enforcing it on every edit would lock every
  migrated lead that lacks the value.
- Cronberry "Hide attribute for role" → `field_visibility` rows for every
  *other* role (EDIT, or VIEW when not editable); "Is Editable = off" →
  `edit_mode = locked`. "Allow back date" is on for every date field, so no
  rule is needed.

### D9 — Follow-ups (Tasks v1)

The existing `tasks` table gains `note`, `completed_at`,
`completed_by_user_id`. A status change may carry `followUpAt` (+ note):
any open follow-up on that process instance is closed as `rescheduled` and a
new one is created for the acting user. `GET /tasks` (mine: overdue / today /
upcoming / done), `PATCH /tasks/:id` (complete, reschedule) and
`GET /leads/:id/tasks`. Completing someone else's task needs `leads:edit` on
the lead. Entering a Follow Up / Call Later status prompts for a date in the
UI. Migration turns `lead_followdate` into an open follow-up for the lead
owner and keeps `lead_last_followdate` as a `datetime` field.

### D10 — Activity history

`Remarks` lines (`<timestamp> :- <text> (<actor>)`, `<br/>`-separated) become
backdated `comment` activities, source `migrated_cronberry_remark`, actor
resolved by exact name or left null with the name kept in the text. Status
text inside a remark is **not** turned into a `status_change` row — the lines
are free text and the label match would be guesswork (the same rule OD-006
applies).

### D11 — Excluded data

`pass` is dropped at read time and never touches memory beyond the parser,
logs, reports or the database (`AGENTS.md`). `message` (OD-019) and `updated`
(OD-015) are not migrated; the report counts them. Requirements on the 13
removed fields are dropped.

### D12 — Admin consolidation

One sidebar entry, **Admin**, opens an administration area with its own
grouped navigation — *Pipeline* (Journeys & statuses, Fields), *People*
(Users, Org chart, Departments & teams, Roles & permissions), *Automation*
(Routing overview, Notification rules, Campaigns), *Data* (Import, Migration
report). Personal settings move to the user menu. The Journey page becomes a
tabbed editor: Statuses (with the new status rules), Fields, Members & access,
Routing.

### D13 — One-time setup script

`pnpm --filter @falcon/api cutover -- --config <file> --users <users.txt>
--export <journeyKey>=<file.xlsx> … --actor-email <admin> [--commit]
[--send-invites] [--report <prefix>]` — dry run by default. It applies
configuration idempotently (matched by key, never by display name), creates
users (no invitation mail unless `--send-invites`), then migrates the leads.
**The whole run is one transaction**: a dry run executes everything and rolls
back, so its report is exactly what a commit would do, and a commit lands
completely or not at all. Every change is audited against `--actor-email`.
Every run writes a
JSON + Markdown report: source / created / merged / skipped / rejected counts
per file, unresolved owners, review-queue duplicates, dropped requirements,
status mismatches. Re-running with `--commit` after a successful commit is a
no-op for existing records (`process_instances.external_ref =
'cronberry:<audience_id>'` is matched first, ADR-0004 priority 1). The `.xlsx`
exports are read as supplied by a small reader on `node:zlib`
(`cutover/xlsx.ts`) — **no new dependency**: the exports use namespace-prefixed
SpreadsheetML without package relationships, which `exceljs` (the first
choice) refuses to open.

The configuration file's shape is documented by the committed synthetic
example `docs/migration/cutover-config.example.json` (validated in CI). The
real Wellsure file names real people, so it is generated outside the
repository and never committed.

### D14 — Departments

Cronberry has none. The config groups roles into departments by function
(Sales, Operations, Account Management, Suspensions, Business Development,
SPN, Amazon B2B, Accounts) so the Users screen is navigable; this has no
access effect (visibility follows D1).

## Status outcome mapping (configuration, editable)

`outcome_type` drives reporting and least-loaded routing only. Defaults in the
cutover config: Completed + positive meaning → `closed_won` (Launched, PLE
Completed, Payments Done, 1st Order Done Ready For Audit); negative names →
`closed_lost` (Not Interested Post 1st Order, Drop, Low Potential Seller,
Unable To Launch, Black Listed, Lost, Final Audit Failed Lost, Not Working Or
Drop Or Refund Required, Completed-type Not Interested); everything else `open`.

## Data conflicts flagged (not silently resolved)

| # | Conflict | Handling |
| - | --- | --- |
| C1 | ADR-0004 phone-alone match vs. data (shared phones) | ADR-0027 |
| C2 | 606 B2B rows in removed status "1st Order Done" | Config maps them to "1st Order Done Ready For Audit" via that status's `aliases`; reported, adjustable |
| C3 | 13 mandatory attributes reference removed fields (incl. `pass`) | Requirement dropped, reported |
| C4 | Two Account Management "Not Interested"/"Not Working" tag lists are truncated in the screenshots | Imported as visible; flagged for the admin to complete |
| C5 | `cronberry-mapping.md` §3.4 says remark lines naming a status become `status_change` | D10: comments only; the mapping doc is updated |
| C6 | "Audit Date" is mandatory for *every* role in Cronberry | Not applied as required-on-create: it would block every lead added in Audience and Unique, including API-sourced ones. Left optional and flagged in the config `notes` for the owner to decide |

## Files to touch

Schema: `packages/database/prisma/schema.prisma`, migration
`00000000000008_cutover_engine_rules/{migration,rollback}.sql`.
Engine: `packages/permission-engine/src/{types,scope,decision,catalog}.ts` + tests.
API: `apps/api/src/permissions/prisma-permission-repository.ts`,
`configuration/{validation,service,prisma-configuration-repository}.ts`,
`admin/*` (reporting lines, journey limits, members),
`leads/{service,validation,filter-model,filter-validation,filter-sql,prisma-lead-repository}.ts`,
new `tasks/*`, `routes/*` and `http/routes/*` for the new endpoints,
new `cutover/*` CLI, `package.json` (`cutover` script).
Web: sidebar + new `pages/admin/AdminLayout`, journey/status/role/field
editors, status-change prompts, `pages/follow-ups/*`, types and API client.
Docs: this plan, ADR-0025/26/27, `access-model.md`, `schema.md`,
`endpoints.md`, `cronberry-mapping.md`, guides, README/getting-started drift.

## Out of scope

Finance (Accounts role's invoices/quotations), Cronberry integrations
(JustDial/IndiaMart/…), SMS/WhatsApp/push campaigns, segments, call assist,
catalogue, repeat-lead *blocking* (no journey uses "Block"), attachment
migration (the exports carry links, not files), bulk actions.

## Risks / open questions

1. Screenshot transcription can be wrong; the config is a reviewable file and
   every value is editable in the admin UI after cutover.
2. Role-tree visibility widens what managers see compared with a sparse
   manager chain — intended (it is Cronberry's behaviour), recorded in ADR-0025.
3. Status rules apply to every write path; an admin locked out of a status by
   its allow-list uses `leads:bypass_status_rules`.
4. Follow-ups are assigned to the person who schedules them, not the owner.

## Test plan

Engine: table-driven tests for `REPORTING_ROLES` (DAG, cycles, inactive users),
journey members, journey-limited actions, status-visibility ancestor union.
API (real Postgres): status rules on every write path, field rules, multi-select
and datetime validation and filtering, follow-ups, export journey narrowing.
Cutover: unit tests on parsing (remarks, brackets, numbers, dates, `pass`
exclusion), dedup grouping, owner resolution; an end-to-end dry-run + commit
on synthetic fixtures; idempotent re-run. Web: admin layout navigation,
status editor, status-change prompts, follow-ups page.

## Rollback plan

Migration `00000000000008_cutover_engine_rules` is additive except one enum value; its
`rollback.sql` drops the new tables/columns and recreates `DataScope` without
`REPORTING_ROLES` (after rewriting any such grants to `TEAM`). A committed
cutover is reversed by restoring the pre-cutover snapshot the runbook requires
taking first.
