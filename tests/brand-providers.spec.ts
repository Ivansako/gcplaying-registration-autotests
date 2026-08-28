import { devices } from '@playwright/test';
import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { BrandContentPage } from '../pages/BrandContentPage';

/**
 * gcplaying0175.com's provider pages (/providers/{Name}) — anonymous (no
 * login), part of the "Full Brand test" regression. Provider links are
 * discovered live from the canonical `/providers` listing page rather than
 * hardcoded (the list could change) — see BrandContentPage.getProviderLinks().
 * Screenshot on every page.
 *
 * Desktop covers all 43 (confirmed live 2026-08-27, both from the homepage
 * and the dedicated /providers page — same set). Each mobile viewport
 * samples 8 instead: 43 pages × 3 viewports would add ~20-30 minutes to an
 * already-long anonymous suite for comparatively little extra coverage,
 * since provider pages share one template already exercised elsewhere
 * (content/legal suites) — confirmed as a deliberate tradeoff with the user.
 */
function stripBrowserType(device: (typeof devices)[string]) {
  const { defaultBrowserType, ...rest } = device;
  return rest;
}

const VIEWPORTS = [
  { name: 'Desktop', config: stripBrowserType(devices['Desktop Chrome']), providerSampleSize: 100 },
  { name: 'Mobile (iPhone 13)', config: stripBrowserType(devices['iPhone 13']), providerSampleSize: 8 },
  { name: 'Mobile (Pixel 7)', config: stripBrowserType(devices['Pixel 7']), providerSampleSize: 8 },
];

test.describe('gcplaying0175.com — provider pages', () => {
  for (const { name, config, providerSampleSize } of VIEWPORTS) {
    test.describe(name, () => {
      test.use({ ...config });

      test.beforeEach(async () => {
        allure.parentSuite('5. Content Pages');
        allure.subSuite('Provider Pages');
        allure.epic('Brand Test');
        allure.feature('Provider pages');
        allure.owner('QA Automation');
        allure.parameter('Viewport', name);
      });

      test(`Provider pages load — ${name}`, { tag: ['@brand', '@providers'] }, async ({ page }) => {
        // The UI check on each page waits for networkidle (capped 3s) +
        // images-settled on top of the navigation itself — Desktop visits
        // all 43 providers, so it needs real headroom.
        test.setTimeout(providerSampleSize >= 43 ? 600_000 : 150_000);

        allure.severity('normal');
        allure.description(
          `Discovers provider links live from the /providers page and visits ${
            providerSampleSize >= 43 ? 'all of them' : `a sample of ${providerSampleSize}`
          }, confirming each loads without an error state. Runs on the "${name}" viewport.`
        );

        const brandContentPage = new BrandContentPage(page);

        const providers = await test.step('Discover provider links', async () => {
          await brandContentPage.visitPage('/providers');
          const found = await brandContentPage.getProviderLinks(providerSampleSize);
          allure.parameter('Provider count', String(found.length));
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
