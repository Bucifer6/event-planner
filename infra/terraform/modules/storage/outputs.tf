output "private_bucket" {
  value = aws_s3_bucket.this["private"].bucket
}

output "private_bucket_arn" {
  value = aws_s3_bucket.this["private"].arn
}

output "media_bucket" {
  value = aws_s3_bucket.this["media"].bucket
}

output "media_bucket_arn" {
  value = aws_s3_bucket.this["media"].arn
}

output "backup_bucket" {
  value = aws_s3_bucket.this["backups"].bucket
}

output "backup_bucket_arn" {
  value = aws_s3_bucket.this["backups"].arn
}

output "objects_kms_key_arn" {
  value = aws_kms_key.objects.arn
}

output "backups_kms_key_arn" {
  value = aws_kms_key.backups.arn
}

output "media_content_disposition" {
  description = "Header value the media host must send (SEC4)."
  value       = var.media_content_disposition
}
