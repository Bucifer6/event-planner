variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "region" {
  type = string
}

variable "instance_type" {
  type = string
}

variable "disk_gb" {
  type = number
}

variable "subnet_id" {
  type = string
}

variable "security_group_id" {
  type = string
}

variable "deploy_ssh_public_key" {
  description = "Public key of the deploy user. Empty = no deploy user."
  type        = string
}

variable "docker_compose_version" {
  type = string
}

variable "app_host" {
  type = string
}

variable "media_host" {
  type = string
}

variable "public_host" {
  type = string
}

variable "acme_email" {
  type = string
}

variable "deploy_dir" {
  description = "Where the release lives on the host (DEPLOY_DIR of the deploy scripts)."
  type        = string
  default     = "/opt/eventdesk"
}

variable "app_secret_arn" {
  description = "Secret holding the application environment; read by reference at start."
  type        = string
}

variable "secrets_kms_key_arn" {
  type = string
}

variable "object_bucket_arns" {
  description = "Buckets the app reads and writes (private, media)."
  type        = list(string)
}

variable "objects_kms_key_arn" {
  type = string
}

variable "backup_bucket_arn" {
  type = string
}

variable "backups_kms_key_arn" {
  type = string
}
