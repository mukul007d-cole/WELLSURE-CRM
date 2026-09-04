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
 * One service, one origin.
 *
 * `apps/web` calls the API at the relative path `/api/v1`, and outside
 * `pnpm dev` there is no Vite proxy to rewrite it. So the container serves the
 * built web bundle *and* the API, and the browser's origin is the API's origin
 * by construction. Splitting them across two hostnames would need CORS plus a
 * path-rewriting CDN in front, for no benefit at this size.
 */

resource "aws_ecr_repository" "this" {
  name                 = local.name_prefix
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = merge(var.common_tags, { Name = local.name_prefix })
}

# Untagged images accumulate on every deploy and are pure cost.
resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# The role the running container assumes. Distinct from the access role in the
# secrets module, which is used before the container starts. This one holds
# nothing: the API talks only to Postgres and an HTTPS API, neither of which
# uses IAM. It exists so that adding S3 later (ADR-0012) has an obvious home.
data "aws_iam_policy_document" "tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["tasks.apprunner.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "instance" {
  name               = "${local.name_prefix}-apprunner-instance"
  assume_role_policy = data.aws_iam_policy_document.tasks_assume.json

  tags = var.common_tags
}

# All egress leaves through the VPC so the private database is reachable. See the
# NAT gateway comment in the network module for why that forces a NAT.
resource "aws_apprunner_vpc_connector" "this" {
  vpc_connector_name = local.name_prefix
  subnets            = var.private_subnet_ids
  security_groups    = [var.application_security_group_id]

  tags = var.common_tags
}

resource "aws_apprunner_service" "this" {
  service_name = local.name_prefix

  source_configuration {
    # Deploys are driven by the pipeline pushing a new immutable tag and calling
    # StartDeployment, not by App Runner watching the repository. That keeps the
    # deployed tag something a human chose and can name in a rollback.
    auto_deployments_enabled = false

    authentication_configuration {
      access_role_arn = var.access_role_arn
    }

    image_repository {
      image_identifier      = "${aws_ecr_repository.this.repository_url}:${var.image_tag}"
      image_repository_type = "ECR"

      image_configuration {
        port = tostring(var.container_port)

        runtime_environment_variables = {
          FALCON_HTTP_PORT           = tostring(var.container_port)
          FALCON_LOG_LEVEL           = var.log_level
          FALCON_EMAIL_TRANSPORT     = var.email_transport
          FALCON_EMAIL_FROM          = var.email_from
          FALCON_CAMPAIGN_EMAIL_FROM = coalesce(var.campaign_email_from, var.email_from)
          FALCON_PUBLIC_BASE_URL     = var.public_base_url
          # Same origin, so the browser never issues a cross-origin request.
          # Set anyway because parseEnv requires it.
          FALCON_CORS_ORIGIN           = var.public_base_url
          FALCON_SESSION_COOKIE_SECURE = "true"
        }

        # Never literals: App Runner resolves these from Secrets Manager at
        # start, so no credential appears in this file, in state as a service
        # attribute, or in the service's console page.
        runtime_environment_secrets = {
          FALCON_DATABASE_URL  = var.database_url_secret_arn
          FALCON_EMAIL_API_KEY = var.email_api_key_secret_arn
        }
      }
    }
  }

  instance_configuration {
    cpu               = var.cpu
    memory            = var.memory
    instance_role_arn = aws_iam_role.instance.arn
  }

  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = aws_apprunner_vpc_connector.this.arn
    }
  }

  # The application already has a real health endpoint; phase 17 uses it rather
  # than building an observability stack around it.
  health_check_configuration {
    protocol            = "HTTP"
    path                = "/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }

  tags = merge(var.common_tags, { Name = local.name_prefix })

  lifecycle {
    # The deployed tag is moved by the deploy pipeline, not by Terraform. Without
    # this, every apply would roll the service back to whatever tag the variable
    # defaulted to.
    ignore_changes = [source_configuration[0].image_repository[0].image_identifier]
  }
}
