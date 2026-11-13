variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "instance_class" {
  type = string
}

variable "allocated_storage_gb" {
  type = number
}

variable "multi_az" {
  type = bool
}

variable "backup_retention_days" {
  description = "INF10: at least 30."
  type        = number
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Private subnets in at least two zones."
  type        = list(string)
}

variable "client_security_group_id" {
  description = "The only security group allowed to connect (the compute host)."
  type        = string
}
