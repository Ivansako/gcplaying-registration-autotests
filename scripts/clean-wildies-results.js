'use strict';

/**
 * Clears out accumulated Wildies test/report artifacts before a fresh
 * full run — added 2026-08-31 after `allure-results-wildies` was found
 * holding 677 files (one day of iterative debugging reruns, each adding
 * more without ever being cleared) right before a "final" report needed
 * to reflect only that one clean run. `allure generate` never cleans its
 * INPUT directory itself, only its output, so this has to be explicit.
 *
 * Deliberately a separate opt-in script, not baked into `test:wildies`
 * itself — a targeted `--grep` rerun to verify one fix is meant to ADD
 * to the existing results (so the next report generation picks up the
 * newer, fixed result for just that test), not wipe everything else out.
 * Run this only when starting a genuinely fresh full run.
 */
const fs = require('fs');
const path = require('path');

// `test-results-wildies`, not the shared `test-results` — confirmed
// live 2026-09-11 every brand config defaulted to that same shared
// directory, so cleaning it here could rip out another brand's
// in-progress run. Each brand config now sets its own `outputDir`.
const TARGETS = ['allure-results-wildies', 'allure-report-wildies', 'playwright-report-wildies', 'test-results-wildies'];

for (const dir of TARGETS) {
  const full = path.join(__dirname, '..', dir);
  fs.rmSync(full, { recursive: true, force: true });
  console.log(`removed ${dir}`);
}
