import { test, expect, devices } from '@playwright/test';
import { allure } from 'allure-playwright';
import { BrandContentPage } from '../pages/BrandContentPage';

/**
 * A sample of gcplaying0175.com's 40+ provider pages (/providers/{Name})
 * — anonymous (no login), part of the "Full Brand test" regression.
 * Provider links are discovered live from the homepage rather than
 * hardcoded (the list could change) — see
 * BrandContentPage.getProviderLinks(). Screenshot on every page, across
 * desktop and mobile.
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

const PROVIDER_SAMPLE_SIZE = 6;

test.describe('gcplaying0175.com — provider pages (sample)', () => {
  for (const { name, config } of VIEWPORTS) {
    test.describe(name, () => {
      test.use({ ...config });

      test.beforeEach(async () => {
        allure.epic('Brand Test');
        allure.feature('Provider pages');
        allure.owner('QA Automation');
        allure.parameter('Viewport', name);
      });

      test(`A sample of provider pages load — ${name}`, { tag: ['@brand', '@providers'] }, async ({ page }) => {
        // The UI check on each page now waits for networkidle (capped 3s)
        // + images-settled on top of the navigation itself.
        test.setTimeout(150_000);

        allure.severity('normal');
        allure.description(
          `Discovers provider links live from the homepage and visits a sample of ${PROVIDER_SAMPLE_SIZE}, ` +
            `confirming each loads without an error state. Runs on the "${name}" viewport.`
        );

        const brandContentPage = new BrandContentPage(page);

        const providers = await test.step('Discover provider links', async () => {
          await brandContentPage.visitPage('/');
          const found = await brandContentPage.getProviderLinks(PROVIDER_SAMPLE_SIZE);
          allure.parameter('Discovered providers', found.map((p) => p.name).join(', '));
          expect(found.length).toBeGreaterThan(0);
          return found;
        });

        for (const provider of providers) {
          await test.step(`Provider: ${provider.name} (${provider.href})`, async () => {
            await brandContentPage.visitPage(provider.href);
            await brandContentPage.attachScreenshot(`${name} — Provider — ${provider.name}`);
          });
        }
      });
    });
  }
});
