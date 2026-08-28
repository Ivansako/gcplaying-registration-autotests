import { devices } from '@playwright/test';
import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { BrandContentPage } from '../pages/BrandContentPage';

/**
 * Casino Website UI extras for gcplaying0175.com — search, side menu,
 * language switcher, footer payment methods. Anonymous (no login), part
 * of the "Full Brand test" regression. From the Jira/Xray "Casino Website
 * UI" manual test folder, confirmed live 2026-08-27.
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

test.describe('gcplaying0175.com — casino website UI extras', () => {
  for (const { name, config } of VIEWPORTS) {
    test.describe(name, () => {
      test.use({ ...config });

      test.beforeEach(async () => {
        allure.parentSuite('3. Site Functionality');
        allure.subSuite('Search, Menu & Language');
        allure.epic('Brand Test');
        allure.feature('Casino website UI');
        allure.owner('QA Automation');
        allure.parameter('Viewport', name);
      });

      test(`Search finds a known game — ${name}`, { tag: ['@brand', '@content'] }, async ({ page }) => {
        allure.severity('normal');
        allure.description(
          `Searches for "Fortune of Olympus" and confirms a matching game result renders. Runs on the "${name}" viewport.`
        );

        const brandContentPage = new BrandContentPage(page);
        await brandContentPage.visitPage('/');

        await test.step('Search for a known game', async () => {
          const hrefs = await brandContentPage.searchGames('Fortune of Olympus');
          allure.parameter('Result hrefs', hrefs.join(', '));
          expect(hrefs).toContain('/game/real/45898');
          await brandContentPage.attachScreenshot(`${name} — search results`);
        });
      });

      test(`Side menu shows the expected nav items — ${name}`, { tag: ['@brand', '@content'] }, async ({ page }) => {
        allure.severity('normal');
        allure.description(`Opens the side menu (burger icon on desktop, bottom-nav "Menu" on mobile) and confirms the expected nav items are visible. Runs on the "${name}" viewport.`);

        const brandContentPage = new BrandContentPage(page);
        await brandContentPage.visitPage('/');

        await test.step('Open the side menu', async () => {
          await brandContentPage.openSideMenu();
          for (const item of ['Lobby', 'Promotions', 'Tournaments', 'Casino', 'Live Casino', 'Table Games', 'Jackpots']) {
            await expect(page.getByText(item, { exact: true }).first()).toBeVisible();
          }
          await brandContentPage.attachScreenshot(`${name} — side menu open`);
        });
      });
    });
  }

  test.describe('Desktop-only checks', () => {
    test.use({ ...stripBrowserType(devices['Desktop Chrome']) });

    test.beforeEach(async () => {
      allure.epic('Brand Test');
      allure.feature('Casino website UI');
      allure.owner('QA Automation');
      allure.parameter('Viewport', 'Desktop');
    });

    test('Language switcher translates the page and switches back cleanly', { tag: ['@brand', '@content'] }, async ({ page }) => {
      // Two full language switches, each with a UI-check screenshot —
      // default 45s isn't enough headroom.
      test.setTimeout(90_000);

      allure.severity('normal');
      allure.description('Switches the site language to Arabic, confirms the page direction and text change, then switches back to English — no side effects left. A global mechanism, checked once.');

      const brandContentPage = new BrandContentPage(page);
      await brandContentPage.visitPage('/');

      await test.step('Switch to Arabic', async () => {
        await brandContentPage.switchLanguage('العربية');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByText('Register', { exact: true })).toHaveCount(0);
        await brandContentPage.attachScreenshot('Desktop — Arabic');
      });

      await test.step('Switch back to English', async () => {
        await brandContentPage.switchLanguage('English');
        await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
        await expect(page.getByRole('button', { name: 'Register' })).toBeVisible();
      });
    });

    test('Footer shows payment method logos', { tag: ['@brand', '@content'] }, async ({ page }) => {
      allure.severity('minor');
      allure.description('Confirms the footer shows at least one payment-method logo.');

      const brandContentPage = new BrandContentPage(page);
      await brandContentPage.visitPage('/');

      await test.step('Read footer payment methods', async () => {
        const methods = await brandContentPage.getFooterPaymentMethods();
        allure.parameter('Payment methods', methods.join(', '));
        expect(methods.length).toBeGreaterThan(0);
        await brandContentPage.attachScreenshot('Desktop — footer payment methods');
      });
    });
  });
});
