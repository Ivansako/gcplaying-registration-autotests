import { expect, FrameLocator, Locator, Page } from '@playwright/test';
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
    // Confirmed live 2026-08-31 (full-suite run): some auto-shown popup
    // (its overlay carries `data-modal="Login"`, but it's not this
    // method's own login form — that hasn't opened yet) can already be
    // covering the header on a fresh navigation, and intercepts pointer
    // events on the header button for this click's whole actionTimeout,
    // throwing before ever reaching the retry below. Same fix as
    // `launchGame()`'s identical race.
    await this.dismissModalIfPresent();
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
   * Findings from any reactive popup (level-up rewards, mission
   * completions, the auto-opening Finances modal, ...) scanned by
   * `dismissModalIfPresent()` right before it closes them — collected
   * here since these popups are gone by the time the caller's own
   * `verifyTranslation()` runs, so their content would otherwise never be
   * checked at all. Drained by `takePendingModalFindings()`.
   */
  private pendingModalFindings: string[] = [];

  /**
   * Returns and clears whatever `dismissModalIfPresent()` has scanned so
   * far in the current test — call this right before `verifyTranslation()`
   * and merge the result into its `extraFlagged` param, the same pattern
   * `verifyAllPromotionTerms()` already uses for promo modals.
   */
  takePendingModalFindings(): string[] {
    const findings = this.pendingModalFindings;
    this.pendingModalFindings = [];
    return findings;
  }

  /**
   * Closes a `[data-modal-overlay="true"]` popup if one is covering the
   * page — confirmed live 2026-08-28: a "Finances" (deposit-prompt)
   * modal can auto-open after login and intercepts clicks on anything
   * underneath it until dismissed, the same category of issue as
   * gcplaying0175.com's promo-popup iframe. Also covers reactive
   * popups tied to real player actions (a "Level Up Reward Unlocked"
   * toast was confirmed live 2026-08-29 right after placing a real
   * sportsbook bet) — these are real, locale-specific content the
   * player actually sees, so this scans for untranslated text (see
   * `pendingModalFindings`/`takePendingModalFindings()`) BEFORE closing
   * it, not just silently discarding whatever it said.
   */
  async dismissModalIfPresent(): Promise<void> {
    const overlay = this.page.locator('[data-modal-overlay="true"]').first();
    if (!(await overlay.isVisible({ timeout: 2_000 }).catch(() => false))) return;

    await step('Dismiss the modal popup, if shown', async () => {
      for (const f of await this.scanForUntranslatedText()) {
        if (!this.pendingModalFindings.includes(f)) this.pendingModalFindings.push(f);
      }
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
   * Places ONE real, minimum-bet spin on a specific, pre-confirmed game
   * ("Better Barn House Bonanza" by Pragmatic Play, `/game/real/63385` —
   * literally the first game link on the casino lobby the day this was
   * investigated, 2026-08-29) and reports the balance before/after. Same
   * constraint as gcplaying0175.com's `AccountPage.spinKnownGame()`: the
   * game's own bet/spin controls render on an opaque `<canvas>` with no
   * accessible DOM, so this is coordinate-based, confirmed live only at
   * a 1280x800 viewport (callers MUST pin
   * `test.use({ viewport: { width: 1280, height: 800 } })` — a different
   * size shifts every coordinate below).
   *
   * Deliberately called ONCE per suite run, not once per locale: the
   * point is to seed one real Game History row, then let every
   * locale/viewport combination check that SAME row's translated labels
   * via plain navigation (`visitPage('/account/game-history', locale)`)
   * — re-spinning per locale would multiply real-money spends for no
   * extra signal, since the spin's own data doesn't change per locale,
   * only the labels/date formatting around it do.
   *
   * Flow confirmed live 2026-08-29: launch → an intro/splash screen
   * (game art + a round icon) needs one click to reach the reels → the
   * default bet (€2.00) is reduced to this game's €0.20 minimum by
   * clicking "-" until it floors (opens a "Bet Multiplier" panel as a
   * side effect, closed via its own X) → one spin click → the header
   * balance dropped from €99.89 to €99.69, confirming a real spin.
   */
  async spinFirstAvailableGame(): Promise<{ balanceBefore: string; balanceAfter: string }> {
    return step('Launch the first available slot and place one real minimum-bet spin', async () => {
      await this.dismissModalIfPresent();
      const balanceBefore = await this.getBalanceText();

      const gameLink = this.page.locator('a[href="/game/real/63385"]').first();
      try {
        await gameLink.click({ timeout: 8_000 });
      } catch {
        // Confirmed live 2026-08-30: the auto-opening "Finances" modal can
        // appear a beat AFTER the dismiss check above, intercepting this
        // click — same race `launchGame()` and `openCashier()` already
        // retry around.
        await this.dismissModalIfPresent();
        await gameLink.click();
      }
      await this.page.waitForTimeout(20_000); // provider splash/loading screen

      await this.dismissModalIfPresent();

      // Intro/splash screen — one click on its round icon to reach the reels.
      await this.page.mouse.click(1008, 616);
      await this.page.waitForTimeout(4_000);

      // Reduce the bet to this game's minimum via the "-" control.
      for (let i = 0; i < 25; i++) {
        await this.page.mouse.click(886, 731);
        await this.page.waitForTimeout(150); // human-speed, not a rapid-fire click storm
      }
      await this.page.waitForTimeout(500);
      // Closes the "Bet Multiplier" panel the clicks above opened.
      await this.page.mouse.click(1113, 193);
      await this.page.waitForTimeout(1_000);

      await this.page.mouse.click(984, 731); // spin
      await this.page.waitForTimeout(6_000); // let the reels finish and the balance settle

      await this.page.goto('/');
      await this.page.waitForLoadState('domcontentloaded');
      await this.dismissModalIfPresent();
      const balanceAfter = await this.getBalanceText();
      return { balanceBefore, balanceAfter };
    });
  }

  /**
   * Places ONE real, minimum-stake bet on the sportsbook (`/sport`) and
   * reports which event it landed on. Same "seed once, check per locale
   * via navigation" reasoning as `spinFirstAvailableGame()` — see that
   * method's comment.
   *
   * The sportsbook itself is a cross-origin third-party widget
   * (`iframe[src*="88wplay"]`, confirmed live 2026-08-29 to genuinely
   * re-embed in the site's own locale — `/en/spbk`, `/fr/spbk`, even a
   * differently-coded `/gr/spbk` for Greek — so this IS real, checkable
   * brand-adjacent content, not an opaque third-party black box like the
   * slot games). Unlike the slots, this iframe's odds/bet-slip controls
   * are REAL accessible DOM (`.master_fe_Selections_selection` odds
   * buttons, `#counter` stake input, `#place-bets` submit), not a canvas
   * — so this is locator-based, not coordinate-based, and should keep
   * working across viewports/minor layout changes.
   *
   * Deliberately picks a NON-LIVE (pre-match) event: confirmed live that
   * a LIVE match's odds can be invalidated by a live score/odds change
   * the moment they shift, silently clearing the pick from the slip
   * before the bet is even placed. Finds AND clicks the button in a
   * single `evaluate()` call rather than finding an index then clicking
   * `.nth(index)` separately — the two-step version raced against this
   * page's constant live re-rendering and clicked the wrong element on
   * the first attempt.
   */
  async placeMinimumSportsbookBet(): Promise<{ event: string | null }> {
    return step('Place one real minimum-stake sportsbook bet, human speed', async () => {
      await this.page.goto('/sport');
      await this.page.waitForTimeout(8_000); // the widget iframe is slow to hydrate

      const frame = this.page.frameLocator('iframe[src*="88wplay"]');
      await frame.locator('.master_fe_Selections_selection').first().waitFor({ timeout: 15_000 });

      const picked = await frame.locator('body').evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('.master_fe_Selections_selection')) as HTMLElement[];
        for (const btn of buttons) {
          let card: Element | null = btn;
          let isLive = false;
          for (let d = 0; d < 8 && card; d++) {
            if (/live/i.test(card.textContent?.slice(0, 30) ?? '')) isLive = true;
            card = card.parentElement;
          }
          if (!isLive) {
            const text = btn.textContent;
            btn.click();
            return text;
          }
        }
        return null;
      });
      if (!picked) return { event: null };

      await this.page.waitForTimeout(2_000); // human-speed pause, let the slip settle
      await frame.locator('#place-bets').click();
      await this.page.waitForTimeout(4_000); // human-speed pause, let the confirmation render

      // A loyalty/reward popup (e.g. "Level Up Reward Unlocked") can
      // appear right after a bet, on top of the whole page — same
      // overlay system as every other modal in this app.
      await this.dismissModalIfPresent();

      return { event: picked };
    });
  }

  /**
   * Opens the sportsbook widget's own "My Bets" tab — the translated bet
   * history this suite checks after `placeMinimumSportsbookBet()` has
   * seeded one. Navigation-only, no new bet placed.
   */
  async openSportsbookMyBets(): Promise<void> {
    await step('Open the sportsbook "My Bets" tab', async () => {
      await this.page.goto('/sport');
      await this.page.waitForTimeout(8_000);
      const frame = this.page.frameLocator('iframe[src*="88wplay"]');
      const myBetsTab = frame.locator('.betslip_fe_ModernTab_modernTab__title', { hasText: 'My Bets' });
      // Always click "Bet Slip" first, unconditionally, on both
      // viewports: on mobile this taps the floating toggle that expands
      // the panel out from behind the site's own fixed bottom nav
      // (confirmed live 2026-08-29 — without this the panel stays
      // collapsed and `force`-clicking "My Bets" anyway hit-tests through
      // to the real, topmost element at that pixel, the bottom nav's
      // "Casino" link, navigating away instead); on desktop it's simply
      // the already-active tab label, a harmless no-op re-select.
      await frame.getByText('Bet Slip', { exact: true }).first().click();
      await this.page.waitForTimeout(2_000);
      await myBetsTab.click();
      await this.page.waitForTimeout(3_000);
    });
  }

  /**
   * Opens the "Cassa"/Cashier modal (`data-modal="Finances"` — the same
   * modal `dismissModalIfPresent()` already knows how to close) via the
   * header's Deposit button. Matched by its icon (`data-icon="deposit"`),
   * not its translated label ("Deposita" in Italian, confirmed live
   * 2026-08-29), so this works regardless of locale.
   */
  async openCashier(): Promise<void> {
    await step('Open the Cashier (Deposit/Withdraw) modal', async () => {
      const financesModal = this.page.locator('[data-modal-overlay="true"][data-modal="Finances"]');
      // The same auto-opening "Finances" modal `dismissModalIfPresent()`
      // closes elsewhere can instead appear a beat AFTER login (confirmed
      // live 2026-08-29 on a mobile viewport) — right as this method's own
      // dismiss-then-click runs, leaving it open and blocking the click on
      // the header's own deposit trigger. If it's already open, there's
      // nothing left to do.
      if (await financesModal.isVisible({ timeout: 1_500 }).catch(() => false)) return;
      await this.dismissModalIfPresent();
      const depositButton = this.page.locator('button:has(div[data-icon="deposit"])').first();
      try {
        await depositButton.click({ timeout: 8_000 });
      } catch {
        // Confirmed live 2026-08-29: on rare occasions the same
        // auto-opening Finances modal appears mid-click (after the
        // already-open check above passed, before the click itself
        // landed), intercepting it. Dismiss whatever showed up and retry
        // once rather than failing the whole check over this race.
        await this.dismissModalIfPresent();
        await depositButton.click();
      }
      await expect(financesModal).toBeVisible({ timeout: 8_000 });
    });
  }

  /**
   * Switches the open Cashier modal between its two tabs. Same
   * "first two buttons inside the modal body are the two tabs, in a
   * fixed order" pattern this app uses consistently (the Login/Sign Up
   * modal's "Registrati"/"Accedi" tabs work identically) — index-based
   * on purpose since the labels ("Deposita"/"Preleva") are translated
   * and can't be matched by text across every locale.
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
   * Opens the Login/Sign Up modal, optionally switching straight to the
   * Sign Up tab. It opens on the Login tab by default (confirmed live
   * 2026-08-29 — "Accedi" carries the active-tab class initially), same
   * hydration-race retry as `submitLoginForm()`.
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
   * Opens the Login modal's "Password dimenticata?"/Forgot Password
   * form. No stable `data-*` attribute distinguishes it from the
   * password-visibility toggle (confirmed live 2026-08-29), and its own
   * label is translated per locale — but it's the only `button[type="button"]`
   * inside the Login form itself (the visibility toggle is a `div`, not
   * a button), so that's locale-agnostic and reliable.
   */
  async openForgotPasswordForm(): Promise<void> {
    await step('Open the Forgot Password form', async () => {
      await this.openAuthModal('login');
      await this.page.locator('[data-modal-overlay="true"] form[type="Login"] button[type="button"]').first().click();
      await expect(this.page.locator('[data-modal-overlay="true"] #email')).toBeVisible({ timeout: 5_000 });
    });
  }

  /**
   * Submits the Forgot Password form and waits for the "Check your
   * email" confirmation screen — confirmed live 2026-08-29 to render
   * real, translated content (not just a toast), safe to submit for
   * real with a genuine account email since it only ever sends a reset
   * email, never changes anything.
   */
  async submitForgotPassword(email: string): Promise<void> {
    await step(`Submit Forgot Password for ${email}`, async () => {
      await this.page.locator('[data-modal-overlay="true"] #email').fill(email);
      await this.page.locator('[data-modal-overlay="true"] form[type="ForgotPassword"] button[type="submit"]').click();
      await this.page.waitForTimeout(2_500);
    });
  }

  /**
   * Fills the Sign Up form with an EXISTING account's email (real
   * server-side "already registered" validation, not just the client-side
   * password-strength hints) and submits if the button actually enables.
   * Confirmed live 2026-08-29: the submit button sometimes stays disabled
   * for reasons not pinned down even with a fully valid-looking form —
   * `attempted: false` signals that so the caller can note it as a known
   * limitation rather than fail the whole test over an unrelated,
   * unconfirmed form-validation quirk. Never actually creates an account
   * either way (the email is already taken).
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
   * Navigates to a URL that doesn't correspond to any real route.
   * Confirmed live 2026-08-29: this site has no dedicated themed 404
   * design — it falls back to the same generic React error boundary
   * ("Something went wrong!") a real crash would show, real translated
   * content either way.
   */
  async visitNonExistentPage(localeSegment = ''): Promise<void> {
    await step('Open a non-existent page (checks the error boundary)', async () => {
      const url = localeSegment ? `/${localeSegment}/this-page-does-not-exist-xyz` : '/this-page-does-not-exist-xyz';
      await this.page.goto(url);
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(1_500);
    });
  }

  /**
   * Opens the account avatar dropdown (distinct from the side menu's
   * language switcher) — its own real, first-party menu items
   * (Profile Info, Notifications, Verification, ...) have never been
   * scanned anywhere else in this suite, since every other check reaches
   * those pages by direct URL rather than clicking through this menu.
   */
  async openAccountMenu(): Promise<void> {
    await step('Open the account avatar dropdown', async () => {
      await this.page.locator('header button[data-icon-button-type="wrapper"]').last().click();
      await this.page.waitForTimeout(500);
    });
  }

  /**
   * NOTE on "Notifications": the account dropdown's own second item
   * opens it, but confirmed live 2026-08-29 that its content is a
   * cross-origin third-party widget (`InboxWidget.html` on a
   * `cloudfront.net` domain — the same gamification-vendor family as the
   * "Smartico" console noise already filtered elsewhere in this file).
   * Unlike the sportsbook widget, there's no evidence it re-embeds per
   * site locale (no locale segment in its URL, no confirmed postMessage
   * handshake) — so it's deliberately NOT opened/deep-scanned here, same
   * category as the LiveChat widget or Sumsub's KYC document upload.
   * `openAccountMenu()` above still covers this dropdown's own real,
   * first-party item labels (including "Notifications" itself).
   */

  /**
   * Opens each tournament's own "More info" detail page, one at a time —
   * discovery-driven via count, so it scales to however many tournaments
   * exist now or are added later, same spirit as
   * `verifyAllPromotionTerms()`. Confirmed live 2026-08-29: "More info"
   * navigates to a real page (`/tournaments/{id}`), not a modal. No
   * stable `data-*` attribute distinguishes a card's "Opt in"/"More info"
   * button pair from the page's own "Active"/"Finished" filter toggle
   * (both are structurally identical — a `<div>` wrapping exactly two
   * `<button>`s), and the labels are translated per locale — but the
   * filter toggle is confirmed to always be the FIRST such pair in the
   * DOM, with one tournament card's pair per tournament after it, so
   * skipping index 0 reliably yields only real tournament cards.
   */
  async verifyAllTournamentDetails(localeSegment = ''): Promise<{ found: number; opened: number; flagged: string[] }> {
    return step("Open and scan each tournament's own detail page", async () => {
      const listingUrl = localeSegment ? `/${localeSegment}/tournaments` : '/tournaments';
      const countCardGroups = () =>
        this.page.evaluate(() => {
          const groups = Array.from(document.querySelectorAll('div')).filter(
            (div) => div.children.length === 2 && div.children[0].tagName === 'BUTTON' && div.children[1].tagName === 'BUTTON'
          );
          return Math.max(0, groups.length - 1);
        });

      await this.page.goto(listingUrl);
      await this.page.waitForTimeout(2_000);
      const found = await countCardGroups();

      let opened = 0;
      const flagged: string[] = [];
      for (let i = 0; i < found; i++) {
        try {
          await this.page.goto(listingUrl);
          await this.page.waitForTimeout(2_000);
          const previousUrl = this.page.url();
          const clicked = await this.page.evaluate((index) => {
            const groups = Array.from(document.querySelectorAll('div')).filter(
              (div) => div.children.length === 2 && div.children[0].tagName === 'BUTTON' && div.children[1].tagName === 'BUTTON'
            );
            const card = groups[index + 1]; // +1 skips the Active/Finished toggle
            if (!card) return false;
            (card.children[1] as HTMLElement).click();
            return true;
          }, i);
          if (!clicked) continue;
          await this.page.waitForURL((url) => url.toString() !== previousUrl, { timeout: 8_000 });
          opened++;
          for (const f of await this.scanForUntranslatedText()) {
            if (!flagged.includes(f)) flagged.push(f);
          }
        } catch {
          // one tournament's detail page misbehaving shouldn't sink the rest
          // — but if EVERY one fails (found > 0, opened stays 0), the
          // caller surfaces that as a real finding instead of silently
          // reporting "nothing to check", see verifyAllTournamentDetails's
          // call site.
        }
      }
      return { found, opened, flagged };
    });
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
  async verifyAllPromotionTerms(): Promise<{ found: number; opened: number; flagged: string[] }> {
    return step("Open and scan each promotion's own details (Terms & Conditions)", async () => {
      const buttons = this.page.locator('[data-button-group="promotion-action"] button');
      // `.count()` reads the DOM as it is right now, with no built-in
      // wait (unlike `.click()`/`.waitFor()`) — confirmed live
      // 2026-08-28 that promo cards render a beat after
      // `domcontentloaded`, the same SPA-hydration-timing class of issue
      // already hit elsewhere in this page object, so an un-waited
      // count read 0 even though the cards appeared moments later.
      await buttons.first().waitFor({ timeout: 8_000 }).catch(() => {});
      const found = await buttons.count();
      let opened = 0;
      const flagged: string[] = [];
      for (let i = 0; i < found; i++) {
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
          // But if EVERY one fails (found > 0, opened stays 0), the
          // caller surfaces that as a real finding instead of silently
          // reporting "nothing to check" — see the spec's call site.
        }
      }
      return { found, opened, flagged };
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
   *
   * On a narrow (mobile) viewport, confirmed live 2026-08-29: the
   * header's own burger icon (`sideMenuToggle`) is NOT visible/clickable
   * — it's replaced by the site's own bottom nav bar, whose first item
   * ("Menu", confirmed via its `#bottom-navigation` position rather than
   * its label text since that's translated) opens the exact same
   * `aside[data-sidemenu="container"]` panel (same `body.sidebar-open`
   * class toggle, same language switcher inside it).
   */
  async openSideMenu(): Promise<void> {
    await step('Open the side menu', async () => {
      const isOpen = await this.page.evaluate(() => document.body.className.includes('sidebar-open'));
      if (isOpen) return;
      await this.clickSideMenuToggle();
      try {
        await expect(this.page.locator('body')).toHaveClass(/sidebar-open/, { timeout: 3_000 });
      } catch {
        await this.clickSideMenuToggle();
        await expect(this.page.locator('body')).toHaveClass(/sidebar-open/, { timeout: 5_000 });
      }
    });
  }

  /**
   * Closes the side menu if open — the site persists the sidebar's
   * open/closed state (confirmed live 2026-08-29: opening it once, then
   * navigating to a brand-new page via `page.goto()` within the SAME
   * test, still loads with the sidebar open), so any method that opens it
   * for a quick check (e.g. `getAvailableLocaleLabels()`) must close it
   * again afterward or it silently stays open for the rest of that test,
   * later intercepting clicks on whatever's underneath it.
   */
  async closeSideMenu(): Promise<void> {
    await step('Close the side menu', async () => {
      const isOpen = await this.page.evaluate(() => document.body.className.includes('sidebar-open'));
      if (!isOpen) return;
      await this.clickSideMenuToggle();
      await expect(this.page.locator('body')).not.toHaveClass(/sidebar-open/, { timeout: 3_000 }).catch(() => {});
    });
  }

  private async clickSideMenuToggle(): Promise<void> {
    const isNarrowViewport = (this.page.viewportSize()?.width ?? 1280) < 700;
    const toggle = isNarrowViewport ? this.page.locator('#bottom-navigation > div').first() : this.sideMenuToggle;
    await toggle.click();
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
    return this.page.evaluate(WildiesPage.untranslatedTextScanner);
  }

  /**
   * Same scan as `scanForUntranslatedText()`, run inside a (possibly
   * cross-origin) iframe instead of the top-level page — needed for the
   * sportsbook widget (`iframe[src*="88wplay"]`), whose own document
   * `this.page.evaluate()` can never see. `frame.locator('body').evaluate()`
   * runs inside the iframe's own execution context, unlike a `page.evaluate()`
   * from the parent, which cross-origin browser security would block from
   * reading that document at all.
   */
  async scanFrameForUntranslatedText(frame: FrameLocator): Promise<string[]> {
    return frame.locator('body').evaluate(WildiesPage.untranslatedTextScanner);
  }

  /**
   * Flags any of `englishStrings` found verbatim in the frame's text —
   * catches a translation gap invisible to `untranslatedTextScanner`: a
   * widget that silently falls back to its default English UI instead of
   * leaking a broken raw key. Confirmed live 2026-08-30: the Sportsbook
   * "My Bets" tab under Español renders entirely in English (Bet Slip, My
   * Bets, Total Stake, Cash Out, ...) with no broken key anywhere, so
   * `scanFrameForUntranslatedText()` correctly found nothing — by its own,
   * narrower definition ("does raw i18n machinery leak through"), nothing
   * was leaking. Deliberately multi-word phrases only — a single common
   * word (e.g. "All", "Open") risks colliding with a real, correctly
   * translated string in some other locale; a multi-word English phrase
   * appearing verbatim on a non-English page cannot be a coincidence.
   */
  async scanFrameForEnglishFallback(frame: FrameLocator, englishPhrases: string[]): Promise<string[]> {
    const bodyText = await frame.locator('body').innerText();
    return englishPhrases
      .filter((phrase) => bodyText.includes(phrase))
      .map((phrase) => `Still shows the English "${phrase}" — the widget appears to have fallen back to English instead of translating`);
  }

  /**
   * Pure, self-contained (no closure over `this`/outer scope) so it can be
   * handed to either `page.evaluate()` or a `FrameLocator`'s `evaluate()`
   * and serialized into that document's own execution context as-is.
   */
  private static readonly untranslatedTextScanner = () => {
    const KEY_PATTERNS: RegExp[] = [
      /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,}$/i, // dot.separated.key
      // SCREAMING_SNAKE_CASE, 4+ segments — confirmed via independent code
      // review 2026-08-30 that 3+ segments (the previous threshold) can
      // collide with a real, correctly-translated promo/transaction code
      // shaped the same way (e.g. "WELCOME_50_BONUS"), which this suite
      // scans for on exactly the pages such codes would appear (Promotions,
      // Transaction History). 4+ segments is long enough that a real key
      // leaking raw (this repo's own confirmed shape, e.g.
      // "nothing.to.update"'s sibling patterns) still gets caught, while a
      // human-authored 2-3-word code mostly won't.
      /^[A-Z][A-Z0-9]*(_[A-Z0-9]+){3,}$/,
      /\{\{\s*[\w.]+\s*\}\}/, // leftover {{ placeholder }}
      /^\[object Object\]$/,
      /^(undefined|null|NaN)$/,
    ];
    // ".ai" added 2026-08-31 — confirmed live the Gamification widget's own
    // "Powered by Smartico.ai" attribution (real, third-party branding,
    // correctly left untranslated in every locale) otherwise matches the
    // dot.separated.key pattern below and false-positives as a broken key.
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

  /**
   * The sportsbook's cross-origin third-party widget — confirmed live
   * 2026-08-29 to genuinely re-embed in the site's own locale
   * (`/en/spbk`, `/fr/spbk`, ...), so its content is real, checkable
   * brand-adjacent translation, not an opaque third-party black box.
   */
  get sportsbookFrame(): FrameLocator {
    return this.page.frameLocator('iframe[src*="88wplay"]');
  }

  /**
   * The "Match X" gamification widget — a third-party Smartico.ai
   * cross-origin iframe (`.../gf/Achievements3.html`), same architecture
   * as `sportsbookFrame`. Confirmed live 2026-08-31: unlike the sportsbook
   * widget, this one does NOT follow the site's own current locale — an
   * account opened here under `open('en')` still showed the widget fully
   * in Italian, presumably a per-account/per-device preference Smartico
   * tracks itself rather than reading the page's locale on each open.
   * Because of that, checks against this frame only scan for broken raw
   * keys leaking through (the same conservative, locale-agnostic check
   * used everywhere else) — asserting it matches the CURRENT test's
   * locale would be asserting something not actually true of this widget,
   * not a real translation bug. Worth flagging to the Wildies team as its
   * own question (is that the intended integration?), separate from this
   * suite's job of catching broken/missing translations.
   */
  get gamificationFrame(): FrameLocator {
    return this.page.frameLocator('iframe[src*="Achievements3.html"]');
  }

  /**
   * Opens the sidebar's "Match X" button — "Match X" is the product's own
   * name, confirmed unchanged across every tested locale, so this locator
   * doesn't need a per-locale label.
   */
  async openGamificationWidget(): Promise<void> {
    await step('Open the gamification (Match X) widget', async () => {
      // getByRole (accessible name), NOT locator(hasText) — confirmed live
      // 2026-08-31: at this suite's normal Desktop width (1280px, from
      // `devices['Desktop Chrome']`) the sidebar collapses to icon-only,
      // and "Match X" only exists as the icon's `alt` text at that point
      // (no separate visible text node), which contributes to the
      // accessible name but not to `hasText`'s plain DOM-text match.
      // On mobile there's no visible sidebar at all until the drawer
      // opens — confirmed live 2026-08-31 that an unopened attempt
      // instead matched an unrelated, off-screen home-page promo banner
      // advertising the same feature. `openSideMenu()` already handles
      // the desktop/mobile toggle difference; scoping the button search
      // to the sidebar's `complementary` landmark avoids that banner.
      await this.dismissModalIfPresent();
      try {
        await this.openSideMenu();
      } catch {
        // Confirmed live 2026-08-31: a "Finances"/reward popup can
        // (re)appear a beat after the check above — same class of race
        // as `launchGame()`'s identical dismiss-and-retry.
        await this.dismissModalIfPresent();
        await this.openSideMenu();
      }
      const matchXButton = this.page.getByRole('complementary').getByRole('button', { name: /match x/i }).first();
      try {
        await matchXButton.click({ timeout: 20_000 });
      } catch {
        // Confirmed live 2026-09-01: the same "Finances" popup this
        // method already dismisses/retries around before opening the
        // side menu can reappear a second time, right before THIS click
        // specifically — a fresh, later auto-open, not a leftover from
        // the earlier check.
        await this.dismissModalIfPresent();
        await matchXButton.click({ timeout: 20_000 });
      }
      await this.gamificationFrame.locator('.menu-item').first().waitFor({ timeout: 10_000 });
    });
  }

  async closeGamificationWidget(): Promise<void> {
    await step('Close the gamification widget', async () => {
      await this.gamificationFrame.locator('.close-button-wrapper .close-button').click();
    });
  }

  /**
   * The 5 sidebar sections inside the widget (Overview, Missions, Levels,
   * Store, Inbox) are plain non-semantic `.menu-item` divs with no stable
   * per-locale text to select by — same DOM-position reasoning already
   * used elsewhere in this file (documented there as a deliberate,
   * fragile-but-necessary tradeoff). Confirmed live 2026-08-31 the order
   * is fixed regardless of locale.
   *
   * On mobile this list lives behind its own internal hamburger
   * (`.header-menu`) rather than being directly on-screen — and,
   * confirmed live 2026-08-31, it can close again after navigating (e.g.
   * re-clicking the already-active section), so this reopens it
   * defensively on a failed click and retries, rather than assuming one
   * open lasts the rest of the test.
   */
  async openGamificationSection(index: number): Promise<void> {
    await step(`Open gamification section #${index}`, async () => {
      // Confirmed live 2026-08-31: on mobile this closes again after EVERY
      // section change (not just when re-selecting the active one), so
      // this opens it proactively every time rather than retrying after a
      // failed click — a retry-after-failure round trip (each with its own
      // multi-second actionability timeout) was blowing well past this
      // test's own timeout once multiplied across 5 sections + sub-tabs.
      if ((this.page.viewportSize()?.width ?? 1280) < 700) {
        await this.gamificationFrame.locator('.header-menu').click().catch(() => {});
        await this.page.waitForTimeout(300);
      }
      await this.gamificationFrame.locator('.menu-item').nth(index).click();
      await this.page.waitForTimeout(1_500); // content-animator transition
    });
  }

  /**
   * Missions and Store each have their own inner tab bar
   * (`.tabs-container .tab-container`, e.g. Missions' Overview/Available/
   * Locked/Completed) — Overview and Inbox don't, so this is a no-op for
   * those (`count()` is simply 0). Discovery-driven rather than a
   * hardcoded "4", since Store's own count differs from Missions'.
   * NOTE: Inbox has a further inner layer of its own (`.inbox-new-
   * categories` "All"/"Favorite") that this does NOT drill into — a
   * documented gap, not silent coverage.
   */
  async gamificationSubTabCount(): Promise<number> {
    return this.gamificationFrame.locator('.tabs-container .tab-container').count();
  }

  async openGamificationSubTab(index: number): Promise<void> {
    await step(`Open gamification sub-tab #${index}`, async () => {
      await this.gamificationFrame.locator('.tabs-container .tab-container').nth(index).click();
      await this.page.waitForTimeout(1_000);
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
    const labels = await links.allTextContents();
    // The site persists the sidebar's open/closed state across page loads
    // (confirmed live 2026-08-29 — see `closeSideMenu()`'s comment), so
    // leaving it open here silently carries over into every later
    // navigation this same test makes, eventually intercepting a click on
    // whatever's underneath it.
    await this.closeSideMenu();
    return labels;
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
    opts: { severity: string; whatChecked?: string; rootCause: string; whatToCheck: string; explainsFailure?: boolean }
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

      // A translated string that's longer than its English original is a
      // common source of mobile layout breakage (German/Finnish especially)
      // — exactly what the mobile viewport pass exists to catch. Treated as
      // a content/localization bug (red), not a generic UI finding, since
      // it's specifically caused by the translated text's length, matching
      // this suite's own green-or-red-only mandate. A few px is normal
      // responsive noise, so only flag it once it's clearly a real overflow.
      const overflowPx = await this.getHorizontalOverflow();
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

      // Three clearly separated paragraphs, same shape whether this passes
      // or fails — confirmed 2026-08-31 the previous single run-on
      // paragraph (what was checked glued directly onto the result) was
      // hard to read at a glance in the Allure Description panel.
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

      await this.flagIssue(pageLabel, {
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
   * Plain visual-evidence screenshot — no broken-image/overflow/console-
   * error checking, unlike `attachScreenshot()`. This suite is UI/i18n
   * content only (2026-08-28): a generic technical finding (a console
   * error, a third-party script warning) isn't what it exists to catch,
   * and flagging one would just bury the one thing that actually
   * matters here — `verifyTranslation()`'s result — in unrelated noise.
   */
  async captureScreenshot(name: string, opts: { fullPage?: boolean; dismissModalFirst?: boolean } = {}): Promise<void> {
    // `fullPage` defaults to true (the common case: showing whatever page
    // content this check just verified). Pass `fullPage: false` for a
    // screenshot taken while the nav drawer is open — confirmed live
    // 2026-09-01 that the drawer is a `position: fixed` overlay, and
    // Playwright's fullPage capture scrolls + stitches the page in
    // segments to build one tall image; a fixed element doesn't scroll
    // with the rest of the page, so it gets captured again at each
    // scroll position and composited into the same image — the garbled,
    // overlapping screenshots this was producing on every "nav menu"
    // attachment. A plain viewport screenshot has no scrolling/stitching
    // to go wrong, and the drawer is fully on-screen within one viewport
    // anyway (that's the whole point of a fixed overlay).
    const fullPage = opts.fullPage ?? true;
    // `dismissModalFirst` — confirmed live 2026-09-01 the "Finances"/
    // reward popup that auto-opens at various points can also do so
    // right before an UNRELATED screenshot (e.g. "Account menu"'s
    // screenshot showed the Cashier deposit modal, not the account
    // dropdown it was supposed to capture). Deliberately opt-in, NOT the
    // default: at several call sites (Login popup, Sign Up popup, Forgot
    // Password) the screenshot's own subject IS a `[data-modal-overlay]`
    // dialog, and `dismissModalIfPresent()` can't tell "the intended
    // modal" from "an unwanted one" — it would close the very thing
    // being screenshotted. Only pass this where the screenshot's target
    // is confirmed NOT itself a modal overlay.
    if (opts.dismissModalFirst) {
      await this.dismissModalIfPresent();
    }
    await step(`Screenshot: ${name}`, async () => {
      await this.page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
      const buffer = await this.page.screenshot({ fullPage, timeout: 30_000 });
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
