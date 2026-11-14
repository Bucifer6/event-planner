variable "domain" {
  description = "Apex domain (the hosted zone)."
  type        = string
}

variable "zone_id" {
  description = "Existing zone id; empty = create the zone."
  type        = string
  default     = ""
}

variable "public_host" {
  type = string
}

variable "app_host" {
  type = string
}

variable "media_host" {
  type = string
}

variable "target_ipv4" {
  description = "Address the three host names point at (the compute ingress)."
  type        = string
}

variable "manage_apex_records" {
  description = "Create the domain-wide records (www, email authentication, CAA). True for production only, so staging does not fight over them."
  type        = bool
}

variable "email_spf" {
  type    = string
  default = ""
}

variable "email_dkim" {
  type    = map(string)
  default = {}
}

variable "email_dmarc" {
  type    = string
  default = ""
}

variable "caa_issuers" {
  type    = list(string)
  default = []
}
