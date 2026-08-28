import { expect, Locator, Page } from '@playwright/test';
import { attachment, descriptionHtml, logStep, step } from 'allure-js-commons';
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
      // Excludes 429s specifically — see BrandContentPage.ts's constructor
      // comment on gcplaying0175.com for why (test-speed noise from
      // visiting many pages back-to-back, not a real defect) — confirmed
      // the same pattern holds here live 2026-08-28.
      if (msg.type() === 'error' && !/status of 429/.test(msg.text())) this.consoleErrors.push(msg.text());
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
   * Visits an arbitrary path (e.g. `/account/info`) under a given
   * locale's URL prefix. `path` is joined directly, so pass it with a
   * leading slash (`/casino`, not `casino`); `localeSegment` is empty for
   * English, matching `open()`'s own convention.
   */
  async visitPage(path: string, localeSegment = ''): Promise<void> {
    const url = localeSegment ? `/${localeSegment}${path}` : path;
    await step(`Open ${url}`, async () => {
      await this.page.goto(url);
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  /**
   * Logs in via the header's login button + modal. Locale-agnostic on
   * purpose: the trigger is found by its `data-header-button` attribute
   * (not its translated label, which differs per locale — "Accedi" in
   * Italian, confirmed live 2026-08-28), and the form fields by `name`.
   */
  private async submitLoginForm(email: string, password: string): Promise<void> {
    const headerButtons = this.page.locator('button[data-header-button]');
    const emailInput = this.page.locator('input[name="usernameEmail"]');
    await headerButtons.first().click();
    // Retries once — confirmed live 2026-08-28 (same class of issue as
    // `openSideMenu()`'s retry): the very first click right after a fresh
    // navigation occasionally lands before the SPA has hydrated event
    // handlers, so the modal never opens even though the button itself
    // is visible/clickable by Playwright's own actionability checks.
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
  }

  async login(email: string, password: string): Promise<void> {
    await step(`Log in as ${email}`, async () => {
      await this.submitLoginForm(email, password);
      // The balance display is the most reliable "actually logged in"
      // signal — locale-agnostic (a currency-formatted number), unlike
      // any header button's translated label.
      await expect(this.page.locator('header').getByText(/[€$]\s?[\d,.]+/)).toBeVisible({ timeout: 15_000 });
      // A "Finances" (deposit-prompt) modal can auto-open right after
      // login — confirmed live 2026-08-28 — and would otherwise
      // intercept clicks on every subsequent step.
      await this.dismissModalIfPresent();
    });
  }

  /**
   * Submits the login form with credentials expected to fail and
   * confirms the login did NOT succeed (no balance ever appears) —
   * doesn't assert on the error message's exact text/selector, since
   * that wasn't pinned down live. Pair with `checkTranslationCompleteness()`
   * right after to catch the common failure mode this repo has already
   * seen once on gcplaying0175.com: the error rendering as a raw,
   * untranslated i18n key instead of real text.
   */
  async expectLoginFailure(email: string, password: string): Promise<void> {
    await step(`Attempt login with invalid credentials: ${email}`, async () => {
      await this.submitLoginForm(email, password);
      await expect(this.page.locator('header').getByText(/[€$]\s?[\d,.]+/)).not.toBeVisible({ timeout: 8_000 });
    });
  }

  async getBalanceText(): Promise<string> {
    return (await this.page.locator('header').getByText(/[€$]\s?[\d,.]+/).first().textContent())?.trim() ?? '';
  }

  /**
   * Closes a `[data-modal-overlay="true"]` popup if one is covering the
   * page — confirmed live 2026-08-28: a "Finances" (deposit-prompt)
   * modal can auto-open after login and intercepts clicks on anything
   * underneath it until dismissed, the same category of issue as
   * gcplaying0175.com's promo-popup iframe.
   */
  async dismissModalIfPresent(): Promise<void> {
    const overlay = this.page.locator('[data-modal-overlay="true"]').first();
    if (!(await overlay.isVisible({ timeout: 2_000 }).catch(() => false))) return;

    await step('Dismiss the modal popup, if shown', async () => {
      // Its own `[data-modal-close-button]` — confirmed live 2026-08-28.
      // NOT a DOM-removal fallback like gcplaying0175.com's promo popup:
      // that promo popup is a third-party iframe injected outside
      // React's own tree, safe to rip out; this modal is a native React
      // component, and forcibly removing its DOM node broke React's
      // reconciliation and crashed the app to an error boundary
      // ("Something went wrong") on the very next render — confirmed
      // live the hard way. Always close it the way the app itself does.
      await overlay.locator('[data-modal-close-button]').click();
      await expect(overlay).toBeHidden({ timeout: 5_000 });
    });
  }

  /**
   * Launches a game by its `/game/real/{id}` href and confirms it reaches
   * a playable state (the third-party provider's iframe becomes visible).
   * Same constraint as `AccountPage.expectGameReachedPlayableState()` on
   * gcplaying0175.com: actual gameplay renders on an opaque `<canvas>`
   * inside a cross-origin iframe with no accessible DOM, so this can
   * confirm the game loaded but can't drive its bet/spin controls
   * generically — that needs the same one-time manual coordinate
   * investigation per game gcplaying's `spinKnownGame()` needed.
   */
  async launchGame(href: string): Promise<void> {
    await step(`Launch game: ${href}`, async () => {
      await this.dismissModalIfPresent();
      const gameLink = this.page.locator(`a[href="${href}"]`).first();
      try {
        await gameLink.click({ timeout: 5_000 });
      } catch {
        // Confirmed live 2026-08-28: the "Finances" modal can appear a
        // beat AFTER the first dismiss check above (not just right after
        // login), reopening in the gap before this click and intercepting
        // it. One retry, dismissing again first, resolves it.
        await this.dismissModalIfPresent();
        await gameLink.click();
      }
      await this.page.waitForTimeout(6_000);
    });
  }

  async expectGameReachedPlayableState(): Promise<void> {
    await step('Verify the game reached a playable state', async () => {
      await expect(this.page.locator('iframe').first()).toBeVisible({ timeout: 15_000 });
    });
  }

  /**
   * NOT YET IMPLEMENTED — placeholder, returns `false` always. Actually
   * placing a real minimum-bet spin needs the same one-time manual
   * coordinate investigation gcplaying0175.com's `spinKnownGame()`
   * needed for its own pre-confirmed game (bet/spin controls render on
   * an opaque `<canvas>` inside a cross-origin iframe with no accessible
   * DOM — coordinate-based is the only option, and blind/unconfirmed
   * coordinates on a real-money-adjacent control aren't safe to guess).
   * beta.wildies.com became unreachable (Cloudflare Access) partway
   * through building this suite, 2026-08-28, before this could be
   * confirmed live. Callers must treat a `false` return as "no fresh
   * spin was placed this run" and adjust what they check/report
   * accordingly, not assume a spin happened.
   */
  async spinMinimumBet(): Promise<boolean> {
    return false;
  }

  /**
   * Opens each promotion's own details modal on the current
   * `/promotions` page, one at a time, scanning EACH modal's text for
   * untranslated content before closing it and moving to the next
   * (rather than scanning once at the very end, by which point every
   * modal is closed again and its content is gone) — confirmed live
   * 2026-08-28: every promo card has exactly one real `<button>` inside
   * its `[data-button-group="promotion-action"]` wrapper (the OTHER
   * action — "Deposit now"/"Play Now"/"Bet Now" — is a `<span
   * role="button">`, not a real button, so this selector reliably
   * matches only the "More info" trigger regardless of locale, unlike
   * text-based matching). Clicking it opens `[data-modal-overlay="true"]
   * data-modal="Promotion"` with that promotion's own details/T&C,
   * closed the same way as `dismissModalIfPresent()`.
   */
  async verifyAllPromotionTerms(): Promise<{ opened: number; flagged: string[] }> {
    return step("Open and scan each promotion's own details (Terms & Conditions)", async () => {
      const buttons = this.page.locator('[data-button-group="promotion-action"] button');
      // `.count()` reads the DOM as it is right now, with no built-in
      // wait (unlike `.click()`/`.waitFor()`) — confirmed live
      // 2026-08-28 that promo cards render a beat after
      // `domcontentloaded`, the same SPA-hydration-timing class of issue
      // already hit elsewhere in this page object, so an un-waited
      // count read 0 even though the cards appeared moments later.
      await buttons.first().waitFor({ timeout: 8_000 }).catch(() => {});
      const count = await buttons.count();
      let opened = 0;
      const flagged: string[] = [];
      for (let i = 0; i < count; i++) {
        try {
          await buttons.nth(i).click({ timeout: 3_000 });
          const overlay = this.page.locator('[data-modal-overlay="true"]');
          await expect(overlay).toBeVisible({ timeout: 3_000 });
          opened++;
          for (const f of await this.scanForUntranslatedText()) {
            if (!flagged.includes(f)) flagged.push(f);
          }
          await this.dismissModalIfPresent();
        } catch {
          // Not every button in this group is guaranteed to open a
          // modal reliably (e.g. mid-scroll layout shift) — skip this
          // one and keep going rather than failing the whole check.
        }
      }
      return { opened, flagged };
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
   * Scans every visible text node on the current page for patterns that
   * indicate a missing translation reached the UI raw — the exact shape
   * of the confirmed real bug on gcplaying0175.com (a toast literally
   * reading "nothing.to.update"): a dot.separated.key, SCREAMING_SNAKE_CASE,
   * a leftover `{{ placeholder }}`, or a stringified JS value ("undefined"/
   * "null"/"[object Object]") leaking into the page. Deliberately
   * conservative (deduped, visibility-checked, domain-like strings such as
   * footer copyright text or displayed URLs excluded) — this is a
   * candidate list for a human to confirm, the same "needs triage"
   * treatment as every other finding in this repo, not a hard "these are
   * definitely bugs" assertion. False negatives (a real but
   * dictionary-word-shaped key) are expected and fine; the goal is
   * catching the obvious raw-key case, not perfect translation QA.
   */
  async scanForUntranslatedText(): Promise<string[]> {
    return this.page.evaluate(() => {
      const KEY_PATTERNS: RegExp[] = [
        /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,}$/i, // dot.separated.key
        /^[A-Z][A-Z0-9]*(_[A-Z0-9]+){2,}$/, // SCREAMING_SNAKE_CASE, 3+ segments
        /\{\{\s*[\w.]+\s*\}\}/, // leftover {{ placeholder }}
        /^\[object Object\]$/,
        /^(undefined|null|NaN)$/,
      ];
      const DOMAIN_LIKE = /\.(com|io|net|org|co|app|gg)\b/i;

      const seen = new Set<string>();
      const flagged: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const text = node.textContent?.trim();
          if (!text) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent!.trim();
        if (seen.has(text) || DOMAIN_LIKE.test(text)) continue;
        if (KEY_PATTERNS.some((re) => re.test(text))) {
          seen.add(text);
          flagged.push(text);
        }
      }
      return flagged;
    });
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

  /**
   * Recurring, already-triaged noise seen on nearly every page during the
   * first full 110-test run (2026-08-28): a sandboxed third-party game
   * iframe blocking its own script (harmless — the sandbox is doing its
   * job), and the Smartico gamification widget logging before it's
   * identified the visitor. Filtered out before deciding severity, same
   * spirit as gcplaying0175.com's INSUFFICIENT_PATH special-case — a
   * page whose ONLY errors are this noise gets a "known, no action
   * needed" writeup instead of "needs triage" repeated on ~100 tests,
   * which would bury any genuinely new error in the same haystack.
   */
  private static readonly KNOWN_NOISE_PATTERNS: RegExp[] = [
    /sandboxed.*allow-scripts/i,
    /Smartico: suspendPopups called in visitor mode/,
  ];

  private consoleErrorAnalysis(errors: string[]): { severity: string; rootCause: string; whatToCheck: string } {
    const genuine = errors.filter((e) => !WildiesPage.KNOWN_NOISE_PATTERNS.some((p) => p.test(e)));

    if (genuine.length === 0) {
      return {
        severity: 'Low (known issue)',
        rootCause:
          'Only already-triaged noise was logged: a sandboxed third-party game iframe blocking its own script ' +
          "(the sandbox working as intended) and/or the Smartico gamification widget logging before it's " +
          'identified the visitor. Confirmed live 2026-08-28 — fires on nearly every page, no functional ' +
          'breakage observed in any session so far.',
        whatToCheck:
          'No action needed unless this starts correlating with real user-facing breakage. Tracked as known ' +
          "noise — don't re-investigate from scratch each time it shows up.",
      };
    }
    return {
      severity: 'Needs triage',
      rootCause:
        "The browser logged a genuine JavaScript error during this page's lifecycle, beyond the already-known " +
        `noise (filtered out below). Could be a real functional bug, third-party script noise, or something ` +
        `not yet catalogued.<br><br><strong>Console errors:</strong><br>${formatConsoleErrors(genuine)}`,
      whatToCheck:
        "Open browser DevTools console on this exact locale/page, reproduce, and check the stack trace's " +
        'originating file/line.',
    };
  }

  /**
   * The single check `tests/wildies-translation-coverage.spec.ts` exists
   * for. Scans every visible piece of text on the page for a raw,
   * untranslated i18n key, then writes a full, human-readable ENGLISH
   * description of what was actually examined — always, whether
   * anything was found or not — directly into the test's Description
   * (visible on the Overview tab, no drilling into steps).
   *
   * Two outcomes only, by explicit request (2026-08-28) — no orange/
   * Broken status anywhere in this suite, since a generic technical
   * finding (a console error, say) isn't what this suite is checking
   * for:
   *  - Nothing found → writes a plain "✅ ...was opened, here's exactly
   *    what was scanned, nothing untranslated found" description via
   *    `descriptionHtml()` directly. Safe to call directly here (not
   *    through the shared issue tracker): on a passing test, the
   *    `testWithIssueAnalysis` auto-fixture finds no recorded issues and
   *    writes nothing itself, so this call is the final, untouched
   *    description.
   *  - Something found → FAILS the test (an untranslated key is exactly
   *    what should turn this check red, not a secondary note on a
   *    green test) via `recordIssue(..., { explainsFailure: true })`,
   *    which the auto-fixture renders as the test's Description once
   *    the test ends — the "what was checked" narrative is folded into
   *    the finding's root cause so the reader sees it before the actual
   *    bug, same ordering as the success case.
   *
   * `extraFlagged` merges in findings collected elsewhere (e.g.
   * `verifyAllPromotionTerms()`'s per-modal scans) — needed because a
   * modal/popup opened and closed before this call runs is gone from
   * the page by the time this method does its own scan, so its content
   * has to be scanned while it's still open and passed in here.
   */
  async verifyTranslation(pageLabel: string, sectionsChecked: string[], extraFlagged: string[] = []): Promise<void> {
    await step(`Verify translation completeness: ${pageLabel}`, async () => {
      const pageFlagged = await this.scanForUntranslatedText();
      const flagged = [...pageFlagged, ...extraFlagged.filter((f) => !pageFlagged.includes(f))];
      const sectionsText = sectionsChecked.length ? ` Sections examined: ${sectionsChecked.join(', ')}.` : '';
      const whatWasChecked =
        `<strong>${pageLabel}</strong> was opened and every visible piece of text on the page — headings, ` +
        'buttons, menu items, form labels, footer links, and any popups/panels opened as part of this check — ' +
        'was scanned for raw, untranslated i18n keys (patterns such as a dot.separated.key, ' +
        'SCREAMING_SNAKE_CASE, a leftover {{ placeholder }}, or a stringified JS value like "undefined" ' +
        `leaking into the UI).${sectionsText}`;

      if (flagged.length === 0) {
        await descriptionHtml(
          `<div style="font-family: sans-serif; font-size: 13px; line-height: 1.6;">` +
            `<p>✅ ${whatWasChecked}</p>` +
            `<p><strong>Result:</strong> fully translated — no untranslated text was found.</p></div>`
        );
        return;
      }

      await this.flagIssue(pageLabel, {
        severity: 'High (content/localization bug)',
        rootCause:
          `${whatWasChecked} <strong>${flagged.length} piece(s) of text render as a raw, untranslated key ` +
          `instead of real content:</strong> ${flagged.map((f) => `"${f}"`).join(', ')}.`,
        whatToCheck:
          'Open this exact page/locale in a real browser and confirm the literal string(s) above render as ' +
          'visible text instead of real, translated content. Usually a missing translation entry for this ' +
          "locale, or a key that's never been localized.",
        explainsFailure: true,
      });
      expect(flagged, `Untranslated text found on ${pageLabel}: ${flagged.join(', ')}`).toEqual([]);
    });
  }

  /**
   * Plain visual-evidence screenshot — no broken-image/overflow/console-
   * error checking, unlike `attachScreenshot()`. This suite is UI/i18n
   * content only (2026-08-28): a generic technical finding (a console
   * error, a third-party script warning) isn't what it exists to catch,
   * and flagging one would just bury the one thing that actually
   * matters here — `verifyTranslation()`'s result — in unrelated noise.
   */
  async captureScreenshot(name: string): Promise<void> {
    await step(`Screenshot: ${name}`, async () => {
      await this.page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
      const buffer = await this.page.screenshot({ fullPage: true, timeout: 30_000 });
      await attachment(name, buffer, ContentType.PNG);
    });
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
