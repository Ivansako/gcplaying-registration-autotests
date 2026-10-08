import { Page, expect } from '@playwright/test';
import { step } from 'allure-js-commons';

/**
 * Page object for spinoloco345.com's provider-language audit — a
 * DIFFERENT underlying platform than the "Wiz" one ShelbySpin/FerraPlay/
 * Wildies share (confirmed live 2026-09-21: this one matches the
 * existing `SpinolocoPage.ts` template already automated for
 * spinoloco7545.com — `[data-card="container"]` game cards, no `<a
 * href>` per game, a `/provider/<Name>` route reached only through the
 * header search modal's "Provedores" tab, not linked from the homepage).
 *
 * Locale: unlike ShelbySpin, this brand has NO manual language switcher
 * anywhere (confirmed by `SpinolocoPage.ts`'s own class comment for the
 * sister brand) — locale is purely geo-IP. Confirmed live 2026-09-21
 * the current network already resolves to `pt` with no VPN needed; if
 * that ever stops being true, `confirmLocale()` fails fast with a clear
 * message instead of silently auditing the wrong language.
 *
 * Game engines here render through the SAME `yavuno.com` wrapper seen on
 * ShelbySpin's Novomatic games — no on-screen DOM text for most
 * providers, so this checks the game frame URL(s) for a language
 * parameter first and falls back to a screenshot for a human to check.
 */
export class Spinoloco345Page {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async open(): Promise<void> {
    await step('Open spinoloco345.com', async () => {
      await this.page.goto('/');
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(1_500); // let the SPA hydrate before any interaction
    });
  }

  async getCurrentLocale(): Promise<string> {
    return this.page.evaluate(() => document.documentElement.lang);
  }

  async confirmLocale(expected: string): Promise<void> {
    await step(`Confirm the session resolves to "${expected}" locale`, async () => {
      const lang = await this.getCurrentLocale();
      if (lang !== expected) {
        throw new Error(
          `Expected document.documentElement.lang === "${expected}" but got "${lang}". ` +
            'This brand has no manual language switcher — it resolves locale by geo-IP only. ' +
            `Connect a VPN whose exit country maps to "${expected}" before running this suite.`
        );
      }
    });
  }

  async login(email: string, password: string): Promise<void> {
    await step(`Log in as ${email}`, async () => {
      await this.page.getByRole('button', { name: 'Entrar' }).first().click();
      const emailInput = this.page.locator('input[name="email"]');
      await emailInput.waitFor({ timeout: 10_000 });
      await emailInput.fill(email);
      await this.page.locator('input[name="password"]').fill(password);
      await this.page
        .locator('input[name="password"]')
        .locator('xpath=ancestor::form[1]')
        .locator('button[type="submit"]')
        .click();
      await expect(this.page.getByText(/[€$]\s?[\d,.]+/).first()).toBeVisible({ timeout: 15_000 });
    });
  }

  /**
   * Scrapes every `/provider/<Name>` link out of the header search
   * modal's "Provedores" tab — discovered dynamically, not hardcoded.
   * 42 providers confirmed live 2026-09-21.
   */
  async getProviderSlugs(): Promise<string[]> {
    return step('Discover the full provider list from the search modal', async () => {
      await this.page.goto('/');
      await this.page.waitForTimeout(1_000);
      // The search trigger — confirmed live 2026-09-21 `header button`
      // also matches the MatchX loyalty icon (an <img>, first in DOM
      // order) before the real search button, so a bare `.first()` picks
      // the wrong one. The search button is the only header button with
      // an inline `<svg>` icon (MatchX uses `<img>`, Entrar/Registar are
      // text buttons) — CSS-module class hashes aren't stable enough to
      // select by directly.
      await this.page.locator('header button:has(svg)').first().click();
      await this.page.getByRole('button', { name: 'Provedores' }).click();
      await this.page.waitForTimeout(800);

      // WRONG in an earlier version of this method: scrolling the modal's
      // own container to force lazy-render only ever surfaced the FIRST
      // page (42 of the real 72 providers, confirmed live 2026-09-22 by
      // the operator catching the undercount directly against the site's
      // own "Providers (72)" modal header) — this grid is NOT infinite-
      // scroll, it's a real paginated "Carregar Mais" (Load More) button,
      // same mechanism `spinoloco-game-launch.spec.ts` already documents
      // for the sister spinoloco7545.com catalog. Click it until it's
      // gone (it disappeared after a single click when this was last
      // confirmed live, but loop with a cap rather than assume that
      // holds — a shrinking or growing catalog changes the page count).
      for (let i = 0; i < 30; i++) {
        const loadMore = this.page.getByRole('button', { name: 'Carregar Mais' });
        const visible = await loadMore.isVisible().catch(() => false);
        if (!visible) break;
        await loadMore.click();
        await this.page.waitForTimeout(600);
      }

      const hrefs = await this.page.evaluate(() =>
        [...document.querySelectorAll('a[href^="/provider/"]')].map((a) => a.getAttribute('href') as string)
      );
      await this.page.keyboard.press('Escape').catch(() => {});
      const slugs = [...new Set(hrefs)].map((h) => decodeURIComponent(h.replace('/provider/', '')));
      if (slugs.length < 50) {
        // Loud, not a silent undercount — this is exactly the mistake
        // that shipped an incomplete 42-of-72 audit once already.
        throw new Error(`Only discovered ${slugs.length} providers — expected 60-80. The "Carregar Mais" pagination probably didn't fully expand; check this method before trusting the result.`);
      }
      return slugs;
    });
  }

  /**
   * Opens a provider's page and launches its first game CARD — this
   * platform has no per-game `<a href>`, only a clickable
   * `[data-card="container"]` (see class comment).
   */
  async launchFirstGameForProvider(providerSlug: string): Promise<{ launched: boolean }> {
    return step(`Open provider "${providerSlug}" and launch its first game`, async () => {
      await this.page.goto(`/provider/${encodeURIComponent(providerSlug)}`);
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(1_500);
      const firstCard = this.page.locator('[data-card="container"]').first();
      const found = await firstCard
        .waitFor({ timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!found) return { launched: false };
      await firstCard.click();

      const gameIframe = this.page.locator('iframe[src]:not([src=""]):not([src*="livechatinc"]):not([src*="trustpilot"])').first();
      const loaded = await gameIframe
        .waitFor({ state: 'visible', timeout: 45_000 })
        .then(() => true)
        .catch(() => false);
      return { launched: loaded };
    });
  }

  /** Same approach as ShelbySpinPage's identical method — see its own comment for why. */
  async getGameFrameLanguageParams(): Promise<string[]> {
    return step("Check the live game frames' own URLs for a language parameter", async () => {
      const urls = this.page
        .frames()
        .map((f) => f.url())
        .filter((u) => u && !u.includes('livechatinc') && !u.includes('trustpilot') && u !== 'about:blank' && !u.includes('spinoloco345.com'));
      const re = /[?&](?:language|lang|locale)=([a-zA-Z_-]+)/gi;
      const found: string[] = [];
      for (const url of urls) {
        for (const m of url.matchAll(re)) found.push(decodeURIComponent(m[1]).toLowerCase());
      }
      return [...new Set(found)];
    });
  }
}
