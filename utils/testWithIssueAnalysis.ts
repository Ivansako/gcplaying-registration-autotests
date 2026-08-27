import { test as base, expect } from '@playwright/test';
import { descriptionHtml } from 'allure-js-commons';
import { classifyFailure } from './failureClassifier';
import { clearIssues, getIssues, renderIssueBlock } from './issueTracker';

/**
 * Drop-in replacement for `@playwright/test`'s `test` — every spec file
 * should import `test`/`expect` from here instead. The auto fixture below
 * runs for every test with no per-file setup needed:
 *  - Collects browser console errors for the whole test (not just what a
 *    page object happened to capture before a crash/timeout cut it off).
 *  - After the test finishes, combines every `recordIssue()` finding from
 *    page objects (see `issueTracker.ts`) with — if the test actually
 *    failed — a human-readable classification of the failure itself (see
 *    `failureClassifier.ts`), and writes the whole thing into the test's
 *    Description in ONE call, so it's visible on Overview with no
 *    step-drilling. Added 2026-08-27: red (failed) tests used to show
 *    only Playwright's raw error; this gives them the same Severity/Root
 *    cause/What to check manually treatment orange findings already had.
 */
export const test = base.extend<{ _issueAnalysis: void }>({
  _issueAnalysis: [
    async ({ page }, use, testInfo) => {
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !/status of 429/.test(msg.text())) consoleErrors.push(msg.text());
      });

      await use();

      const issues = [...getIssues()];
      // Only add the generic pattern-matched classification when no page
      // object already recorded a specific finding for this failure — a
      // known-bug method's own curated write-up (see AccountPage.ts's
      // expectUpdatePasswordDisabled()/saveProfileEditWithNoChanges())
      // is always more precise than the generic fallback, and showing
      // both would just be redundant clutter.
      if ((testInfo.status === 'failed' || testInfo.status === 'timedOut') && issues.length === 0) {
        issues.push(classifyFailure(testInfo, consoleErrors));
      }
      if (issues.length > 0) {
        await descriptionHtml(`<div style="font-family: sans-serif;">${issues.map(renderIssueBlock).join('')}</div>`);
      }
      clearIssues();
    },
    { auto: true },
  ],
});

export { expect };
