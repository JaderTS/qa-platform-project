'use strict';

const express = require('express');
const { askAboutTests } = require('../scripts/lib/qa-assistant');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/ask', async (req, res) => {
  const question = (req.body && req.body.question || '').trim();
  if (!question) {
    return res.status(400).json({ error: 'Missing "question" in request body' });
  }

  try {
    const { answer } = await askAboutTests(question);
    res.json({ answer });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`QA assistant listening on port ${port}`);
});
