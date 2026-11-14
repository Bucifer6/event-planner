variable "name" {
  description = "Prefix for resource names."
  type        = string
}

variable "cidr" {
  description = "Address range of the private network."
  type        = string
  default     = "10.20.0.0/16"
}

variable "ssh_cidrs" {
  description = "Ranges allowed to reach SSH on the compute host. Empty = closed."
  type        = list(string)
  default     = []
}
