# Nothing here is a secret. These are the values the operator copies into the GitHub
# "production" environment and into the application secret (see README.md).

output "hosts" {
  description = "The three host names (INF1)."
  value = {
    public = local.public_host
    app    = local.app_host
    media  = local.media_host
  }
}

output "host_public_ip" {
  description = "Address of the compute host: GitHub environment variable DEPLOY_SSH_HOST, and the target of the DNS records when DNS is managed elsewhere."
  value       = module.compute.public_ip
}

output "name_servers" {
  description = "Set these at the registrar when the zone was created here (empty otherwise)."
  value       = var.manage_dns ? module.dns[0].name_servers : []
}

output "database_endpoint" {
  description = "Host:port of the PostgreSQL 16 instance (private network only). Goes into DATABASE_URL inside the application secret."
  value       = module.database.endpoint
}

output "database_master_secret_arn" {
  description = "Where the provider keeps the master password. Use it once to create the application role; the app never uses the master user."
  value       = module.database.master_secret_arn
}

output "buckets" {
  description = "S3_BUCKET_PRIVATE, S3_BUCKET_MEDIA and BACKUP_S3_BUCKET."
  value = {
    private = module.storage.private_bucket
    media   = module.storage.media_bucket
    backups = module.storage.backup_bucket
  }
}

output "kms_keys" {
  description = "S3_SSE_KMS_KEY_ID (objects) and BACKUP_S3_SSE_KMS_KEY_ID (backups). The backup key is a different key from the one that protects the objects."
  value = {
    objects = module.storage.objects_kms_key_arn
    backups = module.storage.backups_kms_key_arn
  }
}

output "app_secret_name" {
  description = "The secret that holds the application environment (JSON object of NAME: value). Fill it with the secret store's own tools — never through Terraform."
  value       = module.secrets.app_secret_name
}

output "alert_topic_arn" {
  description = "Alarm channel (LAU5)."
  value       = module.monitoring.topic_arn
}
