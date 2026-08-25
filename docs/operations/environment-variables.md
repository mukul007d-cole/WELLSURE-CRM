# Environment variables

Every variable Falcon reads, what it is for, and what a safe local value looks
like next to a real one. Compiled by reading the code that reads them, not from
`.env.example` — the two are cross-checked, and where they disagreed the code
won.

Who reads what:

- **API** — `apps/api/src/env.ts` (`parseEnv`), at boot, from `process.env`
  only. The API never reads a file; `--env-file=../../.env` in the `package.json`
  scripts is a local convenience. A deployed environment injects real
  environment variables, which is why no application code changes for deployment.
- **Prisma CLI** — `packages/database/prisma.config.ts`, which loads the
  repository-root `.env` through `dotenv`.
- **Vite** — `apps/web/vite.config.ts`, which reads the repository-root `.env`
  (`envDir`) and exposes only `VITE_`-prefixed variables, substituted into the
  bundle **at build time**.
- **Docker Compose** — `docker-compose.yml`, local services only.

---

## Required by the API

The API refuses to start if any of these is missing or malformed, and reports
all of the problems at once rather than the first.

| Variable | What it is | Local | Real |
| --- | --- | --- | --- |
| `FALCON_DATABASE_URL` | PostgreSQL connection string. Must be a `postgres:`/`postgresql:` URL. | `postgresql://falcon:falcon_local_only@localhost:5432/falcon?schema=public` | From the secret store, never a literal. Terraform generates the password and publishes it. |
| `FALCON_HTTP_PORT` | Listen port, 1–65535. | `3000` | `3000`; the platform maps it. |
| `FALCON_CORS_ORIGIN` | Comma-separated allowed origins. Each must be a bare origin — scheme and host, no path or trailing slash. | `http://localhost:5173` | The public origin. Same-origin when deployed, but still required. |
| `FALCON_LOG_LEVEL` | A Pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. | `info` | `info`. |
| `FALCON_SESSION_COOKIE_SECURE` | `true` or `false`. Sets the `Secure` flag on the session cookie. | `false` — the dev server is plain HTTP, and `true` would stop the cookie being sent at all. | **`true`, always.** |

## Email

| Variable | What it is | Local | Real |
| --- | --- | --- | --- |
| `FALCON_EMAIL_TRANSPORT` | Delivery mechanism. `console` prints the reset token and a copy-pasteable `curl` to stdout. `resend` sends through Resend. Anything else is accepted but fails loudly on the first send rather than discarding mail. | `console` (the default when unset) | `resend`. **Never `console`** — stdout in a deployed environment is the log stream, so it would write live credentials into your logs. Terraform rejects `console` for this reason. |
| `FALCON_EMAIL_API_KEY` | Provider API key. | Leave blank. | From the secret store. Filled in by hand once; Terraform creates the secret but never holds the value. |
| `FALCON_EMAIL_FROM` | Sender, e.g. `Falcon CRM <no-reply@notify.example.com>`. Must be on a domain verified with the provider. | Leave blank. | A verified sender. See ADR-0018 on splitting transactional and campaign mail across subdomains. |
| `FALCON_PUBLIC_BASE_URL` | Public origin of the deployed app, no trailing slash. The password-reset link in outgoing mail is built from it. | Leave blank. | `https://crm.example.com` |

The last three are **required whenever `FALCON_EMAIL_TRANSPORT` is not
`console`**, and the API refuses to boot without them. Discovering a missing key
on the first password reset — after a user has been invited and is waiting for
mail that will never arrive — is much worse than failing at startup.

## Web

| Variable | What it is | Local | Real |
| --- | --- | --- | --- |
| `VITE_FALCON_ORGANIZATION_ID` | The one organization's UUID. V1 is single-tenant and the login endpoint still takes an `organizationId`, so the frontend carries a fixed value. | The UUID the bootstrap CLI printed. | Same, for the real organization. |
| `FALCON_WEB_ROOT` | Directory holding the built web bundle. When set, the API serves it same-origin and adds an SPA fallback. | **Leave unset** — Vite serves the app and proxies `/api`. | Set by the container image to `/app/apps/web/dist`. |

`VITE_FALCON_ORGANIZATION_ID` is **substituted at build time**, not read at
runtime. Two consequences:

- Changing it requires rebuilding the web bundle, not restarting anything.
- The organization must exist before the bundle is built, so the bootstrap CLI
  runs *before* the image is built. See `docs/operations/deployment.md`.

## Object storage — optional (ADR-0012)

**All five or none.** A partial set is a startup error, because a
half-configured bucket fails at upload time with a credentials error, which is a
worse signal than "not configured". With none of them the API boots, the
attachment routes answer `503 storage_not_configured`, and the UI says so.

| Variable | Local (MinIO) | Real |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://localhost:9000` | The S3 endpoint. |
| `S3_REGION` | `us-east-1` | The bucket's region. |
| `S3_BUCKET` | `falcon-local` | A private bucket. |
| `S3_ACCESS_KEY` | `falcon_local` | From the secret store. |
| `S3_SECRET_KEY` | `falcon_local_only_password` | From the secret store. |

The document locker is **not enabled** on the environment phase 17 stands up.
Turning it on is a follow-up that fills in the `object-storage` Terraform module
and adds these five to the service.

## Local tooling only

Not read by the application. None of these has a deployed counterpart.

| Variable | Read by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Prisma CLI | Target for `prisma migrate` / `prisma:deploy`. Distinct from `FALCON_DATABASE_URL`, which the API reads. |
| `TEST_DATABASE_URL` | test setup | The `falcon_test` database. |
| `FALCON_POSTGRES_URL` | test suites | Enables the PostgreSQL integration suites. **Without it around 60 tests skip silently.** |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Docker Compose | Local PostgreSQL container. |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT` | Docker Compose | Local MinIO container. |
| `REDIS_PORT`, `REDIS_URL` | Docker Compose | Local Redis. **Nothing in the application reads Redis** — there is no client, no queue library and no `REDIS_URL` reader anywhere in the source. Started for parity with a future worker that does not exist yet. |

### Bootstrap CLI

The three values may be given as flags or as these variables. Flags win.

| Variable | Flag |
| --- | --- |
| `FALCON_BOOTSTRAP_ORGANIZATION_NAME` | `--organization-name` |
| `FALCON_BOOTSTRAP_ADMIN_NAME` | `--admin-name` |
| `FALCON_BOOTSTRAP_ADMIN_EMAIL` | `--admin-email` |

---

## Two traps worth knowing

**An exported `DATABASE_URL` silently overrides `.env`.** `dotenv` never
replaces a variable already set in the shell, and cloud dev containers and CI
images commonly export one. Migrations then apply to *that* database while the
API talks to yours, with no warning. Prisma's datasource banner names the
database it is really about to write to — read it, and run
`env | grep DATABASE_URL` when in doubt.

**No cookie signing secret exists, and none is needed.** `@fastify/cookie` is
registered without a `secret`, and sessions are opaque 256-bit random tokens
stored only as SHA-256 hashes and resolved by database lookup
(`apps/api/src/auth/tokens.ts`). There is nothing to forge and nothing to sign.
If you are looking for a `SESSION_SECRET` to set, there isn't one — the complete
list of secrets is the database URL, the email API key, and the two `S3_*`
credentials if the locker is enabled.
