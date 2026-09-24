variable "project_name" {
  description = "Stable project identifier."
  type        = string
  default     = "falcon-crm"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
}

variable "image_tag" {
  description = "Image tag App Runner is created with. GIT SHA of the first real build."
  type        = string
}
variable "common_tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}

variable "aws_region" {
  description = "Region for this environment."
  type        = string
}

variable "public_base_url" {
  description = <<-EOT
    Public https origin of this environment, no trailing slash.

    Chicken-and-egg on the very first apply: App Runner's hostname does not exist
    until the service does. Apply once with a placeholder, read
    `service_url` from the outputs, then set this and apply again. Once a custom
    domain is attached, this becomes that domain and stops moving.
  EOT
  type        = string
}

variable "email_from" {
  description = "Verified sender address for outgoing mail, e.g. `Falcon CRM <no-reply@notify.example.com>`."
  type        = string
}

variable "campaign_email_from" {
  description = "Optional verified campaign sender on a reputation-isolated subdomain. Defaults to email_from."
  type        = string
  default     = null
  nullable    = true
}

variable "db_snapshot_identifier" {
  description = <<-EOT
    Restore the database from this snapshot instead of creating an empty one.
    Null (the default) creates a fresh database — which is what you want
    normally. Set it when bringing staging back after a cost-saving teardown;
    `terraform destroy` leaves a final snapshot named "falcon-crm-staging-final".
  EOT
  type        = string
  default     = null
}