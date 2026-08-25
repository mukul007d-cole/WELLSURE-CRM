output "name_prefix" {
  description = "Naming prefix shared by this environment's resources."
  value       = local.name_prefix
}

output "service_url" {
  description = "App Runner's generated hostname. The value to use for public_base_url until a custom domain is attached."
  value       = "https://${aws_apprunner_service.this.service_url}"
}

output "service_arn" {
  description = "For `aws apprunner start-deployment` in the deploy runbook."
  value       = aws_apprunner_service.this.arn
}

output "ecr_repository_url" {
  description = "Where the deploy pipeline pushes images."
  value       = aws_ecr_repository.this.repository_url
}

output "vpc_connector_arn" {
  description = "Reused by the one-off migration and bootstrap tasks so they reach the private database."
  value       = aws_apprunner_vpc_connector.this.arn
}
