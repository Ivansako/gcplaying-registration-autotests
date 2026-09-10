/**
 * Fast CI-only sanity check (NOT part of the suite): confirms
 * FERRAPLAY_TEST_USER_EMAIL/PASSWORD are actually populated as GitHub
 * Secrets and that account can really log in — a ~30s check instead of
 * waiting for the full ferraplay-i18n suite to find out the same thing.
 */
const { chromium } = require('@playwright/test');

const EMAIL = process.env.FERRAPLAY_TEST_USER_EMAIL;
const PASSWORD = process.env.FERRAPLAY_TEST_USER_PASSWORD;

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.log('RESULT: FAIL — FERRAPLAY_TEST_USER_EMAIL/PASSWORD not set in this environment.');
    process.exit(1);
  }
  console.log(`Secrets present. Email: ${EMAIL.replace(/(?<=.{3}).(?=.*@)/g, '*')}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.goto('https://ferraplay.com/');
  await page.waitForLoadState('domcontentloaded');

  const headerBtn = page.locator('button[data-header-button]').first();
  const emailField = page.locator('input[name="usernameEmail"]');
  await headerBtn.click();
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
