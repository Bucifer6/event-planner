# Secret store (SEC13). Terraform creates the CONTAINER only. The values — session secret,
# database URL of the application role, email provider key, GitHub App key, deploy record
# token, object store keys, … (every name is in .env.example) — are written with the secret
# store's own tools by the operator and are read by the compute host BY REFERENCE at start.
# They are never in this repository, in Terraform state, in an image or in a log.
#
#   aws secretsmanager put-secret-value --secret-id <app_secret_name> --secret-string file://app-env.json
#
# app-env.json is one JSON object: { "SESSION_SECRET": "…", "DATABASE_URL": "…", … }.
# Rotation (at least yearly, and when a staff member leaves): put a new value, then roll the
# release; record the date on /console/launch. The backup DECRYPTION key is deliberately not
# kept here: it lives outside this account (SEC9).

resource "aws_kms_key" "secrets" {
  description             = "${var.name} secret store encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${var.name}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.name}/app-env"
  description             = "EventDesk application environment (JSON object of NAME: value)"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = 30
}
