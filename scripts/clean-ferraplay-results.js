'use strict';

/**
 * Clears out accumulated FerraPlay test/report artifacts before a fresh
 * full run — same reasoning as `clean-wildies-results.js`: a day of
 * iterative debugging reruns (Account menu, Tournaments, page
 * baselines, ...) left `allure-results-ferraplay` holding results from
 * dozens of overlapping partial `--grep` runs, not one clean pass.
 * `allure generate` never cleans its INPUT directory itself, only its
 * output, so this has to be explicit.
 *
 * Deliberately a separate opt-in script, not baked into `test:ferraplay`
 * itself — a targeted `--grep` rerun to verify one fix is meant to ADD
 * to the existing results, not wipe everything else out. Run this only
 * when starting a genuinely fresh full run.
 */
const fs = require('fs');
const path = require('path');

const TARGETS = ['allure-results-ferraplay', 'allure-report-ferraplay', 'playwright-report-ferraplay', 'test-results'];

for (const dir of TARGETS) {
  const full = path.join(__dirname, '..', dir);
  fs.rmSync(full, { recursive: true, force: true });
  console.log(`removed ${dir}`);
}
