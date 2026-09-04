output "name_prefix" {
  description = "Naming prefix shared by this environment's resources."
  value       = local.name_prefix
}

output "endpoint" {
  description = "host:port of the instance."
  value       = aws_db_instance.this.endpoint
}

output "connection_url" {
  description = <<-EOT
    The value of FALCON_DATABASE_URL. Passed to the secrets module, never to the
    service directly — App Runner reads it from Secrets Manager at start.
  EOT
  value       = "postgresql://${local.username}:${urlencode(random_password.master.result)}@${aws_db_instance.this.endpoint}/${local.database}?schema=public"
  sensitive   = true
}
