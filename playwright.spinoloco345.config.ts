import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * Separate Playwright config for spinoloco345.com — same reasoning as
 * every other single-brand config in this repo: its own Allure
 * results/report directory and output dir, pinned to 1 worker (no
 * concurrent runs against a shared account/session — see
 * `feedback_local_verification_workers` in project memory).
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /spinoloco345-.*\.spec\.ts/,
  timeout: 60 * 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  outputDir: 'test-results-spinoloco345',

  reporter: [
    ['list'],
    [
      'allure-playwright',
      {
        resultsDir: 'allure-results-spinoloco345',
        detail: true,
        suiteTitle: true,
        environmentInfo: {
          framework: 'Playwright + TypeScript',
          site: 'https://spinoloco345.com/',
        },
      },
    ],
    ['html', { outputFolder: 'playwright-report-spinoloco345', open: 'never' }],
  ],

  use: {
    baseURL: 'https://spinoloco345.com',
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
