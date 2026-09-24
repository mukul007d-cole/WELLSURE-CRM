# Deployment and runbook — staging

How the staging environment is built, deployed to, migrated, paused and rolled
back.

> ## Status: live
>
> Staging has been applied to AWS account `509726421007` in `ap-south-1`, and is
> serving. Phase 17 wrote the first version of this document before any of it
> had run, and warned that `validate`-clean HCL proves nothing more than
> internal consistency. The first real apply bore that out. It surfaced five
> bugs in the repository that `validate` had passed, all now fixed, plus several
> steps in this document that were wrong. This version describes what actually
> works. Where a step failed, the failure is quoted, because the error message
> is what the next person will search for.
>
> Production is **not** covered here and is not ready. See the header of
> `infra/terraform/environments/production/main.tf`.

---

## What the environment is

Staging is a **long-lived environment Wellsure evaluates the product on**, not a
disposable smoke test (phase 17 Decision 1A). It holds data people care about,
which is why the database keeps real backups and takes a final snapshot
whenever it is destroyed. It no longer has deletion protection. That was
turned off deliberately so the environment can be paused for cost (see
[Cost management](#cost-management)), and the final snapshot is what keeps a
teardown safe.

| Piece | What it is |
| --- | --- |
| Compute | One AWS App Runner service, from a container image in ECR. |
| Database | RDS PostgreSQL 17, private, encrypted, TLS required, 7-day automated backups. |
| Secrets | AWS Secrets Manager, injected as environment variables. |
| One-off tasks | An ECS Fargate cluster and task definition (`oneoff.tf`) for migrations and the bootstrap CLI. |
| Web | Served by the same container as the API, same origin. |
| Email | Resend (ADR-0018). |
| Health | `GET /health` → `{"status":"ok"}`, which App Runner polls. |

**One service, one origin, deliberately.** `apps/web` calls the API at the
relative path `/api/v1`, and outside `pnpm dev` there is no Vite proxy. The API
serves the built bundle when `FALCON_WEB_ROOT` is set, so the browser's origin
is the API's origin by construction.

Not deployed, and each for a recorded reason: **Redis** (nothing in the source
reads it), **`apps/worker`** (built, and inside the image, but how it should run
is undecided; see [Known gaps](#known-gaps)), **object storage** (optional by
ADR-0012; the locker answers `503` without it).

Every name derives from `<project_name>-<environment>`, `falcon-crm-staging`:

| Thing | Name |
| --- | --- |
| App Runner service | `falcon-crm-staging` |
| ECR repository | `509726421007.dkr.ecr.ap-south-1.amazonaws.com/falcon-crm-staging` |
| RDS instance | `falcon-crm-staging` |
| Final snapshot, taken on destroy | `falcon-crm-staging-final` |
| Secrets | `falcon-crm-staging/database-url`, `falcon-crm-staging/email-api-key` |
| One-off cluster and task definition | `falcon-crm-staging-oneoff` |
| One-off log group | `/ecs/falcon-crm-staging-oneoff` (7-day retention) |

The commands below assume these shell variables, set from the repository root.
None of them is a secret:

```bash
export AWS_REGION=ap-south-1
STAGING=infra/terraform/environments/staging
REGISTRY=509726421007.dkr.ecr.ap-south-1.amazonaws.com
REPO=$REGISTRY/falcon-crm-staging
ONEOFF_CLUSTER=falcon-crm-staging-oneoff
# Exists only once first-time setup step 9 has created the service.
SERVICE_ARN=$(terraform -chdir=$STAGING output -raw service_arn)
```

## First-time setup

The order here is forced, and it is not the order the first version of this
document gave. App Runner cannot create a service from an image it cannot pull.
The image cannot be built until the bootstrap CLI has produced the organization
UUID. The CLI needs a migrated database, and migrating needs the one-off runner.
So the first apply creates everything *except* the App Runner service, and the
service comes last.

### 1. Remote state

`infra/terraform/README.md` requires a separately bootstrapped encrypted backend
with locking, and requires its coordinates to stay out of git. `backend.tf` is
therefore an empty `backend "s3" {}` block, configured at init time. The state
is in S3 with a DynamoDB lock table. For the same reason, this document names
neither, although it names everything else about the environment.

This matters more than usual: the database module generates the master password,
so **the state file contains a live credential**. The bucket must be encrypted,
versioned and access-controlled.

```bash
terraform -chdir=$STAGING init \
  -backend-config=bucket=<state-bucket> \
  -backend-config=key=staging/terraform.tfstate \
  -backend-config=region=ap-south-1 \
  -backend-config=dynamodb_table=<lock-table> \
  -backend-config=encrypt=true
```

### 2. Variables

```bash
cp $STAGING/terraform.tfvars.example $STAGING/terraform.tfvars
# edit: email_from and campaign_email_from. Leave public_base_url as the
# placeholder until step 10, and image_tag as the placeholder until step 9.
```

`terraform.tfvars` is gitignored. It holds no secret, but it holds this
environment's choices, which do not belong in the shared repository.

**`image_tag` has no default, on purpose.** The compute module's own default is
`bootstrap`, a tag nothing ever pushes. Left to that, the first full apply would
ask App Runner to create a service from an image that does not exist. With no
default at the root, Terraform refuses to plan until someone names a tag.
Nothing reads it until step 9, so the example's placeholder is fine until then.
Every plan and apply needs it set, targeted ones included.

### 3. Apply everything except the service — the gate

**This is the first step that creates billable resources.** Everything before it
is reversible for free.

```bash
terraform -chdir=$STAGING plan -out=foundation.plan \
  -target=module.network \
  -target=module.database \
  -target=module.secrets \
  -target=module.compute.aws_ecr_repository.this \
  -target=aws_ecs_cluster.oneoff \
  -target=aws_ecs_task_definition.oneoff \
  -target=aws_iam_role_policy.oneoff_secrets \
  -target=aws_iam_role_policy_attachment.oneoff_execution
# read the plan: no aws_apprunner_* resource should appear. Then
terraform -chdir=$STAGING apply foundation.plan
```

Terraform warns that resource targeting is in effect. That is expected here and
in the cost teardown, and nowhere else.

### 4. The email API key

Terraform creates the secret and never holds its value — putting it in a
variable would put it in a tfvars file or a CI variable, and `AGENTS.md` forbids
secrets in git.

```bash
aws secretsmanager put-secret-value \
  --secret-id falcon-crm-staging/email-api-key \
  --secret-string '<the Resend API key>'
```

Until this runs, the secret holds `REPLACE_VIA_CONSOLE_OR_CLI`. `parseEnv`
refuses only an *empty* key, so the service boots with the placeholder and every
send fails at delivery time with `Resend rejected the message: …`.

Verify the sending domain with the provider first. Per ADR-0018, password resets
and marketing campaigns should not share a sending subdomain.

### 5. Build and push the one-off image

Migrations and the bootstrap CLI run as a Fargate task inside the VPC, on an
image built from the Dockerfile's **`build` stage**, not the runtime stage. The
task runs `pnpm --filter @falcon/database exec prisma …`: only the build stage
enables pnpm, and `prisma` and `dotenv` (which `prisma.config.ts` imports) are
devDependencies.

```bash
aws ecr get-login-password | docker login --username AWS --password-stdin $REGISTRY

ONEOFF_TAG=<the default of oneoff_image_tag in oneoff.tf>
docker build --target build --provenance=false --sbom=false \
  --build-arg VITE_FALCON_ORGANIZATION_ID=not-yet-bootstrapped \
  -t $REPO:$ONEOFF_TAG .
docker push $REPO:$ONEOFF_TAG
```

The build stage refuses to run without `VITE_FALCON_ORGANIZATION_ID`, and before
step 7 there is no UUID to give it. This image never serves the web bundle, so
any non-empty value will do, **for this image only**. Every later one-off image
gets the real UUID.

The task definition pins the tag, so it must match `oneoff_image_tag` exactly.
A freshly created repository has no tags to collide with.

### 6. Migrate

The database is not reachable from the internet. The one-off task runs in the
private subnets under the application security group, which the database admits.
It pulls its image and reads its secret through the NAT gateway, as there are no
VPC endpoints.

The task definition's own command is the read-only `prisma migrate status`, so
running it without overrides changes nothing. `migrate-overrides.json` swaps in
`migrate deploy`:

```bash
TASK_ARN=$(aws ecs run-task \
  --cluster $ONEOFF_CLUSTER \
  --task-definition falcon-crm-staging-oneoff \
  --launch-type FARGATE \
  --network-configuration "$(terraform -chdir=$STAGING output -raw oneoff_network_configuration)" \
  --overrides file://$STAGING/migrate-overrides.json \
  --query 'tasks[0].taskArn' --output text)

aws ecs wait tasks-stopped --cluster $ONEOFF_CLUSTER --tasks "$TASK_ARN"
aws ecs describe-tasks --cluster $ONEOFF_CLUSTER --tasks "$TASK_ARN" \
  --query 'tasks[0].{exitCode: containers[0].exitCode, stoppedReason: stoppedReason}'
aws logs tail /ecs/falcon-crm-staging-oneoff \
  --log-stream-name-prefix "oneoff/oneoff/${TASK_ARN##*/}"
```

A clean run exits `0`, and the log ends with `All migrations have been
successfully applied.` `migrate deploy` never prompts, never resets, and prints
`No pending migrations to apply.` when the database is current. Every
directory in `packages/database/prisma/migrations` applies in order, from
`00000000000000_baseline` on.

### 7. Bootstrap the first administrator — read this before running it

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
- **Run it exactly once**, as the one-off task below.
- **Confirm the refusal immediately afterwards** by running the same task a
  second time and seeing the message above in its log. Do not assume the guard
  works — observe it.
- **Treat the log group as holding a credential.** The one-off task definition
  sets `FALCON_EMAIL_TRANSPORT=console`, so the setup token is printed into
  `/ecs/falcon-crm-staging-oneoff` rather than emailed. The token is single-use
  and expires after 30 minutes, and the log group keeps it for 7 days.
- **Keep who can run the task short.** The task definition stays, because it is
  the migration runner. Its default command is the read-only `migrate status`,
  and bootstrap exists only as an override someone types. Anyone with
  `ecs:RunTask` on it and `iam:PassRole` on its two roles can run anything in
  that image with the database secret, so keep that list short.

```bash
TASK_ARN=$(aws ecs run-task \
  --cluster $ONEOFF_CLUSTER \
  --task-definition falcon-crm-staging-oneoff \
  --launch-type FARGATE \
  --network-configuration "$(terraform -chdir=$STAGING output -raw oneoff_network_configuration)" \
  --overrides '{"containerOverrides":[{"name":"oneoff","command":["node","apps/api/dist/bootstrap-cli.js","--organization-name","Wellsure Solutions","--admin-name","<name>","--admin-email","<email>"]}]}' \
  --query 'tasks[0].taskArn' --output text)
# then wait, check the exit code and tail the log exactly as in step 6
```

The log says `Bootstrap complete for organization <uuid>.` Record that UUID;
every image build from now on needs it. It also prints `Reset token: <token>`,
followed by a `curl` line pointing at `localhost`. That line is the development
transport's convenience and is useless here.

**This is also the first step that connects to the database the way the
application does**, which is where the TLS requirement shows up. RDS PostgreSQL
17's default parameter group sets `rds.force_ssl = 1`. Prisma's migration engine
negotiates TLS on its own, so step 6 works either way. The application and this
CLI connect through `@prisma/adapter-pg` (node-postgres), which sends plaintext
unless the URL says otherwise, and the server refuses it. The first deployment
hit exactly this, and Prisma reported:

```
User was denied access on the database
```

That reads like a credentials problem and is not one. The database module now
ends the connection URL with `sslmode=no-verify`. That encrypts the connection
without validating the server certificate against the RDS CA, which is an
acceptable trade inside the VPC, for staging. `require` would not have been the
lighter choice: node-postgres treats it as `verify-full`, which fails without
the CA bundle. **Production wants the RDS CA bundle and `sslmode=verify-full`.**
See `infra/terraform/modules/database/README.md`.

### 8. Build and push the application image

The organization UUID is substituted into the web bundle **at build time**, so
the image cannot be built until step 7 has run. Getting this order wrong ships a
bundle whose first act in the browser is to throw, which looks like a blank page
and nothing else.

```bash
TAG=$(git rev-parse --short HEAD)
docker build --provenance=false --sbom=false \
  --build-arg VITE_FALCON_ORGANIZATION_ID=<uuid from step 7> \
  -t $REPO:$TAG .
docker push $REPO:$TAG
```

**`--provenance=false --sbom=false` is required.** Without them BuildKit attaches
an attestation manifest and pushes a manifest list rather than a single image
manifest, and App Runner cannot pull that. Fargate tolerates it, which is why
the one-off image never exposed the problem. The flags are harmless there, so
every build in this document carries them.

Tags are immutable and the tag is the git SHA, so a deployed version is always
traceable to a commit — and to a rollback target.

Two things about what goes into the image, both learned the hard way:

- **The runtime image keeps dev dependencies, deliberately.** It once ran
  `pnpm prune --prod` to drop them. In this workspace that emptied
  `apps/api/node_modules` entirely — every symlink into the virtual store,
  production dependencies included. The image built cleanly and the API could
  not start, failing to resolve `fastify` and `@aws-sdk/client-s3`:

  ```
  Error [ERR_MODULE_NOT_FOUND]: Cannot find package '…' imported from /app/apps/api/dist/…
  ```

  Correctness was chosen over image size. **Do not reintroduce the prune as an
  optimisation.** The Dockerfile still has a stage named `pruned`, but it prunes
  nothing. CI now builds the image and boots it, which is how a second attempt
  would be caught.
- **`docs/guides` is inside the build context, and the rest of `docs/` is not.**
  The Settings guide viewer reads `docs/guides/*.md` off disk inside the image.
  `.dockerignore` therefore excludes `docs/*` and re-includes `!docs/guides`. A
  plain `docs` exclusion, which is what the file had, fails the runtime stage's
  `COPY` of `docs/guides`.

### 9. Create the service

Set `image_tag` in `terraform.tfvars` to the SHA pushed in step 8, then apply
the whole configuration. The remaining resources are the App Runner service, its
VPC connector, its instance role and that role's policy, and the ECR lifecycle
policy.

```bash
terraform -chdir=$STAGING plan -out=staging.plan
# read the plan; then
terraform -chdir=$STAGING apply staging.plan
```

The first real apply failed here. The service landed in **`CREATE_FAILED`**,
with a `ResourceInitializationError` naming `secretsmanager:GetSecretValue`.
App Runner resolves `runtime_environment_secrets` using the **instance role**,
not the access role. The access role, in the secrets module, covers the image
pull only. The compute module now grants the instance role its secrets read.
It is recorded here because the error sends you looking at the wrong role.

### 10. Point the service at its own hostname

App Runner's hostname does not exist until the service does, and
`FALCON_PUBLIC_BASE_URL` is built from it:

```bash
terraform -chdir=$STAGING output service_url
# set public_base_url in terraform.tfvars to that value, then plan and apply again
```

The apply changes the service's environment, so App Runner redeploys, on the
same image. `image_identifier` is under `ignore_changes`, so Terraform sends
the tag that is actually deployed, not the variable.

Once a custom domain is attached, `public_base_url` becomes that domain and
stops moving.

### 11. The first administrator's password

The token from step 7 is almost certainly dead by now. It lasts 30 minutes, and
steps 8 to 10 take longer than that. Ask the live service for a fresh one. This
is the same route the [Known gaps](#known-gaps) entry describes, and it goes
through Resend, so it is also the first real test of step 4:

```bash
curl -sS -X POST "$(terraform -chdir=$STAGING output -raw service_url)/api/v1/auth/password-reset/request" \
  -H 'content-type: application/json' \
  -d '{"organizationId":"<uuid from step 7>","email":"<admin email>"}'
# → {"accepted":true}, whatever the address; the link arrives by email
```

The link opens `/reset-password?token=…`. After setting the password, sign in.
**A green `/health` proves nothing about the database** — it answers without
touching it — so signing in is the check that the service can reach Postgres.

---

## Routine operations

### Deploy a change

1. Merge to the default branch and let CI go green. CI builds the image and
   boots it, so a broken image fails there rather than here.
2. If `packages/database/prisma/migrations/` gained a directory, decide the
   migration's order now: see [Run a migration](#run-a-migration). An additive
   migration runs before this deploy. One that removes or narrows something runs
   after it.
3. Build and push a new image tagged with the git SHA (first-time setup step 8 —
   the `VITE_FALCON_ORGANIZATION_ID` build arg is still required, and does not
   change).
4. Point the service at the new tag with **`update-service`**:

   ```bash
   aws apprunner describe-service --service-arn "$SERVICE_ARN" \
     --query 'Service.SourceConfiguration' --output json \
     | jq --arg image "$REPO:$TAG" '.ImageRepository.ImageIdentifier = $image' \
     > source-configuration.json
   aws apprunner update-service --service-arn "$SERVICE_ARN" \
     --source-configuration file://source-configuration.json
   ```

   The round-trip through `describe-service` is deliberate. `update-service`
   takes the whole `SourceConfiguration`, and sending only the image identifier
   risks the port, environment variables and secret references that Terraform
   set. The file holds secret ARNs, never secret values.

5. Watch it land. `Service.Status` reads `OPERATION_IN_PROGRESS`, then `RUNNING`.
   The newest operation reads `SUCCEEDED`, or `ROLLBACK_SUCCEEDED` if the new
   revision failed its health check and App Runner kept the old one serving:

   ```bash
   aws apprunner describe-service --service-arn "$SERVICE_ARN" \
     --query 'Service.{status: Status, image: SourceConfiguration.ImageRepository.ImageIdentifier}'
   aws apprunner list-operations --service-arn "$SERVICE_ARN" --max-results 1
   ```

6. Set `image_tag` in your `terraform.tfvars` to the new SHA. Terraform ignores
   it on an existing service, but it is what the service would be recreated
   from, and the ECR lifecycle policy expires old images (below).

> **Do not use `aws apprunner start-deployment` to ship a new build.** It
> redeploys the image the service is *already* pinned to, reports success, and
> changes nothing. That is easy to miss: tags are immutable and every image is
> tagged with its own SHA, so no tag is ever moved to point at newer code. The
> only way to a new build is a new `ImageIdentifier`, which is what
> `update-service` sets.

### Re-run the current image

`start-deployment` is the right command when the image should stay the same and
the container should restart:

```bash
aws apprunner start-deployment --service-arn "$SERVICE_ARN"
```

The case that needs it is **rotating a secret**. App Runner resolves
`runtime_environment_secrets` when a container starts, so a new value in Secrets
Manager (a new email API key, or a new database URL after a restore) reaches
the running service only through a fresh deployment.

### Run a migration

Migrations run separately from the deploy. They are not part of container
startup, so a failed migration never leaves a half-started service.

**Order is decided per migration**, and the rule is not "migrate first":

- **Additive migrations run before the deploy.** A new table, column or index
  that the running version does not know about cannot break it, and the new
  image needs it from its first request. `00000000000001_status_visibility` is
  the example: its header says it is safe to apply ahead of the code that reads
  it, because an empty table imposes no restriction.
- **A migration that removes or narrows something the running version still
  uses runs after the deploy.** `00000000000003_retire_status_visibility` is the
  example. It is `DROP TABLE status_visibility`, and the version it replaced
  built that table into every lead-list query (`leads/filter-sql.ts`).
  Migrating first would have broken every lead list on the live service until
  the new image finished rolling out. Deploy the image that has stopped using
  the thing, confirm it is serving, then migrate.

The flip side belongs in the rollback plan: once a destructive migration has
run, rolling the application back to a version that used what it removed breaks
that version.

`AGENTS.md` requires every migration to be reversible or to have a documented
rollback path.

The procedure, which **must build a new one-off image every time**:

1. Take a manual RDS snapshot. Automated backups exist, but a named snapshot
   taken deliberately is what you want to restore from:

   ```bash
   aws rds create-db-snapshot --db-instance-identifier falcon-crm-staging \
     --db-snapshot-identifier falcon-crm-staging-before-<migration>
   aws rds wait db-snapshot-available \
     --db-snapshot-identifier falcon-crm-staging-before-<migration>
   ```

2. Build and push a new one-off image, under a **new** tag, with the real UUID:

   ```bash
   ONEOFF_TAG=oneoff-<N+1>
   docker build --target build --provenance=false --sbom=false \
     --build-arg VITE_FALCON_ORGANIZATION_ID=<organization uuid> \
     -t $REPO:$ONEOFF_TAG .
   docker push $REPO:$ONEOFF_TAG
   ```

3. Bump the default of `oneoff_image_tag` in `$STAGING/oneoff.tf` to that tag,
   and commit it, so the repository records which image the runner points at.
   Passing `-var oneoff_image_tag=…` instead works once, but the next apply
   without it quietly moves the runner back.
4. Apply the task definition alone, and read the plan:

   ```bash
   terraform -chdir=$STAGING plan -target=aws_ecs_task_definition.oneoff -out=oneoff.plan
   terraform -chdir=$STAGING apply oneoff.plan
   ```

   The plan must show `aws_ecs_task_definition.oneoff` being replaced with the
   image changing. **If it says `No changes`, stop — step 3 did not happen.**
   This is the easy one to get wrong, and it has caught us twice. The task
   definition pins the image tag, so without the bump it still points at the
   previous one-off image, which has no directory for the new migration. The
   task then runs, `migrate deploy` prints `No pending migrations to apply.`,
   exits `0`, and the migration silently does nothing.
5. Run the migration task exactly as in first-time setup step 6, and read the
   log. Success names the migration you meant to apply. `No pending migrations
   to apply.` when you expected one means a stale image: go back to step 3.
6. Check what the database thinks. The task's default command is
   `migrate status`, so this is the same `run-task` without `--overrides`.

The one-off image the task definition pins is subject to the ECR lifecycle
policy like any other: see [Roll back](#roll-back).

### Roll back

**The application** — point the service at the previous SHA's image with
`update-service`, exactly as in [Deploy a change](#deploy-a-change) step 4.
The API is stateless, so this is the fast, safe path and should be the first
move. Tags are immutable, so there is no re-tagging an old image as current.
`start-deployment` would only redeploy the broken one.

Find the previous tag in ECR:

```bash
aws ecr describe-images --repository-name falcon-crm-staging \
  --query 'reverse(sort_by(imageDetails, &imagePushedAt))[].[imagePushedAt, imageTags[0]]' \
  --output table
```

The lifecycle policy keeps the **last 10 images of any tag**, and one-off images
count toward those ten. A rollback target, or the image the one-off task
definition pins, can therefore age out sooner than "ten deploys ago".

**The schema** — do *not* reach for the baseline's `rollback.sql`. It is a
from-scratch teardown that drops every table, and it will destroy this
environment's data. For a populated database the documented reversal is
**point-in-time restore** from RDS automated backups, which is what the 7-day
retention exists for, or a restore from the snapshot taken before the migration.
Restore to a new instance, verify, then repoint.

> A restore drill has **not** been performed. `docs/operations/runbook.md` lists
> it as a prerequisite before any production cutover, and it remains
> outstanding. Until it has been done once, this paragraph describes a
> capability that is configured but unproven.

**The infrastructure** — `terraform destroy` takes a final snapshot
(`skip_final_snapshot = false`). Deletion protection is **off** in staging, so
nothing else stands in the way. That is deliberate, for the cost teardown below,
and is why reading a destroy plan before applying it matters here.

### Logs and health

- **Health:** `GET https://<host>/health` → `{"status":"ok"}`. App Runner polls
  it every 10s and will not shift traffic to an unhealthy revision. It does not
  touch the database, so it says the process is up and nothing more.
- **Application logs:** `/aws/apprunner/falcon-crm-staging/<service-id>/application`.
  The API logs structured JSON through Pino, one line per request, each carrying
  `reqId`, which is also returned to the client as the `x-request-id` header. A
  user's report can therefore be traced to exact log lines.
- **Service events:** `/aws/apprunner/falcon-crm-staging/<service-id>/service`.
  Deployment progress, health-check failures and the reason behind a
  `CREATE_FAILED` belong here, not in the application log.
- **One-off tasks:** `/ecs/falcon-crm-staging-oneoff`, one stream per task,
  `oneoff/oneoff/<task-id>`.
- **Database logs:** RDS exports `postgresql` logs to CloudWatch.

That is the whole observability surface, deliberately. Phase 17's scope was the
minimum needed to confirm the deployment is healthy; alerting, dashboards and
tracing are a follow-up.

---

## Cost management

Idle, staging costs roughly **$60 a month** in `ap-south-1`:

| Line item | Per month |
| --- | --- |
| NAT gateway | ~$40 |
| RDS `db.t4g.micro` | ~$14 |
| Elastic IP (the NAT's) | ~$3.60 |
| App Runner, idle | ~$3 |
| Secrets, ECR storage, logs, state bucket | pennies |

The teardown below brings that to about **$3–4**. It keeps the parts that are
free or cheap to keep and slow or awkward to recreate: the VPC, the secrets,
the ECR images, the one-off runner, and the App Runner service itself with its
hostname. It removes the three things that bill by the hour.

### Pausing staging

1. **Pause App Runner first**, so nothing is serving while its database goes
   away. A paused service keeps its hostname and configuration and is not billed:

   ```bash
   aws apprunner pause-service --service-arn "$SERVICE_ARN"
   ```

2. **Destroy the database module.** This takes the final snapshot automatically,
   because the module sets `skip_final_snapshot = false`:

   ```bash
   terraform -chdir=$STAGING plan -destroy -target=module.database -out=teardown-db.plan
   terraform -chdir=$STAGING apply teardown-db.plan
   aws rds describe-db-snapshots --db-snapshot-identifier falcon-crm-staging-final \
     --query 'DBSnapshots[0].Status'   # "available"
   ```

   The plan destroys four things: the instance, its subnet group,
   `random_password.master`, and the `database-url` secret's version, which
   depends on the instance. Destroying that version does not empty the secret.
   Secrets Manager will not remove the current version, so the old URL stays in
   place until the restore writes a new one. Anything else in the plan is a
   reason to stop.

   **The snapshot name is fixed**, so this fails if `falcon-crm-staging-final`
   already exists from an earlier cycle. RDS will not overwrite a snapshot. See
   step 5 of the restore.

3. **Destroy the NAT gateway and its Elastic IP:**

   ```bash
   terraform -chdir=$STAGING plan -destroy \
     -target=module.network.aws_nat_gateway.this \
     -target=module.network.aws_eip.nat \
     -out=teardown-nat.plan
   terraform -chdir=$STAGING apply teardown-nat.plan
   ```

   The plan destroys five things: the NAT gateway, the EIP, and the private route
   table with its two associations, which route through the NAT. With the NAT
   gone, nothing in the private subnets reaches the internet, one-off tasks
   included. That is fine while there is no database for them to work on.

> **Stopping the RDS instance is not a substitute.** A stopped instance is
> force-started by RDS after seven days, and starts billing again whether or not
> anyone notices. Stop/start is for overnight. A pause of indefinite length is
> the teardown above.

> **The state bucket is what the restore stands on.** After a teardown, the
> state is the only record tying the VPC, subnets, security groups, secrets,
> ECR repository, App Runner service and one-off runner to this configuration.
> Lose it, and the restore apply tries to create every one of them again and
> collides on names. The way back is then a `terraform import` per resource. The
> snapshot itself survives that. The restore sets a fresh master password
> (below), and RDS can reset one at any time. Everything around the snapshot is
> what gets expensive.

### Restoring staging

1. Set `db_snapshot_identifier = "falcon-crm-staging-final"` in
   `terraform.tfvars`. It only matters when the database is being created.
2. Plan the whole configuration and read it:

   ```bash
   terraform -chdir=$STAGING plan -out=restore.plan
   ```

   It should create exactly what the teardown destroyed: the NAT gateway, the
   EIP, the private route table and its associations, the subnet group, a new
   `random_password.master`, the instance, restored from the snapshot, and a new
   secret version. Nothing should change on the App Runner service.

3. Apply it. The restore takes a while. The restored instance comes back with
   the snapshot's master password, and the AWS provider then immediately sets
   the new generated one (a `ModifyDBInstance` right after the restore). The new
   secret version carries a URL with that password.

   ```bash
   terraform -chdir=$STAGING apply restore.plan
   ```

4. Resume the service, and sign in to prove it reaches the database. `/health`
   alone will not tell you. The service reads secrets when its containers start,
   so resuming picks up the new URL. If it somehow does not, `start-deployment`
   forces a fresh read.

   ```bash
   aws apprunner resume-service --service-arn "$SERVICE_ARN"
   ```

5. Once the restored environment is verified, **delete the snapshot it was
   restored from**, or copy it under a dated name and then delete it. The next
   teardown's final snapshot needs the name `falcon-crm-staging-final` to be
   free:

   ```bash
   aws rds copy-db-snapshot \
     --source-db-snapshot-identifier falcon-crm-staging-final \
     --target-db-snapshot-identifier falcon-crm-staging-final-<date>   # optional
   aws rds delete-db-snapshot --db-snapshot-identifier falcon-crm-staging-final
   ```

Leave `db_snapshot_identifier` set afterwards. It forces replacement, but only
when its value *changes*. Leaving it alone, or setting it back to null, plans no
change. **Never change it while the database exists**: a new value plans
destroying the live instance and restoring over it.

> **The restored environment has a new outbound IP address.** Destroying the EIP
> releases it, and the restore allocates a new one. All of the service's
> outbound traffic leaves from that address, email included. If it is ever
> allowlisted with the email provider, or anywhere else, update the allowlist
> after every restore.

---

## Known gaps

Real, and better stated here than discovered later.

**Password setup is implemented.** `/reset-password` is a public web route that
consumes the opaque token from invitation mail and directs the user to sign in
after success. Invalid, used, expired, and weak-password responses are presented
without reproducing password policy in the browser.

**There is no forgot-password UI.** `POST /api/v1/auth/password-reset/request` is
public, rate-limited, and works. It answers `202 {"accepted":true}` whatever the
address, and emails a reset link if the account exists. Nothing in `apps/web`
calls it. The Users page's **Resend invite** does not cover the gap: it appears
only for users who have never set a password, and the API refuses it for anyone
who has (`user has already established a password`). So any user who has set a
password and forgotten it, administrators included, has no route back through
the product. A locked-out administrator needs the `curl` in first-time setup
step 11 and the organization UUID. The UUID is the one every image build passes
as `VITE_FALCON_ORGANIZATION_ID`. The bootstrap log that first printed it keeps
it for only 7 days.

**Email reputation isolation is configurable, not automatic.** Password resets
use `FALCON_EMAIL_FROM`; campaigns use `FALCON_CAMPAIGN_EMAIL_FROM`. When the
campaign value is unset it deliberately falls back to the transactional sender
for backwards compatibility, so operators must configure and provider-verify
separate `notify.` and `mail.` subdomains to obtain the isolation described in
ADR-0018.

**A single NAT gateway.** An AZ outage takes the service's egress with it. Fine
for staging, not for production.

**No restore drill.** As above. The cost teardown's restore path is a snapshot
restore, so the first full teardown-and-restore cycle is most of one, but not
the point-in-time restore the schema rollback relies on.

**Scheduled campaign delivery (`apps/worker`) is built, shipped in the image,
and not running.** Triggered campaigns record a `pending` `campaign_sends` row,
and in staging nothing drains it on a schedule. Such rows go out only when a
manual send or a retry in the same organization happens to drain every pending
row inline. `apps/worker` polls
`POST /internal/campaigns/drain` on `FALCON_WORKER_POLL_INTERVAL_MS`. That is a
shared-secret-gated route, not a user session. `apps/worker/dist` is inside the
runtime image, next to `apps/api/dist`, so the worker is this image with a
different command: `node apps/worker/dist/main.js`, with
`FALCON_API_INTERNAL_URL` and a `FALCON_INTERNAL_WORKER_TOKEN` matching the
API's. Staging sets neither, so the API's `/internal/*` routes answer
`503 internal_worker_not_configured`. What is **not** decided is *how* it
runs. That is an infrastructure choice this document deliberately does not make
silently:

- **A second small always-on service** (a second App Runner service, or an
  ECS service) — the natural fit for this worker's actual shape, a
  long-running poll loop, and the smallest change from what already exists.
- **A scheduled one-off task** (EventBridge Scheduler → ECS `RunTask` on the
  existing one-off cluster, the mechanism migrations already use) — cheaper if
  idle most of the time. But it would need its own task definition on the
  *runtime* image, since the migration runner's build-stage image is not what
  ships. And `main.ts`'s loop would need a "run one poll and exit" variant
  rather than looping forever, since a scheduled task is expected to finish.

Either way, the credential is `FALCON_INTERNAL_WORKER_TOKEN` — generate one
the same way the database password is generated (Terraform, never typed by
a human), store it the same way the email API key is (a Secrets Manager
entry), and inject it into both the API service and whichever shape the worker
takes. App Runner has no private address in this configuration, so
`FALCON_API_INTERNAL_URL` would be the public service URL, and the shared secret
would be the route's only gate.
