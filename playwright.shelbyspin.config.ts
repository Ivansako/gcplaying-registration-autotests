import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * Separate Playwright config for shelbyspin3322.com — same reasoning as
 * every other brand's own config: a distinct Allure results/report
 * directory and `outputDir`, so a run here never collides with another
 * brand's in-progress results (confirmed live 2026-09-11, see
 * `clean-ferraplay-results.js`'s own comment on this exact incident).
 *
 * Pinned to 1 worker per the standing local-verification rule (always
 * `--workers=1`, no concurrent runs — screenshots/game-iframe timing on
 * this "Wiz" platform template are sensitive to resource contention).
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /shelbyspin-.*\.spec\.ts/,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  outputDir: 'test-results-shelbyspin',

  reporter: [
    ['list'],
    [
      'allure-playwright',
      {
        resultsDir: 'allure-results-shelbyspin',
        detail: true,
        suiteTitle: true,
        environmentInfo: {
          framework: 'Playwright + TypeScript',
          site: 'https://shelbyspin3322.com/',
        },
      },
    ],
    ['html', { outputFolder: 'playwright-report-shelbyspin', open: 'never' }],
  ],

  use: {
    baseURL: 'https://shelbyspin3322.com',
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
