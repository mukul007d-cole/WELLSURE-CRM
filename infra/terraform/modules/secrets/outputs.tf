output "name_prefix" {
  description = "Naming prefix shared by this environment's resources."
  value       = local.name_prefix
}

output "database_url_arn" {
  description = "Secret ARN the service references for FALCON_DATABASE_URL."
  value       = aws_secretsmanager_secret.database_url.arn
}

output "email_api_key_arn" {
  description = "Secret ARN the service references for FALCON_EMAIL_API_KEY."
  value       = aws_secretsmanager_secret.email_api_key.arn
}

output "email_api_key_name" {
  description = "Secret name, for the one-time `aws secretsmanager put-secret-value` in the runbook."
  value       = aws_secretsmanager_secret.email_api_key.name
}

output "access_role_arn" {
  description = "Role App Runner assumes to pull the image and read the secrets."
  value       = aws_iam_role.access.arn
}
