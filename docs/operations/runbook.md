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
