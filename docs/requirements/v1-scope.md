# V1 Scope

## Must have

- Auth, session management (provider TBD — see ADR-0005), user activation/deactivation
- Admin-configurable roles and permissions (feature × journey × data-scope × field-level)
- Departments, teams, reporting hierarchy with cascading visibility
- Journey builder (create/edit/deactivate Journeys)
- Status builder per Journey (`outcome_type`, `behavior_type`, ordering, safe deletion with reassignment)
- Service master + per-lead service enrollment
- Custom field builder: types, validation, per-Journey requirement rules (required/optional/hidden), conditional "required from status X" logic, edit modes (manual/locked/calculated/system/api-only), field-level role visibility
- Lead/Seller creation and editing with dynamically rendered forms
- Multi-Journey lead membership, linked across Journeys
- Lead List (Seller List): server-side search/filter/sort/pagination, saved views, bulk reassign, bulk status change, export
- Lead Detail (Seller 360): dynamic field sections, status control with confirmation of side-effects, activity timeline, attached services, linked leads, attachments
- Tasks & reminders, auto-created from `call_later`/`follow_up` status behavior
- Full append-only activity log (lead-level) and system audit log (config-level)
- Document upload (S3), versioning, permission-checked access
- Cronberry Excel/CSV import: staged preview, validation, dedup, resumable commit, error export (see `docs/migration/cronberry-mapping.md`)
- Permission-safe bulk export
- Finance: invoices + payments/outstanding balances (confirmed scope — see ADR-0003)
- Core dashboards: pipeline value, conversion by status, rep leaderboard, forecast
- Email sending + email activity logging
- AWS deployment, monitoring, backups, restore procedure

## Explicitly deferred (do not build in V1)

- WhatsApp, SMS, IVR automation
- Landing page / form builder
- Marketing drip automation
- Amazon SP-API, Amazon Ads API integration
- AI/RAG assistant
- Predictive lead scoring
- Renewal-schedule engine and payout calculation (beyond basic invoice/payment tracking)
- Full accounting-system integration
- Native mobile app
- Self-serve analytics/report builder (Phase 2 — fixed dashboards only for V1)
- Public multi-tenant SaaS behavior (schema supports it via `organization_id`, but V1 ships single-tenant)

## Exit criteria for V1

- Admin can create a brand-new Journey, attach fields to it, define its statuses, and put a real lead through it — with zero code changes.
- A representative Cronberry export migrates with reconciled counts (source / inserted / updated / duplicate / rejected).
- Permission tests pass across all real starting roles, including field-level hiding enforced server-side.
- Seller List performs within target (see `docs/testing/quality-gates.md`) against a synthetic 200k-record dataset.
