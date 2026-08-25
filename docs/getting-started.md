# Getting started — local development

How to go from a fresh clone to a running Falcon CRM with an administrator you
can log in as.

This guide was written by doing the setup on a clean clone and recording what
actually happened, including the two places it fails if you do the obvious
thing. Where a step could not be verified in the environment it was written in,
it says so rather than guessing.

**Time:** about ten minutes, most of it `pnpm install` and `pnpm build`.

---

## 1. Prerequisites

| | Version | Why this one |
| --- | --- | --- |
| Node.js | **24.x** | `package.json` sets `engines.node` to `>=24 <25` and pnpm enforces it. |
| pnpm | 10.28.1 | Pinned by `packageManager`; `corepack enable` installs exactly this. |
| Docker Engine | with Compose v2 | Runs PostgreSQL, Redis and MinIO locally. |
| Terraform | 1.11+ | Only for `infra/terraform`. Not needed for application work. |

Node 24 is not a suggestion. On Node 22 the install stops before doing anything:

```
 ERR_PNPM_UNSUPPORTED_ENGINE  Unsupported environment (bad pnpm and/or Node.js version)
Expected version: >=24 <25
Got: v22.22.2
```

## 2. Clone and install

```bash
git clone <repository-url>
cd WELLSURE-CRM
corepack enable
cp .env.example .env
pnpm install --frozen-lockfile
```

`.env` is gitignored. The values in `.env.example` are local-only credentials;
never reuse them anywhere real.

**You will see this warning, and it is fine:**

```
╭ Warning ────────────────────────────────────────────────────────────╮
│   Ignored build scripts: argon2@0.45.1, core-js@3.50.0, …           │
│   Run "pnpm approve-builds" to pick which dependencies should be    │
│   allowed to run scripts.                                           │
╰─────────────────────────────────────────────────────────────────────╯
```

`argon2` is the one that matters — it hashes passwords — and it ships prebuilt
binaries, so it works without its build script. Verified on linux-x64: hashing
and verifying both succeed on a clean install with the scripts left blocked. If
you are on a platform with no prebuilt binary and password hashing fails at
runtime, `pnpm approve-builds` and select `argon2`.

## 3. Start the local services

```bash
pnpm infra:up
```

This starts PostgreSQL, Redis and MinIO, waits for the three to report healthy,
then runs the one-shot MinIO bucket initializer.

> **Not verified while writing this guide.** The environment it was written in
> had no Docker daemon, so the setup below was completed against a PostgreSQL
> installed directly instead. Every other step in this guide was run for real.
> If `pnpm infra:up` behaves differently from what is written here, trust what
> you see and correct this section.

Defaults are PostgreSQL `localhost:5432`, Redis `localhost:6379`, MinIO
`localhost:9000` with its console on `9001`. If a port is taken, change the
matching `*_PORT` in `.env` and re-run.

Redis is started but nothing reads it — no `REDIS_URL` reader exists anywhere in
the source. MinIO is genuinely optional: without the five `S3_*` variables the
API still boots and the document locker answers `503` (ADR-0012).

Other service commands:

```bash
pnpm infra:logs    # follow logs
pnpm infra:down    # stop, keep data
pnpm infra:reset   # DESTRUCTIVE: stop and delete volumes
```

## 4. Create the schema

```bash
pnpm --filter @falcon/database prisma:deploy
```

```
1 migration found in prisma/migrations

Applying migration `00000000000000_baseline`
All migrations have been successfully applied.
```

There is one migration. Phase 17 squashed the previous nine into a single
baseline that describes the whole schema; see
`docs/data-model/prisma-translation-notes.md`.

> ### Gotcha: an exported `DATABASE_URL` silently wins
>
> The Prisma CLI loads `.env` through `dotenv`, which never replaces a variable
> that is **already set in your shell**. Cloud dev containers and CI images
> commonly export one. When that happens, migrations are applied to *that*
> database while the API — which reads `FALCON_DATABASE_URL` — talks to yours,
> and nothing warns you.
>
> This happened while writing this guide: `prisma:deploy` reported "No pending
> migrations to apply" against a database that had never been migrated, because
> an inherited `DATABASE_URL` pointed somewhere else.
>
> The datasource banner Prisma prints names the database it is really about to
> write to. Read it. When in doubt:
>
> ```bash
> env | grep DATABASE_URL          # should print nothing
> ```

## 5. Create the first organization and administrator

```bash
pnpm build
pnpm --filter @falcon/api bootstrap -- \
  --organization-name "Wellsure Solutions" \
  --admin-name "Local Administrator" \
  --admin-email "admin@wellsure.local"
```

> ### Gotcha: `pnpm build` first, or bootstrap fails
>
> On a clean clone, running the bootstrap command on its own fails with a wall
> of TypeScript errors:
>
> ```
> src/runtime.ts(1,61): error TS2307: Cannot find module '@falcon/database'
> ```
>
> The `bootstrap` script compiles `apps/api` only, and `apps/api` needs
> `@falcon/database`'s generated Prisma client and compiled output, which do not
> exist yet. The root `pnpm build` runs the workspace in dependency order and
> produces them. After the first build you do not need to repeat it.

The command prints the organization UUID and a setup token:

```
Reset token: KpukGqJuKIKR7-6DDPCJ5UP5nnsIF1a6eMNwNJ6KR3E
Complete password setup (replace the password placeholder):
curl --request POST 'http://localhost:3000/api/v1/auth/password-reset/complete' …
Bootstrap complete for organization ee7842ca-89e3-4227-8ac3-87668ee7e447.
```

`FALCON_EMAIL_TRANSPORT=console` is why the token appears in your terminal
instead of being emailed. **Treat that output as a credential.**

This command refuses to run twice — it is not a recovery tool:

```
Bootstrap refused: the database already contains 1 organization(s) and 1 user(s).
```

## 6. Point the web app at that organization

Copy the UUID from step 5 into `.env`:

```bash
VITE_FALCON_ORGANIZATION_ID=ee7842ca-89e3-4227-8ac3-87668ee7e447
```

V1 is single-tenant and the login endpoint still takes an `organizationId`, so
the frontend carries one fixed value (`apps/web/src/lib/constants.ts`). Vite
substitutes it **at build time**, and the app throws on load without it.

> The monorepo keeps one `.env` at the root, but Vite reads `.env` from its own
> root — `apps/web` — so this variable used to be invisible to it and the built
> app failed in the browser with `VITE_FALCON_ORGANIZATION_ID is required`.
> `apps/web/vite.config.ts` now sets `envDir` to the repository root, so editing
> the root `.env` is enough. No `apps/web/.env` is needed.

## 7. Run it

```bash
pnpm dev
```

That starts the services and the watch tasks. To run the two servers separately:

```bash
pnpm --filter @falcon/api dev     # API on http://localhost:3000
pnpm --filter @falcon/web dev     # web on http://localhost:5173
```

Check the API is up:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

Then open <http://localhost:5173> and set the administrator's password using the
token from step 5:

```bash
curl --request POST 'http://localhost:3000/api/v1/auth/password-reset/complete' \
  --header 'content-type: application/json' \
  --data '{"token":"<token from step 5>","newPassword":"<a strong password>"}'
```

Log in with the administrator's email and that password.

Notes on the dev server, both verified:

- Vite proxies **`/api` only**, to `localhost:3000`. `/health` is not proxied, so
  `http://localhost:5173/health` returns the app shell — check health on port
  3000.
- The API does not read `.env` by itself. The `dev`, `start` and `bootstrap`
  scripts pass `--env-file=../../.env` to Node. Running
  `node apps/api/dist/main.js` directly, without that flag, fails on missing
  variables. Deployed environments inject them as real environment variables,
  which is why nothing in the application code needs a change there.

## 8. Confirm it works end to end

The whole loop, run against a clean clone while writing this:

```
complete password setup   -> 204
login                     -> 200
auth/me                   -> 200
roles users journeys fields services permissions/catalog -> 200 200 200 200 200 200
```

## Quality gates

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` skips the PostgreSQL integration suites unless a database is
available. To run them:

```bash
FALCON_POSTGRES_URL=postgresql://falcon:falcon_local_only@localhost:5432/falcon_test pnpm test
```

Without it you will see roughly 60 tests skipped and no indication that anything
is missing.

## After pulling someone else's changes

Dependencies, the generated Prisma client and the schema drift independently.
Run the steps whose inputs actually moved:

```bash
pnpm install --frozen-lockfile                  # only if pnpm-lock.yaml moved
pnpm infra:up                                   # services must be running
pnpm --filter @falcon/database prisma:deploy    # only if prisma/migrations/ changed
pnpm build                                      # regenerates the Prisma client, then compiles
```

`pnpm build` runs `prisma generate`, so a separate generate step is redundant
after it. Skipping the build is what produces type errors about models that
plainly exist in `schema.prisma`.

Confirm the database matches what is checked in:

```bash
pnpm --filter @falcon/database exec prisma migrate status --config prisma.config.ts
```

## Troubleshooting

**A port is already in use.** Change the matching `*_PORT` in `.env` and re-run
`pnpm infra:up`. For the API, `EADDRINUSE` on 3000 usually means an earlier
`pnpm dev` is still running.

**The database needs a clean replay.** `pnpm infra:reset`, then `pnpm infra:up`
and `prisma:deploy`. This deletes all local data. The baseline migration's
`rollback.sql` also drops everything, and is meant only for disposable
databases.

**The MinIO bucket is missing.** `docker compose logs minio-init`. The
initializer is idempotent; re-run with `docker compose up minio-init`.

**Prisma cannot download an engine.** Check access to `binaries.prisma.sh`. Do
not bypass checksum validation.

**`prisma migrate diff` wants to change everything.** It always does — including
a `DROP INDEX "leads_field_values_gin_idx"` that must never be applied. See
`docs/data-model/prisma-translation-notes.md` for the full list of expected
divergences before acting on any diff output.

**On Windows:** PowerShell aliases `curl` to `Invoke-WebRequest`, which does not
accept the flags in this guide. Use `curl.exe` explicitly, or run the commands
under WSL. *(Not verified — this guide was written on Linux. The other
Windows-specific problem this project once had, path handling in an
`import.meta.url` comparison, was fixed: `bootstrap-cli.ts` uses
`pathToFileURL(process.argv[1]).href`, which is correct on Windows.)*

## Where to go next

- `AGENTS.md` — the rules that matter before changing anything.
- `docs/requirements/source-of-truth.md` — why journey and field names are data,
  never code.
- `docs/operations/environment-variables.md` — every variable, what it is for.
- `docs/operations/deployment.md` — how the deployed environment is run.
