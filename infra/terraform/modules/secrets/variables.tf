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

variable "database_url" {
  description = "FALCON_DATABASE_URL, from the database module. Never entered by hand."
  type        = string
  sensitive   = true
}
