variable "project_name" {
  description = "Stable project identifier used in future resource names."
  type        = string
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
}

variable "common_tags" {
  description = "Tags required on future resources."
  type        = map(string)
  default     = {}
}
