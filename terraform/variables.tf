variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefix used to tag and name every resource"
  type        = string
  default     = "qa-platform"
}

variable "environment" {
  description = "Deployment environment (e.g. dev, staging)"
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets (one per AZ)"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets, used only by RDS"
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24"]
}

variable "availability_zones" {
  description = "Availability zones to spread subnets across"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "instance_type" {
  description = "EC2 instance type for the QA runner (t3.micro is free-tier eligible)"
  type        = string
  default     = "t3.micro"
}

variable "key_name" {
  description = "Name of an existing EC2 key pair used for SSH access"
  type        = string
  default     = ""
}

variable "allowed_ssh_cidr" {
  description = "CIDR range allowed to SSH into the runner instance"
  type        = string
  default     = "0.0.0.0/0"
}

variable "domain_name" {
  description = "Domain pointed (A record) at the runner's Elastic IP, used by Caddy to request a Let's Encrypt certificate. Leave empty to skip HTTPS/domain setup."
  type        = string
  default     = ""
}

variable "datadog_site" {
  description = "Datadog site your org lives on (check the URL when logged into the Datadog UI, e.g. datadoghq.com or us5.datadoghq.com)"
  type        = string
  default     = "datadoghq.com"
}

variable "enable_rds" {
  description = "Whether to provision the (optional, billable) RDS instance used to store historical test-run data"
  type        = bool
  default     = false
}

variable "db_name" {
  description = "Database name created on the RDS instance"
  type        = string
  default     = "qaplatform"
}

variable "db_username" {
  description = "Master username for the RDS instance"
  type        = string
  default     = "qaplatform_admin"
}

variable "db_password" {
  description = "Master password for the RDS instance. Set via TF_VAR_db_password or a gitignored *.auto.tfvars file, never commit it."
  type        = string
  default     = ""
  sensitive   = true
}

variable "db_instance_class" {
  description = "Instance class for the RDS instance"
  type        = string
  default     = "db.t3.micro"
}

variable "enable_assistant" {
  description = "Whether to provision the QA assistant app on DigitalOcean App Platform"
  type        = bool
  default     = false
}

variable "assistant_github_repo" {
  description = "GitHub repo (owner/name) App Platform deploys the assistant from - must already have the DigitalOcean GitHub App installed/authorized (App Platform UI prompts for this once)"
  type        = string
  default     = "JaderTS/qa-platform-project"
}

variable "groq_api_key" {
  description = "Groq API key used by the QA assistant (console.groq.com). Set via TF_VAR_groq_api_key, never committed."
  type        = string
  default     = ""
  sensitive   = true
}

variable "dd_api_key" {
  description = "Datadog API key, passed to the assistant app so it can query qa.tests.* metrics. Set via TF_VAR_dd_api_key, never committed."
  type        = string
  default     = ""
  sensitive   = true
}

variable "dd_app_key" {
  description = "Datadog Application key, required (alongside the API key) to query metrics. Set via TF_VAR_dd_app_key, never committed."
  type        = string
  default     = ""
  sensitive   = true
}
