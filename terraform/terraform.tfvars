aws_region   = "us-east-1"
project_name = "qa-platform"
environment  = "dev"

vpc_cidr             = "10.0.0.0/16"
public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24"]
private_subnet_cidrs = ["10.0.11.0/24", "10.0.12.0/24"]
availability_zones   = ["us-east-1a", "us-east-1b"]

instance_type    = "t3.micro"       # free-tier; the hourly cron now has flock+timeout so a hung/OOM run can't cascade
key_name         = "qa-project-key" # back on the original AWS account - the student account is pending AWS account verification
allowed_ssh_cidr = "0.0.0.0/0"      # restrict this to your own IP/32 in real use

# Point an A record for this domain at the `qa_runner_public_ip` output
# before applying the Ansible playbook, so Caddy can issue a certificate.
domain_name = "jaderdomain.app"

# Must match the site your Datadog org lives on (check the URL when logged
# into the Datadog UI). DD_API_KEY / DD_APP_KEY come from the environment,
# never from this file.
datadog_site = "us5.datadoghq.com"

# RDS is optional and off by default. To enable it, set enable_rds = true
# and pass db_password via TF_VAR_db_password (never commit a real password).
enable_rds = false
