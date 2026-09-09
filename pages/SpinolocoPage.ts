import { expect, Locator, Page } from '@playwright/test';
import { attachment, step } from 'allure-js-commons';
import { ContentType } from 'allure-js-commons';
import { GameEntry, defaultMaxLoadMoreClicks, gameKey } from '../utils/spinolocoCatalog';
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

  /**
   * The site force-redirects by geo-IP at the SERVER level — confirmed
   * live 2026-09-08 that requesting `/pl/...` from a non-Polish-resolving
   * IP 302s to `/it/...` (or whatever locale that IP maps to) even with
   * an explicit `NEXT_LOCALE=pl` cookie sent, and there is no client-side
   * language switcher anywhere in the header/side menu/account menu to
   * override it afterward (confirmed: zero `data-*` attributes anywhere
   * in the header, unlike Wildies). This automation CANNOT force Polish
   * content from an arbitrary network — so every navigation below reads
   * back whatever locale the session actually landed on
   * (`document.documentElement.lang`, same robust signal
   * `WildiesPage.getCurrentLocale()` already relies on) and uses THAT
   * prefix, instead of hardcoding `/pl`.
   */
  async open(path = '/'): Promise<void> {
    await step(`Open spinoloco7545.com${path}`, async () => {
      await this.page.goto(path);
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  async getCurrentLocale(): Promise<string> {
    return this.page.evaluate(() => document.documentElement.lang || 'pl');
  }

  async login(account: SpinolocoAccount): Promise<void> {
    await step(`Log in as ${account.email} (${account.currency})`, async () => {
      // No stable `data-*` hook and the label text varies by locale (see
      // this class's own comment) — instead, click header buttons one at
      // a time until a password field appears. Locale/order-independent
      // by construction: whichever button actually opens the login form
      // is "the login trigger", regardless of what it says.
      const passwordInput = this.page.locator('input[type="password"]');
      const headerButtons = this.page.locator('header button');
      const buttonCount = await headerButtons.count();
      for (let i = 0; i < buttonCount; i++) {
        if (await passwordInput.isVisible().catch(() => false)) break;
        await headerButtons.nth(i).click({ timeout: 2_000 }).catch(() => {});
        if (
          await passwordInput
            .waitFor({ state: 'visible', timeout: 1_500 })
            .then(() => true)
            .catch(() => false)
        )
          break;
      }
      await passwordInput.waitFor({ state: 'visible', timeout: 10_000 });
      // The email/username field: `type="password"`'s own form's other
      // text input — HTML `type` is locale-independent, unlike a
      // placeholder string.
      const form = passwordInput.locator('xpath=ancestor::form[1]');
      const emailInput = form.locator('input[type="text"], input[type="email"]').first();
      await emailInput.fill(account.email);
      await passwordInput.fill(account.password);
      await form.locator('button[type="submit"]').click();
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
      const locale = await this.getCurrentLocale();
      await this.page.goto(`/${locale}/slots`);
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  async goToLiveCasino(): Promise<void> {
    await step('Open the Live Casino lobby', async () => {
      const locale = await this.getCurrentLocale();
      await this.page.goto(`/${locale}/live-games`);
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  private static readonly LOAD_MORE_MARK = 'data-spinoloco-load-more';

  /**
   * The "Load more" button, found structurally rather than by its
   * (locale-dependent) label: walks up from the "42 / 4371"-style
   * progress counter (that digit/slash pattern is the same in every
   * locale) looking for a nearby `<button>`, tags it with a temp
   * attribute, and returns a Locator for that. Falls back to the
   * confirmed Polish/Italian/English labels if no counter is found (e.g.
   * a locale whose counter format differs) — belt-and-suspenders, not the
   * primary mechanism.
   *
   * Checks for an ALREADY-marked element first (a cheap `querySelector`)
   * before re-running the expensive full-body `TreeWalker` scan —
   * confirmed live 2026-09-08 that re-scanning the ENTIRE page on every
   * single click (this method used to run unconditionally each
   * iteration) is O(catalog size) per call, and with the catalog growing
   * every batch, the WHOLE pagination loop was effectively O(n²): a
   * 20-minute test timeout hit mid-way through Slots alone. The mark
   * persists across re-renders in practice (confirmed live), so this
   * usually only pays the full scan cost ONCE per page, not once per
   * click.
   */
  private async findLoadMoreButton(): Promise<Locator> {
    const mark = SpinolocoPage.LOAD_MORE_MARK;
    const alreadyMarked = this.page.locator(`[${mark}]`).first();
    if (await alreadyMarked.isVisible({ timeout: 300 }).catch(() => false)) return alreadyMarked;

    const found = await this.page.evaluate((m) => {
      document.querySelectorAll(`[${m}]`).forEach((el) => el.removeAttribute(m));
      const counterRe = /^\s*\d+\s*\/\s*\d+\s*$/;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim() ?? '';
        if (!counterRe.test(text)) continue;
        let container: Element | null = node.parentElement;
        for (let depth = 0; depth < 5 && container; depth++) {
          const candidates = Array.from(container.querySelectorAll('button, [role="button"]'));
          const btn = candidates.find((b) => !(b.textContent ?? '').includes(text));
          if (btn) {
            btn.setAttribute(m, 'true');
            return true;
          }
          container = container.parentElement;
        }
      }
      return false;
    }, mark);
    if (found) return this.page.locator(`[${mark}]`).first();
    return this.page.getByText(/Wczytaj więcej|Visualizza tutto|Load more/i).first();
  }

  /**
   * Clicks "Load more" until the visible card count stops growing (the
   * whole catalog for this page is rendered) or `maxClicks` is hit,
   * whichever comes first.
   *
   * Confirmed live 2026-09-08: "is a load-more-shaped button still
   * visible" is NOT a reliable stop condition on its own. On a page with
   * only 6 games total (a small Live Casino category — e.g. "Lobbies"),
   * the counter correctly read "6 / 6" (nothing left to load) but
   * `findLoadMoreButton()`'s text-based FALLBACK still matched an
   * UNRELATED "Visualizza tutto"/"See all" link belonging to a different
   * section further down the same page, so the loop kept "finding a
   * button" and clicking it — uselessly, ~15s per click, all the way to
   * `maxClicks` — since that click never actually added a card. Card
   * count is the one signal that directly measures the thing this loop
   * actually cares about (did new games appear), immune to which
   * unrelated element the button-finder happened to match.
   */
  async loadMoreUntilAll(maxClicks = defaultMaxLoadMoreClicks() ?? 250): Promise<{ clicks: number; cappedOut: boolean }> {
    return step('Load the full game catalog for this page', async () => {
      let clicks = 0;
      // Diagnostic-only logging (2026-09-08, live debugging session):
      // this loop's real-world runtime turned out to vary wildly (a few
      // seconds to 30+ minutes stuck) with no visibility into WHERE the
      // time was going until a run finished or hit its own timeout.
      // Plain `console.log` from here (Node/test-process context, not
      // `page.evaluate()`) streams to the Playwright reporter's stdout in
      // real time, unlike an Allure attachment (only flushed at test
      // end) — cheap enough to leave in permanently.
      const startedAt = Date.now();
      let cardCountBefore = (await this.collectGameCards().catch(() => [])).length;
      while (clicks < maxClicks) {
        const button = await this.findLoadMoreButton();
        if (!(await button.isVisible({ timeout: 1_000 }).catch(() => false))) break;
        const clickStartedAt = Date.now();
        await button.click().catch(() => {});
        clicks++;
        await this.page.waitForTimeout(300);
        let cardCountAfter = (await this.collectGameCards().catch(() => [])).length;
        if (cardCountAfter <= cardCountBefore) {
          // Give one slow batch the benefit of the doubt — confirmed live
          // some clicks' new cards render well after the initial 300ms
          // settle, and concluding "done" one batch too early would
          // silently truncate a genuinely bigger catalog.
          await this.page.waitForTimeout(1_500);
          cardCountAfter = (await this.collectGameCards().catch(() => [])).length;
        }
        console.log(
          `[spinoloco] loadMore click #${clicks}: ${cardCountBefore} -> ${cardCountAfter} cards, ` +
            `${Date.now() - clickStartedAt}ms this click, ${Date.now() - startedAt}ms total`
        );
        if (cardCountAfter <= cardCountBefore) break; // no growth even after the grace wait — done, or clicking the wrong element
        cardCountBefore = cardCountAfter;
      }
      const cappedOut = clicks >= maxClicks && (await (await this.findLoadMoreButton()).isVisible().catch(() => false));
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
  async collectFullCatalog(maxClicks = defaultMaxLoadMoreClicks() ?? 250): Promise<{ games: GameEntry[]; cappedOut: boolean }> {
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
   * Discovers every "<SECTION HEADING> / See all" link on the CURRENT
   * page (confirmed live: "Zobacz wszystkie" in Polish, "Visualizza
   * tutto" in Italian — same UI element, different label per locale, see
   * this class's own comment on locale handling) and returns each
   * section's label + the URL its link resolves to. Discovery-driven —
   * scales to however many sections a page actually has, no hardcoded
   * category list.
   *
   * Navigates by CLICKING each link and reading back `page.url()`, not by
   * reading a static `href` — confirmed live this brand's "See all"
   * controls aren't guaranteed to be real `<a href>` elements (could be a
   * JS-routed button, same as most of this SPA), so a static href read
   * can silently be empty/wrong. Restores the original page after each,
   * since clicking navigates away.
   */
  async getCategorySections(): Promise<Array<{ label: string; url: string }>> {
    return step('Discover category sections on this page', async () => {
      const startUrl = this.page.url();
      const seeAllLinks = this.page.getByText(/Zobacz wszystkie|Visualizza tutto|See all|View all/i);
      const count = await seeAllLinks.count();
      const sections: Array<{ label: string; url: string }> = [];
      for (let i = 0; i < count; i++) {
        const link = this.page.getByText(/Zobacz wszystkie|Visualizza tutto|See all|View all/i).nth(i);
        // The section's own heading is the nearest preceding heading-like
        // sibling in the same row — read via a small DOM walk rather than
        // a fixed selector, since the row's exact tag isn't confirmed.
        const label = await link
          .evaluate((el) => {
            let node: Element | null = el.parentElement;
            for (let depth = 0; depth < 4 && node; depth++) {
              const heading = node.querySelector('h1, h2, h3, [class*="title" i], [class*="heading" i]');
              if (heading?.textContent?.trim()) return heading.textContent.trim();
              node = node.parentElement;
            }
            return '';
          })
          .catch(() => '');
        if (!label) continue;
        try {
          await link.click({ timeout: 5_000 });
          await this.page.waitForURL((u) => u.toString() !== startUrl, { timeout: 8_000 }).catch(() => {});
          sections.push({ label, url: this.page.url() });
        } catch {
          // one section's link misbehaving shouldn't sink discovery of the rest
        } finally {
          await this.page.goto(startUrl);
          await this.page.waitForLoadState('domcontentloaded');
        }
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

      // Confirmed live 2026-09-09: a game page renders (at least) THREE
      // `<iframe>`s — the real game engine (e.g.
      // `wizmatech2.games.amusnet.io/...`), a LiveChat widget
      // (`secure.livechatinc.com`), and one with an empty `src`. Plain
      // `iframe.first()` was matching whichever of those happens to be
      // first in DOM order — NOT necessarily the game — so this was
      // waiting on the wrong element and reporting every launch as
      // "never became visible" regardless of whether the actual game
      // loaded fine. Scoped to a real, non-livechat `src` instead.
      const iframe = this.page.locator('iframe[src]:not([src=""]):not([src*="livechatinc"])').first();
      const errorText = this.page.getByText(/błąd|error|failed|niedostępn|access denied|nie znaleziono|500|502|503/i);
      try {
        await Promise.race([
          iframe.waitFor({ state: 'visible', timeout: 30_000 }),
          errorText.first().waitFor({ state: 'visible', timeout: 30_000 }),
        ]);
      } catch {
        // Diagnostic-only (2026-09-09 live debugging): dumps the real
        // game iframe's own dimensions/attachment state at the moment
        // this gives up, straight from the actual Playwright browser
        // (not a proxy tool that can misrepresent a hidden/background
        // pane's layout) — settles whether it's genuinely never
        // attaching vs. attaching but staying zero-size.
        const diag = await this.page
          .evaluate(() => {
            const el = document.querySelector('iframe[src]:not([src=""]):not([src*="livechatinc"])') as HTMLIFrameElement | null;
            if (!el) return { found: false };
            const rect = el.getBoundingClientRect();
            return {
              found: true,
              src: el.src.slice(0, 80),
              offsetW: el.offsetWidth,
              offsetH: el.offsetHeight,
              rectW: rect.width,
              rectH: rect.height,
              display: getComputedStyle(el).display,
              bodyW: document.body.offsetWidth,
              bodyH: document.body.offsetHeight,
            };
          })
          .catch((e) => ({ found: false, error: String(e) }));
        console.log(`[spinoloco] launch timeout diagnostic for ${game.name}: ${JSON.stringify(diag)}`);
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

  /**
   * Lightweight per-game evidence shot for the launch check — viewport
   * only (no `fullPage` scroll-and-stitch: a game view is one fixed
   * screen, not a long page, and stitching a cross-origin iframe's canvas
   * mid-scroll is exactly the kind of thing that produced Wildies'
   * garbled/overlapping screenshots). No automated check can tell
   * whether the game's own Spin/Play button rendered — that control
   * lives inside an opaque cross-origin canvas with no accessible DOM —
   * so this is the human-verifiable record for that (2026-09-08
   * decision): a human scans this screenshot per game to catch a missing
   * button that "iframe loaded, no error text" alone wouldn't.
   */
  async attachGameScreenshot(name: string): Promise<void> {
    await step(`Screenshot: ${name}`, async () => {
      const buffer = await this.page.screenshot({ fullPage: false, timeout: 15_000 }).catch(() => null);
      if (buffer) await attachment(name, buffer, ContentType.PNG);
    });
  }
}
