output "zone_id" {
  value = local.zone_id
}

output "name_servers" {
  description = "Name servers of a zone created here (empty when an existing zone was used)."
  value       = var.zone_id == "" ? aws_route53_zone.this[0].name_servers : []
}
