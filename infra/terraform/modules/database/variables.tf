variable "project_name" {
  description = "Stable project identifier used in resource names."
  type        = string
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "common_tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}

variable "private_subnet_ids" {
  description = "Private subnets for the DB subnet group. RDS requires at least two AZs."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "RDS requires a subnet group spanning at least two availability zones."
  }
}

variable "database_security_group_id" {
  description = "Security group admitting PostgreSQL traffic from the API only."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL major version. Must match what the migration baseline targets."
  type        = string
  # docker-compose.yml and the Testcontainers suites both run 17.x, so local,
  # CI and deployed all agree on the major version.
  default = "17.5"
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Initial storage in GiB. Autoscales to four times this."
  type        = number
  default     = 20
}

variable "backup_retention_days" {
  description = "Automated backup retention. Zero disables backups and the documented restore path with them."
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_days >= 1
    error_message = "Point-in-time restore is this environment's documented rollback path, so retention cannot be zero."
  }
}

variable "deletion_protection" {
  description = "Refuse to delete the instance until this is turned off."
  type        = bool
  default     = true
}
