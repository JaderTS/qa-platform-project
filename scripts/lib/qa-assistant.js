'use strict';

// Shared by scripts/ask.js (CLI) and assistant/server.js (HTTP endpoint):
// pulls the last 24h of qa.tests.* metrics from Datadog and asks Groq to
// answer a question about them in plain language.

const METRICS = [
  'qa.tests.total',
  'qa.tests.passed',
  'qa.tests.failed',
  'qa.tests.flaky',
  'qa.tests.skipped',
  'qa.tests.duration_seconds',
  'qa.tests.success_ratio',
];

async function queryDatadogMetric(metric, apiKey, appKey, site) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 24 * 60 * 60;
  const query = `avg:${metric}{*}`;
  const url = `https://api.${site}/api/v1/query?query=${encodeURIComponent(query)}&from=${from}&to=${now}`;

  const response = await fetch(url, {
    headers: {
      'DD-API-KEY': apiKey,
      'DD-APPLICATION-KEY': appKey,
    },
  });
  if (!response.ok) {
    throw new Error(`Datadog query for ${metric} failed with ${response.status}`);
  }

  const data = await response.json();
  const series = data.series && data.series[0];
  const points = series ? series.pointlist.filter(([, value]) => value !== null) : [];
  if (!points.length) return null;

  const [lastTimestampMs, lastValue] = points[points.length - 1];
  return {
    value: lastValue,
    timestamp: new Date(lastTimestampMs).toISOString(),
    runsInWindow: points.length,
  };
}

async function getTestHealthSummary() {
  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  const site = process.env.DD_SITE || 'datadoghq.com';
  if (!apiKey || !appKey) {
    throw new Error('DD_API_KEY and DD_APP_KEY must be set to query Datadog');
  }

  const summary = {};
  for (const metric of METRICS) {
    summary[metric] = await queryDatadogMetric(metric, apiKey, appKey, site);
  }
  return summary;
}

function summaryToContext(summary) {
  return Object.entries(summary)
    .map(([metric, point]) =>
      point
        ? `${metric}: ${point.value} (as of ${point.timestamp}, ${point.runsInWindow} data points in the last 24h)`
        : `${metric}: no data in the last 24h`
    )
    .join('\n');
}

async function askAboutTests(question) {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    throw new Error('GROQ_API_KEY must be set');
  }
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

  const summary = await getTestHealthSummary();
  const context = summaryToContext(summary);

  const systemPrompt = [
    'You are the QA Cloud Platform assistant. You answer questions about the',
    'health of an automated API test suite (Playwright tests against',
    'JSONPlaceholder), based only on the following metrics pulled from',
    'Datadog for the last 24 hours:',
    '',
    context,
    '',
    'Answer concisely (2-4 sentences), in the same language the question was',
    "asked in. If there is no data, say so plainly instead of guessing.",
  ].join('\n');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      temperature: 0.3,
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return { answer: data.choices[0].message.content.trim(), summary };
}

module.exports = { getTestHealthSummary, askAboutTests };
