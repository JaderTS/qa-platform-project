# Requires DD_API_KEY and DD_APP_KEY in the environment (see provider.tf).
# This is the "active" half of the Datadog integration: scripts/export-metrics.js
# already pushes qa.tests.* on every run; this monitor watches that stream
# and flips red in Datadog the moment a run reports a failure.
resource "datadog_monitor" "qa_test_failures" {
  name    = "[${var.project_name}] QA test suite has failing tests"
  type    = "metric alert"
  message = "The JSONPlaceholder API test suite reported failing tests in the last run. Check the Grafana dashboard or the Playwright report for details. No further notification targets are configured - see monitor tags for context."

  # Evaluated hourly (matches the cron/CI cadence in ansible/playbook.yml
  # and .github/workflows/playwright.yml), so a 1h window avoids false
  # "no data" gaps between runs.
  query = "max(last_1h):max:qa.tests.failed{job:qa_platform_tests} > 0"

  monitor_thresholds {
    critical = 0
  }

  notify_no_data    = false
  renotify_interval = 0
  include_tags      = true

  tags = ["project:${var.project_name}", "env:${var.environment}"]
}
