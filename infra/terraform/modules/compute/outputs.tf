output "name_prefix" {
  description = "Naming prefix shared by this environment's resources."
  value       = local.name_prefix
}

output "service_url" {
  description = "App Runner's generated hostname. The value to use for public_base_url until a custom domain is attached."
  value       = "https://${aws_apprunner_service.this.service_url}"
}

output "service_arn" {
  description = "For `aws apprunner update-service` (a new image) and `start-deployment` (the same image again) in the deploy runbook."
  value       = aws_apprunner_service.this.arn
}

output "ecr_repository_url" {
  description = "Where the deploy pipeline pushes images."
  value       = aws_ecr_repository.this.repository_url
}

output "vpc_connector_arn" {
  description = "The App Runner VPC connector. The one-off tasks do not use it; they run in the private subnets directly."
  value       = aws_apprunner_vpc_connector.this.arn
}
