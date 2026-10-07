// Usage: node scripts/ferraplay-locale-audit/capture.js  -> writes capture.json here; then run analyze.js.
// Read-only: capture rendered body text of every page x locale into capture.json (for cross-locale English-fallback analysis),
// and test where the home hero banners actually lead when clicked.
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { chromium } = require('@playwright/test');

const OUT = __dirname;
const ID = process.env.FERRAPLAY_CF_ACCESS_CLIENT_ID;
const SECRET = process.env.FERRAPLAY_CF_ACCESS_CLIENT_SECRET;
const LOCALES = [['en', ''], ['it', 'it'], ['pt', 'pt'], ['el', 'el'], ['es', 'es'], ['pl', 'pl'], ['hu', 'hu'], ['fr', 'fr']];
const PAGES = ['/', '/casino', '/live-casino', '/buy_bonus', '/promotions', '/tournaments', '/inout_games', '/providers', '/faq', '/contact-us', '/terms-and-conditions', '/privacy-policy', '/aml-policy', '/responsible-gambling'];

async function route(page) {
  await page.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === 'ferraplay.com') {
      await r.continue({ headers: { ...r.request().headers(), 'CF-Access-Client-Id': ID, 'CF-Access-Client-Secret': SECRET } });
    } else await r.continue();
  });
}

(async () => {
  const browser = await chromium.launch();
  const result = {};
  for (const [code, seg] of LOCALES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: 'NEXT_LOCALE', value: code, domain: 'ferraplay.com', path: '/' }]);
    const page = await ctx.newPage();
    await route(page);
    for (const p of PAGES) {
      const url = 'https://ferraplay.com' + (seg ? '/' + seg : '') + (p === '/' && seg ? '' : p === '/' ? '/' : p);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
        await page.waitForTimeout(3500);
        try { await page.locator('[data-modal-overlay="true"] [data-modal-close-button]').first().click({ timeout: 1500 }); } catch {}
        const lang = await page.evaluate(() => document.documentElement.lang);
        const text = await page.evaluate(() => document.body.innerText);
        (result[p] ||= {})[code] = { lang, text };
        console.log(`ok  ${code} ${p} lang=${lang} chars=${text.length}`);
      } catch (e) {
        console.log(`ERR ${code} ${p} ${e.message.split('\n')[0]}`);
      }
    }
    await ctx.close();
    fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify(result));
  }

  // Where do the hero banners lead? (English)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'NEXT_LOCALE', value: 'en', domain: 'ferraplay.com', path: '/' }]);
  const page = await ctx.newPage();
  await route(page);
  await page.goto('https://ferraplay.com/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(3500);
  try { await page.locator('[data-modal-overlay="true"] [data-modal-close-button]').first().click({ timeout: 1500 }); } catch {}
  const banners = await page.evaluate(() =>
    [...document.querySelectorAll('main a[href], main button')].filter((e) => e.closest('[class*="slide" i], [class*="banner" i], [class*="swiper" i], [class*="carousel" i]')).map((e) => ({ tag: e.tagName, href: e.getAttribute('href'), text: (e.innerText || '').trim().slice(0, 40) }))
  );
  console.log('BANNER ELEMENTS:', JSON.stringify(banners.slice(0, 25)));
  for (const target of ['HACKSAW', 'INOUT', 'MONDAY CASHBACK', 'FIRST DEPOSIT', 'WEEKEND', 'RAKEBACK', 'Mission Control']) {
    try {
      await page.goto('https://ferraplay.com/', { waitUntil: 'domcontentloaded', timeout: 40000 });
      await page.waitForTimeout(3000);
      try { await page.locator('[data-modal-overlay="true"] [data-modal-close-button]').first().click({ timeout: 1500 }); } catch {}
      const el = page.getByText(target, { exact: false }).first();
      await el.scrollIntoViewIfNeeded({ timeout: 4000 });
      await el.click({ timeout: 4000, force: true });
      await page.waitForTimeout(2500);
      const modal = await page.locator('[data-modal-overlay="true"]').first().isVisible().catch(() => false);
      console.log(`CLICK "${target}" -> url=${page.url()} modalOpen=${modal} h1=${(await page.locator('h1').first().innerText().catch(() => '')).slice(0, 60)}`);
    } catch (e) {
      console.log(`CLICK "${target}" failed: ${e.message.split('\n')[0]}`);
    }
  }
  await browser.close();
})();
