output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "qa_runner_public_ip" {
  description = "Static (Elastic IP) public IP of the QA runner - use this as the Ansible inventory host and as the target of your domain's A record"
  value       = aws_eip.qa_runner.public_ip
}

output "qa_runner_public_dns" {
  description = "Public DNS of the QA runner EC2 instance"
  value       = aws_instance.qa_runner.public_dns
}

output "rds_endpoint" {
  description = "Connection endpoint of the RDS instance, if enabled"
  value       = var.enable_rds ? aws_db_instance.main[0].endpoint : null
}
