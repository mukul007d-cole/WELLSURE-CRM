# AGENTS.md — Falcon CRM

## Read this before any task

Falcon is a **configurable CRM engine** for Wellsure Solutions, replacing Cronberry. The single most important rule on this project:

**Every journey, status, field, role, and department name you'll see in `docs/` is example/seed data, not a hardcoded requirement.** They come from Wellsure's real current usage, used to design and seed the system — not to bake business logic in. If your implementation only works because a journey is literally named "Overlapping" or a field is literally named `gst_number`, that's a bug. See `docs/requirements/source-of-truth.md` for the full framing — read it first, every time.

## Read first, every task

1. `docs/requirements/source-of-truth.md`
2. `docs/requirements/glossary.md`
3. `docs/requirements/v1-scope.md`
4. Any `docs/architecture/decisions/*.md` relevant to the task
5. The specific `docs/` file(s) for the module being touched

## Repository layout

```
falcon-crm/
├── apps/{web,api,worker}
├── packages/{database,contracts,permission-engine,workflow-engine,validation,ui,observability,test-support}
├── docs/{requirements,architecture/decisions,data-model,permissions,workflows,api,migration,testing,operations}
├── infra/terraform/
```

## Commands

- Setup: (fill in once scaffolded — e.g. `pnpm install`)
- Dev: `pnpm dev`
- Test: `pnpm test`
- Lint: `pnpm lint`
- Type-check: `pnpm typecheck`
- Build: `pnpm build`

## Non-negotiable rules

- **Authorization is enforced in the API, never only in the UI.** Every response strips fields/records the requester's role/scope/journey-access doesn't permit, per `docs/permissions/access-model.md`.
- **Every material mutation writes an audit event** — `activity_logs` for lead-level changes, `system_audit_logs` for configuration changes (roles, fields, journeys, statuses, users).
- **Nothing is hard-deleted.** Journeys, statuses, fields, services, and roles get deactivated/versioned. Deleting a status with active leads is blocked until they're reassigned.
- **No hardcoded business data in application logic.** Journey names, status names, field names, role names — all live in the database as configuration, never as enum values or string literals in application code (beyond seed/migration scripts).
- **The `pass` field and any plaintext credentials from the legacy Cronberry export are never migrated or stored anywhere.**
- Do not introduce a new production dependency without explaining why in the PR/diff description.
- Do not edit files unrelated to the task's stated scope.
- Do not store secrets, tokens, or real personal data in git.
- Database migrations must be reversible or have a documented rollback path.

## Definition of done

See `docs/testing/quality-gates.md`. Every task must satisfy that checklist before being considered complete — not just "the code runs."

## When something in the spreadsheets/example data conflicts with these docs

Stop and flag it. Do not silently pick one. See precedence order in `docs/requirements/source-of-truth.md`.
