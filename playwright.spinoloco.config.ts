import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * Separate Playwright config for spinoloco7545.com — a different brand
 * from gcplaying0175.com and beta.wildies.com, same reasoning as
 * `playwright.wildies.config.ts`: its own Allure results/report
 * directory rather than sharing either.
 *
 * `outputDir` is likewise its own — confirmed live 2026-09-11 that
 * every brand config defaulted to the SAME `test-results/`, so running
 * two brands' suites at once hit real file-lock conflicts and
 * cross-contamination on that shared directory. Not applied to an
 * already-running process — only takes effect on this config's NEXT
 * invocation.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: /spinoloco-.*\.spec\.ts/,
  outputDir: './test-results-spinoloco',
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  // Same reasoning as `playwright.wildies.config.ts`: the game-launch
  // shard picker (`shardIndexForToday()`) and the real-bet check's
  // per-provider real spend both assume one sequential pass, not
  // Playwright's own auto-parallel workers.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  reporter: [
    ['list'],
    [
      'allure-playwright',
      {
        resultsDir: 'allure-results-spinoloco',
        detail: true,
        suiteTitle: true,
        environmentInfo: {
          framework: 'Playwright + TypeScript',
          site: 'https://spinoloco7545.com/',
        },
      },
    ],
    ['html', { outputFolder: 'playwright-report-spinoloco', open: 'never' }],
  ],

  use: {
    baseURL: 'https://spinoloco7545.com',
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // Mobile-only (2026-09-08 decision) — see `utils/deviceViewports.ts`.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
