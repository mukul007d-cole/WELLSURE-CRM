# Phase 17 (Part 2) — Deploy to a Real Environment

> **Status: decisions made; implementation up to the apply gate.** Nothing has
> been provisioned. No infrastructure exists, no account has been touched, and
> nothing that costs money has been created.
>
> **Decisions taken** (see "Decisions requiring approval" for the tradeoffs each
> was chosen against):
>
> | | Chosen |
> | --- | --- |
> | 1. What staging is for | **1A — long-lived evaluation environment** |
> | 2. Deployment target | **2B — AWS, minimal surface** (App Runner + RDS + Secrets Manager) |
> | 3. Email provider | **3B — Resend** for staging, revisit for production |
> | 4. Secret management | **4A — platform-native** (Secrets Manager references injected as env vars) |
>
> **The apply gate is still closed.** Everything that costs nothing —
> infrastructure code, the email transport, the environment contract, the
> documentation — is in scope now. `terraform apply` and everything after it
> needs three things this repo cannot supply: an AWS account with credentials, a
> domain someone controls, and a Resend API key. See "What crossing the gate
> needs".

## Goal

Make the CRM that sixteen phases have already built reachable by real people, on
one real environment, safely — with real email delivery, real secret management,
and documentation that lets someone else run and redeploy it.

## Docs read

- `AGENTS.md`, `PLANS.md`, `README.md`
- `docs/requirements/v1-scope.md`, `docs/requirements/source-of-truth.md`,
  `docs/requirements/open-decisions.md`
- `docs/architecture/decisions/0005-auth-provider-deferred.md`,
  `0007-custom-session-auth.md`, `0012-object-storage-and-journey-moves.md`,
  `0013-campaign-trigger-fan-out.md`, `0016-bulk-import-and-export.md`,
  `0017-bounded-configuration-purge.md`
- `docs/operations/runbook.md`, `docs/testing/quality-gates.md`
- `infra/terraform/README.md` and every `.tf` file under `infra/terraform`
- `apps/api/src/auth/email-sender.ts`, `apps/api/src/auth/password-reset.ts`,
  `apps/api/src/env.ts`, `apps/api/src/runtime.ts`, `apps/api/src/main.ts`
- `apps/web/vite.config.ts`, `apps/web/src/lib/constants.ts`,
  `apps/web/src/lib/api-client.ts`
- `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`

---

## Current state — what investigation actually found

Six findings change the shape of this phase. Each was verified against the repo,
not assumed.

### 1. The Terraform provisions nothing at all

This is the single most important finding.

```
$ grep -rn 'resource "\|provider "\|data \|backend "' infra/
0
```

Every one of the seven modules — `network`, `compute`, `database`, `cache`,
`object-storage`, `observability`, `backup` — contains exactly this and nothing
else:

```hcl
terraform {
  required_version = ">= 1.11.0, < 2.0.0"
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}
```

There are no `resource` blocks, no `provider` block, no backend configuration,
and no cloud provider actually selected anywhere. `terraform validate` passes in
CI because the HCL is syntactically valid and internally consistent — which is
exactly the trap this phase was warned about. The environment roots wire seven
empty modules together and output their name prefixes.

**"Apply the Terraform for staging" is therefore not a step that exists.** There
is nothing to apply. Whatever target is chosen, its infrastructure-as-code has to
be *written* in this phase. That is the dominant cost here, and it is why the
target decision below matters more than it would if the scaffolding were real.

`infra/terraform/README.md` and `v1-scope.md` both name AWS as the intended
direction ("AWS deployment, monitoring, backups, restore procedure"), so the
scaffolding implies a choice without implementing any of it.

### 2. The deployed system is smaller than the local one

`docker-compose.yml` and `.env.example` describe Postgres, Redis and MinIO. Only
one of those is actually needed:

| Service | Needed in a deployed environment? | Evidence |
| --- | --- | --- |
| **PostgreSQL 17** | **Yes** | The whole application. |
| **Redis** | **No** | Zero references in any source file or `package.json` — no `redis`, `ioredis`, `bullmq`, or `REDIS_URL` reader anywhere. It is local scaffolding nothing consumes. |
| **Object storage (S3/MinIO)** | **Optional** | ADR-0012: `parseEnv` takes all five `S3_*` variables or none. Without them the API boots, the locker routes answer `503 storage_not_configured`, and the UI says so. |
| **`apps/worker`** | **No** | The entire package is `export const workspaceName = '@falcon/worker'`. There is no worker behaviour to run. |

There is also no background scheduler to host: campaign delivery drains through
`drainPending`, called from an authenticated HTTP route
(`apps/api/src/routes/campaigns.ts:214`), not from a timer.

So the deployment is: **one Postgres, one Node process, one static bundle.**
Optionally a bucket. That is a materially smaller and cheaper thing to stand up
than the seven-module Terraform layout suggests.

### 3. The email abstraction is genuinely clean — the swap is small

`createEmailSender` returns one object satisfying two role interfaces:

```ts
interface EmailSender      { sendPasswordReset(input: { to: string; token: string; expiresAt: Date }): Promise<void> }
interface CampaignEmailSender { sendEmail(message: { to: string; subject: string; html: string }): Promise<void> }
```

`createEmailSender({ transport, httpPort })` branches on `transport`, returns the
console implementation for `'console'`, and returns a `deliveryNotConfigured`
stub for anything else that rejects loudly rather than silently discarding mail.
The gate for local development already exists and needs no change:
`FALCON_EMAIL_TRANSPORT` defaults to `console`.

**A real provider is one new branch and two method implementations.** Confirmed,
not assumed.

One real gap: the console transport hardcodes the reset link as
`http://localhost:${httpPort}/api/v1/auth/password-reset/complete`. A deployed
transport must emit a link to the *public* URL, and no environment variable for
that exists yet. This phase adds one (`FALCON_PUBLIC_BASE_URL`).

### 4. There is no cookie signing secret to manage

The phase brief lists "session cookie signing material" as a secret to move into
a secret store. **That material does not exist**, and inventing it would be the
wrong outcome:

- `@fastify/cookie` is registered with no `secret`, so cookies are unsigned.
- Sessions are opaque 256-bit random tokens (`randomBytes(32)`), stored only as
  SHA-256 hashes in the `sessions` table, and validated by database lookup.

There is nothing to forge and therefore nothing to sign. The real secrets are:
**the database URL, the email provider API key, and — only if object storage is
enabled — the two `S3_*` credentials.** That is the complete list.

### 5. Config already flows entirely through `process.env`

`main.ts` calls `createRuntime(process.env)` → `parseEnv(env)`. Nothing reads a
file at runtime; `--env-file=../../.env` in the `package.json` scripts is a local
convenience, and no `dotenv` call exists in application code.

**This means the minimum real change for secret management is zero code
change.** Every candidate platform injects secrets as environment variables. The
work is in provisioning and wiring, not in the application.

### 6. Two deployment constraints in the web app that dictate topology

**The frontend calls the API same-origin.** `apps/web/src/lib/api-client.ts:42`
is `const API_BASE = '/api/v1'`, a relative path. In development, Vite's proxy
forwards `/api` to `localhost:3000`. **In production there is no Vite dev
server**, so either one origin serves both the bundle and the API, or a proxy/CDN
must rewrite `/api/*` to the API. This rules out naively hosting the bundle on a
static host pointed at a separate API domain, and is a real input to the target
decision.

**The organization ID is baked in at build time.** `constants.ts` reads
`import.meta.env.VITE_FALCON_ORGANIZATION_ID` and throws if it is missing. Vite
substitutes it during `vite build`. Verified empirically — building with the
variable absent leaves the throw in the shipped bundle:

```
$ env -u VITE_FALCON_ORGANIZATION_ID pnpm exec vite build
$ grep -c "VITE_FALCON_ORGANIZATION_ID is required" dist/assets/index-*.js
1
```

The real organization's UUID only exists *after* the bootstrap CLI runs. So the
deploy order is forced: **provision → migrate → bootstrap → read the org id →
build the web bundle → deploy it.** The runbook has to say this; getting it
wrong produces a white screen with a console error and no other symptom.

### 7. What "staging" is for is genuinely undecided

Nothing in `docs/` says. `v1-scope.md` names "AWS deployment" once and says
nothing about environments; `open-decisions.md` uses "staging" only to mean a
holding area for unmapped Cronberry columns, not an environment. The Terraform
has `dev`, `staging` and `production` roots that are byte-identical apart from
the `environment` variable.

**This is the pivotal question, and I am not going to assume an answer** — it
changes the target, the cost, and how much of this phase's effort is throwaway.
See Decision 1.

---

## Decisions requiring approval

### Decision 1 — What staging is for *(this drives everything else)*

| | **1A. Long-lived evaluation environment** | **1B. Disposable smoke-test environment** |
| --- | --- | --- |
| **What it is** | Wellsure logs in, configures journeys, enters real-ish data, and evaluates the product before a production cutover. | A short-lived environment that proves the deploy pipeline and the migration work, then is torn down. |
| **Implies** | It is effectively pre-production. Needs real backups, a real domain, real email deliverability, and data that survives. | Nothing needs to survive. Backups, DNS and deliverability can be minimal. |
| **Effort** | Higher — most of production's work, done once. | Much lower. |
| **Risk** | Becomes production by accident without production's guarantees. | Wellsure has nowhere to evaluate; the real work moves to a later production phase. |

**My recommendation: 1A.** The phase brief frames the goal as "making the thing
that already exists reachable by real people", and sixteen phases of finished
product with no one able to see it is the problem worth solving. A disposable
smoke test does not solve it. But this is a business call about whether Wellsure
is ready to look at the product, and it is theirs to make.

### Decision 2 — Deployment target

All three options require writing infrastructure code from scratch (Finding 1).
The difference is how much.

| | **2A. AWS, full Terraform** | **2B. AWS, minimal surface** | **2C. Managed PaaS** (Fly.io / Render) |
| --- | --- | --- | --- |
| **Shape** | VPC + ECS Fargate + RDS + S3 + ALB/CloudFront + Secrets Manager + CloudWatch + AWS Backup — the seven existing module stubs, filled in. | App Runner + RDS + Secrets Manager. No custom VPC, no cache module, no observability module. | One container + managed Postgres + platform secret store, TLS and DNS included. |
| **Matches stated intent** | Yes — `v1-scope.md` and `infra/terraform/README.md` both say AWS. | Yes. | No — a deliberate divergence. |
| **Same-origin (Finding 6)** | ALB path rule, or serve the bundle from the API container. | App Runner serves one origin; simplest to serve the bundle from the API process. | One service, one origin. Simplest of the three. |
| **New IaC to write** | All seven modules, plus remote state bootstrap, plus DNS/TLS. Substantial. | Two modules' worth. Moderate. | Small; Terraform providers exist for both Fly and Render, so IaC is not abandoned. |
| **Time to a working URL** | Weeks. | Days. | Hours to a day. |
| **Cost** | Highest (NAT gateway alone is a meaningful monthly floor). | Moderate. | Lowest. |
| **Throwaway if production later needs full AWS** | None. | Little — App Runner→ECS is a real migration but RDS, secrets and the container image all carry over. | Most — the IaC would be rewritten. |

**My recommendation depends on Decision 1:**

- **If 1A (long-lived):** choose **2B**. It stays on the stated AWS path, so
  nothing is thrown away, and it writes only the infrastructure this system
  actually needs — remembering that Redis and the worker are not needed at all
  (Finding 2). 2A's extra five modules provision things nothing in this
  application consumes; building them now is speculative work, and `cache` in
  particular would provision a Redis nothing reads.
- **If 1B (disposable):** choose **2C**. A disposable environment does not
  justify weeks of AWS IaC, and the PaaS gets a working URL in a day.

I am recommending against 2A in both cases: it is the option that most looks
like the existing scaffolding and least matches what the application actually
runs.

### Decision 3 — Email provider

The application sends two very different kinds of mail through one transport:
password setup/reset (transactional, deliverability-critical, low volume) and
marketing campaigns (bulk). **Worth flagging: putting bulk campaign mail and
password resets on the same sending domain risks bulk complaints degrading
deliverability of the resets** — i.e. a marketing complaint rate could stop
people being able to log in. A subdomain split (`mail.` vs `notify.`) is the
standard mitigation, and I would apply it whichever provider is chosen.

| | **3A. Amazon SES** | **3B. Resend** | **3C. Postmark** |
| --- | --- | --- | --- |
| **Cost** | Cheapest by a wide margin at volume. | Free tier covers evaluation; cheap after. | Most expensive per message. |
| **Setup lead time** | **Slowest — starts sandboxed** (only verified recipients) and leaving the sandbox is a support request that can take days. This can block the phase. | Minutes: API key + domain DNS records. | Hours: domain verification, plus an approval step. |
| **Fit if on AWS** | Native — IAM rather than an API key to manage. | Fine, an ordinary API key. | Fine. |
| **Transactional deliverability** | Good, needs warming and your own reputation management. | Good. | Best in class; it is the product's whole focus. |
| **Bulk campaigns** | Yes. | Yes. | Separate message stream; it deliberately separates the two. |

**My recommendation: 3B (Resend) for staging**, because the SES sandbox is a
real schedule risk for a phase whose point is to get something reachable
quickly, and because its API is a few lines against the two-method interface in
Finding 3. **Revisit for production**, where SES's cost (if on AWS) or
Postmark's deliverability (for resets specifically) are both stronger arguments
than they are for an evaluation environment.

The implementation makes this cheap to revisit: the provider lives behind
`createEmailSender`'s existing `transport` switch, so changing it later is one
new branch, not a refactor.

### Decision 4 — Secret management

Because config already flows through `process.env` (Finding 5), **no application
code changes for any of these.**

| | **4A. Platform-native secret store** | **4B. AWS Secrets Manager, fetched at boot** | **4C. SOPS/age encrypted in git** |
| --- | --- | --- | --- |
| **What it is** | App Runner + Secrets Manager references (2B), or `fly secrets` / Render env groups (2C). Injected as env vars. | The API fetches and decrypts secrets itself at startup. | Encrypted files committed; decrypted at deploy time. |
| **Code change** | **None.** | New startup path, an AWS SDK dependency, and IAM handling — a new production dependency needing justification per `AGENTS.md`. | None, plus tooling in the deploy pipeline. |
| **Rotation** | Platform-managed. | Best — supports rotation without redeploy. | Manual, and a commit. |
| **Secrets in git** | Never. | Never. | Ciphertext only, but present. |

**My recommendation: 4A.** It is the minimum real change the brief asks for, it
adds no dependency, and it is what both candidate platforms treat as standard.
4B's rotation advantage is real but is not worth a new boot-time dependency for
an evaluation environment; it is the right upgrade when production needs
scheduled credential rotation.

`.gitignore` already excludes `.env`, `.env.*`, `*.tfstate*` and `.terraform/`,
so no additional guard is needed to keep secrets out of version control. **No
provider credential will appear in code or in git under any option.**

---

## Proposed approach

Assuming the recommended path (**1A + 2B + 3B + 4A**); the shape is the same for
1B + 2C with a smaller infrastructure step.

**Step 1 — Terraform for staging, written from scratch.** Fill in `database`
(RDS Postgres 17, private, encrypted, automated backups) and `compute` (App
Runner service from a container image, health check on `/health`), plus a
`secrets` module. Leave `cache`, `observability` and `backup` as the stubs they
are and record why: Redis is unused, `/health` plus platform logs is the
"minimum needed to confirm the deployment is healthy" the brief allows, and RDS
automated backups cover the backup module's purpose for staging. Bootstrap the
encrypted remote state backend separately first, as `infra/terraform/README.md`
already requires; backend coordinates stay uncommitted.

**Step 2 — Real email transport.** Add a `resend` branch to `createEmailSender`
implementing `sendPasswordReset` and `sendEmail`. Add `FALCON_PUBLIC_BASE_URL`
to `parseEnv` (required only when the transport is not `console`, so local
development is unchanged) and use it for the reset link. API key from the
platform secret store. Unit tests for both methods against a faked HTTP client;
one real send verified by hand during Step 5.

**Step 3 — Secrets.** `FALCON_DATABASE_URL` from the RDS module output,
`FALCON_EMAIL_API_KEY` entered once by hand, and — if the locker is enabled —
the two `S3_*` credentials. All referenced by the service definition, never
literal.

**Step 4 — Bring the environment up, in this order** (forced by Finding 6):

1. `terraform apply` — **the approval gate; this is the first step that costs
   money.**
2. `prisma migrate deploy` — applies Part 1's squashed baseline. Run as a
   one-off task against the private database, not from a laptop.
3. Bootstrap CLI, once, for the real organization. **It is unauthenticated by
   design and refuses to run if any Organization or User exists**, which is its
   own protection; the runbook will still specify running it as a one-off task
   that exits, never as a reachable endpoint, and confirming the refusal
   afterwards.
4. Capture the organization UUID from the bootstrap output.
5. Build the web bundle with `VITE_FALCON_ORGANIZATION_ID` set to it, and deploy
   it behind the same origin as the API.

**Step 5 — Verify against the deployed environment**, the same way this project
has verified locally throughout: health check, the password-reset email actually
arriving in a real inbox, login, the admin configuration screens, creating a
lead, and confirming its audit row.

**Step 6 — Documentation** (a deliverable, not polish):

- `docs/getting-started.md` — written by doing a clean setup and recording what
  really happens. Findings on the four known gotchas are in "Gotchas verified"
  below.
- `docs/operations/deployment.md` — deploy a change, run a migration, roll back,
  where logs and health checks live, and the bootstrap-CLI safety procedure.
- `docs/operations/environment-variables.md` — every variable the app reads,
  what it is for, a safe local default, and what a real value looks like.

## Gotchas verified, not copied

The brief listed four known gotchas and asked that each be re-verified rather
than documented blind. Results:

| Gotcha | Status |
| --- | --- |
| `docker compose --wait` failing on one-shot init containers | **Already fixed.** `infra:up` scopes `--wait` to `postgres redis minio` and starts `minio-init` in a separate command. Will not be documented as a workaround. |
| `apps/api` not loading `.env` automatically at runtime | **Still true, by design.** No `dotenv` in application code; the `dev`/`start`/`bootstrap` scripts pass `--env-file=../../.env`. Worth documenting, and it is *why* deployment needs no code change (Finding 5). |
| Windows `import.meta.url` path handling | **Already fixed.** `bootstrap-cli.ts:108` uses `pathToFileURL(process.argv[1]).href`, the Windows-safe idiom, not a string comparison. |
| Windows PowerShell `curl` alias | **Not verifiable here** (Linux container). Will be marked as unverified rather than asserted either way. |
| Vite needing its own `.env`/`envDir` | **Still true, and unfixed.** No `envDir` in `vite.config.ts`, no `apps/web/.env`. Proven above — the built bundle still contains the "is required" throw. |

**One extra gotcha found, not on the list:** the documented bootstrap command in
`README.md` does not work.

```
$ pnpm --filter @falcon/api bootstrap -- --organization-name "…" --admin-name "…" --admin-email "…"
Expected --organization-name, --admin-name, and --admin-email arguments
```

The `--` separator arrives as `argv[0]`, and `parseBootstrapOptions`
(`bootstrap-cli.ts:29`) reads flags in pairs from index 0, so the first "flag" it
sees is `--`. The environment-variable form works, and so does invoking
`node dist/bootstrap-cli.js` directly. Since the setup guide and the deployment
runbook both have to tell someone how to run this command, fixing the argument
parsing to skip a leading `--` is in scope for this phase; it is one line.

## Files to touch

**New:**
- `infra/terraform/modules/database/main.tf`, `outputs.tf`, `variables.tf`
- `infra/terraform/modules/compute/main.tf`, `outputs.tf`, `variables.tf`
- `infra/terraform/modules/secrets/{main,outputs,variables}.tf`, `README.md`
- `infra/terraform/environments/staging/backend.tf`
- `apps/api/src/auth/resend-email-sender.ts` + its unit test
- `docs/getting-started.md`
- `docs/operations/deployment.md`
- `docs/operations/environment-variables.md`
- `docs/architecture/decisions/0018-deployment-target-and-email-provider.md`

**Modified:**
- `infra/terraform/environments/staging/main.tf`, `outputs.tf`, `variables.tf`
- `infra/terraform/README.md` — it currently says "provisions no AWS resources"
- `apps/api/src/auth/email-sender.ts` — one new transport branch
- `apps/api/src/env.ts` — `FALCON_PUBLIC_BASE_URL`, required only off-console
- `apps/api/src/bootstrap-cli.ts` — skip a leading `--` in argv
- `apps/web/vite.config.ts` — `envDir` so the monorepo-root `.env` is read
- `.env.example` — new variables with safe local defaults
- `README.md` — point at the new setup guide
- `docs/operations/runbook.md` — replace "Phase 1 validation-only" statements

## Out of scope

Per the brief, and held to deliberately:

- Any application feature or bug fix not required to make deployment work. Two
  things noticed and **not** folded in: `apps/worker` is an empty stub, and
  Redis is configured but unused. Both are follow-ups, not this phase.
- **Production cutover.** Staging only, unless investigation shows production is
  genuinely ready and it is separately approved. Given Finding 1 — no
  infrastructure code exists at all — production is plainly not ready, so this
  phase should not touch it.
- Load testing and the 200k-record performance validation in
  `docs/testing/quality-gates.md`.
- The Cronberry data migration.
- Monitoring/observability beyond the existing `/health` path and the
  platform's own logs.

## Risks / open questions

1. **Decision 1 is unanswered and blocks the rest.** Everything else branches on
   it. It is the first thing to settle at approval.
2. **The infrastructure has to be written, not applied.** If the phase was
   scoped on the assumption that working Terraform existed, the estimate is
   wrong and this is the moment to find out.
3. **A domain is needed and none is identified.** Real email requires DNS
   records on a domain someone controls; TLS and the same-origin requirement
   need a hostname. Who owns the domain, and which subdomain staging gets, is an
   unanswered dependency outside the repo.
4. **SES sandbox lead time** (Decision 3) can block delivery for days. This is
   the main argument for 3B.
5. **Bulk and transactional mail share one transport**, so campaign complaints
   can degrade password-reset deliverability. Mitigated by a subdomain split;
   flagged because it is a product-level consequence, not just a config detail.
6. **The bootstrap CLI is unauthenticated by design.** Its real protection is
   that it refuses when any Organization or User exists, which the runbook will
   verify immediately after first run rather than trusting.
7. **No conflict found** between example data and `docs/` during this
   investigation, so `source-of-truth.md`'s precedence rule was not engaged.

## Test plan

Per `docs/testing/quality-gates.md`:

- Unit tests for the new email transport — both methods, against a faked HTTP
  client, including that a provider failure rejects rather than silently
  resolving (matching the existing `deliveryNotConfigured` contract).
- Unit tests for `parseEnv` covering `FALCON_PUBLIC_BASE_URL`: required when the
  transport is not `console`, absent-and-fine when it is.
- A unit test for the bootstrap argv fix, including the leading-`--` form.
- `terraform fmt -check` and `validate` in CI, unchanged — **explicitly noting
  in the PR that this proves syntax, not a working environment**, which is what
  Finding 1 shows it has always meant here.
- The full existing suite must stay green; this phase changes no application
  behaviour.
- Manual end-to-end verification against the deployed environment (Step 5),
  recorded in the PR the way Part 1's was.
- Following `docs/getting-started.md` start to finish on a clean checkout, and
  fixing whatever it gets wrong.

## What crossing the gate needs

The apply step and everything after it depend on three things that do not exist
in the repository and cannot be created from it:

1. **An AWS account and credentials** for the staging environment, plus a
   separately bootstrapped encrypted remote state backend (S3 + DynamoDB lock),
   whose coordinates stay uncommitted per `infra/terraform/README.md`.
2. **A domain someone at Wellsure controls**, and a decision on which subdomain
   staging gets. This is needed three times over: TLS, the same-origin
   requirement in Finding 6, and the DNS records that make email deliverable.
3. **A Resend account and API key**, with the sending domain verified. Per the
   deliverability risk in Decision 3, the intent is to split streams by
   subdomain rather than send campaigns and password resets from the same one.

Until all three exist, Steps 4 and 5 cannot run, and the deployment
documentation's verification section stays unfilled rather than asserted.

## Rollback plan

- **Application:** redeploy the previous container image. The API is stateless.
- **Schema:** Part 1's baseline is the only migration. Its `rollback.sql` is a
  full teardown and is **not** the tool for a populated environment — the
  documented reversal there is a point-in-time restore from RDS automated
  backups, which the deployment doc will state and the runbook will require a
  drill for before any production cutover.
- **Infrastructure:** `terraform destroy` for staging, which is safe precisely
  because staging holds no data anyone depends on yet — a property that stops
  being true the moment Decision 1A staging carries Wellsure's evaluation data,
  which the deployment doc will call out.
- **Email:** setting `FALCON_EMAIL_TRANSPORT` back to an unimplemented value
  makes sends fail loudly rather than silently, by the existing
  `deliveryNotConfigured` contract. There is no state to unwind.
