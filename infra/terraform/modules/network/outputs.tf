output "name_prefix" {
  description = "Naming prefix shared by this environment's resources."
  value       = local.name_prefix
}

output "vpc_id" {
  description = "VPC the environment runs in."
  value       = aws_vpc.this.id
}

output "private_subnet_ids" {
  description = "Subnets for the database and the App Runner VPC connector."
  value       = aws_subnet.private[*].id
}

output "application_security_group_id" {
  description = "Security group the API runs under; the database accepts only this."
  value       = aws_security_group.application.id
}

output "database_security_group_id" {
  description = "Security group protecting the database."
  value       = aws_security_group.database.id
}
