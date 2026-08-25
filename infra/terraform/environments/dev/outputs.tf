output "module_name_prefixes" {
  description = "Naming prefixes exposed by each module."
  value = {
    network        = module.network.name_prefix
    compute        = module.compute.name_prefix
    database       = module.database.name_prefix
    secrets        = module.secrets.name_prefix
    cache          = module.cache.name_prefix
    object_storage = module.object_storage.name_prefix
    observability  = module.observability.name_prefix
    backup         = module.backup.name_prefix
  }
}

output "service_url" {
  description = "Where the environment is reachable. Set `public_base_url` to this before the second apply."
  value       = module.compute.service_url
}

output "service_arn" {
  description = "For `aws apprunner start-deployment` when deploying a new image."
  value       = module.compute.service_arn
}

output "ecr_repository_url" {
  description = "Where to push the container image."
  value       = module.compute.ecr_repository_url
}

output "database_endpoint" {
  description = "host:port of the database. Not reachable from outside the VPC."
  value       = module.database.endpoint
}

output "email_api_key_secret_name" {
  description = "Fill this in once, by hand: `aws secretsmanager put-secret-value --secret-id <this>`."
  value       = module.secrets.email_api_key_name
}
