# Falcon CRM

Falcon is Wellsure Solutions' configurable CRM engine. Journey, Status, Field,
Role, Department, Service, and assignment labels are database configuration—not
application constants. Phase 1 contains foundation infrastructure only; there is
no CRM UI, API, worker behavior, or authentication provider yet.

## Setting up

**Start here: [`docs/getting-started.md`](docs/getting-started.md).** It walks a
clean clone through to a running app with an administrator you can log in as,
and it records the two places the setup fails if you do the obvious thing. The
rest of this file is reference for people who already have it running.

- Every environment variable: [`docs/operations/environment-variables.md`](docs/operations/environment-variables.md)
- How the deployed environment is run: [`docs/operations/deployment.md`](docs/operations/deployment.md)

## Prerequisites

- Node.js 24 (`engines.node` is `>=24 <25`, and pnpm enforces it)
- Corepack and pnpm 10.28.1
- Docker Engine with Docker Compose v2
- Terraform 1.11+ for infrastructure validation (optional for local app work)

## Setup

```bash
git clone <repository-url>
cd WELLSURE-CRM
corepack enable
cp .env.example .env
pnpm install --frozen-lockfile
```

The example credentials are local-only. Never reuse them outside local
development or commit `.env`.

## Run locally

```bash
pnpm dev
```

`pnpm dev` starts and health-checks PostgreSQL, Redis, and private MinIO storage,
then starts TypeScript watch tasks. Stopping the watch command does not delete or
stop service data.

```bash
pnpm infra:logs   # follow service logs
pnpm infra:down   # stop services and preserve volumes
pnpm infra:reset  # DESTRUCTIVE: stop services and delete local volumes
```

Service defaults are PostgreSQL `localhost:5432`, Redis `localhost:6379`, MinIO
API `localhost:9000`, and MinIO console `localhost:9001`. Override ports in the
ignored `.env` file if they conflict locally.

## Database

```bash
pnpm --filter @falcon/database prisma:generate
pnpm --filter @falcon/database prisma:validate
pnpm --filter @falcon/database prisma:deploy
pnpm --filter @falcon/database prisma:migrate
```

`prisma:deploy` applies every checked-in migration that the target database has
not run yet and nothing else. It is the command to use after pulling someone
else's schema change: it never prompts, never resets, and is a no-op when the
database is already current.

`prisma:migrate` is the authoring command — it applies the checked-in baseline
and creates a _new_ development migration when `schema.prisma` has changed. Reach
for it only when you are the one changing the schema, because it can offer to
reset the database.

`prisma/migrations/` holds a single squashed baseline,
`00000000000000_baseline`, which describes the whole schema. Its `rollback.sql`
is a full teardown, not an incremental one — it drops every table and is
intended only for disposable local or CI databases.

> **The baseline is hand-written SQL, and that is deliberate.** Prisma cannot
> express CHECK constraints, triggers, GIN or expression indexes, partial unique
> indexes, or database-side column defaults, all of which this schema depends on.
> A `prisma migrate diff` will therefore always report differences against a
> correct database — including a `DROP INDEX "leads_field_values_gin_idx"` that
> must never be applied. See `docs/data-model/prisma-translation-notes.md` for
> the full list of expected divergences before acting on any diff output.

### Pulling someone else's changes

Dependencies, the generated Prisma client, and the database schema all drift
independently. After `git pull`, run the steps whose inputs actually changed:

```bash
pnpm install --frozen-lockfile                      # only if pnpm-lock.yaml moved
pnpm infra:up                                       # services must be running first
pnpm --filter @falcon/database prisma:deploy        # only if prisma/migrations/ gained a directory
pnpm build                                          # regenerates the Prisma client, then compiles
```

`pnpm build` runs `prisma generate` as part of `@falcon/database`, so a separate
generate step is redundant after a build. Skipping it is what produces type
errors about models that plainly exist in `schema.prisma`.

Confirm the database matches the checked-in migrations with:

```bash
pnpm --filter @falcon/database exec prisma migrate status --config prisma.config.ts
```

> **A `DATABASE_URL` exported in your shell silently overrides `.env`.** The
> Prisma CLI loads `.env` through `dotenv`, which never replaces a variable that
> is already set, so an inherited `DATABASE_URL` — common in cloud dev
> containers and CI images — points migration commands at _that_ database while
> the app, which reads `FALCON_DATABASE_URL`, still talks to your local one. The
> datasource banner Prisma prints names the host it is really about to write to;
> read it before confirming a migration. Run `env | grep DATABASE_URL` when in
> doubt, and pass the URL explicitly if one is set.

## Quality commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## First administrator bootstrap

On a fully migrated, empty database, provision the one-time initial organization
and administrator with:

```bash
pnpm build   # on a clean clone: the bootstrap script compiles apps/api only,
             # which needs @falcon/database built first
pnpm --filter @falcon/api bootstrap -- \
  --organization-name "Example Organization" \
  --admin-name "Example Administrator" \
  --admin-email "admin@example.com"
```

It prints the new organization's UUID. Put that in `.env` as
`VITE_FALCON_ORGANIZATION_ID`, which Vite substitutes into the web bundle at
build time.

The values may instead be supplied as `FALCON_BOOTSTRAP_ORGANIZATION_NAME`,
`FALCON_BOOTSTRAP_ADMIN_NAME`, and `FALCON_BOOTSTRAP_ADMIN_EMAIL`. The normal API
environment variables, including `FALCON_DATABASE_URL`, are also required.
`FALCON_EMAIL_TRANSPORT` defaults to `console` for local development. That
transport prints the opaque, expiring setup token and a copy-pasteable password
reset request; treat the output as a credential. An explicitly selected transport
that has not yet been implemented fails loudly instead of discarding the reset.

This command refuses with a non-zero exit code if any Organization or User
already exists. It is not an admin recovery or additional-user creation tool;
use the authenticated user-administration API after first-run provisioning.

## Terraform structure

Environment roots and module contracts live under `infra/terraform`. Phase 17
filled in `network`, `database`, `compute` and `secrets` for the staging
environment; `cache`, `object-storage`, `observability` and `backup` remain
interface-only, each for a reason recorded in the environment root.

**Nothing has been applied.** No AWS resources exist. See
[`docs/operations/deployment.md`](docs/operations/deployment.md) for what
provisioning would involve and what it needs first.

```bash
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/environments/staging init -backend=false
terraform -chdir=infra/terraform/environments/staging validate
```

> `validate` proves the HCL is syntactically valid and internally consistent. It
> does **not** prove the configuration describes a working environment — this
> repository's seven empty module stubs passed it for sixteen phases.

Repeat validation for `staging` and `production`.

## Troubleshooting

- **A service port is occupied:** change the corresponding `*_PORT` value in
  `.env`, then run `pnpm infra:up`.
- **Postgres schema needs a clean replay:** run `pnpm infra:reset`, then
  `pnpm infra:up` and the Prisma migration command. This deletes all local data.
- **MinIO bucket is missing:** inspect `docker compose logs minio-init`; the
  initializer is idempotent and can be rerun with `docker compose up minio-init`.
- **Prisma cannot download an engine:** verify access to `binaries.prisma.sh` or
  the approved internal Prisma engine mirror. Do not bypass checksum validation
  in CI or production.

See `docs/testing/quality-gates.md` and `docs/operations/runbook.md` for the wider
acceptance and operations baseline.
