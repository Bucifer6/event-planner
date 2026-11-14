# Every operator decision (docs/build/10-operator-decisions.md) is a variable here. Defaults
# marked PLACEHOLDER are not recommendations: they make `terraform validate` pass and must be
# reviewed before the first apply. Copy production.tfvars.example and fill it in.

variable "project" {
  description = "Short name used as a prefix for every resource."
  type        = string
  default     = "eventdesk"
}

variable "environment" {
  description = "staging or production. One state (workspace or backend key) per environment."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

# OPERATOR DECISION (INF9): all production data stays in the EU, Romania preferred. The
# reference provider has no region in Romania; eu-central-1 (Frankfurt) is the PLACEHOLDER.
# A Romania-hosted vendor is a different provider — see README.md "Swapping the vendor".
variable "region" {
  description = "EU region for every resource."
  type        = string
  default     = "eu-central-1"

  validation {
    condition     = can(regex("^eu-", var.region))
    error_message = "INF9: the region must be in the EU."
  }
}

# ── DNS (INF1) ────────────────────────────────────────────────────────────────

variable "domain" {
  description = "Apex domain of the public site. The app is app.<domain>, media is media.<domain>."
  type        = string
  default     = "eventdesk.ro"
}

variable "manage_dns" {
  description = "Create the DNS records here. Set false when DNS stays with the registrar (then create the records in dns/README by hand)."
  type        = bool
  default     = true
}

variable "dns_zone_id" {
  description = "Existing hosted zone for the domain. Empty = create the zone (then point the registrar's name servers at it). Staging normally reuses the production zone."
  type        = string
  default     = ""
}

variable "staging_label" {
  description = "Staging host names are <label>.<domain>, app.<label>.<domain>, media.<label>.<domain>."
  type        = string
  default     = "staging"
}

# OPERATOR DECISION (INF2, LAU3): the values come from the chosen email provider. Empty =
# the record is not created. Production must not go live without all three (LAU3).
variable "email_spf" {
  description = "SPF TXT value for the sending domain, e.g. \"v=spf1 include:<provider> -all\". PLACEHOLDER: empty."
  type        = string
  default     = ""
}

variable "email_dkim" {
  description = "DKIM records from the email provider: selector host label => CNAME target. PLACEHOLDER: none."
  type        = map(string)
  default     = {}
}

variable "email_dmarc" {
  description = "DMARC TXT value, e.g. \"v=DMARC1; p=quarantine; rua=mailto:<mailbox>\". PLACEHOLDER: empty."
  type        = string
  default     = ""
}

variable "caa_issuers" {
  description = "Certificate authorities allowed to issue for the domain (the reference ingress uses ACME with Let's Encrypt)."
  type        = list(string)
  default     = ["letsencrypt.org"]
}

# ── Database (INF10, INF12) ───────────────────────────────────────────────────

variable "db_instance_class" {
  description = "PLACEHOLDER size for the managed PostgreSQL 16 instance."
  type        = string
  default     = "db.t4g.small"
}

variable "db_allocated_storage_gb" {
  description = "Initial storage in GiB (grows automatically up to four times this)."
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "Standby in a second zone. OPERATOR DECISION (cost against the 4 h RTO of LAU5)."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "INF10: daily backups kept for 30 days. Applies to the provider's snapshots and to the encrypted dumps in the backup bucket."
  type        = number
  default     = 30

  validation {
    condition     = var.backup_retention_days >= 30
    error_message = "INF10 requires at least 30 days of backup retention."
  }
}

# ── Object storage (INF3, INF10, INF12, SEC4) ─────────────────────────────────

variable "object_recovery_days" {
  description = "INF10: a deleted or overwritten object stays recoverable this long (bucket versioning)."
  type        = number
  default     = 30

  validation {
    condition     = var.object_recovery_days >= 30
    error_message = "INF10 requires 30 days of object recovery."
  }
}

# ── Compute (Q7: one web service, one worker) ─────────────────────────────────

variable "host_instance_type" {
  description = "PLACEHOLDER size of the Docker host that runs web + worker + public site + ingress."
  type        = string
  default     = "t3.medium"
}

variable "host_disk_gb" {
  description = "Encrypted root disk of the host (images and logs only; no application data lives on it)."
  type        = number
  default     = 40
}

variable "deploy_ssh_public_key" {
  description = "PUBLIC key of the deploy user. The private half is the GitHub environment secret DEPLOY_SSH_KEY. PLACEHOLDER: empty = no deploy user is created."
  type        = string
  default     = ""
}

# OPERATOR DECISION: who may open SSH to the host. GitHub-hosted runners have no fixed
# addresses; the choices are a self-hosted runner / bastion with a fixed address (list it
# here), or SSH open to the internet with key-only login (["0.0.0.0/0"]). PLACEHOLDER: closed.
variable "deploy_ssh_cidrs" {
  description = "CIDR ranges allowed to reach SSH on the host. Empty = SSH closed (deploys from the console cannot run)."
  type        = list(string)
  default     = []
}

variable "acme_email" {
  description = "Contact address for TLS certificates on the ingress. PLACEHOLDER."
  type        = string
  default     = "ops@example.invalid"
}

variable "docker_compose_version" {
  description = "Docker Compose plugin release installed on the host."
  type        = string
  default     = "v2.29.7"
}

# ── Monitoring (LAU5) ─────────────────────────────────────────────────────────

variable "alert_email" {
  description = "Monitored operator mailbox that receives infrastructure alarms. PLACEHOLDER — the alert channel is an operator decision; application alerts use OPS_ALERT_WEBHOOK_URL."
  type        = string
  default     = "alerts@example.invalid"
}
