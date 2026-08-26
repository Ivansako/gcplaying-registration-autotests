import { expect, Locator, Page } from '@playwright/test';
import { attachment, step } from 'allure-js-commons';
import { ContentType } from 'allure-js-commons';

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

  constructor(page: Page) {
    this.page = page;
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

  async attachScreenshot(name: string): Promise<void> {
    const buffer = await this.page.screenshot({ fullPage: true });
    await attachment(name, buffer, ContentType.PNG);
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
