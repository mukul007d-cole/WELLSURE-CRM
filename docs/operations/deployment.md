# Deployment and runbook — staging

How the staging environment is built, deployed to, migrated, and rolled back.

> ## Status: not yet provisioned
>
> Phase 17 wrote everything in this document but **has not applied it**. No AWS
> resources exist, no account has been touched, and nothing here has been run
> against real infrastructure. The Terraform is `fmt`- and `validate`-clean,
> which — as phase 17's investigation established the hard way — means the HCL is
> internally consistent and **nothing more**. It has never been `plan`ned against
> a real account.
>
> Crossing that gate needs three things this repository cannot supply: an AWS
> account with credentials, a domain someone at Wellsure controls, and a Resend
> API key. Until then, treat the command sequences below as reviewed intent, not
> as verified procedure, and expect the first apply to surface corrections that
> belong back in this file.
>
> Production is **not** covered here and is not ready. See the header of
> `infra/terraform/environments/production/main.tf`.

---

## What the environment is

Staging is a **long-lived environment Wellsure evaluates the product on**, not a
disposable smoke test (phase 17 Decision 1A). It holds data people care about,
which is why the database keeps real backups and deletion protection, and why
`terraform destroy` is not a casual operation.

| Piece | What it is |
| --- | --- |
| Compute | One AWS App Runner service, from a container image in ECR. |
| Database | RDS PostgreSQL 17, private, encrypted, 7-day automated backups. |
| Secrets | AWS Secrets Manager, injected as environment variables. |
| Web | Served by the same container as the API, same origin. |
| Email | Resend (ADR-0018). |
| Health | `GET /health` → `{"status":"ok"}`, which App Runner polls. |

**One service, one origin, deliberately.** `apps/web` calls the API at the
relative path `/api/v1`, and outside `pnpm dev` there is no Vite proxy. The API
serves the built bundle when `FALCON_WEB_ROOT` is set, so the browser's origin
is the API's origin by construction.

Not deployed, and each for a recorded reason: **Redis** (nothing in the source
reads it), **`apps/worker`** (a one-line stub), **object storage** (optional by
ADR-0012; the locker answers `503` without it).

## First-time setup

### 1. Remote state

`infra/terraform/README.md` requires a separately bootstrapped encrypted backend
with locking, and requires its coordinates to stay out of git. `backend.tf` is
therefore an empty `backend "s3" {}` block, configured at init time.

This matters more than usual: the database module generates the master password,
so **the state file contains a live credential**. The bucket must be encrypted,
versioned and access-controlled.

```bash
terraform -chdir=infra/terraform/environments/staging init \
  -backend-config=bucket=<state-bucket> \
  -backend-config=key=staging/terraform.tfstate \
  -backend-config=region=<region> \
  -backend-config=dynamodb_table=<lock-table> \
  -backend-config=encrypt=true
```

### 2. Apply — the gate

**This is the first step that creates billable resources.** Everything before it
is reversible for free.

```bash
cp infra/terraform/environments/staging/terraform.tfvars.example \
   infra/terraform/environments/staging/terraform.tfvars
# edit: aws_region, email_from. Leave public_base_url as the placeholder.
terraform -chdir=infra/terraform/environments/staging plan -out=staging.plan
# read the plan; then
terraform -chdir=infra/terraform/environments/staging apply staging.plan
```

Two applies are needed the first time. App Runner's hostname does not exist
until the service does, and `FALCON_PUBLIC_BASE_URL` is built from it:

```bash
terraform -chdir=infra/terraform/environments/staging output service_url
# set public_base_url in terraform.tfvars to that value, then apply again
```

Once a custom domain is attached, `public_base_url` becomes that domain and
stops moving.

### 3. The email API key

Terraform creates the secret and never holds its value — putting it in a
variable would put it in a tfvars file or a CI variable, and `AGENTS.md` forbids
secrets in git.

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(terraform -chdir=infra/terraform/environments/staging output -raw email_api_key_secret_name)" \
  --secret-string '<the Resend API key>'
```

Verify the sending domain with the provider first. Per ADR-0018, password resets
and marketing campaigns should not share a sending subdomain.

### 4. Migrate

The database is not reachable from the internet. Run migrations as a one-off
task inside the VPC, on the same image, with the same secret:

```bash
# One-off ECS/Fargate task or an SSM session on a bastion, in the private
# subnets and the application security group.
node_modules/.bin/prisma migrate deploy --config prisma.config.ts
```

There is one migration, `00000000000000_baseline`. `migrate deploy` never
prompts, never resets, and is a no-op when the database is current.

### 5. Bootstrap the first administrator — read this before running it

The bootstrap CLI creates the one organization and the first administrator. It
is **unauthenticated by design**, and it needs to be, because there is no
account to authenticate as yet.

Its real protection is that **it refuses when any Organization or User already
exists**:

```
Bootstrap refused: the database already contains 1 organization(s) and 1 user(s).
```

That is not a door left open — it is a one-shot that closes itself. But it is
still the most sensitive command in this document, so:

- **Run it as a one-off task that exits.** It is a CLI, never an HTTP route.
  Nothing in the deployed service exposes it, and nothing should be added that
  does.
- **Run it exactly once**, from inside the VPC, with the database secret.
- **Confirm the refusal immediately afterwards** by running it a second time and
  seeing the message above. Do not assume the guard works — observe it.
- **Treat the output as a credential.** It prints an opaque setup token. On a
  real transport the token is emailed rather than printed, but the organization
  UUID still appears in the task log.
- **Do not leave the task definition able to run unattended.** Delete it, or
  scope its IAM so nobody can trigger it casually.

```bash
node apps/api/dist/bootstrap-cli.js \
  --organization-name "Wellsure Solutions" \
  --admin-name "<name>" \
  --admin-email "<email>"
```

Record the organization UUID it prints. The next step needs it.

### 6. Build and push the image

The organization UUID is substituted into the web bundle **at build time**, so
the image cannot be built until step 5 has run. Getting this order wrong ships a
bundle whose first act in the browser is to throw, which looks like a blank page
and nothing else.

```bash
aws ecr get-login-password --region <region> \
  | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com

docker build \
  --build-arg VITE_FALCON_ORGANIZATION_ID=<uuid from step 5> \
  -t "$(terraform -chdir=infra/terraform/environments/staging output -raw ecr_repository_url):$(git rev-parse --short HEAD)" .

docker push "<repository-url>:<sha>"
```

Tags are immutable and the tag is the git SHA, so a deployed version is always
traceable to a commit — and to a rollback target.

### 7. Deploy

```bash
aws apprunner start-deployment \
  --service-arn "$(terraform -chdir=infra/terraform/environments/staging output -raw service_arn)"
```

Terraform does **not** move the deployed tag; the service's `image_identifier`
is under `ignore_changes` precisely so an unrelated `terraform apply` cannot roll
the application back to whatever the variable happened to default to.

---

## Routine operations

### Deploy a change

1. Merge to the default branch and let CI go green.
2. Build and push a new image tagged with the git SHA (step 6 — the
   `VITE_FALCON_ORGANIZATION_ID` build arg is still required, and does not change).
3. `aws apprunner start-deployment`.
4. Watch `/health` and the service's log stream until the new revision is
   serving.

No migration is involved unless `prisma/migrations/` gained a directory.

### Run a migration

Migrations run **before** the image that depends on them, and separately from the
deploy — they are not part of container startup, so a failed migration never
leaves a half-started service.

1. Confirm the migration is additive, or that the running version tolerates both
   shapes. `AGENTS.md` requires every migration to be reversible or to have a
   documented rollback path.
2. Take a manual RDS snapshot. Automated backups exist, but a named snapshot
   taken deliberately is what you want to restore from.
3. Run `prisma migrate deploy` as a one-off task (step 4).
4. Deploy the new image.

Check what the database thinks:

```bash
prisma migrate status --config prisma.config.ts
```

### Roll back

**The application** — redeploy the previous image tag. The API is stateless, so
this is the fast, safe path and should be the first move:

```bash
aws apprunner start-deployment --service-arn <arn>   # after re-tagging, or
# deploy the previous SHA's image, which is still in ECR (last 10 kept)
```

**The schema** — do *not* reach for the baseline's `rollback.sql`. It is a
from-scratch teardown that drops every table, and it will destroy this
environment's data. For a populated database the documented reversal is
**point-in-time restore** from RDS automated backups, which is what the 7-day
retention exists for. Restore to a new instance, verify, then repoint.

> A restore drill has **not** been performed. `docs/operations/runbook.md` lists
> it as a prerequisite before any production cutover, and it remains
> outstanding. Until it has been done once, this paragraph describes a
> capability that is configured but unproven.

**The infrastructure** — `terraform destroy` takes a final snapshot
(`skip_final_snapshot = false`) and is blocked by `deletion_protection` on the
database until that is explicitly turned off. Both are deliberate: staging holds
evaluation data, so destroying it should be awkward.

### Logs and health

- **Health:** `GET https://<host>/health` → `{"status":"ok"}`. App Runner polls
  it every 10s and will not shift traffic to an unhealthy revision.
- **Application logs:** the service's CloudWatch log group. The API logs
  structured JSON through Pino, one line per request, each carrying `reqId` —
  which is also returned to the client as the `x-request-id` header, so a user's
  report can be traced to exact log lines.
- **Database logs:** RDS exports `postgresql` logs to CloudWatch.

That is the whole observability surface, deliberately. Phase 17's scope was the
minimum needed to confirm the deployment is healthy; alerting, dashboards and
tracing are a follow-up.

---

## Known gaps

Real, and better stated here than discovered later.

**There is no password-reset page in the web app.** `/login` is its only
unauthenticated route, so the link in a password-setup email
(`<base>/reset-password?token=…`) currently resolves to the SPA fallback rather
than a password form. The first administrator is unaffected — the bootstrap CLI
prints the token to the operator. But **invited users cannot complete setup from
the email alone**, and inviting real users should wait for that page. Adding it
is an application change, which phase 17 held out of scope.

**The email domain is shared between transactional and campaign mail.** Both go
through one transport. A high complaint rate on campaigns can degrade
deliverability of password resets — i.e. marketing could stop people logging in.
The mitigation is a subdomain split; see ADR-0018.

**A single NAT gateway.** An AZ outage takes the service's egress with it. Fine
for staging, not for production.

**No restore drill.** As above.
