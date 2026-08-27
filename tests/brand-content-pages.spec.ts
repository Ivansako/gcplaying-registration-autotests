import { devices } from '@playwright/test';
import { test } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { BrandContentPage } from '../pages/BrandContentPage';

/**
 * Public content pages for gcplaying0175.com — Promotions, Tournaments,
 * Table Games, and the Evolution/Playtech/Backseat Gaming/Phantom Games
 * sub-lobbies. All anonymous (no login), part of the "Full Brand test"
 * regression alongside brand-gcplaying.spec.ts's registration+login flow.
 * Screenshot on every page, across desktop and mobile.
 */
function stripBrowserType(device: (typeof devices)[string]) {
  const { defaultBrowserType, ...rest } = device;
  return rest;
}

const VIEWPORTS = [
  { name: 'Desktop', config: stripBrowserType(devices['Desktop Chrome']) },
  { name: 'Mobile (iPhone 13)', config: stripBrowserType(devices['iPhone 13']) },
  { name: 'Mobile (Pixel 7)', config: stripBrowserType(devices['Pixel 7']) },
];

// path + expected on-page text. Promotions and Table Games render without
// a plain h1/h2 (confirmed live) — checked for "loaded, no error" only.
const PAGES: Array<{ label: string; path: string; expectedText?: string }> = [
  { label: 'Promotions', path: '/promotions' },
  { label: 'Tournaments', path: '/tournaments', expectedText: 'Tournaments' },
  { label: 'Table Games', path: '/table_games' },
  { label: 'Evolution Live', path: '/lobby/evolution' },
  { label: 'Playtech Live', path: '/lobby/playtech' },
  { label: 'Backseat Gaming', path: '/backseat_games' },
  { label: 'Phantom Games', path: '/phantom_games' },
];

test.describe('gcplaying0175.com — public content pages', () => {
  for (const { name, config } of VIEWPORTS) {
    test.describe(name, () => {
      test.use({ ...config });

      test.beforeEach(async () => {
        allure.epic('Brand Test');
        allure.feature('Public content pages');
        allure.owner('QA Automation');
        allure.parameter('Viewport', name);
      });

      test(`Public content pages load — ${name}`, { tag: ['@brand', '@content'] }, async ({ page }) => {
        // The UI check on each page now waits for networkidle (capped 3s)
        // + images-settled on top of the navigation itself, so 7 pages
        // costs noticeably more than before.
        test.setTimeout(150_000);

        allure.severity('normal');
        allure.description(
          'Visits Promotions, Tournaments, Table Games, Evolution Live, Playtech Live, Backseat Gaming, ' +
            `and Phantom Games and confirms each loads without an error state. Runs on the "${name}" viewport.`
        );

        const brandContentPage = new BrandContentPage(page);

        for (const { label, path, expectedText } of PAGES) {
          await test.step(`${label} (${path})`, async () => {
            await brandContentPage.visitPage(path, expectedText);
            await brandContentPage.attachScreenshot(`${name} — ${label}`);
          });
        }
      });
    });
  }
});
