/*
 * Production — not yet applied. The procedure is
 * docs/operations/production-deployment.md.
 *
 * Same shape as staging, which has been applied for real, plus what staging's
 * first apply taught: an `image_tag` with no default, and a one-off runner
 * (`oneoff.tf`) for migrations and bootstrap.
 *
 * Differs from staging on purpose:
 *
 *   * the database is Multi-AZ, with 14 days of backups, by default —
 *     `db_multi_az`, `db_backup_retention_days` and `db_instance_class` are
 *     decisions in terraform.tfvars, and the guide prices them;
 *   * `deletion_protection` keeps the module default of true. Staging turns it
 *     off to allow a cost teardown. Production must not.
 *
 * Accepted for launch, and listed in the guide's known gaps:
 *
 *   * a single NAT gateway, so an AZ outage takes egress with it;
 *   * the connection URL ends `sslmode=no-verify` — encrypted, but the RDS CA
 *     is not validated. Hardening means the RDS CA bundle in the image and
 *     `verify-full`;
 *   * no WAF, no rate limiting beyond the API's own, and no alerting on the
 *     health check;
 *   * no restore drill yet — `docs/operations/runbook.md` lists it as a
 *     prerequisite for cutover.
 *
 * Four modules, not seven. `cache`, `observability` and `backup` are still
 * interface-only stubs, deliberately:
 *
 *   * `cache` — nothing in the application reads Redis. There is no `REDIS_URL`
 *     reader, no client library, and no queue anywhere in the source. It is in
 *     docker-compose and .env.example and consumed by nothing. Provisioning
 *     ElastiCache would be paying for an idle server.
 *   * `observability` — the API has a real `/health` endpoint and structured
 *     Pino logs, and App Runner ships stdout to CloudWatch already. Phase 17's
 *     scope is the minimum needed to confirm the deployment is healthy.
 *   * `backup` — RDS automated backups plus the final snapshot cover this
 *     environment's documented restore path. AWS Backup adds a second mechanism
 *     over the same data.
 *
 * Each is a follow-up with a trigger, not an oversight. See
 * docs/planning/phase-17-deployment.md.
 */

locals {
  common_tags = merge(var.common_tags, {
    Application = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

module "network" {
  source       = "../../modules/network"
  project_name = var.project_name
  environment  = var.environment
  common_tags  = local.common_tags
}

module "database" {
  source                     = "../../modules/database"
  project_name               = var.project_name
  environment                = var.environment
  common_tags                = local.common_tags
  private_subnet_ids         = module.network.private_subnet_ids
  database_security_group_id = module.network.database_security_group_id
  instance_class             = var.db_instance_class
  multi_az                   = var.db_multi_az
  backup_retention_days      = var.db_backup_retention_days
}

module "secrets" {
  source       = "../../modules/secrets"
  project_name = var.project_name
  environment  = var.environment
  common_tags  = local.common_tags
  # Terraform-derived, never hand-entered. The email API key is created empty by
  # this module and filled in out of band.
  database_url = module.database.connection_url
}

module "compute" {
  source                        = "../../modules/compute"
  project_name                  = var.project_name
  environment                   = var.environment
  common_tags                   = local.common_tags
  private_subnet_ids            = module.network.private_subnet_ids
  application_security_group_id = module.network.application_security_group_id
  access_role_arn               = module.secrets.access_role_arn
  database_url_secret_arn       = module.secrets.database_url_arn
  email_api_key_secret_arn      = module.secrets.email_api_key_arn
  public_base_url               = var.public_base_url
  email_from                    = var.email_from
  campaign_email_from           = var.campaign_email_from
  image_tag                     = var.image_tag
}

# Interface-only, as they have been since phase 1. Kept wired so the environment
# still reports every module's naming prefix and so filling one in later is a
# change to the module, not to this file.
module "cache" {
  source       = "../../modules/cache"
  project_name = var.project_name
  environment  = var.environment
  common_tags  = local.common_tags
}

# Also still a stub. Object storage is optional by design (ADR-0012): without the
# five S3_* variables the API boots, the locker routes answer 503, and the UI
# says so. Turning the document locker on for staging is a follow-up that fills
# this module in and adds those five variables to the service.
module "object_storage" {
  source       = "../../modules/object-storage"
  project_name = var.project_name
  environment  = var.environment
  common_tags  = local.common_tags
}

module "observability" {
  source       = "../../modules/observability"
  project_name = var.project_name
  environment  = var.environment
  common_tags  = local.common_tags
}

module "backup" {
  source       = "../../modules/backup"
  project_name = var.project_name
  environment  = var.environment
  common_tags  = local.common_tags
}
