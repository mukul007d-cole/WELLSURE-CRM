locals {
  common_tags = merge(var.common_tags, {
    Application = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

module "network" {
  source       = "../../modules/network"
  project_name = var.project_name
  environment  = var.environment
  common_tags  = local.common_tags
}

module "compute" {
  source       = "../../modules/compute"
  project_name = var.project_name
  environment  = var.environment
  common_tags  = local.common_tags
}

module "database" {
  source       = "../../modules/database"
  project_name = var.project_name
  environment  = var.environment
  common_tags  = local.common_tags
}

module "cache" {
  source       = "../../modules/cache"
  project_name = var.project_name
  environment  = var.environment
  common_tags  = local.common_tags
}

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
