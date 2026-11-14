variable "name" {
  description = "Prefix for bucket names (must be globally unique together with the suffixes)."
  type        = string
}

variable "object_recovery_days" {
  description = "INF10: how long an overwritten or deleted object stays recoverable."
  type        = number
}

variable "backup_retention_days" {
  description = "INF10: how long an encrypted database dump is kept."
  type        = number
}

variable "media_content_disposition" {
  description = "SEC4: what the media host must answer for every stored PDF. An object store cannot force response headers on its own; the web app's /api/media route and the ingress apply this value. It is recorded here so a different vendor's module (for example one with a CDN in front) can enforce it at the edge."
  type        = string
  default     = "attachment"
}
