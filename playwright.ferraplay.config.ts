import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * Separate Playwright config for ferraplay.com — same reasoning as
 * `playwright.wildies.config.ts`: a distinct brand gets its own
 * Allure results/report directory rather than sharing another brand's.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /ferraplay-.*\.spec\.ts/,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
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
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // Chromium only — same repo-wide policy as every other suite.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
