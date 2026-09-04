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
  description = "Subnets the VPC connector places the service's egress in."
  type        = list(string)
}

variable "application_security_group_id" {
  description = "Security group the service egresses from; the database admits only this."
  type        = string
}

variable "access_role_arn" {
  description = "Role App Runner assumes to pull the image and read secrets, from the secrets module."
  type        = string
}

variable "database_url_secret_arn" {
  description = "Secrets Manager ARN for FALCON_DATABASE_URL."
  type        = string
}

variable "email_api_key_secret_arn" {
  description = "Secrets Manager ARN for FALCON_EMAIL_API_KEY."
  type        = string
}

variable "public_base_url" {
  description = <<-EOT
    Public origin of the deployed environment, no trailing slash. Used for the
    password-reset link in outgoing mail and as the CORS origin. Before a custom
    domain is attached this is App Runner's generated URL; the first apply
    therefore sets a placeholder and a second apply sets the real one.
  EOT
  type        = string

  validation {
    condition     = can(regex("^https://[^/]+$", var.public_base_url))
    error_message = "public_base_url must be an https origin with no path or trailing slash."
  }
}

variable "email_transport" {
  description = "FALCON_EMAIL_TRANSPORT. `console` would print credentials into CloudWatch, so a deployed environment must not use it."
  type        = string
  default     = "resend"

  validation {
    condition     = var.email_transport != "console"
    error_message = "The console transport prints reset tokens to stdout, which in a deployed environment means into the log stream."
  }
}

variable "email_from" {
  description = "Verified sender, e.g. `Falcon CRM <no-reply@notify.example.com>`."
  type        = string
}

variable "campaign_email_from" {
  description = "Optional campaign sender; defaults to email_from for backwards compatibility."
  type        = string
  default     = null
  nullable    = true
}

variable "image_tag" {
  description = "Image tag for the first deploy. Later deploys move this outside Terraform; see the lifecycle block."
  type        = string
  default     = "bootstrap"
}

variable "container_port" {
  description = "Port the API listens on inside the container."
  type        = number
  default     = 3000
}

variable "cpu" {
  description = "App Runner vCPU allocation."
  type        = string
  default     = "0.25 vCPU"
}

variable "memory" {
  description = "App Runner memory allocation."
  type        = string
  default     = "0.5 GB"
}

variable "log_level" {
  description = "FALCON_LOG_LEVEL, a Pino level."
  type        = string
  default     = "info"
}
