'use strict';

/**
 * This suite is red-or-green only, by explicit, repeated request — see
 * `verifyTranslation()`'s and `openAccountMenu()`'s own comments on the
 * same mandate. allure-playwright maps ANY uncaught exception (a
 * Playwright action timeout — e.g. `.click()` finding nothing in time —
 * not just an explicit `throw`) to a top-level "broken" status, while
 * only an `expect()` assertion failure maps to "failed". Patching every
 * individual call site that could ever throw isn't tractable across a
 * suite this size, so this runs after `promote-broken-steps.js` and
 * relabels any remaining "broken" result to "failed" — the underlying
 * step/error detail is untouched, only the top-level category changes,
 * so what actually happened is still fully visible.
 *
 * Only for Wildies — gcplaying0175.com's own suite deliberately keeps
 * the 3-state orange/green/red system (see project memory: "UI check
 * two-stage pattern"), this must never run against its results dir.
 */
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', process.argv[2] || 'allure-results-wildies');

function main() {
  if (!fs.existsSync(RESULTS_DIR)) return;

  const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith('-result.json'));
  let relabeled = 0;

  for (const file of files) {
    const filePath = path.join(RESULTS_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (data.status === 'broken') {
      data.status = 'failed';
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
      relabeled++;
    }
  }

  if (relabeled > 0) {
    console.log(`wildies-no-broken: relabeled ${relabeled} "broken" result(s) to "failed" (red-or-green only).`);
  }
}

main();
