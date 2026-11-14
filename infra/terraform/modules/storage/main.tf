# S3-compatible object storage (INF3), EU region:
#
#   private  — every upload (photos, plans, quotes). Read only through signed, scoped links.
#   media    — PDFs served on the separate media host as downloads, never inline (SEC4).
#   backups  — encrypted database dumps. Its at-rest key is a DIFFERENT key from the one for
#              the objects, and the dumps themselves are encrypted before upload with a key
#              that is not in this account at all (SEC9: the key is never stored alongside
#              the backups).
#
# All three: no public access, TLS only, versioning (a deleted asset is recoverable for 30
# days, INF10), server-side encryption with a customer-managed key (INF12).

resource "aws_kms_key" "objects" {
  description             = "${var.name} object storage encryption at rest"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "objects" {
  name          = "alias/${var.name}-objects"
  target_key_id = aws_kms_key.objects.key_id
}

resource "aws_kms_key" "backups" {
  description             = "${var.name} backup bucket encryption at rest (separate from the objects key)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "backups" {
  name          = "alias/${var.name}-backups"
  target_key_id = aws_kms_key.backups.key_id
}

locals {
  buckets = {
    private = {
      kms_key_arn = aws_kms_key.objects.arn
    }
    media = {
      kms_key_arn = aws_kms_key.objects.arn
    }
    backups = {
      kms_key_arn = aws_kms_key.backups.arn
    }
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets

  bucket = "${var.name}-${each.key}"

  tags = {
    Purpose = each.key
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each = aws_s3_bucket.this

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = local.buckets[each.key].kms_key_arn
    }
  }
}

# Uploads: an overwritten or deleted object is kept as an old version for 30 days, then
# removed for good. Nothing live is ever expired by this rule.
resource "aws_s3_bucket_lifecycle_configuration" "objects" {
  for_each = toset(["private", "media"])

  bucket = aws_s3_bucket.this[each.key].id

  rule {
    id     = "recover-for-${var.object_recovery_days}-days"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.object_recovery_days
    }

    expiration {
      expired_object_delete_marker = true
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}

# Backups: a dump is kept for the retention period, then expires. The pipeline itself can
# write and read dumps but never delete them (see the compute module's policy).
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.this["backups"].id

  rule {
    id     = "keep-${var.backup_retention_days}-days"
    status = "Enabled"

    filter {}

    expiration {
      days = var.backup_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.object_recovery_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.this]
}

data "aws_iam_policy_document" "tls_only" {
  for_each = aws_s3_bucket.this

  statement {
    sid       = "DenyPlainHttp"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [each.value.arn, "${each.value.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "tls_only" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id
  policy = data.aws_iam_policy_document.tls_only[each.key].json

  depends_on = [aws_s3_bucket_public_access_block.this]
}
