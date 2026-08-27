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
   * Renders a small, self-contained HTML block for a "🔍 Issue Analysis"
   * attachment — Allure's step tree only shows the raw finding text (see
   * `attachScreenshot()`), which isn't enough to act on without opening
   * the source code, so every finding also gets one of these attached
   * right next to it: what's actually wrong, how bad it is, and what a
   * human should go check. No native "Issue" tab exists in Allure
   * (Overview/History/Retries are hardcoded in the report viewer, not
   * configurable) — an attachment inside the step is the closest
   * equivalent that's actually achievable.
   */
  private issueAnalysisHtml(opts: { severity: string; rootCause: string; whatToCheck: string }): string {
    // Explicit charset — without it, the em-dashes and curly quotes in
    // these write-ups render as mojibake (confirmed live 2026-08-27).
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <div style="font-family: sans-serif; font-size: 13px; line-height: 1.6; max-width: 640px;">
      <p><strong>Severity:</strong> ${opts.severity}</p>
      <p><strong>Root cause</strong><br>${opts.rootCause}</p>
      <p><strong>What to check manually</strong><br>${opts.whatToCheck}</p>
    </div>
    </body></html>`;
  }

  /**
   * Console-error findings get a richer analysis than the other two
   * categories: distinguishes a known, already-triaged site defect
   * (currently just INSUFFICIENT_PATH — see project memory) from a
   * genuinely new one, since those need very different follow-up.
   */
  private consoleErrorAnalysis(errors: string[]): { severity: string; rootCause: string; whatToCheck: string } {
    if (errors.some((e) => e.includes('INSUFFICIENT_PATH'))) {
      return {
        severity: 'Low (known issue)',
        rootCause:
          'Matches a known, already-triaged site defect: "em: INSUFFICIENT_PATH" thrown from a useMemo in the ' +
          "site's shared [locale] layout chunk. Confirmed live 2026-08-27 — fires on both anonymous and " +
          'authenticated flows (not login-specific, despite the name it was first found under), most likely ' +
          'triggered by opening interactive UI (modals, popups). No functional breakage observed in any session ' +
          'so far.',
        whatToCheck:
          'No action needed unless this starts correlating with real user-facing breakage. Tracked as a known ' +
          'defect — don\'t re-investigate from scratch each time it shows up.',
      };
    }
    return {
      severity: 'Needs triage',
      rootCause: `The browser logged a genuine JavaScript error during this page's lifecycle: ${errors.slice(0, 3).join(' | ')}. Could be a real functional bug, third-party script noise, or something not yet catalogued.`,
      whatToCheck:
        "Open browser DevTools console on this exact page/flow, reproduce, and check the stack trace's " +
        'originating file/line. If it recurs across many tests, consider whether it should be filtered as noise ' +
        '(like the 429s already excluded here) or documented as a new known issue.',
    };
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
      const buffer = await this.page.screenshot({ fullPage: true, timeout: 30_000 });
      await attachment(name, buffer, ContentType.PNG);

      if (brokenImages.length > 0) {
        await logStep(`Broken images: ${brokenImages.join(', ')}`, Status.BROKEN);
        await attachment(
          '🔍 Issue Analysis — Broken images',
          this.issueAnalysisHtml({
            severity: 'Medium',
            rootCause: `${brokenImages.length} &lt;img&gt; element(s) failed to load (naturalWidth stayed 0): ${brokenImages.join(', ')}. Usually a missing/renamed asset, a broken CDN reference, or a timing race where the src was requested before the resource existed.`,
            whatToCheck:
              'Open this page in a real browser and look for a broken-image icon or blank space where the ' +
              'listed image(s) should render. Check the Network tab for 4xx/5xx responses on the URLs above.',
          }),
          ContentType.HTML
        );
      }
      if (overflowPx > 0) {
        await logStep(`Horizontal overflow: ${overflowPx}px wider than the viewport`, Status.BROKEN);
        await attachment(
          '🔍 Issue Analysis — Horizontal overflow',
          this.issueAnalysisHtml({
            severity: overflowPx > 50 ? 'Medium' : 'Low',
            rootCause: `The page renders ${overflowPx}px wider than the viewport, forcing an unwanted horizontal scrollbar. Usually an image/table without max-width, a fixed-width element, or a layout bug specific to this viewport.`,
            whatToCheck:
              'Resize the browser to this exact viewport and look for a horizontal scrollbar. In DevTools, use ' +
              "the Elements panel's layout/overflow debugging (or widen elements one at a time) to find which " +
              'one is too wide.',
          }),
          ContentType.HTML
        );
      }
      if (consoleErrors.length > 0) {
        await logStep(`Browser console errors: ${consoleErrors.slice(0, 3).join(' | ')}`, Status.BROKEN);
        await attachment(
          '🔍 Issue Analysis — Console errors',
          this.issueAnalysisHtml(this.consoleErrorAnalysis(consoleErrors)),
          ContentType.HTML
        );
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
   * Opens the site search (magnifying-glass icon, present at both
   * desktop and mobile widths despite its `Navbar_mobileIcon` class
   * name), searches `query`, and returns the result game hrefs.
   * Confirmed live 2026-08-27: search is games-only — a provider name
   * like "Evolution" returns games whose *titles* contain it, not a
   * distinct Provider/Category result type.
   */
  async searchGames(query: string): Promise<string[]> {
    return step(`Search for "${query}"`, async () => {
      await this.page.locator('[class*="Navbar_mobileIcon"]').first().click();
      const input = this.page.locator('input#searchGames');
      await input.waitFor();
      // A short settle wait before typing — confirmed live 2026-08-27
      // that typing immediately after the input becomes visible can
      // drop early keystrokes mid-transition, silently truncating the
      // query into one that matches nothing.
      await this.page.waitForTimeout(500);
      // pressSequentially + Enter, not fill() — confirmed live
      // 2026-08-27 (under this project's configured ru-RU locale):
      // without Enter, only a "N results" count label renders
      // (`SearchGamesInput_containerResults`), not the actual results
      // panel with clickable game links.
      await input.pressSequentially(query, { delay: 50 });
      await input.press('Enter');
      // Filtered by visible text matching `query`, not a container class —
      // confirmed live 2026-08-27 that the results panel's wrapping class
      // isn't stable (varies with a Games/Providers/Categories tab bar
      // that isn't always present), while every game card's own text
      // reliably contains its title regardless of which panel it's in.
      const results = this.page.locator('a[class*="GameCard_gameLink"]', { hasText: query });
      await expect(results.first()).toBeVisible({ timeout: 15_000 });
      const hrefs = await results.evaluateAll((links) => links.map((l) => l.getAttribute('href')));
      return [...new Set(hrefs.filter((href): href is string => !!href))];
    });
  }

  /**
   * Opens the side menu — desktop uses a permanent burger icon, mobile
   * (viewport width < 768) uses the bottom-nav "Menu" button instead;
   * both open the identical `SideMenu_menuItems` panel. Confirmed live
   * 2026-08-27.
   */
  async openSideMenu(): Promise<void> {
    await step('Open the side menu', async () => {
      const width = this.page.viewportSize()?.width ?? 1280;
      const trigger =
        width < 768
          ? this.page.locator('button[data-action="menu"]')
          : this.page.locator('[class*="Burger_container_block_openCloseButton"]');
      await trigger.click();
      await this.page.locator('nav[class*="SideMenu_menuItems"]').waitFor();
    });
  }

  /**
   * Switches the site language via the selector inside the side menu.
   * Confirmed live 2026-08-27: switching to Arabic sets
   * `<html lang="ar" dir="rtl">` and translates visible text.
   */
  async switchLanguage(label: 'English' | 'العربية'): Promise<void> {
    await step(`Switch language to ${label}`, async () => {
      await this.openSideMenu();
      await this.page.locator('div[class*="SelectLanguage_input"]').click();
      await this.page.locator('[class*="SelectLanguage_option"]', { hasText: label }).click();
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  /**
   * Footer payment-method logos. Scoped to `footer` specifically — a
   * visually similar provider-logo grid (`Provider_gridImage`) exists
   * elsewhere on the page with an easily-confused class prefix.
   */
  async getFooterPaymentMethods(): Promise<string[]> {
    const images = this.page.locator('footer [class*="Cashiers_gridImage"]');
    return images.evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).alt));
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
