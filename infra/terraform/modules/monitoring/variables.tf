variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "alert_email" {
  description = "Monitored operator mailbox for infrastructure alarms."
  type        = string
}

variable "instance_id" {
  type = string
}

variable "db_instance_identifier" {
  type = string
}

variable "db_allocated_storage_gb" {
  type = number
}
