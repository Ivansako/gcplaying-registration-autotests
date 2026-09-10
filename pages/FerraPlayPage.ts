import { expect, Locator, Page } from '@playwright/test';
import { attachment, descriptionHtml, step } from 'allure-js-commons';
import { ContentType } from 'allure-js-commons';
import { recordIssue } from '../utils/issueTracker';

/**
 * Page object for ferraplay.com's locale switcher and i18n coverage —
 * a direct port of `WildiesPage.ts`'s equivalent methods, confirmed
 * live 2026-09-10 that ferraplay.com runs the exact same underlying
 * "Wiz" platform as beta.wildies.com (identical `data-icon-button-type`/
 * `data-sidemenu`/`data-modal` markup, hashed `dyn-xx` CSS class names,
 * identical login modal and generic error-boundary shape) — every
 * selector below was independently re-verified live on THIS site rather
 * than assumed to carry over, but they turned out to match exactly.
 *
 * Scope: anonymous pages, locale switching, footer, 404/error boundary,
 * Login/Sign Up/Forgot Password popups, Promotions, and (since
 * 2026-09-10, once real test accounts were provided) the authenticated
 * side — account menu, Cashier UI, authenticated pages, Game History,
 * and one real minimum-bet slot spin. FerraPlay's own "Loyalty"/
 * "Missions" features (distinct nav items, not the Smartico "Match X"
 * widget Wildies has) haven't been investigated at all yet — not
 * assumed to work the same way. The sportsbook (`/sport`) does NOT
 * render any widget in this environment even when logged in (confirmed
 * live 2026-09-10 — the content area stays blank, no `iframe` beyond
 * the license/live-chat ones) — no real sportsbook bet is placed, and
 * there's no "Sportsbook My Bets" check, unlike Wildies.
 *
 * Confirmed live 2026-09-10:
 *  - URL is a path prefix per locale (`/it`, `/el`, ...); English is the
 *    exception, served at bare "/" — visiting "/en" explicitly redirects
 *    back to "/".
 *  - A fresh visit to bare "/" resolves by geo-IP (this environment's
 *    network landed on French) rather than always English — same
 *    quirk already documented for Wildies; only an explicit non-English
 *    prefix is reliable from automation.
 *  - The switcher lives inside the left sidebar
 *    (`aside[data-sidemenu="container"]`), opened via the header's icon
 *    button (`header [data-icon-button-type="first-icon"]`), toggling
 *    `body` between `sidebar-open`/`sidebar-close` classes.
 */
export class FerraPlayPage {
  readonly page: Page;

  readonly sideMenuToggle: Locator;
  readonly langSwitcherTrigger: Locator;
  readonly langSwitcherPanel: Locator;

  private pendingModalFindings: string[] = [];

  constructor(page: Page) {
    this.page = page;

    // Scoped to <header> and `.first()` — same generic template
    // attribute reuse Wildies documented (search icon, pagination
    // arrows also use `data-icon-button-type`).
    this.sideMenuToggle = page.locator('header [data-icon-button-type="first-icon"]').first();
    this.langSwitcherTrigger = page.locator('[data-sidemenu="lang-switcher-trigger"]');
    this.langSwitcherPanel = page.locator('[data-sidemenu="lang-switcher"]');
  }

  async open(localeSegment = ''): Promise<void> {
    await step(`Open ferraplay.com${localeSegment ? '/' + localeSegment : ''}`, async () => {
      await this.page.goto(`/${localeSegment}`);
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  /**
   * Visits an arbitrary path under a given locale's URL prefix. `path`
   * is joined directly, so pass it with a leading slash (`/casino`, not
   * `casino`); `localeSegment` is empty for English.
   */
  async visitPage(path: string, localeSegment = ''): Promise<void> {
    const url = localeSegment ? `/${localeSegment}${path}` : path;
    await step(`Open ${url}`, async () => {
      await this.page.goto(url);
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  async visitNonExistentPage(localeSegment = ''): Promise<void> {
    await step('Open a non-existent page (checks the error boundary)', async () => {
      const url = localeSegment ? `/${localeSegment}/this-page-does-not-exist-xyz` : '/this-page-does-not-exist-xyz';
      await this.page.goto(url);
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(1_500);
    });
  }

  takePendingModalFindings(): string[] {
    const findings = this.pendingModalFindings;
    this.pendingModalFindings = [];
    return findings;
  }

  /**
   * Closes a blocking popup if one is auto-shown — same `[data-modal-
   * overlay="true"]` / `[data-modal-close-button]` mechanism as Wildies.
   * Scans the popup's own text for untranslated keys BEFORE closing it
   * (real, locale-specific content a player would actually see),
   * draining via `takePendingModalFindings()`.
   */
  async dismissModalIfPresent(): Promise<void> {
    const overlay = this.page.locator('[data-modal-overlay="true"]').first();
    if (!(await overlay.isVisible({ timeout: 2_000 }).catch(() => false))) return;

    await step('Dismiss the modal popup, if shown', async () => {
      for (const f of await this.scanForUntranslatedText()) {
        if (!this.pendingModalFindings.includes(f)) this.pendingModalFindings.push(f);
      }
      await overlay
        .locator('[data-modal-close-button]')
        .click()
        .then(() => expect(overlay).toBeHidden({ timeout: 5_000 }))
        .catch(() => {});
    });
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
      try {
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
   * Switches to `displayName` (the option's own native-language label)
   * via the sidebar dropdown, then returns the resulting `<html lang>`.
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
   * Reads every option currently offered in the dropdown — discovery-
   * driven rather than hardcoded, so a change in what the site actually
   * offers shows up here instead of silently going unnoticed.
   */
  async getAvailableLocaleLabels(): Promise<string[]> {
    await this.openSideMenu();
    await this.langSwitcherTrigger.click();
    const links = this.langSwitcherPanel.getByRole('link');
    await expect(links.first()).toBeVisible();
    const labels = await links.allTextContents();
    await this.closeSideMenu();
    return labels;
  }

  /**
   * Logs in via the header's login button + modal. Confirmed live
   * 2026-09-10 with a real account — the "Finances" cashier modal
   * auto-opens right after login (same as Wildies), dismissed by the
   * caller via `dismissModalIfPresent()`.
   */
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

  async getBalanceText(): Promise<string> {
    return (await this.page.locator('header').getByText(/[€$]\s?[\d,.]+/).first().textContent())?.trim() ?? '';
  }

  /**
   * Opens the account avatar dropdown. The avatar is always the LAST
   * `header button[data-icon-button-type="wrapper"]`, not a fixed index
   * — confirmed live 2026-09-10 there are 3 on mobile (burger, search,
   * avatar) but only 2 on Desktop (burger, avatar; the search icon
   * collapses into an inline search bar at that width instead), so a
   * hardcoded `.nth(2)` matched on mobile and timed out on Desktop.
   *
   * The "opened" signal is deliberately NOT `data-modal=
   * "userHeaderProfile"` (that's what Wildies uses, and what this
   * dropdown renders as on FerraPlay's own MOBILE viewport) — confirmed
   * live 2026-09-10 that on Desktop the exact same menu items
   * (Profile Info, Notifications, Verification, ...) render in a plain
   * `<div><ul><li><a>` dropdown with NO `data-modal`/`data-modal-
   * overlay` attribute anywhere, a materially different component from
   * the mobile full-screen sheet. The one link both versions share is
   * `a[href="/account/info"]` ("Profile Info"), so that's the real
   * viewport-agnostic success signal.
   */
  async openAccountMenu(): Promise<void> {
    await step('Open the account avatar dropdown', async () => {
      const profileInfoLink = this.page.locator('a[href="/account/info"]').first();
      if (await profileInfoLink.isVisible().catch(() => false)) return;
      const avatarButton = this.page.locator('header button[data-icon-button-type="wrapper"]').last();
      let opened = false;
      for (let attempt = 0; attempt < 5 && !opened; attempt++) {
        await this.dismissModalIfPresent();
        try {
          await avatarButton.click({ timeout: 5_000 });
          await expect(profileInfoLink).toBeVisible({ timeout: 4_000 });
          opened = true;
        } catch {
          // Loop again — a fresh dismiss + click attempt.
        }
      }
      if (!opened) {
        // Final attempt, letting its own error surface if this is a real
        // failure rather than another round of the same race.
        await this.dismissModalIfPresent();
        await avatarButton.click();
        await expect(profileInfoLink).toBeVisible({ timeout: 8_000 });
      }
    });
  }

  /**
   * Opens the "Cassa"/Cashier modal (`data-modal="Finances"`) via the
   * header's balance/Deposit trigger — confirmed live 2026-09-10 this
   * is `header button[data-button-type="wrapper"]` (note: `data-button-
   * type`, NOT `data-icon-button-type` — a plain text+icon button, not
   * one of the icon-only ones), same auto-open-after-login race as
   * Wildies' equivalent.
   */
  async openCashier(): Promise<void> {
    await step('Open the Cashier (Deposit/Withdraw) modal', async () => {
      const financesModal = this.page.locator('[data-modal-overlay="true"][data-modal="Finances"]');
      if (await financesModal.isVisible({ timeout: 1_500 }).catch(() => false)) return;
      await this.dismissModalIfPresent();
      const depositButton = this.page.locator('header button[data-button-type="wrapper"]').first();
      try {
        await depositButton.click({ timeout: 8_000 });
      } catch {
        await this.dismissModalIfPresent();
        await depositButton.click();
      }
      await expect(financesModal).toBeVisible({ timeout: 8_000 });
    });
  }

  /**
   * Switches the open Cashier modal between its two tabs — same
   * index-based pattern as Wildies (labels are translated, order is
   * fixed: 0 = Deposit, 1 = Withdraw).
   */
  async switchCashierTab(tab: 'deposit' | 'withdraw'): Promise<void> {
    await step(`Switch Cashier to: ${tab}`, async () => {
      const idx = tab === 'deposit' ? 0 : 1;
      await this.page
        .locator('[data-modal-overlay="true"][data-modal="Finances"] [data-modal-body="true"] button')
        .nth(idx)
        .click();
      await this.page.waitForTimeout(500);
    });
  }

  /**
   * Launches a game by its `/game/real/{id}` href and confirms it
   * reaches a playable state. Retries once on a failed click — confirmed
   * live 2026-09-10 the auto-opening "Finances" modal can intercept
   * this exact click right after login, same race Wildies documents for
   * its own `launchGame()`.
   */
  async launchGame(href: string): Promise<void> {
    await step(`Launch game: ${href}`, async () => {
      await this.dismissModalIfPresent();
      const gameLink = this.page.locator(`a[href="${href}"]`).first();
      try {
        await gameLink.click({ timeout: 5_000 });
      } catch {
        await this.dismissModalIfPresent();
        await gameLink.click();
      }
      await this.page.waitForTimeout(8_000);
    });
  }

  async expectGameReachedPlayableState(): Promise<void> {
    await step('Verify the game reached a playable state', async () => {
      await expect(this.page.locator('iframe').first()).toBeVisible({ timeout: 15_000 });
    });
  }

  /**
   * Places ONE real, minimum-bet spin on a specific, pre-confirmed game
   * ("Book of Ra" by Novomatic/Greentube — the real title starts "BOOK
   * OF R..." and is cut off by the game's own logo art, confirmed via
   * its `/game/real/23929` href being the first Top Games card,
   * 2026-09-10) and reports the balance before/after. Same
   * canvas-with-no-accessible-DOM constraint as Wildies'
   * `spinFirstAvailableGame()`: coordinate-based, confirmed live ONLY at
   * a 1280x800 viewport.
   *
   * Deliberately called ONCE per suite run (seeds one real Game History
   * row that every locale/viewport combination's Game History check
   * then just navigates to and reads — re-spinning per locale would
   * multiply real-money spend for no extra signal).
   *
   * Flow confirmed live 2026-09-10: launch → game loads straight to the
   * reels, NO intro/splash click needed (unlike Wildies' game) → default
   * bet €0.99 reduced to this game's €0.18 minimum by clicking "-" ~30
   * times (no side-panel opens as a side effect, also unlike Wildies) →
   * one spin click → balance dropped €100.00 → €99.82, confirming a real
   * spin. The new Game History row only appeared after a page reload —
   * a real backend/indexing delay, not a UI bug — so
   * `verifyTranslation()`'s own Game History check must reload once
   * before reading the table.
   */
  async spinFirstAvailableGame(): Promise<{ balanceBefore: string; balanceAfter: string }> {
    return step('Launch the first available slot and place one real minimum-bet spin', async () => {
      await this.dismissModalIfPresent();
      const balanceBefore = await this.getBalanceText();

      const gameLink = this.page.locator('a[href="/game/real/23929"]').first();
      try {
        await gameLink.click({ timeout: 8_000 });
      } catch {
        await this.dismissModalIfPresent();
        await gameLink.click();
      }
      await this.page.waitForTimeout(10_000); // provider loading screen

      await this.dismissModalIfPresent();

      // Reduce the bet to this game's minimum via the "-" control.
      for (let i = 0; i < 30; i++) {
        await this.page.mouse.click(592, 735);
        await this.page.waitForTimeout(150); // human-speed, not a rapid-fire click storm
      }
      await this.page.waitForTimeout(500);

      await this.page.mouse.click(1055, 735); // spin
      await this.page.waitForTimeout(6_000); // let the reels finish and the balance settle

      await this.page.goto('/');
      await this.page.waitForLoadState('domcontentloaded');
      await this.dismissModalIfPresent();
      const balanceAfter = await this.getBalanceText();
      return { balanceBefore, balanceAfter };
    });
  }

  /**
   * Opens the Login/Sign Up modal, optionally switching to the Sign Up
   * tab. Confirmed live 2026-09-10: identical markup to Wildies
   * (`button[data-header-button]`, `[data-modal-overlay="true"]`,
   * register tab's first button inside `[data-modal-body="true"]`).
   */
  async openAuthModal(tab: 'login' | 'register' = 'login'): Promise<void> {
    await step(`Open the ${tab === 'register' ? 'Sign Up' : 'Login'} modal`, async () => {
      const headerButtons = this.page.locator('button[data-header-button]');
      const overlay = this.page.locator('[data-modal-overlay="true"]');
      await headerButtons.first().click();
      try {
        await overlay.waitFor({ timeout: 4_000 });
      } catch {
        await headerButtons.first().click();
        await overlay.waitFor({ timeout: 10_000 });
      }
      if (tab === 'register') {
        await overlay.locator('[data-modal-body="true"] button').first().click();
        await expect(this.page.locator('input[name="email"]')).toBeVisible({ timeout: 5_000 });
      }
    });
  }

  /**
   * Opens the Login modal's Forgot Password form — same
   * `form[type="Login"] button[type="button"]` locator as Wildies (the
   * visibility toggle is a `div`, not a `button`, so this stays
   * unambiguous — confirmed live by inspecting the actual DOM). Retries
   * the click once on a timeout: confirmed live 2026-09-10 the very
   * first click right after the modal opens can land before the SPA has
   * hydrated this particular button's handler — same hydration-race
   * class already documented/retried elsewhere in this codebase (e.g.
   * `WildiesPage.submitLoginForm()`), just not previously hit on THIS
   * specific transition.
   */
  async openForgotPasswordForm(): Promise<void> {
    await step('Open the Forgot Password form', async () => {
      await this.openAuthModal('login');
      const forgotButton = this.page.locator('[data-modal-overlay="true"] form[type="Login"] button[type="button"]').first();
      const emailField = this.page.locator('[data-modal-overlay="true"] #email');
      await forgotButton.click();
      try {
        await expect(emailField).toBeVisible({ timeout: 5_000 });
      } catch {
        await forgotButton.click();
        await expect(emailField).toBeVisible({ timeout: 10_000 });
      }
    });
  }

  async submitForgotPassword(email: string): Promise<void> {
    await step(`Submit Forgot Password for ${email}`, async () => {
      await this.page.locator('[data-modal-overlay="true"] #email').fill(email);
      await this.page.locator('[data-modal-overlay="true"] form[type="ForgotPassword"] button[type="submit"]').click();
      await this.page.waitForTimeout(2_500);
    });
  }

  /**
   * Submits the login form with credentials expected to fail and
   * confirms it didn't succeed (no balance ever appears in the header).
   */
  async expectLoginFailure(email: string, password: string): Promise<void> {
    await step(`Attempt login with invalid credentials: ${email}`, async () => {
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
      await expect(this.page.locator('header').getByText(/[€$]\s?[\d,.]+/)).not.toBeVisible({ timeout: 8_000 });
    });
  }

  /**
   * Fills Sign Up with an EXISTING account's email (real server-side
   * "already registered" validation) and submits if the button actually
   * enables — confirmed live 2026-09-10 the same field ids as Wildies
   * (`#email`, `#passwordHints`) exist on this form. Never actually
   * creates an account either way (the email is already taken).
   */
  async attemptDuplicateEmailRegistration(email: string): Promise<{ attempted: boolean }> {
    return step(`Attempt Sign Up with an already-registered email: ${email}`, async () => {
      await this.openAuthModal('register');
      const overlay = this.page.locator('[data-modal-overlay="true"]');
      await overlay.locator('#email').pressSequentially(email, { delay: 15 });
      await overlay.locator('#passwordHints').pressSequentially('NotARealPass9', { delay: 15 });
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(1_500);
      const submitBtn = overlay.locator('button[type="submit"]');
      if (await submitBtn.isDisabled()) return { attempted: false };
      await submitBtn.click();
      await this.page.waitForTimeout(2_500);
      return { attempted: true };
    });
  }

  /**
   * Pure, self-contained scanner for raw/untranslated i18n keys leaking
   * into visible text — identical patterns to
   * `WildiesPage.untranslatedTextScanner` (dot.separated.key,
   * SCREAMING_SNAKE_CASE with 4+ segments, leftover `{{ placeholder }}`,
   * stringified JS values).
   */
  private static readonly untranslatedTextScanner = () => {
    const KEY_PATTERNS: RegExp[] = [
      /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,}$/i,
      /^[A-Z][A-Z0-9]*(_[A-Z0-9]+){3,}$/,
      /\{\{\s*[\w.]+\s*\}\}/,
      /^\[object Object\]$/,
      /^(undefined|null|NaN)$/,
    ];
    const DOMAIN_LIKE = /\.(com|io|net|org|co|app|gg|ai)\b/i;

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
  };

  async scanForUntranslatedText(): Promise<string[]> {
    return this.page.evaluate(FerraPlayPage.untranslatedTextScanner);
  }

  async scanForEnglishFallback(englishPhrases: string[], scope: Locator = this.page.locator('body')): Promise<string[]> {
    const bodyText = await scope.innerText();
    return englishPhrases
      .filter((phrase) => bodyText.includes(phrase))
      .map((phrase) => `Still shows the English "${phrase}" — this page appears to have fallen back to English instead of translating`);
  }

  /**
   * Global, page-agnostic English phrases for the footer's English-
   * fallback check — confirmed live 2026-09-10 by diffing the English
   * footer against Italiano's (the only non-English, non-excluded
   * locale checked so far): "Casino"/"Promotions"/"Sports"/"FAQ" all
   * stayed the same or close enough in Italian to be unsafe (loanwords,
   * same reasoning Wildies already documented for its own dropped
   * candidates) — only these 5 visibly changed. NOT yet cross-checked
   * against Português/Ελληνικά/Español/Polski/Magyar — do that before
   * trusting this list as exhaustive, same discipline as Wildies'
   * `GLOBAL_ENGLISH_UI_PHRASES`.
   */
  private static readonly GLOBAL_ENGLISH_UI_PHRASES = [
    'Contact Us',
    'Terms and Conditions',
    'Privacy Policy',
    'AML-KYC Policy',
    'Responsible Gambling',
  ];

  async verifyFooterTranslation(localeLabel: string, localeCode: string): Promise<void> {
    await step(`Verify footer translation: ${localeLabel}`, async () => {
      const flagged =
        localeCode === 'en' ? [] : await this.scanForEnglishFallback(FerraPlayPage.GLOBAL_ENGLISH_UI_PHRASES, this.page.locator('footer'));

      if (flagged.length === 0) {
        await descriptionHtml(
          `<div style="font-family: sans-serif; font-size: 13px; line-height: 1.6;">` +
            `<p><strong>What was checked:</strong> The footer under "${localeLabel}" was scanned against a ` +
            'known-English phrase baseline ("Contact Us", "Privacy Policy", "Terms and Conditions", ...) to ' +
            'catch a link silently staying in English instead of translating.</p>' +
            `<p><strong>Result:</strong> ✅ Fully translated — no English fallback found.</p></div>`
        );
        return;
      }

      recordIssue({
        where: 'Footer',
        severity: 'High (content/localization bug)',
        rootCause: `❌ ${flagged.length} footer link(s) still show English under "${localeLabel}": ${flagged.join(', ')}.`,
        whatToCheck:
          `Open the footer under "${localeLabel}" in a real browser and confirm the link(s) above render in ` +
          'English instead of a real translation. Usually a missing translation entry for this locale.',
        explainsFailure: true,
      });
      expect(flagged, `Footer shows English fallback under ${localeLabel}: ${flagged.join(', ')}`).toEqual([]);
    });
  }

  async verifyTranslation(pageLabel: string, sectionsChecked: string[], extraFlagged: string[] = []): Promise<void> {
    await step(`Verify translation completeness: ${pageLabel}`, async () => {
      const pageFlagged = await this.scanForUntranslatedText();
      const flagged = [...pageFlagged, ...extraFlagged.filter((f) => !pageFlagged.includes(f))];

      const overflowPx = await this.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflowPx > 20) {
        flagged.push(
          `Layout overflow: the page renders ${overflowPx}px wider than the viewport — likely a translated ` +
            `string that doesn't fit its container at this screen size`
        );
      }

      const sectionsText = sectionsChecked.length ? ` Sections examined: ${sectionsChecked.join(', ')}.` : '';
      const whatWasChecked =
        `<strong>${pageLabel}</strong> was opened and every visible piece of text on the page — headings, ` +
        'buttons, menu items, form labels, footer links, and any popups/panels opened as part of this check — ' +
        'was scanned for raw, untranslated i18n keys (patterns such as a dot.separated.key, ' +
        'SCREAMING_SNAKE_CASE, a leftover {{ placeholder }}, or a stringified JS value like "undefined" ' +
        `leaking into the UI), and the page's rendered width was checked against the viewport to catch a ` +
        `translated string long enough to break the layout.${sectionsText}`;

      if (flagged.length === 0) {
        await descriptionHtml(
          `<div style="font-family: sans-serif; font-size: 13px; line-height: 1.6;">` +
            `<p><strong>What was checked:</strong> ${whatWasChecked}</p>` +
            `<p><strong>Result:</strong> ✅ Fully translated — no untranslated text or layout overflow was found.</p>` +
            `<p><strong>Should be retested manually:</strong> Not needed — the automated scan already covers ` +
            `every visible string on this exact page/locale/viewport combination.</p></div>`
        );
        return;
      }

      recordIssue({
        where: pageLabel,
        severity: 'High (content/localization bug)',
        whatChecked: whatWasChecked,
        rootCause:
          `❌ ${flagged.length} piece(s) of text render as a raw, untranslated key instead of real content: ` +
          `${flagged.map((f) => `"${f}"`).join(', ')}.`,
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
   * Plain visual-evidence screenshot — same `#bottom-navigation` hide-
   * on-mobile fix as `WildiesPage.captureScreenshot()` (confirmed live
   * 2026-09-10 the same element exists here, same fixed-position
   * scroll-and-stitch artifact risk).
   */
  async captureScreenshot(name: string, opts: { fullPage?: boolean; dismissModalFirst?: boolean } = {}): Promise<void> {
    const fullPage = opts.fullPage ?? true;
    if (opts.dismissModalFirst) {
      await this.dismissModalIfPresent();
    }
    await step(`Screenshot: ${name}`, async () => {
      await this.page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
      const HIDE_STYLE_ID = 'ferraplay-test-hide-bottom-nav';
      if (fullPage) {
        await this.page
          .evaluate((id) => {
            const style = document.createElement('style');
            style.id = id;
            style.textContent = '#bottom-navigation { display: none !important; }';
            document.head.appendChild(style);
          }, HIDE_STYLE_ID)
          .catch(() => {});
      }
      const buffer = await this.page.screenshot({ fullPage, timeout: 30_000 });
      if (fullPage) {
        await this.page
          .evaluate((id) => {
            document.getElementById(id)?.remove();
          }, HIDE_STYLE_ID)
          .catch(() => {});
      }
      await attachment(name, buffer, ContentType.PNG);
    });
  }

  /**
   * Discovery-driven: opens every promotion's own "More info" panel (if
   * any), scans each for untranslated text, and closes it again. Mirrors
   * `WildiesPage.verifyAllPromotionTerms()` — confirmed live 2026-09-10
   * (84/84 across all locales/viewports) that "More info" here opens a
   * `[data-modal-overlay="true"]` panel, same as Wildies.
   */
  async verifyAllPromotionTerms(): Promise<{ found: number; opened: number; flagged: string[] }> {
    return step('Open every promotion\'s own Terms & Conditions', async () => {
      const buttons = this.page.getByRole('button', { name: /more info/i });
      const found = await buttons.count();
      let opened = 0;
      const flagged: string[] = [];

      for (let i = 0; i < found; i++) {
        try {
          await buttons.nth(i).click();
          await this.page.waitForTimeout(500);
          const overlay = this.page.locator('[data-modal-overlay="true"]').first();
          await overlay.waitFor({ timeout: 5_000 });
          opened++;
          flagged.push(...(await this.scanForUntranslatedText()));
          await overlay
            .locator('[data-modal-close-button]')
            .click()
            .then(() => expect(overlay).toBeHidden({ timeout: 5_000 }))
            .catch(() => {});
        } catch {
          // Counted in `found` but not `opened` — surfaced by the call
          // site as its own finding rather than silently skipped.
        }
      }

      return { found, opened, flagged: [...new Set(flagged)] };
    });
  }

  /**
   * Discovery-driven: opens every tournament's own detail page (if any)
   * and scans each for untranslated text. Structurally DIFFERENT from
   * `verifyAllPromotionTerms()` — confirmed live 2026-09-10 a
   * tournament's "More info" is a real client-side navigation to
   * `/tournaments/{id}` (a distinct URL, back-navigable), not a modal
   * like Promotions. Re-visits the listing URL before each attempt
   * rather than relying on browser back navigation, so one tournament's
   * detail page misbehaving can't strand the loop somewhere unexpected.
   */
  async verifyAllTournamentDetails(localeSegment = ''): Promise<{ found: number; opened: number; flagged: string[] }> {
    return step("Open and scan each tournament's own detail page", async () => {
      const listingUrl = localeSegment ? `/${localeSegment}/tournaments` : '/tournaments';
      const buttons = this.page.getByRole('button', { name: /more info/i });
      await buttons.first().waitFor({ timeout: 8_000 }).catch(() => {});
      const found = await buttons.count();

      let opened = 0;
      const flagged: string[] = [];
      for (let i = 0; i < found; i++) {
        try {
          await this.page.goto(listingUrl);
          await this.page.waitForLoadState('domcontentloaded');
          const targetButtons = this.page.getByRole('button', { name: /more info/i });
          await targetButtons.first().waitFor({ timeout: 8_000 }).catch(() => {});
          const previousUrl = this.page.url();
          await targetButtons.nth(i).click({ timeout: 5_000 });
          await this.page.waitForURL((url) => url.toString() !== previousUrl, { timeout: 8_000 });
          opened++;
          for (const f of await this.scanForUntranslatedText()) {
            if (!flagged.includes(f)) flagged.push(f);
          }
        } catch {
          // One tournament's detail page misbehaving shouldn't sink the
          // rest — but if EVERY one fails (found > 0, opened stays 0),
          // the caller surfaces that as a real finding instead of
          // silently reporting "nothing to check".
        }
      }
      return { found, opened, flagged };
    });
  }
}
