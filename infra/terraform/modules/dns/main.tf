# DNS for the three host names (INF1) and the email-authentication records (LAU3):
#
#   <domain>         public site          → compute ingress
#   app.<domain>     web app and /mcp     → compute ingress
#   media.<domain>   uploaded PDFs        → compute ingress (a different ORIGIN than the app, SEC4)
#
# SPF, DKIM and DMARC values come from the email provider (operator decision); a record is
# created only when its value is given.

resource "aws_route53_zone" "this" {
  count = var.zone_id == "" ? 1 : 0

  name = var.domain
}

locals {
  zone_id = var.zone_id == "" ? aws_route53_zone.this[0].zone_id : var.zone_id
  hosts   = toset([var.public_host, var.app_host, var.media_host])
}

resource "aws_route53_record" "host" {
  for_each = local.hosts

  zone_id = local.zone_id
  name    = each.value
  type    = "A"
  ttl     = 300
  records = [var.target_ipv4]
}

resource "aws_route53_record" "www" {
  count = var.manage_apex_records ? 1 : 0

  zone_id = local.zone_id
  name    = "www.${var.domain}"
  type    = "A"
  ttl     = 300
  records = [var.target_ipv4]
}

resource "aws_route53_record" "spf" {
  count = var.manage_apex_records && var.email_spf != "" ? 1 : 0

  zone_id = local.zone_id
  name    = var.domain
  type    = "TXT"
  ttl     = 3600
  records = [var.email_spf]
}

resource "aws_route53_record" "dkim" {
  for_each = var.manage_apex_records ? var.email_dkim : {}

  zone_id = local.zone_id
  name    = "${each.key}.${var.domain}"
  type    = "CNAME"
  ttl     = 3600
  records = [each.value]
}

resource "aws_route53_record" "dmarc" {
  count = var.manage_apex_records && var.email_dmarc != "" ? 1 : 0

  zone_id = local.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 3600
  records = [var.email_dmarc]
}

resource "aws_route53_record" "caa" {
  count = var.manage_apex_records && length(var.caa_issuers) > 0 ? 1 : 0

  zone_id = local.zone_id
  name    = var.domain
  type    = "CAA"
  ttl     = 3600
  records = [for issuer in var.caa_issuers : "0 issue \"${issuer}\""]
}
