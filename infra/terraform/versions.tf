terraform {
  required_version = ">= 1.9"
  required_providers {
    # Operator-configurable vendor: aws is the reference; any EU-region provider works
    # by swapping the provider block and resource types in main.tf.
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
