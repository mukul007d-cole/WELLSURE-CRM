variable "project_name" {
  description = "Stable project identifier."
  type        = string
  default     = "falcon-crm"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
}

variable "common_tags" {
  description = "Tags required on all future resources."
  type        = map(string)
  default     = {}
}
