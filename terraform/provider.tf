terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    datadog = {
      source  = "DataDog/datadog"
      version = "~> 3.0"
    }
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
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

# Reads DD_API_KEY / DD_APP_KEY from the environment - never put real
# Datadog keys in terraform.tfvars. api_url must match the Datadog site
# your org lives on (see var.datadog_site).
provider "datadog" {
  api_url = "https://api.${var.datadog_site}/"
}

# Reads DIGITALOCEAN_TOKEN from the environment - generate one at
# https://cloud.digitalocean.com/account/api/tokens.
provider "digitalocean" {}
