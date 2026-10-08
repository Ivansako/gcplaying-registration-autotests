'use strict';

/**
 * Clears out accumulated ShelbySpin3322 test/report artifacts before a
 * fresh full run — same reasoning as `clean-ferraplay-results.js`.
 */
const fs = require('fs');
const path = require('path');

const TARGETS = ['allure-results-shelbyspin', 'allure-report-shelbyspin', 'playwright-report-shelbyspin', 'test-results-shelbyspin'];

for (const dir of TARGETS) {
  const full = path.join(__dirname, '..', dir);
  fs.rmSync(full, { recursive: true, force: true });
  console.log(`removed ${dir}`);
}
