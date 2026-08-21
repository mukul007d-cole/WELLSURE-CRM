# Operations Runbook

## Environments

Separate dev, staging, and production. Infrastructure defined in Terraform (`infra/terraform/`), not click-ops.

## AWS production layout

- Route 53 + ACM, CloudFront where needed
- Application Load Balancer
- ECS Fargate for web, API, worker services
- RDS PostgreSQL — encrypted, automated backups, point-in-time recovery
- ElastiCache Redis (background jobs, throttling, scheduled work)
- S3 for documents/exports/import files — private by default
- Identity provider per ADR-0005 (once resolved)
- SES for email
- Secrets Manager + KMS for credentials and token encryption
- CloudWatch for logs, metrics, alarms
- WAF on public endpoints

## Security baseline

- MFA optional for privileged roles
- TLS everywhere; private subnets for DB and Redis
- File type/size validation and malware scanning on uploads
- No marketplace or legacy passwords stored anywhere in Falcon (see ADR on `pass` field exclusion in migration docs)
- Integration tokens scoped, encrypted, rotated, access-logged
- Dependency/static-analysis/container scanning in CI
- Regular backup-restore test (not just backups existing — proven restorable)

## Monitoring

- Structured logs, correlation/request IDs on every request
- Error tracking (e.g. Sentry) wired to alerts
- Dashboards for API latency, error rate, queue depth, DB connection saturation

## Incident basics

- Rollback plan defined before each production deploy, not improvised during an incident
- Hypercare window immediately after migration cutover and each major release

## Phase 1 local foundation

Local PostgreSQL, Redis, and MinIO run through the root `docker-compose.yml` and
bind only to localhost. `pnpm dev` starts/health-checks them without deleting
volumes; `pnpm infra:down` preserves data and `pnpm infra:reset` is explicitly
destructive. The MinIO initialization job creates a private bucket idempotently.
Local example credentials are never suitable for shared or deployed environments.

The Terraform environment/module structure is validation-only in Phase 1. It
creates no AWS resources, configures no remote state, and includes no identity
provider while ADR-0005 is open. Production backend bootstrap, RPO/RTO, and a
real restore drill remain prerequisites before deployment. Phase 1 verifies only
that the rollback SQL can rebuild a disposable empty development schema; this is
not evidence of a production restore capability.

## Bounded hard-delete (purge)

`purge` permanently removes a configuration entity. It is the only irreversible
operation in the product; a purged row exists nowhere except in a database
backup. See ADR-0017.

**Granting it.** `bootstrapFirstAdmin` deliberately does not grant `purge` — it
is the one catalog action withheld — so the initial administrator gets `403` on
every purge route until somebody grants it under Roles & Permissions. That is
working as designed, and the bootstrap CLI prints it at first run. The grant
itself is an ordinary permission change and appears in `system_audit_logs`.

**What it can and cannot remove.** Journeys, Statuses, Fields, Services, Teams,
Roles and Notification Rules, and only when the entity is already deactivated
and nothing real still references it. Leads, Users and Departments have no purge
route at all. A refusal returns `409 dependency_conflict` naming what is still
in the way.

**After a purge.** The `system_audit_logs` row with `action = 'purge'` is the
only surviving record. Its `old_value` holds the entity's own columns plus every
mapping row removed with it, which is enough to recreate the configuration by
hand. That row is append-only and cannot itself be deleted.

**Recovering a purge that should not have happened.** There is no undo. Restore
from a backup, or recreate the entity from its audit snapshot — note that it
will have a new id, so anything that referenced the old id by value (an export,
a saved report) will not reconnect.

**If a delete is failing with `configuration is deactivated/versioned, never
deleted`.** That is the `*_no_delete` trigger doing its job. Only the purge
transaction is exempt, via a transaction-scoped `SET LOCAL falcon.purge = 'on'`.
Do not set that GUC by hand to force a delete: it bypasses the dependency checks
and the audit row, which is the entire safety mechanism.
