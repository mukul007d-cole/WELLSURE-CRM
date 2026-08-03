# Falcon CRM

Falcon is Wellsure Solutions' configurable CRM engine. Journey, Status, Field,
Role, Department, Service, and assignment labels are database configuration—not
application constants. Phase 1 contains foundation infrastructure only; there is
no CRM UI, API, worker behavior, or authentication provider yet.

## Prerequisites

- Node.js 24 LTS
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
pnpm --filter @falcon/database prisma:migrate
```

`prisma:migrate` applies the checked-in baseline and creates a new development
migration only when the schema changes. The initial rollback script is destructive
and is intended solely for disposable Phase 1 databases.

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
pnpm --filter @falcon/api bootstrap -- \
  --organization-name "Example Organization" \
  --admin-name "Example Administrator" \
  --admin-email "admin@example.com"
```

The values may instead be supplied as `FALCON_BOOTSTRAP_ORGANIZATION_NAME`,
`FALCON_BOOTSTRAP_ADMIN_NAME`, and `FALCON_BOOTSTRAP_ADMIN_EMAIL`. The normal API
environment variables, including `FALCON_DATABASE_URL`, are also required.
Configure password-reset email delivery before running the command: the initial
administrator receives an opaque, expiring setup token by email and uses the
password-reset flow to choose a password. The token is never printed.

This command refuses with a non-zero exit code if any Organization or User
already exists. It is not an admin recovery or additional-user creation tool;
use the authenticated user-administration API after first-run provisioning.

## Terraform structure

Environment roots and module contracts live under `infra/terraform`. They create
no AWS resources yet.

```bash
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/environments/dev init -backend=false
terraform -chdir=infra/terraform/environments/dev validate
```

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
