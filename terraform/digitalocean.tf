# Optional (off by default - enable_assistant = false) QA assistant: a small
# Express endpoint (assistant/server.js) that answers natural-language
# questions about the test suite's health, backed by Datadog metrics and
# Groq for the language model. Deployed on DigitalOcean App Platform instead
# of a droplet, since it's a single stateless HTTP service that doesn't
# warrant managing a VM.
#
# One-time manual prerequisite: the DigitalOcean GitHub App must be
# installed/authorized for assistant_github_repo. App Platform's UI prompts
# for this the first time you connect a GitHub source; there's no
# Terraform-only way to do this handshake.
resource "digitalocean_app" "qa_assistant" {
  count = var.enable_assistant ? 1 : 0

  spec {
    name   = "${var.project_name}-assistant"
    region = "nyc"

    service {
      name               = "assistant"
      instance_count     = 1
      instance_size_slug = "apps-s-1vcpu-0.5gb"
      http_port          = 8080

      github {
        repo           = var.assistant_github_repo
        branch         = "main"
        deploy_on_push = true
      }

      build_command = "npm ci"
      run_command   = "node assistant/server.js"

      health_check {
        http_path = "/health"
      }

      env {
        key   = "GROQ_API_KEY"
        value = var.groq_api_key
        type  = "SECRET"
      }

      env {
        key   = "DD_API_KEY"
        value = var.dd_api_key
        type  = "SECRET"
      }

      env {
        key   = "DD_APP_KEY"
        value = var.dd_app_key
        type  = "SECRET"
      }

      env {
        key   = "DD_SITE"
        value = var.datadog_site
      }
    }
  }
}

output "assistant_url" {
  description = "Public URL of the QA assistant app, if enabled"
  value       = var.enable_assistant ? digitalocean_app.qa_assistant[0].live_url : null
}
