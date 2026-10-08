import { Page, Locator, expect } from '@playwright/test';
import { step } from 'allure-js-commons';

/**
 * Page object for shelbyspin3322.com's provider-language audit — this
 * brand runs the same "Wiz" platform already documented for
 * FerraPlay/Wildies/ShelbySpin1213 (identical login-modal markup,
 * `data-modal-close-button` dismissal, `/providers/<Name>` listing
 * pages, `/game/real/<id>` game links, and — confirmed live 2026-09-21
 * after an earlier wrong assumption in this same file — the identical
 * sidebar language switcher too: `[data-sidemenu="lang-switcher-trigger"]`
 * / `[data-sidemenu="lang-switcher"]`).
 *
 * IMPORTANT: `switchLocale()` (below) is the right way to get Dutch —
 * NOT a VPN. The homepage's initial geo-IP-resolved language was a red
 * herring: on this brand, being on a Netherlands-IP ALSO trips a
 * regulatory regional block on the game aggregator itself ("games are
 * not available in Netherlands on this website" / KSA licensing),
 * confirmed live 2026-09-21 — so the one country whose geo-IP yields
 * Dutch is also the one country where no game will ever launch. The
 * in-page switcher sidesteps this entirely: whatever country's IP the
 * session is actually on (as long as it isn't itself geo-blocked),
 * explicitly switching to "Nederlands" gets Dutch UI text with games
 * still launching normally.
 */
export class ShelbySpinPage {
  readonly page: Page;

  readonly sideMenuToggle: Locator;
  readonly langSwitcherTrigger: Locator;
  readonly langSwitcherPanel: Locator;

  constructor(page: Page) {
    this.page = page;
    // The "wrapper" <button>, not the nested "first-icon" <div> it
    // contains — confirmed live 2026-09-21 via a standalone debug script
    // that clicking the inner icon div never actually toggles
    // `sidebar-open`/`sidebar-close` on <body> (Playwright's click()
    // doesn't error, it just has no effect), while clicking the wrapper
    // button reliably does. FerraPlayPage's identical-looking selector
    // targets "first-icon" and (per that file's own comments) works
    // there — not assumed to carry over here without this same check.
    this.sideMenuToggle = page.locator('header [data-icon-button-type="wrapper"]').first();
    this.langSwitcherTrigger = page.locator('[data-sidemenu="lang-switcher-trigger"]');
    this.langSwitcherPanel = page.locator('[data-sidemenu="lang-switcher"]');
  }

  async open(): Promise<void> {
    await step('Open shelbyspin3322.com', async () => {
      await this.page.goto('/');
      await this.page.waitForLoadState('domcontentloaded');
      // `domcontentloaded` fires before this SPA's React hydration
      // attaches real click handlers — confirmed live 2026-09-21 the
      // side-menu toggle can silently no-op if clicked too early
      // (Playwright's click() itself never errors). A fixed settle
      // delay is simpler and more reliable here than guessing which
      // element to waitFor as an "app is ready" signal.
      await this.page.waitForTimeout(1_500);
    });
  }

  async getCurrentLocale(): Promise<string> {
    return this.page.evaluate(() => document.documentElement.lang);
  }

  private async clickSideMenuToggle(): Promise<void> {
    const isNarrowViewport = (this.page.viewportSize()?.width ?? 1280) < 700;
    const toggle = isNarrowViewport ? this.page.locator('#bottom-navigation > div').first() : this.sideMenuToggle;
    await toggle.click();
  }

  async openSideMenu(): Promise<void> {
    await step('Open the side menu', async () => {
      const isOpen = await this.page.evaluate(() => document.body.className.includes('sidebar-open'));
      if (isOpen) return;
      // One retry: the same hydration-timing race `open()` waits out
      // can still occasionally swallow the first click.
      try {
        await this.clickSideMenuToggle();
        await expect(this.page.locator('body')).toHaveClass(/sidebar-open/, { timeout: 3_000 });
      } catch {
        await this.clickSideMenuToggle();
        await expect(this.page.locator('body')).toHaveClass(/sidebar-open/, { timeout: 5_000 });
      }
    });
  }

  async closeSideMenu(): Promise<void> {
    await step('Close the side menu', async () => {
      const isOpen = await this.page.evaluate(() => document.body.className.includes('sidebar-open'));
      if (!isOpen) return;
      await this.clickSideMenuToggle();
      await expect(this.page.locator('body')).not.toHaveClass(/sidebar-open/, { timeout: 3_000 }).catch(() => {});
    });
  }

  /**
   * Switches to `displayName` (the option's own native-language label,
   * e.g. `"Nederlands"`) via the sidebar dropdown — see the class
   * comment for why this, not a VPN, is the correct way to get Dutch on
   * this brand.
   */
  async switchLocale(displayName: string): Promise<string> {
    return step(`Switch locale to: ${displayName}`, async () => {
      const previousLang = await this.getCurrentLocale();
      await this.openSideMenu();
      await this.langSwitcherTrigger.click();
      const option = this.langSwitcherPanel.getByRole('link', { name: displayName, exact: true });
      await expect(option).toBeVisible();
      await option.click();
      await this.page
        .waitForFunction((prev) => document.documentElement.lang !== prev, previousLang, { timeout: 5_000 })
        .catch(() => {});
      await this.closeSideMenu();
      return this.getCurrentLocale();
    });
  }

  private async dismissModalIfPresent(): Promise<void> {
    const overlay = this.page.locator('[data-modal-overlay="true"]').first();
    if (await overlay.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await overlay
        .locator('[data-modal-close-button]')
        .click()
        .then(() => expect(overlay).toBeHidden({ timeout: 5_000 }))
        .catch(() => {});
    }
  }

  async login(email: string, password: string): Promise<void> {
    await step(`Log in as ${email}`, async () => {
      await this.dismissModalIfPresent();
      const headerButtons = this.page.locator('button[data-header-button]');
      const emailInput = this.page.locator('input[name="usernameEmail"]');
      await headerButtons.first().click();
      try {
        await emailInput.waitFor({ timeout: 3_000 });
      } catch {
        await headerButtons.first().click();
        await emailInput.waitFor({ timeout: 10_000 });
      }
      await emailInput.fill(email);
      await this.page.locator('input[name="password"]').fill(password);
      await this.page
        .locator('input[name="password"]')
        .locator('xpath=ancestor::form[1]')
        .locator('button[type="submit"]')
        .click();
      await expect(this.page.locator('header').getByText(/[€$]\s?[\d,.]+/)).toBeVisible({ timeout: 15_000 });
      await this.dismissModalIfPresent();
    });
  }

  /**
   * Scrapes every `/providers/<Name>` link off the homepage — discovered
   * dynamically rather than hardcoded, so a provider added/removed from
   * the real catalog is reflected next run with no code change. 61
   * providers confirmed live 2026-09-21.
   */
  async getProviderSlugs(): Promise<string[]> {
    return step('Discover the full provider list from the homepage', async () => {
      await this.page.goto('/');
      const hrefs = await this.page.evaluate(() =>
        [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')))].filter(
          (h): h is string => !!h && h.startsWith('/providers/')
        )
      );
      return hrefs.map((h) => decodeURIComponent(h.replace('/providers/', '')));
    });
  }

  /**
   * Opens a provider's listing page and launches its FIRST game card —
   * one representative game per provider, per the brief (not an
   * exhaustive per-provider catalog sweep, see `spinolocoCatalog.ts` for
   * that different, heavier pattern this suite deliberately doesn't
   * need).
   */
  async launchFirstGameForProvider(providerSlug: string): Promise<{ launched: boolean; gameUrl?: string }> {
    return step(`Open provider "${providerSlug}" and launch its first game`, async () => {
      await this.page.goto(`/providers/${encodeURIComponent(providerSlug)}`);
      await this.page.waitForLoadState('domcontentloaded');
      const firstGame = this.page.locator('a[href^="/game/real/"]').first();
      const found = await firstGame
        .waitFor({ timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!found) return { launched: false };
      const gameUrl = await firstGame.getAttribute('href');
      await firstGame.click();
      await this.dismissModalIfPresent();

      // Same iframe-scoping fix `SpinolocoPage.launchGameAndCheck()` already
      // needed: the page also carries a LiveChat iframe and one with an
      // empty `src` — the real game engine is whichever real-`src` iframe
      // isn't LiveChat.
      const gameIframe = this.page.locator('iframe[src]:not([src=""]):not([src*="livechatinc"]):not([src*="trustpilot"])').first();
      const loaded = await gameIframe
        .waitFor({ state: 'visible', timeout: 45_000 })
        .then(() => true)
        .catch(() => false);
      return { launched: loaded, gameUrl: gameUrl ?? undefined };
    });
  }

  /**
   * Extracts any `language=`/`lang=`/`locale=` query parameter from
   * every real game-related frame's own URL (excluding LiveChat/
   * Trustpilot/blank frames). NOT text extraction — confirmed live
   * 2026-09-21 that every game engine on this platform renders through
   * `<canvas>` (Pragmatic via `cdn.bored-perch-96.net`, Novomatic's
   * `yavuno.com` wrapper, ...), so there is no DOM text to read at all;
   * `innerText` comes back empty regardless of provider or how long you
   * wait. But the frame `src` itself often carries the language it was
   * launched with in plain sight — confirmed live on Pragmatic:
   * `...%60%7Clanguage%3Den%60%7C...` in the URL despite the parent site
   * being switched to Dutch — which is a far cheaper and more reliable
   * signal than OCR-ing canvas pixels would be. Returns every match
   * found across every frame; empty array means this provider doesn't
   * expose language in the URL at all (verdict falls back to
   * "inconclusive", and the screenshot taken alongside this is the real
   * evidence for a human to check).
   */
  async getGameFrameLanguageParams(): Promise<string[]> {
    return step("Check the live game frames' own URLs for a language parameter", async () => {
      const urls = this.page
        .frames()
        .map((f) => f.url())
        .filter((u) => u && !u.includes('livechatinc') && !u.includes('trustpilot') && u !== 'about:blank' && !u.includes('shelbyspin3322.com'));
      const re = /[?&](?:language|lang|locale)=([a-zA-Z_-]+)/gi;
      const found: string[] = [];
      for (const url of urls) {
        for (const m of url.matchAll(re)) found.push(decodeURIComponent(m[1]).toLowerCase());
      }
      return [...new Set(found)];
    });
  }
}
