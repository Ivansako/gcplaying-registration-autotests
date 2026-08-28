import { expect, Locator, Page } from '@playwright/test';
import { attachment, logStep, step } from 'allure-js-commons';
import { ContentType, Status } from 'allure-js-commons';
import { formatConsoleErrors, recordIssue } from '../utils/issueTracker';

/**
 * Page object for beta.wildies.com's locale switcher — written ahead of
 * German/Finnish/Spanish/Swedish/Norwegian being added to the dropdown
 * (see the "Add German | Finnish | Spanish | Swedish | Norwegian
 * languages to the Drop Down and deploy to Beta" ticket) so the check is
 * ready the moment they land, exercised meanwhile against the 6 locales
 * already live.
 *
 * Confirmed live 2026-08-28 (anonymous session, desktop):
 *  - URL is a path prefix per locale (`/fr`, `/el`, ...) — English is the
 *    one exception, served at the bare root `/` with no `/en` prefix.
 *  - The switcher lives inside the left sidebar (`aside[data-sidemenu="container"]`),
 *    opened via the header's icon button (`[data-icon-button-type="first-icon"]`,
 *    toggles `body` between `sidebar-open`/`sidebar-close` classes — no
 *    aria-expanded to poll, has to be inferred from `body.className`).
 *    Inside it, `[data-sidemenu="lang-switcher-trigger"]` expands a list
 *    of `<a>` options inside `[data-sidemenu="lang-switcher"]`, one per
 *    locale, labeled with the language's own native display name (e.g.
 *    "Ελληνικά", not "Greek"/"el") — every option's `href` is a static
 *    "/" placeholder (real navigation happens client-side on click), so
 *    matching is by visible text, not href.
 *  - `document.documentElement.lang` reliably reflects the active locale
 *    code right after navigation — confirmed for en/fr — the same,
 *    single, most robust check to use for every locale rather than
 *    matching translated page text (which this page object doesn't know
 *    ahead of time for locales not yet added).
 *  - Same underlying platform/component library as gcplaying0175.com
 *    (identical `WizButton`/ripple-effect markup), but this brand's CSS
 *    build fully minifies class names (`dyn-xx` hashes, no CSS-module
 *    semantic names) — every locator here is built on stable `data-*`
 *    attributes instead, never on a class name.
 */
export class WildiesPage {
  readonly page: Page;

  readonly sideMenuToggle: Locator;
  readonly sideMenu: Locator;
  readonly langSwitcherTrigger: Locator;
  readonly langSwitcherPanel: Locator;

  private consoleErrors: string[] = [];

  constructor(page: Page) {
    this.page = page;
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') this.consoleErrors.push(msg.text());
    });

    // Scoped to <header> and `.first()` — `[data-icon-button-type="first-icon"]`
    // is a generic template attribute this design system reuses on other
    // icon-only buttons too (confirmed live 2026-08-28: matched the header
    // search icon on every page, and pagination prev/next arrows on pages
    // with enough content sections — up to 15 matches on some locales).
    this.sideMenuToggle = page.locator('header [data-icon-button-type="first-icon"]').first();
    this.sideMenu = page.locator('aside[data-sidemenu="container"]');
    this.langSwitcherTrigger = page.locator('[data-sidemenu="lang-switcher-trigger"]');
    this.langSwitcherPanel = page.locator('[data-sidemenu="lang-switcher"]');
  }

  async open(localeSegment = ''): Promise<void> {
    await step(`Open beta.wildies.com${localeSegment ? '/' + localeSegment : ''}`, async () => {
      await this.page.goto(`/${localeSegment}`);
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  /**
   * Idempotent: checks `body`'s class first, since the toggle is a plain
   * click (no distinct open/close targets) and clicking an already-open
   * menu would close it. Retries the click once — confirmed live
   * 2026-08-28 that the very first click on a freshly-loaded page
   * occasionally doesn't register (no console error, no intercepting
   * overlay found; looks like the handler attaches a beat after the icon
   * itself becomes clickable).
   */
  async openSideMenu(): Promise<void> {
    await step('Open the side menu', async () => {
      const isOpen = await this.page.evaluate(() => document.body.className.includes('sidebar-open'));
      if (isOpen) return;
      await this.sideMenuToggle.click();
      try {
        await expect(this.page.locator('body')).toHaveClass(/sidebar-open/, { timeout: 3_000 });
      } catch {
        await this.sideMenuToggle.click();
        await expect(this.page.locator('body')).toHaveClass(/sidebar-open/, { timeout: 5_000 });
      }
    });
  }

  /**
   * Switches to `displayName` (the option's own native-language label,
   * e.g. "Ελληνικά" — not a locale code) via the sidebar dropdown, then
   * returns the resulting `<html lang>` value for the caller to assert
   * against the expected code.
   *
   * The switch is a client-side route change, not a full page load —
   * confirmed live 2026-08-28: `waitForLoadState('domcontentloaded')`
   * resolves near-instantly since no real navigation/reload fires,
   * racing ahead of the React re-render that actually updates
   * `<html lang>` and produced flaky wrong-locale reads in automation
   * (never reproduced by hand, since manual testing has a human-scale
   * delay between the click and the next check). Waits for the URL and
   * the `lang` attribute to actually change instead of a load event.
   */
  async switchLocale(displayName: string): Promise<string> {
    return step(`Switch locale to: ${displayName}`, async () => {
      const previousUrl = this.page.url();
      const previousLang = await this.getCurrentLocale();

      await this.openSideMenu();
      await this.langSwitcherTrigger.click();
      const option = this.langSwitcherPanel.getByRole('link', { name: displayName, exact: true });
      await expect(option).toBeVisible();
      await option.click();

      await this.page.waitForURL((url) => url.toString() !== previousUrl, { timeout: 10_000 }).catch(() => {});
      await this.page
        .waitForFunction((prev) => document.documentElement.lang !== prev, previousLang, { timeout: 5_000 })
        .catch(() => {});
      return this.getCurrentLocale();
    });
  }

  async getCurrentLocale(): Promise<string> {
    return this.page.evaluate(() => document.documentElement.lang);
  }

  /**
   * Reads every option currently offered in the dropdown (native display
   * names) — discovery-driven rather than hardcoded, so a run against
   * this test today (6 locales) and one after the 5 new locales land (11)
   * both just reflect whatever the site actually offers.
   */
  async getAvailableLocaleLabels(): Promise<string[]> {
    await this.openSideMenu();
    await this.langSwitcherTrigger.click();
    const links = this.langSwitcherPanel.getByRole('link');
    await expect(links.first()).toBeVisible();
    return links.allTextContents();
  }

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

  private issueAnalysisHtml(opts: { severity: string; rootCause: string; whatToCheck: string }): string {
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <div style="font-family: sans-serif; font-size: 13px; line-height: 1.6; max-width: 640px;">
      <p><strong>Severity:</strong> ${opts.severity}</p>
      <p><strong>Root cause</strong><br>${opts.rootCause}</p>
      <p><strong>What to check manually</strong><br>${opts.whatToCheck}</p>
    </div>
    </body></html>`;
  }

  private async flagIssue(
    where: string,
    opts: { severity: string; rootCause: string; whatToCheck: string; explainsFailure?: boolean }
  ): Promise<void> {
    recordIssue({ where, ...opts });
  }

  private consoleErrorAnalysis(errors: string[]): { severity: string; rootCause: string; whatToCheck: string } {
    return {
      severity: 'Needs triage',
      rootCause:
        "The browser logged a genuine JavaScript error during this page's lifecycle. Could be a real functional " +
        `bug, third-party script noise, or something not yet catalogued.<br><br><strong>Console errors:</strong><br>${formatConsoleErrors(errors)}`,
      whatToCheck:
        "Open browser DevTools console on this exact locale/page, reproduce, and check the stack trace's " +
        'originating file/line.',
    };
  }

  /**
   * Same pattern as `BrandContentPage.attachScreenshot()` — see that
   * file's comment for the full rationale. No brand-specific known-issue
   * special-casing here yet (unlike gcplaying0175.com's INSUFFICIENT_PATH)
   * since this is the first suite written against this brand.
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
        const opts = {
          severity: 'Medium',
          rootCause: `${brokenImages.length} &lt;img&gt; element(s) failed to load (naturalWidth stayed 0): ${brokenImages.join(', ')}.`,
          whatToCheck: 'Open this locale in a real browser and look for a broken-image icon or blank space.',
        };
        await attachment('🔍 Issue Analysis — Broken images', this.issueAnalysisHtml(opts), ContentType.HTML);
        await this.flagIssue(`Broken images — ${name}`, opts);
      }
      if (overflowPx > 0) {
        await logStep(`Horizontal overflow: ${overflowPx}px wider than the viewport`, Status.BROKEN);
        const opts = {
          severity: overflowPx > 50 ? 'Medium' : 'Low',
          rootCause: `The page renders ${overflowPx}px wider than the viewport. Translated strings (especially German/Finnish, often longer than English) are a common cause of new-locale overflow.`,
          whatToCheck: 'Resize to this viewport and look for a horizontal scrollbar or clipped text.',
        };
        await attachment('🔍 Issue Analysis — Horizontal overflow', this.issueAnalysisHtml(opts), ContentType.HTML);
        await this.flagIssue(`Horizontal overflow — ${name}`, opts);
      }
      if (consoleErrors.length > 0) {
        await logStep(`Browser console errors: ${consoleErrors.slice(0, 3).join(' | ')}`, Status.BROKEN);
        const opts = this.consoleErrorAnalysis(consoleErrors);
        await attachment('🔍 Issue Analysis — Console errors', this.issueAnalysisHtml(opts), ContentType.HTML);
        await this.flagIssue(`Console errors — ${name}`, opts);
      }
    });
  }
}
