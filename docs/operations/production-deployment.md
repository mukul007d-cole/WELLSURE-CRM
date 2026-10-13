# Production deployment — step by step

This guide takes Falcon from nothing to a live production environment, with
Wellsure's data in it. Follow it top to bottom. Every step says what to run,
what you should see, and what to do if you see something else.

It is the staging procedure (`deployment.md`), which has been run for real, with
production's names and production's choices. Where this guide is brief,
`deployment.md` explains why.

**Time:** about half a day for the infrastructure, phases 1–10. Configuring the
workspace and migrating Cronberry data, phases 11–12, depend on the decisions
listed in phase 0.

---

## Phase 0 — Before you start

Do not start phase 1 until every box here is ticked.

### Accounts and access

- [ ] **AWS access** to the account production will live in, with rights to
      create VPC, RDS, App Runner, ECR, ECS, IAM, Secrets Manager and CloudWatch
      resources.
- [ ] **A domain Wellsure controls**, and someone who can add DNS records to it.
      You need it for email sending, and for the CRM's own address if you
      want one such as `crm.<your-domain>`.
- [ ] **A Resend account**, with the sending domain(s) verified. Use two
      subdomains: one for password and invitation mail (for example
      `notify.<your-domain>`) and one for campaigns (for example
      `mail.<your-domain>`). Have the API key ready. ADR-0018 explains why.
- [ ] **The first administrator's** full name and email address. That person
      must be able to receive email at that address.

### Tools on the machine you run this from

| Tool | Check | Expected |
| --- | --- | --- |
| AWS CLI v2 | `aws --version` | `aws-cli/2.x` |
| Terraform 1.11 | `terraform version` | `Terraform v1.11.x` (CI uses 1.11.4) |
| Docker with buildx | `docker buildx version` | any version |
| jq | `jq --version` | any version |
| git | `git status` | a clean checkout of `main` |

Build from a commit whose CI is green. CI builds the image and boots it, so a
green `main` is known to produce a working image.

### Decisions

Each of these goes into `terraform.tfvars` in phase 2. The recommended values
are already in `terraform.tfvars.example`.

| Decision | Recommended | Why | Alternative |
| --- | --- | --- | --- |
| `db_multi_az` | `true` | A standby in a second AZ. The database survives an AZ outage, and patching does not take it down. | `false` halves the database cost, but maintenance means minutes of downtime. |
| `db_backup_retention_days` | `14` | Two weeks of point-in-time restore. Long enough to notice a problem after a holiday. | Anything from 1 up. |
| `db_instance_class` | `db.t4g.micro` | Staging ran on it. Can be raised later with a short restart. | `db.t4g.small` doubles the memory. |

### What it costs

Measured on staging in `ap-south-1`, adjusted for the choices above:

| Item | Per month, idle |
| --- | --- |
| NAT gateway | ~$40 |
| RDS, Multi-AZ `db.t4g.micro` | ~$28 (~$14 single-AZ) |
| Elastic IP | ~$3.60 |
| App Runner, idle | ~$3, plus usage under load |
| Secrets, ECR, logs | under $5 |
| **Total** | **roughly $75–80 before traffic** |

### Migration readiness

The Cronberry migration in phase 12 is **not ready** until the actions in
`docs/migration/cronberry-export-verification-2026-09.md` §8 are done. In
particular, the export currently has no phone numbers. Phases 1–11 do not
depend on it, so you can build production now and migrate once those answers
are in.

---

## Phase 1 — Set up your shell

Run everything from the repository root, in **one terminal session**. The
commands below rely on these variables.

```bash
cd WELLSURE-CRM                      # the repository root
git checkout main && git pull

export AWS_REGION=ap-south-1
# export AWS_PROFILE=<profile>       # if you use named profiles

ENV_DIR=infra/terraform/environments/production
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGISTRY=$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com
REPO=$REGISTRY/falcon-crm-production
ONEOFF_CLUSTER=falcon-crm-production-oneoff
ONEOFF_TASKDEF=falcon-crm-production-oneoff
ONEOFF_LOGS=/ecs/falcon-crm-production-oneoff

echo "Deploying production into AWS account $ACCOUNT"
```

**Check:** the account number printed is the one production belongs in. If
not, stop and fix your credentials. Everything after this creates resources
in that account.

Then define one helper. It runs a one-off task in the VPC, waits for it,
prints its exit code and shows its log. Phases 6 and 7 use it:

```bash
run_oneoff() {   # usage: run_oneoff [overrides-json | file://path]
  local overrides="$1" task
  task=$(aws ecs run-task \
    --cluster "$ONEOFF_CLUSTER" --task-definition "$ONEOFF_TASKDEF" \
    --launch-type FARGATE \
    --network-configuration "$(terraform -chdir=$ENV_DIR output -raw oneoff_network_configuration)" \
    ${overrides:+--overrides "$overrides"} \
    --query 'tasks[0].taskArn' --output text) || return 1
  echo "Started $task — waiting for it to finish…"
  aws ecs wait tasks-stopped --cluster "$ONEOFF_CLUSTER" --tasks "$task"
  aws ecs describe-tasks --cluster "$ONEOFF_CLUSTER" --tasks "$task" \
    --query 'tasks[0].{exitCode: containers[0].exitCode, stoppedReason: stoppedReason}' \
    --output table
  sleep 5   # let the last log lines arrive
  aws logs tail "$ONEOFF_LOGS" --log-stream-name-prefix "oneoff/oneoff/${task##*/}"
}
```

> If you close the terminal, re-run this whole phase before continuing.

---

## Phase 2 — Terraform state and variables

### 2a. The state bucket

Terraform keeps its state in S3, with a DynamoDB lock table. **The state holds
the database password**, so the bucket must be private, encrypted and
versioned.

Reuse the bucket and table staging used, if they still exist. Production gets
its own key, so the two never touch. If you need new ones:

```bash
STATE_BUCKET=falcon-crm-terraform-state-$ACCOUNT
LOCK_TABLE=falcon-crm-terraform-locks

aws s3api create-bucket --bucket "$STATE_BUCKET" \
  --create-bucket-configuration LocationConstraint=$AWS_REGION
aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "$STATE_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws dynamodb create-table --table-name "$LOCK_TABLE" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

Otherwise set `STATE_BUCKET` and `LOCK_TABLE` to the existing names.

```bash
terraform -chdir=$ENV_DIR init \
  -backend-config=bucket=$STATE_BUCKET \
  -backend-config=key=production/terraform.tfstate \
  -backend-config=region=$AWS_REGION \
  -backend-config=dynamodb_table=$LOCK_TABLE \
  -backend-config=encrypt=true
```

**You should see:** `Terraform has been successfully initialized!`

### 2b. Variables

```bash
cp $ENV_DIR/terraform.tfvars.example $ENV_DIR/terraform.tfvars
```

Edit `$ENV_DIR/terraform.tfvars`:

- `email_from` and `campaign_email_from`: your verified Resend senders.
- The three `db_*` values: your phase 0 decisions.
- Leave `image_tag` and `public_base_url` as placeholders. Phases 9 and 10
  fill them in.

`terraform.tfvars` is gitignored. Do not commit it.

---

## Phase 3 — Create the foundation

This is **the first step that costs money.**

App Runner cannot be created yet: it needs an image, and the image needs an
organization ID that only exists after phase 7. So this apply creates
everything except the App Runner service.

```bash
terraform -chdir=$ENV_DIR plan -out=foundation.plan \
  -target=module.network \
  -target=module.database \
  -target=module.secrets \
  -target=module.compute.aws_ecr_repository.this \
  -target=aws_ecs_cluster.oneoff \
  -target=aws_ecs_task_definition.oneoff \
  -target=aws_iam_role_policy.oneoff_secrets \
  -target=aws_iam_role_policy_attachment.oneoff_execution
```

**Read the plan.** It should only *create*. It should include a VPC, subnets, a
NAT gateway, `aws_db_instance` with `multi_az = true` if you chose that, two
secrets, an ECR repository, and the one-off cluster and task definition. **No
`aws_apprunner_*` resource should appear.** The warning about resource
targeting is expected.

```bash
terraform -chdir=$ENV_DIR apply foundation.plan
```

The database takes 10–20 minutes, longer with Multi-AZ.

**You should see:** `Apply complete!`

---

## Phase 4 — The email API key

```bash
aws secretsmanager put-secret-value \
  --secret-id falcon-crm-production/email-api-key \
  --secret-string 're_xxxxxxxxxxxxxxxx'      # your Resend API key
```

**You should see:** a JSON reply with `"VersionStages": ["AWSCURRENT"]`.

> Paste the key only into this command, never into a file in the repository.
> Until this runs, the secret holds a placeholder and every email fails with
> `Resend rejected the message: …`.

---

## Phase 5 — Build the one-off image

Migrations and the bootstrap command run from an image built from the
Dockerfile's **`build` stage**. That stage has pnpm and the Prisma CLI; the
runtime image does not.

```bash
aws ecr get-login-password | docker login --username AWS --password-stdin $REGISTRY

docker build --target build --provenance=false --sbom=false \
  --build-arg VITE_FALCON_ORGANIZATION_ID=not-yet-bootstrapped \
  -t $REPO:oneoff-1 .
docker push $REPO:oneoff-1
```

- `oneoff-1` must match `oneoff_image_tag` in `$ENV_DIR/oneoff.tf`, which it
  does on a fresh environment.
- The placeholder organization ID is fine **for this image only**. It never
  serves the web app.
- `--provenance=false --sbom=false` is required for the App Runner image in
  phase 8, and harmless here. Use it on every build.

**You should see:** the push end with a `digest: sha256:…` line.

---

## Phase 6 — Create the database tables

```bash
run_oneoff file://$ENV_DIR/migrate-overrides.json
```

**You should see:** `exitCode` `0`, and the log ending with
`All migrations have been successfully applied.`

| If you see | It means | Do |
| --- | --- | --- |
| `CannotPullContainerError` | The image tag does not exist in ECR | Re-check phase 5's tag against `oneoff_image_tag`. |
| `ResourceInitializationError` mentioning secrets | The task cannot read its secret | Re-run phase 3's apply; the one-off role policy may be missing. |
| A non-zero exit and a Prisma error | The migration itself failed | Stop. Keep the log, and do not continue. |

---

## Phase 7 — Create the organization and first administrator

This command creates the one organization and its first administrator. It
**refuses to run a second time**, which is its protection.

```bash
run_oneoff '{"containerOverrides":[{"name":"oneoff","command":["node","apps/api/dist/bootstrap-cli.js","--organization-name","Wellsure Solutions","--admin-name","<Full Name>","--admin-email","<admin@your-domain>"]}]}'
```

**You should see:** exit code `0` and
`Bootstrap complete for organization <uuid>.`

> **Copy that UUID into your password manager now.** Every image build needs
> it, and the log it appears in is deleted after 7 days.

Now **prove it refuses**, by running the exact same command again:

```bash
run_oneoff '{"containerOverrides":[{"name":"oneoff","command":["node","apps/api/dist/bootstrap-cli.js","--organization-name","Wellsure Solutions","--admin-name","<Full Name>","--admin-email","<admin@your-domain>"]}]}'
```

**You should see:** a non-zero exit code and
`Bootstrap refused: the database already contains 1 organization(s) and 1 user(s).`

Two things in the first run's log to know about:

- It also prints `Reset token: …` and a `curl` line pointing at `localhost`.
  Ignore both. The token expires in 30 minutes, long before the site exists,
  and phase 10 issues a fresh one by email. Until then, the log group counts as
  holding a credential.
- If either run fails with `User was denied access on the database`, the
  connection is not using TLS. The database module's URL must end
  `sslmode=no-verify`. Do not change the password. It is not a password
  problem.

---

## Phase 8 — Build the application image

Now with the **real organization UUID** from phase 7:

```bash
ORG_ID=<uuid from phase 7>
TAG=$(git rev-parse --short HEAD)

docker build --provenance=false --sbom=false \
  --build-arg VITE_FALCON_ORGANIZATION_ID=$ORG_ID \
  -t $REPO:$TAG .
docker push $REPO:$TAG
echo "image_tag = \"$TAG\""
```

> **Get the UUID right.** It is baked into the web app. A wrong or missing value
> builds fine and then shows a blank page, or a login that always fails.

---

## Phase 9 — Create the service

Set `image_tag` in `$ENV_DIR/terraform.tfvars` to the value just printed. Then
plan the **whole** configuration:

```bash
terraform -chdir=$ENV_DIR plan -out=service.plan
```

**Read the plan.** It should create the App Runner service, its VPC connector,
its instance role and policy, and the ECR lifecycle policy, and change nothing
else.

```bash
terraform -chdir=$ENV_DIR apply service.plan
SERVICE_ARN=$(terraform -chdir=$ENV_DIR output -raw service_arn)
SERVICE_URL=$(terraform -chdir=$ENV_DIR output -raw service_url)
curl -sS $SERVICE_URL/health
```

**You should see:** `{"status":"ok"}`. Creation takes about five minutes.

| If you see | It means | Do |
| --- | --- | --- |
| `CREATE_FAILED`, `ResourceInitializationError` naming `secretsmanager:GetSecretValue` | The instance role cannot read the secrets | The compute module grants this. Check you are on current `main`. |
| `CREATE_FAILED`, and the service log says the image cannot be pulled | The image was built without `--provenance=false --sbom=false` | Rebuild with the flags, under a new tag. Update `image_tag`, and apply again. |
| `ERR_MODULE_NOT_FOUND` in the application log | The image is missing dependencies | Should be impossible from a green `main`, because CI boots the image. Check the commit. |

Add `SERVICE_ARN` and `SERVICE_URL` to the variables from phase 1 whenever you
open a new terminal.

---

## Phase 10 — Give the service its address, and sign in

### 10a. A custom domain (recommended)

Skip to 10b to use App Runner's generated address instead.

```bash
DOMAIN=crm.<your-domain>
aws apprunner associate-custom-domain --service-arn $SERVICE_ARN \
  --domain-name $DOMAIN --no-enable-www-subdomain
aws apprunner describe-custom-domains --service-arn $SERVICE_ARN
```

In your DNS, add:

- every record listed under `CertificateValidationRecords` (CNAMEs, for the
  TLS certificate), and
- a CNAME from `crm` to the `DNSTarget` shown.

Re-run `describe-custom-domains` until the domain's `Status` is `active`. That
can take from minutes to a couple of hours, depending on DNS.

The custom domain is managed by this CLI call, not by Terraform, the same as the
email key.

### 10b. Tell the app its own address

Set `public_base_url` in `$ENV_DIR/terraform.tfvars` to `https://crm.<your-domain>`,
or to `$SERVICE_URL` if you skipped 10a. Then:

```bash
terraform -chdir=$ENV_DIR plan -out=url.plan    # should change only the service's environment
terraform -chdir=$ENV_DIR apply url.plan
```

The service redeploys itself on the same image. That takes a few minutes.

### 10c. The administrator's first sign-in

Ask the live service to email the administrator a password link. This also
proves email works:

```bash
BASE_URL=https://crm.<your-domain>     # or $SERVICE_URL
curl -sS -X POST "$BASE_URL/api/v1/auth/password-reset/request" \
  -H 'content-type: application/json' \
  -d "{\"organizationId\":\"$ORG_ID\",\"email\":\"<admin@your-domain>\"}"
```

**You should see:** `{"accepted":true}`. The administrator receives an email
within a minute or two.

They open the link, set a password, and sign in.

> **Signing in is the real test.** `/health` does not touch the database, so a
> successful sign-in is what proves the whole chain works.

If no email arrives: check the Resend dashboard for the attempt, and the
service's application log for `Resend rejected the message`.

---

## Phase 11 — Configure the workspace

Everything about Wellsure's process is configuration, done in the app as the
administrator. Nothing here needs code. Follow `docs/guides/admin-guide.md`.
For the Cronberry migration, the order matters:

1. **Roles and permissions.** Grant `leads:import` only to whoever runs the
   migration.
2. **Users.** Every person who will own or work leads, with real email
   addresses. This is the people table from the verification report's §3.2.
3. **Journeys**, and for each one **its Statuses**. The status names must match
   the cleaned export's values exactly, per the verification report's §3.4.
4. **Fields.** One for every column you will import. Include a text Field for
   `audience_id`, which is the match key.

---

## Phase 12 — Migrate the Cronberry data

**Prerequisite:** every action in
`docs/migration/cronberry-export-verification-2026-09.md` §8 is done, and you
have one cleaned CSV per Journey. Those files must not contain `pass` or the
FCM token columns.

For each file, in the app, under Sellers → Import:

1. Upload the file, choose its Journey, and map every column. Map `lead_status`
   to Status and the owner columns to assignments.
2. Set the match key to the `audience_id` Field.
3. **Preview.** Read every rejected row, and fix the file or the configuration
   until the preview is what you expect.
4. **Commit.** Check that the counts reconcile: created + skipped + rejected =
   rows in the file.

Then spot-check a dozen sellers against Cronberry, by owner, status and Field
values. Delete the export files from every machine they were copied to.

---

## Phase 13 — Before you announce it

- [ ] The second bootstrap run refused (phase 7).
- [ ] The administrator signed in (phase 10c).
- [ ] A second user, invited from the Users page, received the invitation email
      and signed in.
- [ ] Imported counts reconcile, and the spot-check matched (phase 12).
- [ ] **Limit who can run the one-off task.** Anyone allowed `ecs:RunTask` on
      `falcon-crm-production-oneoff`, and `iam:PassRole` on its two roles, can
      run anything with the database password. Keep that to the people who
      deploy.
- [ ] The organization UUID, the state bucket name and the Resend account are
      recorded where the team keeps credentials.
- [ ] **Take a named snapshot** of the clean, migrated database:

  ```bash
  aws rds create-db-snapshot --db-instance-identifier falcon-crm-production \
    --db-snapshot-identifier falcon-crm-production-go-live
  ```

---

## After go-live

### Deploying an update

1. Merge to `main` and wait for CI to go green.
2. If the change adds a migration, read "Migrating" below **first**. It decides
   whether the migration runs before or after this deploy.
3. Build and push the image, as in phase 8, with the same `ORG_ID` and a new
   `TAG`.
4. Point the service at it:

   ```bash
   aws apprunner describe-service --service-arn $SERVICE_ARN \
     --query 'Service.SourceConfiguration' --output json \
     | jq --arg image "$REPO:$TAG" '.ImageRepository.ImageIdentifier = $image' \
     > source-configuration.json
   aws apprunner update-service --service-arn $SERVICE_ARN \
     --source-configuration file://source-configuration.json
   ```

5. Watch it until the newest operation is `SUCCEEDED`:

   ```bash
   aws apprunner list-operations --service-arn $SERVICE_ARN --max-results 1
   ```

   `ROLLBACK_SUCCEEDED` means the new version failed its health check, and the
   old one is still serving.

6. Set `image_tag` in `terraform.tfvars` to the new `TAG`.

> **Never use `aws apprunner start-deployment` to ship a new version.** It
> redeploys the version already running. Use it only to restart the same
> version, for example after changing a secret.

**Rolling back** is the same `update-service`, with the previous tag. List the
tags with:

```bash
aws ecr describe-images --repository-name falcon-crm-production \
  --query 'reverse(sort_by(imageDetails, &imagePushedAt))[].[imagePushedAt, imageTags[0]]' \
  --output table
```

### Migrating

- **Additive migrations** (a new table, column or index) run **before** the
  deploy that needs them.
- **A migration that removes or narrows something** runs **after** the deploy
  that stops using it.

Every time:

1. Snapshot: `aws rds create-db-snapshot --db-instance-identifier falcon-crm-production --db-snapshot-identifier falcon-crm-production-before-<name>`
2. Build and push a one-off image under a **new** tag, the next number after
   the current `oneoff_image_tag`, with the real UUID:
   `ONEOFF_TAG=oneoff-<next>`, then
   `docker build --target build --provenance=false --sbom=false --build-arg VITE_FALCON_ORGANIZATION_ID=$ORG_ID -t $REPO:$ONEOFF_TAG . && docker push $REPO:$ONEOFF_TAG`
3. Change `oneoff_image_tag`'s default in `$ENV_DIR/oneoff.tf` to that tag, and
   commit it.
4. `terraform -chdir=$ENV_DIR plan -target=aws_ecs_task_definition.oneoff -out=oneoff.plan`.
   **It must show the task definition being replaced.** If it says
   `No changes`, step 3 did not happen, and the migration would silently do
   nothing.
5. `terraform -chdir=$ENV_DIR apply oneoff.plan`
6. `run_oneoff file://$ENV_DIR/migrate-overrides.json`. The log must name the
   new migration. `No pending migrations to apply.` means a stale image: go
   back to step 3.

`deployment.md` explains each rule, with the real cases from this repository's
history.

---

## Known gaps at launch

These are accepted for go-live, and each is a follow-up.

| Gap | Effect | Workaround until fixed |
| --- | --- | --- |
| **No "forgot password" page** | A user who forgets their password cannot reset it in the app. **Resend invite** works only for users who never set one. | An administrator runs the `curl` from phase 10c with that user's email. |
| **Scheduled campaign delivery is not running** | Triggered campaigns queue but are not sent automatically. Manual sends work. | Send manually. A decision on how to run `apps/worker` is pending (see `deployment.md`). |
| **One NAT gateway** | An outage in that AZ cuts the service's outbound traffic, including email. | None. A second NAT costs about $40 a month more. |
| **Database TLS is not certificate-verified** | Connections are encrypted, but the RDS certificate is not checked. Acceptable inside the private network. | Hardening: the RDS CA bundle in the image and `sslmode=verify-full`. |
| **No alerting** | Nobody is told if `/health` fails. | Check the App Runner console. A CloudWatch alarm is a small follow-up. |
| **No restore drill** | Backups exist, but restoring has not been rehearsed. | Restore `falcon-crm-production-go-live` to a scratch instance once, soon after launch. |
