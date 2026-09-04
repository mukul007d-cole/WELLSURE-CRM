terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60, < 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6, < 4.0"
    }
  }
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  database    = "falcon"
  username    = "falcon"
}

resource "aws_db_subnet_group" "this" {
  name       = local.name_prefix
  subnet_ids = var.private_subnet_ids

  tags = merge(var.common_tags, { Name = local.name_prefix })
}

/*
 * Generated here rather than supplied as a variable, so the password never
 * exists in a tfvars file, a shell history, or a pull request. It lands in
 * Terraform state — which is why `infra/terraform/README.md` requires the state
 * backend to be encrypted — and is published to Secrets Manager by the secrets
 * module, which is where the application reads it from.
 *
 * RDS rejects several punctuation characters in master passwords; the excluded
 * set below is the documented one.
 */
resource "random_password" "master" {
  length           = 40
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_instance" "this" {
  identifier     = local.name_prefix
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  db_name  = local.database
  username = local.username
  password = random_password.master.result

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 4
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.database_security_group_id]
  # The database is never reachable from the internet. Migrations and psql go
  # through a one-off task inside the VPC — see docs/operations/deployment.md.
  publicly_accessible = false

  # Staging is a long-lived evaluation environment (phase 17 Decision 1A), so it
  # holds data Wellsure cares about even though it is not production. Backups are
  # therefore real, and this is what the documented point-in-time restore
  # rollback path depends on.
  backup_retention_period = var.backup_retention_days
  backup_window           = "02:00-03:00"
  maintenance_window      = "Sun:03:30-Sun:04:30"
  copy_tags_to_snapshot   = true

  # Single-AZ: staging accepts a maintenance-window restart. Production would
  # set this true.
  multi_az = false

  auto_minor_version_upgrade = true
  deletion_protection        = var.deletion_protection
  # A final snapshot is what makes `terraform destroy` recoverable rather than
  # terminal, which matters once this environment holds evaluation data.
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name_prefix}-final"

  # Postgres logs to CloudWatch; this plus the API's own logs is the whole
  # observability surface phase 17 builds, deliberately.
  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = merge(var.common_tags, { Name = local.name_prefix })
}
