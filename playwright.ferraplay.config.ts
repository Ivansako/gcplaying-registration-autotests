import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * Separate Playwright config for ferraplay.com — same reasoning as
 * `playwright.wildies.config.ts`: a distinct brand gets its own
 * Allure results/report directory rather than sharing another brand's.
 * `outputDir` (Playwright's own trace/video/screenshot dump, separate
 * from Allure's `resultsDir`) is likewise its own — confirmed live
 * 2026-09-11 that every brand config defaulted to the SAME
 * `test-results/`, so running two brands' suites at once (e.g. this one
 * and Spinoloco's) hit real file-lock conflicts and cross-contamination
 * on that shared directory.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /ferraplay-.*\.spec\.ts/,
  outputDir: './test-results-ferraplay',
  // Bumped from 45s/15s/10s (2026-09-21): recurring runs kept mixing
  // genuine translation findings with plain automation timeouts on
  // otherwise-normal page/modal transitions — per the user, those aren't
  // useful noise to sift through every time. More headroom here doesn't
  // hide a real hang (nothing in this suite depends on a slow response
  // meaning "broken"), it just stops transient slowness from reading as
  // a false failure.
  timeout: 60_000,
  expect: {
    timeout: 12_000,
  },
  // Same reasoning as `playwright.wildies.config.ts`: pinned to 1
  // worker, not left to CI-only auto-parallel, since the locale
  // switcher's own dropdown-open/close state and any future shared
  // test account aren't safe across concurrent workers.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  reporter: [
    ['list'],
    [
      'allure-playwright',
      {
        resultsDir: 'allure-results-ferraplay',
        detail: true,
        suiteTitle: true,
        environmentInfo: {
          framework: 'Playwright + TypeScript',
          site: 'https://ferraplay.com/',
        },
      },
    ],
    ['html', { outputFolder: 'playwright-report-ferraplay', open: 'never' }],
  ],

  use: {
    baseURL: 'https://ferraplay.com',
    trace: 'retain-on-failure',
    // 'off' — same reasoning as Wildies: `captureScreenshot()` already
    // takes its own deliberately-timed screenshot(s) before any
    // assertion that can fail.
    screenshot: 'off',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 35_000,
  },

  // Chromium only — same repo-wide policy as every other suite.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
