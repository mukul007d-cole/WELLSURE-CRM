terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60, < 7.0"
    }
  }
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

/*
 * Two secrets, and the difference between them is the whole point of this
 * module.
 *
 * The database URL is *derived* — Terraform generated the password and knows
 * the endpoint, so it writes the value. The email API key is *not*: it comes
 * from a third party, so Terraform creates an empty container for it and a
 * human fills it in once, out of band. Putting it in a variable would put it in
 * a tfvars file or a CI variable, and `AGENTS.md` forbids secrets in git.
 *
 * `ignore_changes` on the email key's version is what stops the next
 * `terraform apply` overwriting the hand-entered value with the placeholder.
 */

resource "aws_secretsmanager_secret" "database_url" {
  name        = "${local.name_prefix}/database-url"
  description = "FALCON_DATABASE_URL. Written by Terraform from the RDS module."
  # Staging is disposable enough to want a short window if it is ever recreated,
  # but not zero: a deleted secret with no recovery window is unrecoverable.
  recovery_window_in_days = 7

  tags = var.common_tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = var.database_url
}

resource "aws_secretsmanager_secret" "email_api_key" {
  name                    = "${local.name_prefix}/email-api-key"
  description             = "FALCON_EMAIL_API_KEY. Set by hand; Terraform never holds this value."
  recovery_window_in_days = 7

  tags = var.common_tags
}

resource "aws_secretsmanager_secret_version" "email_api_key" {
  secret_id = aws_secretsmanager_secret.email_api_key.id
  # A placeholder, so the secret exists and the service can reference it before
  # anyone has an API key. The API refuses to boot on a real transport with an
  # unusable key, which is the intended loud failure rather than silent
  # non-delivery — see parseEnv and docs/operations/deployment.md.
  secret_string = "REPLACE_VIA_CONSOLE_OR_CLI"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# The role App Runner assumes to *fetch* the secrets. Distinct from the instance
# role the application runs as: this one is used before the container starts.
data "aws_iam_policy_document" "build_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["build.apprunner.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.database_url.arn, aws_secretsmanager_secret.email_api_key.arn]
  }
}

resource "aws_iam_role" "access" {
  name               = "${local.name_prefix}-apprunner-access"
  assume_role_policy = data.aws_iam_policy_document.build_assume.json

  tags = var.common_tags
}

resource "aws_iam_role_policy" "read_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.access.id
  policy = data.aws_iam_policy_document.read_secrets.json
}

resource "aws_iam_role_policy_attachment" "ecr_pull" {
  role       = aws_iam_role.access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}
