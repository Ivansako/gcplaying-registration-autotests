import { test } from '@playwright/test';

/**
 * Shared accumulator for "🔍 Issue Analysis" findings so they can be
 * rendered into the test's Description in ONE place (see
 * `testWithIssueAnalysis.ts`), regardless of which page object recorded
 * them or how many page objects a single test uses. Page objects used to
 * call `allure.descriptionHtml()` directly per finding — with more than
 * one page object active in a test, the second one's call would silently
 * overwrite the first's, since `descriptionHtml()` replaces rather than
 * appends. Keyed by `test.info().testId` (stable per running test, works
 * from inside a page object method with no need to thread `testInfo`
 * through every constructor — `test.info()` is Playwright's documented
 * way to reach the current test's info from anywhere during its run).
 */
export interface IssueEntry {
  where: string;
  severity: string;
  rootCause: string;
  whatToCheck: string;
  /**
   * Set true only by a finding that was recorded specifically because
   * THIS test's own assertion failed for a known, curated reason (e.g.
   * `AccountPage.expectUpdatePasswordDisabled()`'s catch block). Routine
   * UI-check findings (broken images/overflow/console errors — recorded
   * on every check regardless of pass/fail) leave this unset. The
   * `testWithIssueAnalysis` fixture only skips its generic
   * `classifyFailure()` fallback when at least one entry has this set —
   * otherwise a red test whose only recorded issue is an unrelated
   * routine orange note (e.g. the known INSUFFICIENT_PATH console error)
   * would show that instead of an actual explanation for why it failed.
   */
  explainsFailure?: boolean;
}

const issuesByTest = new Map<string, IssueEntry[]>();

export function recordIssue(entry: IssueEntry): void {
  const key = test.info().testId;
  const list = issuesByTest.get(key) ?? [];
  list.push(entry);
  issuesByTest.set(key, list);
}

export function getIssues(): IssueEntry[] {
  return issuesByTest.get(test.info().testId) ?? [];
}

export function clearIssues(): void {
  issuesByTest.delete(test.info().testId);
}

export function renderIssueBlock(entry: IssueEntry): string {
  return `<div style="margin: 0 0 14px; padding: 10px 14px; border-left: 4px solid #e2a33a; background: #fff8ec; font-family: sans-serif; font-size: 13px; line-height: 1.6;">
    <p style="margin: 0 0 6px; font-weight: 600;">⚠️ ${entry.where}</p>
    <p style="margin: 0 0 4px;"><strong>Severity:</strong> ${entry.severity}</p>
    <p style="margin: 0 0 4px;"><strong>Root cause:</strong> ${entry.rootCause}</p>
    <p style="margin: 0;"><strong>What to check manually:</strong> ${entry.whatToCheck}</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Renders raw browser console error text as a readable line-by-line list
 * (one `<br>`-separated line per error, up to 5) instead of a single
 * truncated `.join(' | ')` sentence — used by both the orange UI-check
 * console-error finding and the red-test failure classifier so a person
 * reading either sees the actual error text, not just a summary.
 *
 * Only the error's first line is kept — some site errors (e.g.
 * INSUFFICIENT_PATH) are logged via `console.error(err)` with the full
 * multi-line stack trace attached, which buried the actual message under
 * 15+ lines of noise. The full text is still available in the raw JSON
 * UI-check attachment for anyone who needs the stack.
 */
export function formatConsoleErrors(errors: string[]): string {
  return errors
    .slice(0, 5)
    .map((e) => {
      const [firstLine, ...rest] = e.split('\n');
      const suffix = rest.length > 0 ? ` (+${rest.length} more line${rest.length === 1 ? '' : 's'}, see attached JSON)` : '';
      return `&gt; ${escapeHtml(firstLine)}${suffix}`;
    })
    .join('<br>');
}
