import { TestInfo } from '@playwright/test';
import { formatConsoleErrors, IssueEntry } from './issueTracker';

/**
 * Turns a raw Playwright failure (timeout stack trace, assertion diff,
 * etc.) into the same human-readable Severity/Root cause/What to check
 * shape used for known bugs and UI-check findings — added 2026-08-27
 * after explicit feedback that red tests still only showed Playwright's
 * raw error, unlike orange ones. Pattern-matches the failure signatures
 * this repo has actually hit (see this session's history: concurrent
 * local runs crashing the browser, registration hitting Cloudflare's
 * rate limit, etc.) rather than attempting to cover every possible
 * Playwright error — falls back to a generic "needs triage" writeup with
 * the raw message for anything unrecognized.
 */
export function classifyFailure(testInfo: TestInfo, consoleErrors: string[]): IssueEntry {
  const error = testInfo.errors[0];
  const message = error?.message ?? testInfo.error?.message ?? '(no error message captured)';

  let entry: IssueEntry;

  if (/Target page, context or browser has been closed/.test(message)) {
    entry = {
      where: 'Test failed — browser/session crashed mid-test',
      severity: 'Environment (likely not a site bug)',
      rootCause:
        'The browser or page closed unexpectedly partway through the test, not because of anything the site ' +
        'did. Usually caused by running too many Playwright processes at once (resource contention — see the ' +
        'project convention of always using --workers=1 and no concurrent local runs) or a very long ' +
        'continuous session exhausting memory.',
      whatToCheck:
        'Re-run this exact test alone (no other Playwright process running at the same time). If it passes ' +
        "cleanly in isolation, this failure was an environment artifact and can be ignored — it isn't a real " +
        'regression.',
    };
  } else if (/Test timeout of \d+ms exceeded/.test(message)) {
    entry = {
      where: 'Test failed — timed out',
      severity: 'Needs triage',
      rootCause:
        'The test (or one of its actions/assertions) took longer than the configured timeout without ' +
        'completing. Could be a genuinely slow/hung page, a locator that never matched anything, or — if this ' +
        'ran alongside other tests/processes — resource contention slowing everything down rather than a real ' +
        'site issue.',
      whatToCheck:
        'Re-run this exact test alone with --workers=1. If it still times out in isolation, open the attached ' +
        'trace.zip (`npx playwright show-trace`) to see exactly which step got stuck and why.',
    };
  } else if (/signup-popup/.test(message) && /toBeHidden/.test(message) && /visible/i.test(message)) {
    entry = {
      where: 'Test failed — registration modal never closed after submit',
      severity: 'Needs triage (likely rate-limit, not a regression)',
      rootCause:
        'The signup modal stayed open after submitting the registration form, so the flow never reached a ' +
        "logged-in state. The site's own sign-up endpoint rate-limits (HTTP 429) bursts of registrations from " +
        'the same source — this is the most common cause when several registration tests ran back-to-back ' +
        'shortly before this one.',
      whatToCheck:
        'Check whether other registration tests ran shortly before this one in the same session — if so, this ' +
        'is likely the known Cloudflare rate-limit, not a real bug. Re-run this test on its own, well after ' +
        'the last registration attempt, to confirm either way.',
    };
  } else if (/expect\(.*\)\..*failed/is.test(message) || /Expected:|Received:/i.test(message)) {
    entry = {
      where: 'Test failed — assertion mismatch',
      severity: 'Needs triage',
      rootCause:
        "The page's actual state didn't match what the test expected (see the Expected/Received values in the " +
        'error above). Could be a real UI/behavior regression on the site, or the test itself needs updating ' +
        'if the site changed intentionally.',
      whatToCheck:
        'Compare the "Expected" vs "Received" values in the error message above against the live site to see ' +
        'which one is wrong — the test or the site.',
    };
  } else {
    entry = {
      where: 'Test failed',
      severity: 'Needs triage',
      rootCause: `Unrecognized failure pattern: ${message.slice(0, 300)}`,
      whatToCheck:
        'Open the attached screenshot/video/trace.zip for this test to see what the page looked like when it ' +
        'failed, and read the full error above for the exact assertion or step that broke.',
    };
  }

  if (consoleErrors.length > 0) {
    entry.rootCause +=
      `<br><br><strong>Browser console errors seen during this test:</strong><br>` + formatConsoleErrors(consoleErrors);
  }

  return entry;
}
