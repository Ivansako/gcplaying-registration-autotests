/**
 * One-off diagnostic, not part of the suite: takes a screenshot of
 * beta.wildies.com's Home page (English, desktop) right before attempting
 * to click the side-menu toggle, then attempts the click and screenshots
 * whatever state it's in afterward (success or timeout). Answers, with an
 * actual picture instead of another guess, whether something is visually
 * covering the header in this environment specifically — see the session
 * notes on `openSideMenu()` failing 100% of the time in CI while
 * Promotions/404 (which never touch the header) pass 100% of the time.
 */
const { chromium } = require('@playwright/test');

const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'beta.wildies.com') {
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

  page.on('console', (msg) => console.log(`[console.${msg.type()}] ${msg.text()}`));
  page.on('response', (res) => {
    if (!res.ok() && res.url().includes('wildies.com')) {
      console.log(`[response] ${res.status()} ${res.url()}`);
    }
  });

  console.log('Navigating to https://beta.wildies.com/ ...');
  const response = await page.goto('https://beta.wildies.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  console.log(`Top-level response: ${response?.status()} ${response?.url()}`);
  console.log(`Page title: ${await page.title()}`);

  await page.waitForTimeout(2000); // let any client-side overlay/banner render
  await page.screenshot({ path: 'diagnostic-before-click.png', fullPage: false });
  console.log('Saved diagnostic-before-click.png');

  const toggle = page.locator('header [data-icon-button-type="first-icon"]').first();
  const count = await toggle.count();
  console.log(`header [data-icon-button-type="first-icon"] matches found: ${count}`);
  if (count > 0) {
    const box = await toggle.boundingBox();
    console.log(`Bounding box: ${JSON.stringify(box)}`);
    const elementAtPoint = box
      ? await page.evaluate(
          ({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            return el ? el.outerHTML.slice(0, 300) : null;
          },
          { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        )
      : null;
    console.log(`document.elementFromPoint at button center: ${elementAtPoint}`);
  }

  try {
    await toggle.click({ timeout: 15_000 });
    console.log('CLICK SUCCEEDED');
  } catch (err) {
    console.log(`CLICK FAILED: ${err.message.split('\n')[0]}`);
  }

  await page.screenshot({ path: 'diagnostic-after-click.png', fullPage: false });
  console.log('Saved diagnostic-after-click.png');

  await browser.close();
})();
