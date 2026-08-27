'use strict';

/**
 * allure-playwright sets each test result's top-level `status` purely from
 * Playwright's own pass/fail outcome (see its `onTestEnd` handler) — it
 * never looks at nested step statuses. Our UI-check findings are reported
 * via `logStep(..., Status.BROKEN)` specifically so a finding doesn't fail
 * the test (see pages/*.ts `attachScreenshot()`), which means those tests
 * keep a top-level "passed" status even though a nested step is "broken".
 * That's correct for pass/fail purposes, but leaves the finding invisible
 * in the Suites/Behaviors tree (which colors by the top-level status only)
 * unless you open the test and expand its steps.
 *
 * This walks every result JSON in allure-results/ before `allure generate`
 * runs and promotes any "passed" test that contains a "broken" step
 * (at any depth) to a top-level "broken" status — so it renders as the
 * orange dot in the report tree. Never touches an already-"failed" test
 * (a real functional failure stays red, as it should).
 *
 * Also copies allure-categories.json (tracked in the repo root) into
 * allure-results/categories.json, since allure-results/ itself is
 * gitignored and rebuilt fresh every run. Allure's built-in status *name*
 * shown on the badge/tooltip is always "Broken" — that's hardcoded in the
 * report viewer itself, not configurable — but the Categories grouping
 * (a separate tab/label Allure derives from categories.json) is, so this
 * renames the default "Test defects"/"Product defects" buckets to
 * "Passed with Errors" / "Failed", matching this project's own vocabulary
 * for the three states that matter here: Passed (green), Failed (red),
 * Passed with Errors (orange).
 */
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'allure-results');
const CATEGORIES_SOURCE = path.join(__dirname, '..', 'allure-categories.json');

function hasBrokenStep(steps) {
  for (const step of steps || []) {
    if (step.status === 'broken') return true;
    if (hasBrokenStep(step.steps)) return true;
  }
  return false;
}

function main() {
  if (!fs.existsSync(RESULTS_DIR)) return;

  if (fs.existsSync(CATEGORIES_SOURCE)) {
    fs.copyFileSync(CATEGORIES_SOURCE, path.join(RESULTS_DIR, 'categories.json'));
  }

  const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith('-result.json'));
  let promoted = 0;

  for (const file of files) {
    const filePath = path.join(RESULTS_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (data.status === 'passed' && hasBrokenStep(data.steps)) {
      data.status = 'broken';
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
      promoted++;
    }
  }

  if (promoted > 0) {
    console.log(`promote-broken-steps: promoted ${promoted} test result(s) to "broken" (passed, but a UI-check finding was reported).`);
  }
}

main();
