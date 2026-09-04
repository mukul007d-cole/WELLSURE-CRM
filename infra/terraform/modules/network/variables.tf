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

variable "cidr_block" {
  description = "VPC address range. Must leave room for four /20 subnets."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrsubnet(var.cidr_block, 4, 3))
    error_message = "cidr_block must be large enough to carve four subnets from (a /20 or larger)."
  }
}
