data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Bare Ubuntu host: Docker, Compose and the QA stack are installed by the
# Ansible playbook in ../ansible, not by Terraform, to keep infra
# provisioning and app configuration separate.
resource "aws_instance" "qa_runner" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.runner.id]
  key_name                    = var.key_name != "" ? var.key_name : null
  associate_public_ip_address = true

  tags = {
    Name = "${var.project_name}-qa-runner"
  }
}

# Static public IP so the DNS record you create at your registrar doesn't
# break every time the instance is stopped/started.
resource "aws_eip" "qa_runner" {
  instance = aws_instance.qa_runner.id
  domain   = "vpc"

  tags = {
    Name = "${var.project_name}-qa-runner-eip"
  }
}
