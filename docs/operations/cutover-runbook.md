# Cutover runbook — moving from Cronberry to Falcon

The one-time cutover (Phase 24, plan D13) sets Falcon up from a configuration
file and migrates the leads from the legacy exports. Everything Wellsure-specific
lives in the configuration file; the script only knows the *shape* of the data.

## What you need

| Input | What it is |
| --- | --- |
| Configuration file (JSON) | Departments, roles (permissions, journey limits, reporting lines), journeys (members, statuses with colors, reasons, allowed roles, required fields, auto-assignment), fields (types, options, journeys, per-role visibility, required-on-create). Shape: `docs/migration/cutover-config.example.json`. **The real file names people and is never committed.** |
| Users file | The user list copied from the legacy user-management screen (serial number, name, then `email⇥role⇥level⇥status`). Roles are matched by `roles[].sourceName`. |
| Export workbooks | One `.xlsx` per journey, exactly as exported. Columns in `excludedColumns` (always including `pass`) are dropped when the file is read and never stored, logged or reported. |
| An administrator | An active Falcon user in the organization (normally the bootstrap administrator). Every change is audited against them. |

## Steps

1. **Bootstrap** the organization if it is new (`pnpm --filter @falcon/api bootstrap -- …`,
   see `docs/getting-started.md`).
2. **Dry run.** Nothing is saved; the report shows exactly what a commit would do,
   because the dry run executes everything inside a transaction and rolls it back.

   ```bash
   pnpm --filter @falcon/api cutover -- \
     --config /secure/path/cutover-config.json \
     --users /secure/path/users.txt \
     --export amazon_b2b=/secure/path/b2b.xlsx \
     --export account_management=/secure/path/am.xlsx \
     --export unique=/secure/path/unique.xlsx \
     --actor-email admin@your-domain \
     --report /secure/path/cutover-dry-run
   ```

3. **Read the report** (`…-dry-run.md`, details in `.json`). Check:
   - *Reconciliation* says **balanced**: source records = process instances + already
     migrated + rejected.
   - *Unmapped statuses*: add the spelling to that status's `aliases` and re-run.
   - *Values dropped*: usually a dropdown value missing from a field's `options`.
   - *Placeholder accounts*: former owners who are not in the users file. Their leads
     stay attributed to an inactive account their managers can see and reassign.
   - *Review queue*: possible duplicates that were deliberately **not** merged (ADR-0027).
     Merge them by hand afterwards if they really are one seller.
   - *Configuration notes*: decisions left to the business owner.
4. **Commit.** Add `--commit`. The whole cutover is a single transaction, so it lands
   completely or not at all. Add `--send-invites` to email every active migrated user
   a set-password link (the same flow as **Resend invite**).
5. **Re-running is safe.** Records are matched by `external_ref`
   (`<source>:<record id>`), configuration by key, and users by email. A second run
   creates nothing that already exists and changes only configuration that differs
   from the file.

## After the cutover

- Look through **Admin → Journeys → Members & access** for anyone missing from a
  journey's member list.
- Imported remarks show up in each lead's timeline as comments. Follow-up dates show
  up as open follow-ups for the lead owner.
- To undo the cutover on a fresh database, restore the pre-cutover backup. Falcon never
  hard-deletes leads.
