'use strict';

const { askAboutTests } = require('./lib/qa-assistant');

async function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    console.error('Usage: npm run ask -- "how are the tests doing today?"');
    process.exit(1);
  }

  try {
    const { answer } = await askAboutTests(question);
    console.log(answer);
  } catch (err) {
    console.error(`Could not get an answer: ${err.message}`);
    process.exit(1);
  }
}

main();
