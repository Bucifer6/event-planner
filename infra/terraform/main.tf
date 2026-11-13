# EventDesk.ro infrastructure (R0-02): network, managed PostgreSQL 16, object storage, a
# secret store, one compute host for web + worker, DNS for the three host names, monitoring.
#
# NOT APPLIED from the build environment. Read README.md first.
#
# Module boundaries are the provider-agnostic part: each module's variables and outputs say
# what the platform needs (an encrypted database with 30-day backups, three encrypted
# versioned buckets, a secret store read by reference, …). The bodies are the AWS reference.

locals {
  name = "${var.project}-${var.environment}"

  # production: eventdesk.ro / app.eventdesk.ro / media.eventdesk.ro
  # staging:    staging.eventdesk.ro / app.staging.eventdesk.ro / media.staging.eventdesk.ro
  public_host = var.environment == "production" ? var.domain : "${var.staging_label}.${var.domain}"
  app_host    = "app.${local.public_host}"
  media_host  = "media.${local.public_host}"
}

module "network" {
  source = "./modules/network"

  name      = local.name
  ssh_cidrs = var.deploy_ssh_cidrs
}

module "database" {
  source = "./modules/database"

  name                     = local.name
  instance_class           = var.db_instance_class
  allocated_storage_gb     = var.db_allocated_storage_gb
  multi_az                 = var.db_multi_az
  backup_retention_days    = var.backup_retention_days
  subnet_ids               = module.network.private_subnet_ids
  vpc_id                   = module.network.vpc_id
  client_security_group_id = module.network.app_security_group_id
}

module "storage" {
  source = "./modules/storage"

  name                  = local.name
  object_recovery_days  = var.object_recovery_days
  backup_retention_days = var.backup_retention_days
}

module "secrets" {
  source = "./modules/secrets"

  name = local.name
}

module "compute" {
  source = "./modules/compute"

  name                   = local.name
  instance_type          = var.host_instance_type
  disk_gb                = var.host_disk_gb
  subnet_id              = module.network.public_subnet_id
  security_group_id      = module.network.app_security_group_id
  deploy_ssh_public_key  = var.deploy_ssh_public_key
  docker_compose_version = var.docker_compose_version
  region                 = var.region

  app_host    = local.app_host
  media_host  = local.media_host
  public_host = local.public_host
  acme_email  = var.acme_email

  app_secret_arn      = module.secrets.app_secret_arn
  secrets_kms_key_arn = module.secrets.kms_key_arn
  object_bucket_arns  = [module.storage.private_bucket_arn, module.storage.media_bucket_arn]
  objects_kms_key_arn = module.storage.objects_kms_key_arn
  backup_bucket_arn   = module.storage.backup_bucket_arn
  backups_kms_key_arn = module.storage.backups_kms_key_arn
}

module "dns" {
  source = "./modules/dns"
  count  = var.manage_dns ? 1 : 0

  domain              = var.domain
  zone_id             = var.dns_zone_id
  public_host         = local.public_host
  app_host            = local.app_host
  media_host          = local.media_host
  target_ipv4         = module.compute.public_ip
  manage_apex_records = var.environment == "production"
  email_spf           = var.email_spf
  email_dkim          = var.email_dkim
  email_dmarc         = var.email_dmarc
  caa_issuers         = var.caa_issuers
}

module "monitoring" {
  source = "./modules/monitoring"

  name                    = local.name
  alert_email             = var.alert_email
  instance_id             = module.compute.instance_id
  db_instance_identifier  = module.database.identifier
  db_allocated_storage_gb = var.db_allocated_storage_gb
}
