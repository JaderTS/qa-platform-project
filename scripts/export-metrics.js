'use strict';

// Reads the Playwright JSON reporter output and pushes run metrics to a
// Prometheus Pushgateway so pass/fail/duration trends can be graphed in
// Grafana. Safe to run even if the pushgateway is unreachable (logs and
// exits 0) so it never fails a CI job on its own.

const fs = require('fs');
const path = require('path');

const RESULTS_FILE = process.env.RESULTS_FILE || path.join(process.cwd(), 'test-results', 'results.json');
const PUSHGATEWAY_URL = process.env.PUSHGATEWAY_URL || 'http://localhost:9091';
const JOB_NAME = process.env.PUSHGATEWAY_JOB || 'qa_platform_tests';
const INSTANCE = process.env.PUSHGATEWAY_INSTANCE || 'jsonplaceholder-suite';

function loadStats() {
  const raw = fs.readFileSync(RESULTS_FILE, 'utf8');
  const report = JSON.parse(raw);
  const stats = report.stats || {};

  const passed = stats.expected || 0;
  const failed = stats.unexpected || 0;
  const flaky = stats.flaky || 0;
  const skipped = stats.skipped || 0;
  const total = passed + failed + flaky + skipped;
  const durationSeconds = (stats.duration || 0) / 1000;
  const successRatio = total > 0 ? (passed + flaky) / total : 0;

  return { total, passed, failed, flaky, skipped, durationSeconds, successRatio };
}

function toPrometheusExposition(metrics) {
  return [
    '# TYPE qa_tests_total gauge',
    `qa_tests_total ${metrics.total}`,
    '# TYPE qa_tests_passed gauge',
    `qa_tests_passed ${metrics.passed}`,
    '# TYPE qa_tests_failed gauge',
    `qa_tests_failed ${metrics.failed}`,
    '# TYPE qa_tests_flaky gauge',
    `qa_tests_flaky ${metrics.flaky}`,
    '# TYPE qa_tests_skipped gauge',
    `qa_tests_skipped ${metrics.skipped}`,
    '# TYPE qa_tests_duration_seconds gauge',
    `qa_tests_duration_seconds ${metrics.durationSeconds}`,
    '# TYPE qa_tests_success_ratio gauge',
    `qa_tests_success_ratio ${metrics.successRatio}`,
    '',
  ].join('\n');
}

async function pushToGateway(body) {
  const url = `${PUSHGATEWAY_URL}/metrics/job/${JOB_NAME}/instance/${INSTANCE}`;
  const response = await fetch(url, { method: 'PUT', body });
  if (!response.ok) {
    throw new Error(`pushgateway responded with ${response.status}`);
  }
}

// Optional: also forward the same metrics to Datadog as custom metrics,
// so the same run can be graphed there instead of / alongside Grafana.
async function pushToDatadog(metrics) {
  const apiKey = process.env.DD_API_KEY;
  if (!apiKey) return;

  const site = process.env.DD_SITE || 'datadoghq.com';
  const now = Math.floor(Date.now() / 1000);
  const tags = [`job:${JOB_NAME}`, `instance:${INSTANCE}`];

  const series = Object.entries({
    'qa.tests.total': metrics.total,
    'qa.tests.passed': metrics.passed,
    'qa.tests.failed': metrics.failed,
    'qa.tests.flaky': metrics.flaky,
    'qa.tests.skipped': metrics.skipped,
    'qa.tests.duration_seconds': metrics.durationSeconds,
    'qa.tests.success_ratio': metrics.successRatio,
  }).map(([metric, value]) => ({
    metric,
    type: 0,
    points: [{ timestamp: now, value }],
    tags,
  }));

  const response = await fetch(`https://api.${site}/api/v2/series`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'DD-API-KEY': apiKey },
    body: JSON.stringify({ series }),
  });
  if (!response.ok) {
    throw new Error(`datadog API responded with ${response.status}`);
  }
}

async function main() {
  const metrics = loadStats();
  console.log('QA test run metrics:', metrics);

  try {
    await pushToGateway(toPrometheusExposition(metrics));
    console.log(`Metrics pushed to ${PUSHGATEWAY_URL} (job=${JOB_NAME}, instance=${INSTANCE})`);
  } catch (err) {
    console.warn(`Could not push metrics to Pushgateway: ${err.message}`);
  }

  try {
    await pushToDatadog(metrics);
    if (process.env.DD_API_KEY) console.log('Metrics pushed to Datadog');
  } catch (err) {
    console.warn(`Could not push metrics to Datadog: ${err.message}`);
  }
}

main();
