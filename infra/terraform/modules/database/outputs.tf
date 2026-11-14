output "identifier" {
  value = aws_db_instance.this.identifier
}

output "endpoint" {
  description = "host:port, reachable from the compute host only."
  value       = aws_db_instance.this.endpoint
}

output "master_secret_arn" {
  description = "Secret-store entry holding the master password (managed by the provider)."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}
