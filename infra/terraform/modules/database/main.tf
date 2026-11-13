# Managed PostgreSQL 16 (Q7, INF9): encrypted at rest with a customer-managed key (INF12),
# daily automatic backups kept 30 days (INF10), private network only, TLS required.
#
# These provider snapshots are the first line of recovery (RPO 24 h, LAU5). The SECOND,
# independent line is the application-level dump that the worker and the deploy pipeline
# encrypt with a key held outside this account (scripts/deploy/container-backup.sh, SEC9).

resource "aws_kms_key" "database" {
  description             = "${var.name} database encryption at rest"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "database" {
  name          = "alias/${var.name}-database"
  target_key_id = aws_kms_key.database.key_id
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "database" {
  name        = "${var.name}-database"
  description = "EventDesk PostgreSQL: only the compute host may connect"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name}-database"
  }
}

resource "aws_vpc_security_group_ingress_rule" "postgres" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from the compute host"
  referenced_security_group_id = var.client_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
}

resource "aws_db_instance" "this" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class
  db_name        = "eventdesk"

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.allocated_storage_gb * 4
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.database.arn

  # The master password is generated and kept by the provider's secret store; it never
  # appears in Terraform state, in the repository or in a variable (SEC13).
  username                    = "eventdesk_admin"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = var.multi_az
  parameter_group_name   = aws_db_parameter_group.this.name

  # Daily backup at 23:30 UTC (02:30 Europe/Bucharest in summer), kept 30 days (INF10).
  backup_retention_period  = var.backup_retention_days
  backup_window            = "23:30-00:30"
  maintenance_window       = "sun:01:00-sun:02:00"
  copy_tags_to_snapshot    = true
  delete_automated_backups = false

  auto_minor_version_upgrade = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${var.name}-final"
}
