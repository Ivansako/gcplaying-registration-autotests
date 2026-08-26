import { test, devices } from '@playwright/test';
import { allure } from 'allure-playwright';
import { BrandContentPage } from '../pages/BrandContentPage';

/**
 * Footer/legal pages for gcplaying0175.com — all anonymous (no login),
 * part of the "Full Brand test" regression. Screenshot on every page,
 * across desktop and mobile.
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

// hrefs confirmed live 2026-08-26 from the homepage footer.
const PAGES: Array<{ label: string; path: string; expectedText?: string }> = [
  { label: 'Terms & Conditions', path: '/terms-and-conditions', expectedText: 'Terms and conditions' },
  { label: 'Bonuses Terms & Conditions', path: '/bonus-policy' },
  { label: 'Privacy Policy', path: '/privacy-policy' },
  { label: 'AML-KYC Policy', path: '/aml-kyc' },
  { label: 'About Us', path: '/about-us' },
  { label: 'Contact Us', path: '/contact-us' },
  { label: 'Responsible Gambling', path: '/responsible-gambling' },
  { label: 'FAQ', path: '/faq', expectedText: 'FAQ' },
];

test.describe('gcplaying0175.com — footer / legal pages', () => {
  for (const { name, config } of VIEWPORTS) {
    test.describe(name, () => {
      test.use({ ...config });

      test.beforeEach(async () => {
        allure.epic('Brand Test');
        allure.feature('Footer / legal pages');
        allure.owner('QA Automation');
        allure.parameter('Viewport', name);
      });

      test(`Footer and legal pages load — ${name}`, { tag: ['@brand', '@legal'] }, async ({ page }) => {
        test.setTimeout(90_000);

        allure.severity('normal');
        allure.description(
          'Visits the 8 footer/legal pages (Terms & Conditions, Bonuses Terms & Conditions, Privacy ' +
            'Policy, AML-KYC Policy, About Us, Contact Us, Responsible Gambling, FAQ) and confirms each ' +
            `loads without an error state. Runs on the "${name}" viewport.`
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
