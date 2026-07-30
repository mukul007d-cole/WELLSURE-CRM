terraform {
  required_version = ">= 1.11.0, < 2.0.0"
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}
