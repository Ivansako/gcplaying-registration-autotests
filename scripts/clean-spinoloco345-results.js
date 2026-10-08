'use strict';

/**
 * Clears out accumulated Spinoloco345 test/report artifacts before a
 * fresh full run — same reasoning as `clean-shelbyspin-results.js`.
 */
const fs = require('fs');
const path = require('path');

const TARGETS = ['allure-results-spinoloco345', 'allure-report-spinoloco345', 'playwright-report-spinoloco345', 'test-results-spinoloco345'];

for (const dir of TARGETS) {
  const full = path.join(__dirname, '..', dir);
  fs.rmSync(full, { recursive: true, force: true });
  console.log(`removed ${dir}`);
}
