terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # State holds resource ids, never secret values (the database password is managed by the
  # provider's secret store and the application secret has no version in Terraform). Still,
  # keep it in an encrypted, access-controlled, EU-located backend — an operator decision:
  #
  # backend "s3" {
  #   bucket = "REPLACE-terraform-state-bucket"
  #   key = "eventdesk/production.tfstate"
  #   region = "eu-central-1"
  #   encrypt = true
  #   dynamodb_table = "REPLACE-terraform-locks"
  # }
}
