# Terraform foundation

Terraform is organized into environment composition roots and reusable modules.
Each environment passes `environment`, `project_name`, `aws_region`,
`public_base_url`, `email_from` and `common_tags` to the module boundaries.

## What is real and what is not

Phase 17 filled in the modules the application actually needs and left the rest
as the interface-only stubs they have been since phase 1.

| Module | State | Why |
| --- | --- | --- |
| `network` | Real | VPC, private and public subnets, NAT, security groups. |
| `database` | Real | RDS PostgreSQL, private, encrypted, automated backups. |
| `secrets` | Real | Secrets Manager entries and the role App Runner reads them with. |
| `compute` | Real | ECR repository, VPC connector, App Runner service. |
| `cache` | Stub | Nothing in the application reads Redis — no client, no queue, no `REDIS_URL` reader. |
| `object-storage` | Stub | Optional by ADR-0012; without the `S3_*` variables the locker answers `503` and the API still boots. |
| `observability` | Stub | The API has a real `/health` and structured logs, and App Runner ships stdout to CloudWatch. |
| `backup` | Stub | RDS automated backups plus the final snapshot cover the documented restore path. |

**Nothing has been applied.** No AWS resources exist and no account has been
touched. See `docs/operations/deployment.md`, and ADR-0018 for the decisions
behind this shape.

Production has never been applied and is not ready; the header of
`environments/production/main.tf` lists what must be answered first.

## State

Production and staging state use a separately bootstrapped encrypted remote
backend with locking. Backend coordinates and account-specific values must not
be committed, so `backend.tf` is an empty `backend "s3" {}` block configured at
`init` time.

This matters more than usual here: the `database` module generates the master
password, so **the state file holds a live credential**. The bucket must be
encrypted, versioned and access-controlled.

## CI

Pull requests run formatting and `init -backend=false` / `validate` only. Apply
is never a pull-request action, and future plans require protected environments
and human review.

```bash
terraform fmt -check -recursive infra/terraform
terraform -chdir=infra/terraform/environments/staging init -backend=false
terraform -chdir=infra/terraform/environments/staging validate
```

> **What `validate` proves, and what it does not.** It checks that the HCL is
> syntactically valid and internally consistent. It does not check that the
> configuration describes a working environment, that the resources are
> sufficient, or that an apply would succeed. Every module in this directory was
> an empty stub for sixteen phases and validated cleanly the whole time. Treat a
> green CI run as "the HCL parses", and a reviewed `terraform plan` against a
> real account as the first real evidence.
