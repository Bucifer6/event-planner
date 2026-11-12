# R0-02 reference topology (EU). Artifact only — applied by the operator, never from CI
# of this repo. Vendor is operator-configurable (variables.tf).

provider "aws" {
  region = var.region
}

# --- DNS (INF1): root marketing site, app, media ---
resource "aws_route53_zone" "root" {
  name = var.root_domain
}

resource "aws_route53_record" "app" {
  zone_id = aws_route53_zone.root.zone_id
  name    = var.app_domain
  type    = "CNAME"
  ttl     = 300
  records = ["<app-ingress-placeholder>"] # operator fills from the app compute output
}

resource "aws_route53_record" "media" {
  zone_id = aws_route53_zone.root.zone_id
  name    = var.media_domain
  type    = "CNAME"
  ttl     = 300
  records = ["<media-cdn-placeholder>"] # operator fills from the object-store CDN output
}

resource "aws_route53_record" "root_apex" {
  zone_id = aws_route53_zone.root.zone_id
  name    = var.root_domain
  type    = "A"
  alias {
    name                   = "<public-site-placeholder>"
    zone_id                = "<public-site-zone-id>"
    evaluate_target_health = true
  }
}

# --- Database (R0-03): managed Postgres, encrypted, daily backups 30-day retention ---
resource "random_password" "db" {
  length  = 32
  special = true
}

resource "aws_db_instance" "postgres" {
  identifier              = "eventdesk-${var.env}"
  engine                  = "postgres"
  instance_class          = var.db_instance_class
  allocated_storage       = 20
  storage_encrypted       = true
  db_name                 = "eventdesk"
  username                = "eventdesk_app"
  password                = random_password.db.result # value only ever lands in the secret store
  backup_retention_period = 30
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"
  deletion_protection     = var.env == "prod"
  publicly_accessible     = false
}

# Backup key management is separate from the backups (SEC9): the KMS key is created and
# access-controlled out of band by the operator; here we only reference it.
resource "aws_s3_bucket" "backups" {
  bucket = "eventdesk-${var.env}-backups"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.backup_kms_key_arn
    }
  }
}

# --- Media object store (INF3): S3-compatible, EU; served with attachment headers (SEC4) ---
resource "aws_s3_bucket" "media" {
  bucket = "eventdesk-${var.env}-media"
}

resource "aws_s3_bucket_policy" "media_attachment" {
  bucket = aws_s3_bucket.media.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "ForceAttachmentDisposition"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.media.arn}/*"
      Condition = {
        StringEquals = { "s3:ExistingObjectTag/content-disposition" = "attachment" }
      }
    }]
  })
}

# --- App compute ---
resource "aws_ecs_cluster" "app" {
  name = "eventdesk-${var.env}"
}

# Task role reads secrets by ARN only (SEC13); DATABASE_URL is injected at boot from the
# secret store, and the app refuses to boot in production without it (instrumentation.ts).
resource "aws_ecs_task_definition" "app" {
  family                   = "eventdesk-${var.env}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = "<execution-role-placeholder>"
  container_definitions = jsonencode([{
    name  = "web"
    image = var.app_image
    environment = [
      { name = "APP_ENV", value = var.env == "prod" ? "production" : "staging" },
      { name = "APP_URL", value = "https://${var.app_domain}" },
      { name = "PUBLIC_SITE_URL", value = "https://${var.root_domain}" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
      { name = "APP_SECRETS", valueFrom = var.app_secrets_arn }
    ]
  }])
}
