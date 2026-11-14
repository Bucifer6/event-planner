output "instance_id" {
  value = aws_instance.host.id
}

output "public_ip" {
  description = "Fixed address of the host (DNS target, DEPLOY_SSH_HOST)."
  value       = aws_eip.host.public_ip
}
