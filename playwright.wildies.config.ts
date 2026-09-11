import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * Separate Playwright config for beta.wildies.com — a different brand
 * from gcplaying0175.com, on purpose kept in its own Allure results/report
 * directory and local port rather than sharing gcplaying's. Mixing two
 * unrelated brands into one report was confusing to look at and made the
 * Suites tree need extra bookkeeping (numbered category prefixes) just to
 * keep them visually apart — a real separate config is simpler and scales
 * better once a third brand shows up.
 *
 * `outputDir` is likewise its own — confirmed live 2026-09-11 that
 * every brand config defaulted to the SAME `test-results/`, so running
 * two brands' suites at once hit real file-lock conflicts and
 * cross-contamination on that shared directory.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /wildies-.*\.spec\.ts/,
  outputDir: './test-results-wildies',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  // Deliberately NOT fullyParallel, and workers pinned to 1 (not left to
  // CI-only via `process.env.CI ? ... : undefined`) — confirmed via
  // independent code review 2026-08-30 that a plain local run of this
  // config (e.g. `npx playwright test --config=playwright.wildies.config.ts`
  // with no `--workers` flag) would otherwise default to Playwright's own
  // auto-parallel worker count, which breaks two things at once: the
  // account pool's `poolCursor` (a plain module-level counter, not
  // safe across concurrent worker processes) and this suite's own
  // shared-test-account rate-limit reasoning (see wildiesAccounts.ts).
  // Baked into the config itself so this holds regardless of how the
  // suite is invoked, not just when someone remembers the CLI flag.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Never retries, in CI or locally — this suite places real money once
  // per run (one slot spin, one sportsbook bet); a retry on a flaky seed
  // test would silently place a SECOND real spin/bet, contradicting the
  // suite's own "spent once" design (confirmed via independent code
  // review 2026-08-30 that nothing else in this config or the CI workflow
  // guards against that).
  retries: 0,
  workers: 1,

  reporter: [
    ['list'],
    [
      'allure-playwright',
      {
        resultsDir: 'allure-results-wildies',
        detail: true,
        suiteTitle: true,
        environmentInfo: {
          framework: 'Playwright + TypeScript',
          site: 'https://beta.wildies.com/',
        },
      },
    ],
    ['html', { outputFolder: 'playwright-report-wildies', open: 'never' }],
  ],

  use: {
    baseURL: 'https://beta.wildies.com',
    trace: 'retain-on-failure',
    // 'off', not 'only-on-failure' or 'on' — every check already takes
    // its own deliberately-named, deliberately-timed screenshot(s) via
    // `captureScreenshot()`, both a content shot AND a nav-menu shot,
    // BEFORE the assertion that can fail. Confirmed live 2026-09-01 that
    // 'only-on-failure' was STILL confusing: it fires at the moment of
    // failure, which on the anonymous/authenticated page checks is
    // AFTER the nav-menu screenshot deliberately opened the drawer (to
    // check its own translations) and never closes it again — so a
    // failing test's generic "screenshot" attachment showed the drawer
    // still open instead of the page content the actual finding was on,
    // even though the content screenshot taken moments earlier already
    // had it. Turning this off entirely removes that confusing
    // duplicate; the deliberate screenshots are the complete record.
    screenshot: 'off',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // Chromium only — 2026-08-30 policy: every suite in this repo runs in
  // Chrome only, no cross-browser project. Also closes a real bug an
  // independent code review found: `npm run test:wildies` doesn't pass
  // `--project`, so with two projects configured, a plain run of that
  // script executed the ENTIRE suite twice (once per browser) — meaning
  // the "seed once per run" real-money slot spin and sportsbook bet each
  // fired twice. A single project makes that impossible by construction.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
