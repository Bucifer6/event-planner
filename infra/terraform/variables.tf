# R0-02: every operator decision is a variable with a placeholder default — never a
# hard-coded guess (docs/build/10-operator-decisions.md). Secrets are referenced by ARN
# from the operator-configured secret store (SEC13); no values in the repo.

variable "env" {
  description = "dev | staging | prod"
  type        = string
}

variable "region" {
  description = "EU region; Romania preferred where the vendor offers it (INF9)"
  type        = string
  default     = "eu-central-1" # placeholder — operator sets the EU region for the chosen vendor
}

variable "root_domain" {
  type    = string
  default = "eventdesk.ro"
}

variable "app_domain" {
  type    = string
  default = "app.eventdesk.ro"
}

variable "media_domain" {
  type    = string
  default = "media.eventdesk.ro"
}

# Secret store references (ARNs), not values (SEC13).
variable "database_url_secret_arn" {
  type = string
}
variable "app_secrets_arn" {
  type = string
}
variable "backup_kms_key_arn" {
  description = "Backup encryption key, managed separately from the backups (SEC9)"
  type        = string
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro" # placeholder; prod sized by operator
}

variable "app_image" {
  description = "Container image for the app, pushed by the deploy workflow"
  type        = string
}
