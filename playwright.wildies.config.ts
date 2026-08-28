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
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /wildies-.*\.spec\.ts/,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,

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
    screenshot: 'on',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
