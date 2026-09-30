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
  description = <<-EOT
    Image tag App Runner is created with: the git SHA of a build already pushed
    to ECR.

    No default, on purpose. The compute module's own default is "bootstrap", a
    tag nothing ever pushes, and App Runner cannot create a service from an
    image it cannot pull. With no default, Terraform stops and asks for a value
    instead of quietly using that one. After creation the service ignores this
    value (see the compute module's lifecycle block) — deploys move the tag
    with `aws apprunner update-service` — but keep it naming an image still in
    ECR, because it is what the service comes back as if it is ever recreated.
  EOT
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

    Only change it while the database does not exist. It forces replacement,
    so a new value against a live instance plans a destroy-and-restore. Leaving
    it set after a restore, or setting it back to null, plans no change.
  EOT
  type        = string
  default     = null
}
