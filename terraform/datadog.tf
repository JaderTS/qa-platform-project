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

# Mirrors monitoring/grafana/dashboards/qa-tests.json so the same numbers
# are browsable in Datadog too. Terraform can't flip this dashboard's
# "Public Sharing" toggle (the Datadog API/provider doesn't expose that) -
# that's a one-time manual step: open the dashboard -> Share icon -> Enable
# public sharing.
resource "datadog_dashboard" "qa_tests" {
  title       = "${var.project_name} - JSONPlaceholder test suite"
  description = "Mirrors the Grafana dashboard - same qa.tests.* metrics."
  layout_type = "ordered"

  widget {
    query_value_definition {
      title = "Success ratio"
      request {
        q          = "avg:qa.tests.success_ratio{*}"
        aggregator = "last"
      }
      precision   = 2
      custom_unit = "%"
      autoscale   = true
    }
  }

  widget {
    query_value_definition {
      title = "Tests passed"
      request {
        q          = "avg:qa.tests.passed{*}"
        aggregator = "last"
      }
      autoscale = true
    }
  }

  widget {
    query_value_definition {
      title = "Tests failed"
      request {
        q          = "avg:qa.tests.failed{*}"
        aggregator = "last"
      }
      autoscale = true
    }
  }

  widget {
    query_value_definition {
      title = "Run duration (s)"
      request {
        q          = "avg:qa.tests.duration_seconds{*}"
        aggregator = "last"
      }
      autoscale = true
    }
  }

  widget {
    timeseries_definition {
      title = "Pass/fail trend"
      request {
        q            = "avg:qa.tests.passed{*}"
        display_type = "line"
      }
      request {
        q            = "avg:qa.tests.failed{*}"
        display_type = "line"
      }
      request {
        q            = "avg:qa.tests.flaky{*}"
        display_type = "line"
      }
    }
  }
}

output "datadog_dashboard_url" {
  description = "Datadog dashboard URL (private until you enable Public Sharing manually)"
  value       = "https://${var.datadog_site}${datadog_dashboard.qa_tests.url}"
}
