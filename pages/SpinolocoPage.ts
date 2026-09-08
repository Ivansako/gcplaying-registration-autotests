import { expect, Locator, Page } from '@playwright/test';
import { attachment, step } from 'allure-js-commons';
import { ContentType } from 'allure-js-commons';
import { GameEntry, gameKey } from '../utils/spinolocoCatalog';
import { SpinolocoAccount } from '../utils/spinolocoAccounts';

/**
 * Page object for spinoloco7545.com — same underlying "Wiz" platform as
 * gcplaying0175.com/beta.wildies.com (`WizGameCard`/`WizButton` component
 * family), built fresh against the live site 2026-09-08 rather than
 * assumed from those brands' markup (confirmed live this brand's CSS
 * module class names carry a semantic prefix + build hash, e.g.
 * `WizGameCard_container_gameName_inner_providerName__d6xtL` — the hash
 * suffix isn't stable across builds, so every locator here is built on
 * `data-card`/`data-type` attributes, which aren't hashed, never on a
 * full class name).
 *
 * Single locale (`/pl`) — unlike Wildies this brand has no locale
 * switcher to route around.
 *
 * Game grid confirmed live 2026-09-08:
 *  - `/pl/slots` (Casino) and `/pl/live-games` (Live Casino) each render
 *    42 `[data-card="container"]` cards at a time, with a "Wczytaj
 *    więcej" (Load more) button underneath and a "42 / 4371"-style
 *    counter — NOT infinite scroll, a real click is required per batch.
 *  - Each card: `[data-card="game-image-container"] img` (thumbnail,
 *    served from `imagedelivery.net`), `[data-card="game-name"]` wraps
 *    two `<p>` — first is the game title, second the provider name.
 *  - Clicking a card navigates the WHOLE page to `/pl/game/real/{id}`,
 *    shows a provider-branded loading screen, then an `iframe` to a
 *    third-party aggregator domain (e.g. `universal.88wplay.com` for
 *    Pragmatic) with `currency`/`language` baked into its query string.
 *  - Category browsing: `/pl/live-games` visibly groups games into named
 *    sections ("NAJLEPSZE GRY", "RULETKA", ...), each with its own
 *    "Zobacz wszystkie" (See all) link to that category's own filtered
 *    listing — the same shape this suite relies on for `/pl/slots` and
 *    the homepage. NOT confirmed to cover literally all 26 categories
 *    from `pageProps.categories` this way — some may only exist as a
 *    game-card badge/tag with no dedicated section — treat
 *    `getCategorySections()`'s result as "every category with a
 *    browsable page", not a guaranteed-complete list of 26.
 *
 * This environment's own outbound network started getting a 403
 * "ACCESS RESTRICTED... not available for your country" block from this
 * brand mid-investigation (2026-09-08, both the Browser tool AND a plain
 * curl from the same sandbox) — the identical bot/proxy-fingerprint
 * pattern already documented for beta.wildies.com blocking ~all VPN/CI
 * IPs while a real browser works fine (see project memory). Selectors
 * below are confirmed against real, successfully-loaded pages before that
 * block hit; category-page URL patterns specifically were NOT
 * cross-verified beyond `/pl/slots` and `/pl/live-games` themselves — the
 * next real run (from an unblocked network) should confirm/fix drift.
 */
export class SpinolocoPage {
  readonly page: Page;
  private consoleErrors: string[] = [];

  constructor(page: Page) {
    this.page = page;
    this.page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Confirmed live 2026-09-08 on a plain, freshly-loaded page (no
      // interaction yet) — generic third-party marketing/chat-widget
      // noise (Smartico, LiveChatWidget, the sportsbook proxy's own
      // unrelated 522/404s, an ad-blocker's ERR_BLOCKED_BY_CLIENT) rather
      // than anything this suite's game-catalog checks care about. Same
      // filtering spirit as `WildiesPage`'s 429 exclusion.
      if (/status of 429|status of 522|Smartico|LiveChatWidget|No DGA script|ERR_BLOCKED_BY_CLIENT|sport-proxy/i.test(text)) return;
      this.consoleErrors.push(text);
    });
  }

  async open(path = '/pl'): Promise<void> {
    await step(`Open spinoloco7545.com${path}`, async () => {
      await this.page.goto(path);
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  async login(account: SpinolocoAccount): Promise<void> {
    await step(`Log in as ${account.email} (${account.currency})`, async () => {
      // Confirmed live 2026-09-08: "Zaloguj się" labels three separate
      // elements at once the modal is open (header trigger, the modal's
      // own Login/Sign Up tab, and the submit button) — `.first()` before
      // the modal exists unambiguously hits the header trigger; `.last()`
      // after the form is filled hits the submit button, since it's the
      // last such element in DOM order.
      await this.page.getByRole('button', { name: 'Zaloguj się' }).first().click();
      const emailInput = this.page.getByPlaceholder('Nazwa użytkownika/Email');
      await emailInput.waitFor({ timeout: 10_000 });
      await emailInput.fill(account.email);
      await this.page.getByPlaceholder('Hasło').fill(account.password);
      await this.page.getByRole('button', { name: 'Zaloguj się' }).last().click();
      // Balance renders as "€ 100.00" (EUR) or a "zł"-suffixed amount
      // (PLN) in the header once login completes — confirmed live for
      // EUR 2026-09-08; PLN's exact formatting NOT independently
      // confirmed, this regex is written to cover both.
      await expect(this.page.locator('header').getByText(/[€$]\s?[\d\s,.]+|[\d\s,.]+\s?zł/i)).toBeVisible({
        timeout: 15_000,
      });
    });
  }

  async goToSlots(): Promise<void> {
    await step('Open the Slots (Casino) lobby', async () => {
      await this.page.goto('/pl/slots');
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  async goToLiveCasino(): Promise<void> {
    await step('Open the Live Casino lobby', async () => {
      await this.page.goto('/pl/live-games');
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  private get loadMoreButton(): Locator {
    return this.page.getByText('Wczytaj więcej', { exact: true });
  }

  /**
   * Clicks "Load more" until it disappears (the whole catalog for this
   * page is rendered) or `maxClicks` is hit, whichever comes first. A cap
   * exists so a single check can't run forever if the button's own
   * disappearance signal ever breaks — the caller decides whether hitting
   * the cap is worth flagging (it means this run didn't see the FULL
   * catalog for this page).
   */
  async loadMoreUntilAll(maxClicks = 250): Promise<{ clicks: number; cappedOut: boolean }> {
    return step('Load the full game catalog for this page', async () => {
      let clicks = 0;
      while (clicks < maxClicks) {
        if (!(await this.loadMoreButton.isVisible({ timeout: 1_000 }).catch(() => false))) break;
        await this.loadMoreButton.click();
        clicks++;
        await this.page.waitForTimeout(300);
      }
      const cappedOut = clicks >= maxClicks && (await this.loadMoreButton.isVisible().catch(() => false));
      return { clicks, cappedOut };
    });
  }

  /** Reads every game card currently rendered in the DOM. */
  async collectGameCards(): Promise<GameEntry[]> {
    return this.page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-card="container"]'));
      return cards
        .map((card) => {
          const img = card.querySelector('[data-card="game-image-container"] img') as HTMLImageElement | null;
          const paragraphs = card.querySelectorAll('[data-card="game-name"] p');
          const name = paragraphs[0]?.textContent?.trim() ?? '';
          const provider = paragraphs[1]?.textContent?.trim() ?? '';
          return { name, provider, imageUrl: img?.src ?? '' };
        })
        .filter((g) => g.name && g.imageUrl);
    });
  }

  /**
   * Loads the FULL catalog for whichever lobby page is currently open
   * (`goToSlots()`/`goToLiveCasino()`/a category page must be called
   * first) and returns every distinct game found. Dedupes by
   * name+provider — a game can legitimately appear more than once across
   * "Load more" batches if the underlying list re-sorts mid-scrape.
   */
  async collectFullCatalog(maxClicks = 250): Promise<{ games: GameEntry[]; cappedOut: boolean }> {
    const { cappedOut } = await this.loadMoreUntilAll(maxClicks);
    const raw = await this.collectGameCards();
    const seen = new Map<string, GameEntry>();
    for (const g of raw) seen.set(gameKey(g), g);
    return { games: [...seen.values()], cappedOut };
  }

  /**
   * Forces every currently-rendered thumbnail to actually attempt to
   * load (bypassing `loading="lazy"` for cards never scrolled into view)
   * and reports which ones failed — `naturalWidth === 0` after `complete`
   * is the same broken-image signal `AccountPage.getBrokenImages()` uses
   * site-wide. A thumbnail URL returning a real HTTP error (missing CDN
   * asset) fails this way; a thumbnail that's merely a generic loading
   * placeholder still in flight does not, since this waits for `complete`
   * first.
   */
  async findBrokenThumbnails(): Promise<GameEntry[]> {
    const broken = await this.page.evaluate(async () => {
      const cards = Array.from(document.querySelectorAll('[data-card="container"]'));
      const entries = cards.map((card) => {
        const img = card.querySelector('[data-card="game-image-container"] img') as HTMLImageElement | null;
        const paragraphs = card.querySelectorAll('[data-card="game-name"] p');
        return {
          name: paragraphs[0]?.textContent?.trim() ?? '',
          provider: paragraphs[1]?.textContent?.trim() ?? '',
          img,
        };
      });
      for (const e of entries) {
        if (e.img) e.img.loading = 'eager';
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      await Promise.all(
        entries.map(
          (e) =>
            e.img &&
            !e.img.complete &&
            new Promise<void>((resolve) => {
              e.img!.addEventListener('load', () => resolve(), { once: true });
              e.img!.addEventListener('error', () => resolve(), { once: true });
              setTimeout(resolve, 8_000);
            })
        )
      );
      return entries
        .filter((e) => e.img && e.img.complete && e.img.naturalWidth === 0 && e.img.src)
        .map((e) => ({ name: e.name, provider: e.provider, imageUrl: e.img!.src }));
    });
    return broken;
  }

  /**
   * Discovers every "<SECTION HEADING> / Zobacz wszystkie" link on the
   * CURRENT page (confirmed live on `/pl/live-games`: "NAJLEPSZE GRY" and
   * "RULETKA" sections, each followed by its own "Zobacz wszystkie" link
   * to that category's dedicated listing) and returns each section's
   * label + the URL its link resolves to. Discovery-driven — scales to
   * however many sections a page actually has, no hardcoded category
   * list.
   */
  async getCategorySections(): Promise<Array<{ label: string; url: string }>> {
    return step('Discover category sections on this page', async () => {
      const seeAllLinks = this.page.getByText('Zobacz wszystkie', { exact: true });
      const count = await seeAllLinks.count();
      const sections: Array<{ label: string; url: string }> = [];
      for (let i = 0; i < count; i++) {
        const link = seeAllLinks.nth(i);
        // The section's own heading is the nearest preceding heading-like
        // sibling in the same row — read via a small DOM walk rather than
        // a fixed selector, since the row's exact tag isn't confirmed.
        const label = await link.evaluate((el) => {
          let node: Element | null = el.parentElement;
          for (let depth = 0; depth < 4 && node; depth++) {
            const heading = node.querySelector('h1, h2, h3, [class*="title" i], [class*="heading" i]');
            if (heading?.textContent?.trim()) return heading.textContent.trim();
            node = node.parentElement;
          }
          return '';
        });
        const href = await link.evaluate((el) => el.closest('a')?.getAttribute('href') ?? '');
        if (label) sections.push({ label, url: href });
      }
      return sections;
    });
  }

  /**
   * Launches a game by clicking its card (found by exact name + provider
   * text within a `[data-card="container"]`) and waits for it to reach a
   * playable state OR surface an explicit error, reporting which. Success
   * criteria confirmed live 2026-09-08: the third-party `iframe` becomes
   * visible (covers both "drops straight into the game" and the "Press
   * anywhere to start" splash — both render inside that same iframe).
   * Failure criteria: the iframe never appears within the timeout, OR the
   * TOP-level page (not the opaque cross-origin iframe, which can't be
   * inspected) shows explicit error text — the exact wording wasn't
   * pinned down live (this environment got network-blocked mid-
   * investigation, see class comment), so this matches a conservative,
   * multilingual set of known failure phrases; tighten/expand it once a
   * real failure has been seen live.
   */
  async launchGameAndCheck(game: GameEntry): Promise<{ ok: boolean; reason?: string }> {
    return step(`Launch: ${game.name} (${game.provider})`, async () => {
      // Exact match on the game-name paragraph — `hasText` alone would
      // substring-match "Sweet Bonanza" against "Sweet Bonanza 1000"
      // too, which can pick the wrong card.
      const exactName = new RegExp(`^${game.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
      const card = this.page
        .locator('[data-card="container"]')
        .filter({ has: this.page.locator('[data-card="game-name"] p', { hasText: exactName }) })
        .first();
      try {
        await card.click({ timeout: 8_000 });
      } catch (err) {
        return { ok: false, reason: `Could not click the game card: ${(err as Error).message}` };
      }

      const iframe = this.page.locator('iframe').first();
      const errorText = this.page.getByText(/błąd|error|failed|niedostępn|access denied|nie znaleziono|500|502|503/i);
      try {
        await Promise.race([
          iframe.waitFor({ state: 'visible', timeout: 30_000 }),
          errorText.first().waitFor({ state: 'visible', timeout: 30_000 }),
        ]);
      } catch {
        await this.page.goBack().catch(() => {});
        return { ok: false, reason: 'Neither the game iframe nor an error message appeared within 30s' };
      }

      const hasIframe = await iframe.isVisible().catch(() => false);
      const hasError = await errorText.first().isVisible().catch(() => false);
      await this.page.goBack().catch(() => {});
      if (hasIframe && !hasError) return { ok: true };
      return { ok: false, reason: hasError ? (await errorText.first().textContent()) ?? 'Error text shown' : 'No iframe reached visibility' };
    });
  }

  /**
   * Attaches a full-page screenshot plus any console errors seen since
   * the last call — purely informational (2026-09-08 decision: this
   * suite is red-or-green only, unlike Wildies' orange `broken` pattern.
   * A console error here is incidental noise unrelated to what a given
   * check is actually verifying, so it's surfaced for visibility, not
   * used to fail or flag anything on its own).
   */
  async attachScreenshot(name: string): Promise<void> {
    await step(`UI check: ${name}`, async () => {
      await this.page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
      const consoleErrors = this.consoleErrors.splice(0);

      const HIDE_STYLE_ID = 'spinoloco-test-hide-bottom-nav';
      await this.page
        .evaluate((id) => {
          const style = document.createElement('style');
          style.id = id;
          // Same fixed-bottom-nav-overlap issue already fixed for
          // Wildies — `!important` survives the component re-asserting
          // its own inline style mid-capture.
          style.textContent = '#bottom-navigation { display: none !important; }';
          document.head.appendChild(style);
        }, HIDE_STYLE_ID)
        .catch(() => {});
      const buffer = await this.page.screenshot({ fullPage: true, timeout: 30_000 });
      await this.page
        .evaluate((id) => document.getElementById(id)?.remove(), HIDE_STYLE_ID)
        .catch(() => {});
      await attachment(name, buffer, ContentType.PNG);

      if (consoleErrors.length > 0) {
        await attachment(`Console errors — ${name}`, consoleErrors.slice(0, 20).join('\n'), ContentType.TEXT);
      }
    });
  }
}
