import { expect, Locator, Page } from '@playwright/test';
import { attachment, logStep, step } from 'allure-js-commons';
import { ContentType, Status } from 'allure-js-commons';

/**
 * Page object for gcplaying0175.com's public, anonymous-access pages —
 * promotions/tournaments/content pages, footer/legal pages, and provider
 * pages. Deliberately separate from `RegistrationPage` (the auth modal)
 * and `AccountPage` (authenticated-only area): none of these pages need
 * a login.
 *
 * Confirmed live 2026-08-26 (anonymous session):
 *  - Not every page has a plain `h1`/`h2` — `/promotions` and
 *    `/table_games` render without one, so `visitPage()`'s `expectedText`
 *    check is optional; those two are checked for "loaded, no error
 *    state" only.
 *  - Footer hrefs: /terms-and-conditions, /bonus-policy, /privacy-policy,
 *    /aml-kyc, /about-us, /contact-us, /responsible-gambling, /faq.
 *  - Provider pages live at /providers/{Name} — read live via
 *    `getProviderLinks()` rather than hardcoded, since the ~40-provider
 *    list could change.
 */
export class BrandContentPage {
  readonly page: Page;
  private consoleErrors: string[] = [];

  constructor(page: Page) {
    this.page = page;
    this.page.on('console', (msg) => {
      // Excludes 429s specifically: visiting several pages back-to-back in
      // one test reliably rate-limits a background resource call (the
      // site's own Cloudflare limit, confirmed live 2026-08-27) — noise
      // from test speed, not a real defect. Other failures (404, 500, JS
      // errors) still count.
      if (msg.type() === 'error' && !/status of 429/.test(msg.text())) this.consoleErrors.push(msg.text());
    });
  }

  /**
   * Same removal-based dismissal as `RegistrationPage`/`AccountPage`'s
   * own copies — duplicated rather than shared, matching this repo's
   * existing per-page-object choice.
   */
  async dismissPromoPopupIfPresent(): Promise<void> {
    const removedCount = await this.page.evaluate(() => {
      const frames = document.querySelectorAll('iframe.__btgPromoHolder');
      frames.forEach((frame) => frame.remove());
      return frames.length;
    });
    if (removedCount > 0) {
      await step('Dismiss the promo popup, if shown', async () => {});
    }
  }

  /**
   * Waits for the page's images to finish loading (`img.complete` — true
   * for both successfully- and failed-loaded images, so this never hangs
   * on a genuinely broken image), on top of the networkidle wait already
   * done by the caller. Best-effort: a page with persistent background
   * requests (polling, websockets) can legitimately never settle.
   */
  private async waitForImagesLoaded(timeoutMs = 4_000): Promise<void> {
    await this.page
      .waitForFunction(() => Array.from(document.querySelectorAll('img')).every((img) => img.complete), undefined, {
        timeout: timeoutMs,
      })
      .catch(() => {});
  }

  private async getBrokenImages(): Promise<string[]> {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter((img) => img.complete && img.naturalWidth === 0 && img.src)
        .map((img) => img.src)
    );
  }

  private async getHorizontalOverflow(): Promise<number> {
    return this.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  }

  /**
   * Second-stage UI check, run right after each functional check: waits
   * for the page to genuinely finish rendering (networkidle + every
   * <img> settled — a plain `domcontentloaded` wait was catching promo
   * banners mid-load in screenshots), then checks for broken images, JS
   * console errors, and horizontal layout overflow before attaching a
   * full-page screenshot and a JSON report. The networkidle wait is
   * capped short (3s) rather than the Playwright default, since a page
   * with any persistent background connection (websocket, polling)
   * would otherwise burn the full default timeout on every single check.
   *
   * Findings here are reported via `logStep(..., Status.BROKEN)` rather
   * than a failing `expect()` — deliberately: the functional check
   * already passed (that's what actually failing the test is for), a UI
   * finding is a real thing worth flagging but shouldn't turn the whole
   * regression run red on its own. `logStep` writes directly into
   * Allure's step model without throwing, so it shows as an orange
   * "broken" line nested under this step while the test itself, and this
   * step, both still report as passed.
   */
  async attachScreenshot(name: string): Promise<void> {
    await step(`UI check: ${name}`, async () => {
      await this.page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
      await this.waitForImagesLoaded();

      const consoleErrors = this.consoleErrors.splice(0);
      const brokenImages = await this.getBrokenImages();
      const overflowPx = await this.getHorizontalOverflow();

      await attachment(
        `UI report — ${name}`,
        JSON.stringify({ brokenImages, overflowPx, consoleErrors }, null, 2),
        ContentType.JSON
      );
      const buffer = await this.page.screenshot({ fullPage: true });
      await attachment(name, buffer, ContentType.PNG);

      if (brokenImages.length > 0) {
        await logStep(`Broken images: ${brokenImages.join(', ')}`, Status.BROKEN);
      }
      if (overflowPx > 0) {
        await logStep(`Horizontal overflow: ${overflowPx}px wider than the viewport`, Status.BROKEN);
      }
      if (consoleErrors.length > 0) {
        await logStep(`Browser console errors: ${consoleErrors.slice(0, 3).join(' | ')}`, Status.BROKEN);
      }
    });
  }

  /**
   * Navigates to `path` and confirms it loaded successfully: not a 404
   * (the site's own not-found page — none of the surveyed pages hit
   * this, but a stale href would), and — when given — that `expectedText`
   * is visible somewhere on the page.
   */
  async visitPage(path: string, expectedText?: string | RegExp): Promise<void> {
    await step(`Visit ${path}`, async () => {
      await this.page.goto(path);
      await this.page.waitForLoadState('domcontentloaded');
      await this.dismissPromoPopupIfPresent();
      await expect(this.page.getByText(/page not found/i)).toHaveCount(0);
      if (expectedText) {
        await expect(this.page.getByText(expectedText).first()).toBeVisible();
      }
    });
  }

  /**
   * Reads provider links from the current page (call after visiting the
   * homepage) and returns the first `limit` — discovery-driven rather
   * than a hardcoded provider list, same idea as
   * `AccountPage.getAccountMenuItems()`.
   */
  async getProviderLinks(limit: number): Promise<Array<{ name: string; href: string }>> {
    const links = this.page.locator('a[href*="/providers/"]');
    const count = await links.count();
    const seen = new Set<string>();
    const results: Array<{ name: string; href: string }> = [];
    for (let i = 0; i < count && results.length < limit; i++) {
      const href = await links.nth(i).getAttribute('href');
      if (href && !seen.has(href)) {
        seen.add(href);
        results.push({ name: href.replace('/providers/', ''), href });
      }
    }
    return results;
  }
}
