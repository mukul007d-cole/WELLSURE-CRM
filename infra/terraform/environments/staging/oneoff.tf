variable "oneoff_image_tag" {
  type    = string
  default = "oneoff-1"
}

resource "aws_ecs_cluster" "oneoff" {
  name = "${var.project_name}-${var.environment}-oneoff"
  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "oneoff" {
  name              = "/ecs/${var.project_name}-${var.environment}-oneoff"
  retention_in_days = 7
  tags              = local.common_tags
}

data "aws_iam_policy_document" "oneoff_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "oneoff_execution" {
  name               = "${var.project_name}-${var.environment}-oneoff-execution"
  assume_role_policy = data.aws_iam_policy_document.oneoff_assume.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "oneoff_execution" {
  role       = aws_iam_role.oneoff_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "oneoff_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [module.secrets.database_url_arn, module.secrets.email_api_key_arn]
  }
}

resource "aws_iam_role_policy" "oneoff_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.oneoff_execution.id
  policy = data.aws_iam_policy_document.oneoff_secrets.json
}

resource "aws_iam_role" "oneoff_task" {
  name               = "${var.project_name}-${var.environment}-oneoff-task"
  assume_role_policy = data.aws_iam_policy_document.oneoff_assume.json
  tags               = local.common_tags
}

resource "aws_ecs_task_definition" "oneoff" {
  family                   = "${var.project_name}-${var.environment}-oneoff"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.oneoff_execution.arn
  task_role_arn            = aws_iam_role.oneoff_task.arn

  container_definitions = jsonencode([{
    name             = "oneoff"
    image            = "${module.compute.ecr_repository_url}:${var.oneoff_image_tag}"
    essential        = true
    workingDirectory = "/app"
    command          = ["pnpm", "--filter", "@falcon/database", "exec", "prisma", "migrate", "status", "--config", "prisma.config.ts"]

    environment = [
      { name = "FALCON_HTTP_PORT", value = "3000" },
      { name = "FALCON_CORS_ORIGIN", value = var.public_base_url },
      { name = "FALCON_LOG_LEVEL", value = "info" },
      { name = "FALCON_SESSION_COOKIE_SECURE", value = "true" },
      { name = "FALCON_EMAIL_TRANSPORT", value = "console" },
    ]

    secrets = [
      { name = "FALCON_DATABASE_URL", valueFrom = module.secrets.database_url_arn },
      { name = "DATABASE_URL", valueFrom = module.secrets.database_url_arn },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.oneoff.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "oneoff"
      }
    }
  }])

  tags = local.common_tags
}

output "oneoff_cluster_name" { value = aws_ecs_cluster.oneoff.name }
output "oneoff_task_definition" { value = aws_ecs_task_definition.oneoff.family }
output "oneoff_log_group" { value = aws_cloudwatch_log_group.oneoff.name }
output "oneoff_network_configuration" {
  value = jsonencode({
    awsvpcConfiguration = {
      subnets        = module.network.private_subnet_ids
      securityGroups = [module.network.application_security_group_id]
      assignPublicIp = "DISABLED"
    }
  })
}
