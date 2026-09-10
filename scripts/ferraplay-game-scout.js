/**
 * One-off investigation script (NOT part of the suite, not run by CI):
 * logs into ferraplay.com with a real account and screenshots the first
 * casino game after launch — same purpose as the one-time manual
 * coordinate investigation `WildiesPage.spinFirstAvailableGame()`'s own
 * comment describes needing for Wildies. Uses a real Playwright
 * Chromium (not the Claude Browser preview pane, which got stuck on
 * every game's splash screen in this environment — a WebGL/canvas
 * limitation there, not a site bug).
 *
 * Read-only by default (launches the game, screenshots it, does NOT
 * place a real spin) — pass SPIN=1 to also reduce the bet to its floor
 * and place one real spin, for re-confirming `spinFirstAvailableGame()`'s
 * hardcoded coordinates still hold if the game's UI ever changes.
 *
 * Requires FERRAPLAY_TEST_USER_EMAIL/PASSWORD in the environment (the
 * project's .env is picked up automatically) — never hardcode real
 * credentials into this file.
 */
require('dotenv/config');
const { chromium } = require('@playwright/test');

const EMAIL = process.env.FERRAPLAY_TEST_USER_EMAIL;
const PASSWORD = process.env.FERRAPLAY_TEST_USER_PASSWORD;
const DO_SPIN = process.env.SPIN === '1';

if (!EMAIL || !PASSWORD) {
  console.error('Set FERRAPLAY_TEST_USER_EMAIL/PASSWORD (e.g. in .env) before running this script.');
  process.exit(1);
}

async function dismissAnyModal(page, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const overlay = page.locator('[data-modal-overlay="true"]').first();
    if (!(await overlay.isVisible({ timeout: 1500 }).catch(() => false))) return;
    await overlay.locator('[data-modal-close-button]').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
}

(async () => {
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
  await page.locator('header').getByText(/[€$]\s?[\d,.]+/).first().waitFor({ timeout: 15_000 });
  console.log('Logged in, balance visible.');

  await dismissAnyModal(page);

  const gameHref = '/game/real/23929'; // "Book of Ra" — first Top Games card, confirmed 2026-09-10
  console.log(`Launching ${gameHref} ...`);
  const gameLink = page.locator(`a[href="${gameHref}"]`).first();
  let launched = false;
  for (let i = 0; i < 6 && !launched; i++) {
    try {
      await gameLink.click({ timeout: 5_000 });
      launched = true;
    } catch {
      console.log(`click attempt ${i} intercepted, dismissing and retrying...`);
      await dismissAnyModal(page, 1);
    }
  }
  console.log('launched:', launched);
  await page.waitForTimeout(10_000);
  await dismissAnyModal(page, 3);

  await page.screenshot({ path: 'scout-game.png' });
  console.log('Saved scout-game.png');

  if (!DO_SPIN) {
    console.log('SPIN=1 not set — skipping the real spin. Set it to re-confirm the bet/spin coordinates.');
    await browser.close();
    return;
  }

  const balanceBefore = await page.locator('header').getByText(/[€$]\s?[\d,.]+/).first().textContent();
  console.log('Balance before:', balanceBefore);

  for (let i = 0; i < 30; i++) {
    await page.mouse.click(592, 735); // "-" bet control
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scout-min-bet.png' });

  await page.mouse.click(1055, 735); // spin
  await page.waitForTimeout(6_000);
  await page.screenshot({ path: 'scout-after-spin.png' });

  await page.goto('https://ferraplay.com/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  const balanceAfter = await page.locator('header').getByText(/[€$]\s?[\d,.]+/).first().textContent();
  console.log('Balance after:', balanceAfter);

  await browser.close();
})();
