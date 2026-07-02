terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local backend by default. For team use, switch to an S3 backend:
  # backend "s3" {
  #   bucket = "my-tfstate-bucket"
  #   key    = "qa-platform/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region
}
