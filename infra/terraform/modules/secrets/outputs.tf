output "app_secret_arn" {
  value = aws_secretsmanager_secret.app.arn
}

output "app_secret_name" {
  value = aws_secretsmanager_secret.app.name
}

output "kms_key_arn" {
  value = aws_kms_key.secrets.arn
}
