/**
 * Fast CI-only sanity check (NOT part of the suite): confirms
 * FERRAPLAY_TEST_USER_EMAIL/PASSWORD and FERRAPLAY_CF_ACCESS_CLIENT_ID/
 * SECRET are actually populated as GitHub Secrets and that login really
 * works — a ~30s check instead of waiting for the full ferraplay-i18n
 * suite to find out the same thing. Also screenshots the landing page
 * before doing anything else, to catch a geo/bot block or (confirmed
 * live 2026-09-11, both from GitHub Actions AND a local machine) the
 * site's own Cloudflare Access gate, instead of just reporting a
 * confusing selector timeout.
 */
const { chromium } = require('@playwright/test');

const EMAIL = process.env.FERRAPLAY_TEST_USER_EMAIL;
const PASSWORD = process.env.FERRAPLAY_TEST_USER_PASSWORD;
const CF_ACCESS_CLIENT_ID = process.env.FERRAPLAY_CF_ACCESS_CLIENT_ID;
const CF_ACCESS_CLIENT_SECRET = process.env.FERRAPLAY_CF_ACCESS_CLIENT_SECRET;

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.log('RESULT: FAIL — FERRAPLAY_TEST_USER_EMAIL/PASSWORD not set in this environment.');
    process.exit(1);
  }
  console.log(`Secrets present. Email: ${EMAIL.replace(/(?<=.{3}).(?=.*@)/g, '*')}`);
  console.log(`CF Access token present: ${!!(CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET)}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'ferraplay.com') {
        await route.continue({
          headers: {
            ...route.request().headers(),
            'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
            'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
          },
        });
      } else {
        await route.continue();
      }
    });
  }

  const response = await page.goto('https://ferraplay.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  console.log(`Top-level response: ${response?.status()} ${response?.url()}`);
  console.log(`Page title: ${await page.title()}`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'secrets-check-landing.png' });
  console.log('Saved secrets-check-landing.png');

  const headerBtn = page.locator('button[data-header-button]').first();
  const emailField = page.locator('input[name="usernameEmail"]');
  try {
    await headerBtn.click({ timeout: 10_000 });
  } catch (e) {
    console.log('RESULT: FAIL — login button never appeared:', e.message.split('\n')[0]);
    await browser.close();
    process.exit(1);
  }
  try {
    await emailField.waitFor({ timeout: 5_000 });
  } catch {
    await headerBtn.click();
    await emailField.waitFor({ timeout: 10_000 });
  }
  await emailField.fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page
    .locator('input[name="password"]')
    .locator('xpath=ancestor::form[1]')
    .locator('button[type="submit"]')
    .click();

  try {
    await page.locator('header').getByText(/[€$]\s?[\d,.]+/).first().waitFor({ timeout: 15_000 });
    const balance = await page.locator('header').getByText(/[€$]\s?[\d,.]+/).first().textContent();
    console.log(`RESULT: PASS — logged in successfully, balance: ${balance}`);
  } catch {
    console.log('RESULT: FAIL — login did not succeed (balance never appeared in header).');
    process.exitCode = 1;
  }

  await browser.close();
})();
