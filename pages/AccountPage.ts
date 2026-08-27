import { expect, Locator, Page } from '@playwright/test';
import { attachment, logStep, step } from 'allure-js-commons';
import { ContentType, Status } from 'allure-js-commons';

/**
 * Page object for everything that exists only *after* logging in — header
 * (balance/notifications/account menu), site navigation, the account
 * menu's own sub-sections, the deposit modal, and launching a game.
 * `RegistrationPage` owns the auth modal itself (signup/login); this page
 * object picks up from an already-authenticated session.
 *
 * KNOWN SITE BUG (confirmed live and in isolation 2026-08-27, not a test
 * artifact): a JS error — "em: INSUFFICIENT_PATH", thrown from a useMemo
 * inside the shared `[locale]` layout chunk — fires a burst of ~21
 * identical occurrences immediately after login and keeps recurring on
 * every authenticated page. `attachScreenshot()`'s console-error check
 * (see below) picks this up on every authenticated check — reported as
 * an orange "broken" Allure step (not a red test failure, see
 * `attachScreenshot()`'s own comment for why), so it stays visible
 * without redding out the whole authenticated suite. Same applies to
 * `RegistrationPage`'s post-login screenshots. Left in deliberately
 * rather than filtered out, since this is a real defect, not noise
 * (unlike the 429s filtered in the console listener below).
 *
 * Markup confirmed live on 2026-08-26 (logged in as the TEST_USER_EMAIL
 * account via a throwaway discovery script):
 *  - The header balance and the Deposit button share one container
 *    (`Balance_container__<hash>`) — disambiguated from the *account
 *    menu's own* "Total Balance" element (a different `Balance_container`
 *    CSS module) by filtering for the one that actually contains the
 *    Deposit button.
 *  - Notifications: `Navbar_inboxWrapper__<hash>` — its text content is
 *    the unread-count badge (e.g. "1"), no separate testid.
 *  - Clicking the avatar (`UserAvatar_headerContainer__<hash>`) opens
 *    `UserProfilePopUp_container__<hash>`, listing real account sections
 *    as `<a class="UserProfileLinks_link__<hash>">` — read dynamically
 *    (not hardcoded) since the exact set isn't guaranteed to stay fixed;
 *    live it showed Profile Info, Refer a Friend, Verification, My
 *    Promotions, Game History, Transaction History, Pending Withdrawals.
 *  - Main nav pills (Casino/Live Casino/Jackpots/Providers/...) are
 *    `div.Navbar_navbar__container_item__<hash>` — clickable divs, not
 *    links.
 *  - Deposit opens a `CashierModal_modalWrapper__<hash>` popup showing a
 *    "Payment Methods (N)" list and preset amounts — checked for
 *    presence only, never submitted (no real payment placed).
 *  - Games launch inside a cross-origin third-party iframe (Pragmatic
 *    Play and others, confirmed via 2 different providers). Any
 *    HTML intro/rules screen inside it (e.g. a "CONTINUE" button) is
 *    reachable via `page.frameLocator()`, but actual gameplay renders on
 *    a `<canvas>` with zero accessible DOM elements — the exact same
 *    constraint already documented in `tests/game-providers.spec.ts` for
 *    ferraplay.com. This page object can launch a game and confirm it
 *    reaches a playable (canvas-rendered) state; it can't drive an
 *    arbitrary game's own bet/spin controls — that needs the same
 *    one-time manual investigation as the ferraplay findings ledger.
 */
export class AccountPage {
  readonly page: Page;

  readonly depositButton: Locator;
  readonly balanceContainer: Locator;
  readonly notificationsButton: Locator;
  readonly avatarButton: Locator;
  readonly accountMenu: Locator;
  readonly accountMenuLinks: Locator;

  readonly depositModal: Locator;
  readonly depositPaymentMethodsLabel: Locator;
  readonly depositModalCloseButton: Locator;

  // Profile Info tab (/account/balance) — field names confirmed live
  // 2026-08-26. Scoped globally by `name` rather than to a wrapper
  // element, since the exact Change Password modal's own wrapper class
  // wasn't pinned down and these names are unique on the page anyway.
  readonly changePasswordButton: Locator;
  readonly oldPasswordInput: Locator;
  readonly newPasswordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly updatePasswordButton: Locator;

  readonly usernameInput: Locator;
  readonly phoneInput: Locator;
  readonly emailInput: Locator;
  readonly cityInput: Locator;
  readonly streetInput: Locator;
  readonly zipCodeInput: Locator;

  private consoleErrors: string[] = [];

  constructor(page: Page) {
    this.page = page;
    this.page.on('console', (msg) => {
      // Excludes 429s specifically — see BrandContentPage.ts's constructor
      // comment for why (test-speed noise, not a real defect).
      if (msg.type() === 'error' && !/status of 429/.test(msg.text())) this.consoleErrors.push(msg.text());
    });

    this.depositButton = page.getByRole('button', { name: 'Deposit' });
    // The account-menu popup has its own "Total Balance" element using a
    // similarly-named CSS module — filtering for the container that
    // actually holds the Deposit button picks the header one specifically.
    this.balanceContainer = page.locator('[class*="Balance_container"]').filter({ has: this.depositButton });
    this.notificationsButton = page.locator('[class*="Navbar_inboxWrapper"]');
    this.avatarButton = page.locator('[class*="UserAvatar_headerContainer"]');
    this.accountMenu = page.locator('[class*="UserProfilePopUp_container"]');
    this.accountMenuLinks = this.accountMenu.locator('a[class*="UserProfileLinks_link"]');

    this.depositModal = page.locator('[class*="CashierModal_modalWrapper"]');
    this.depositPaymentMethodsLabel = this.depositModal.getByText(/Payment Methods/i).first();
    this.depositModalCloseButton = this.depositModal.locator('[class*="IconButton_iconButton"]').first();

    this.changePasswordButton = page.getByRole('button', { name: 'Change password', exact: true });
    this.oldPasswordInput = page.locator('input[name="oldPassword"]');
    this.newPasswordInput = page.locator('input[name="newPassword"]');
    this.confirmPasswordInput = page.locator('input[name="confirmPassword"]');
    this.updatePasswordButton = page.getByRole('button', { name: 'Update Password' });

    this.usernameInput = page.locator('input[name="nickName"]');
    this.phoneInput = page.locator('input[name="phoneNumber"]');
    this.emailInput = page.locator('input[name="email"]');
    this.cityInput = page.locator('input[name="city"]');
    this.streetInput = page.locator('input[name="street"]');
    this.zipCodeInput = page.locator('input[name="zipCode"]');
  }

  /**
   * Same removal-based dismissal as `RegistrationPage.dismissPromoPopupIfPresent()`
   * — duplicated rather than shared, since this page object is for the
   * post-login area and `RegistrationPage` is intentionally left untouched.
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
   * Second-stage UI check, run right after each functional check. Waits
   * for the page to genuinely finish rendering (networkidle, capped
   * short at 3s — a logged-in session has persistent websocket/polling
   * connections for balance/notifications that would otherwise burn the
   * full default timeout on every single check + every <img> settled),
   * then checks for broken images, JS console errors, and horizontal
   * layout overflow before attaching the screenshot and a JSON report.
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
      }
      if (overflowPx > 0) {
        await logStep(`Horizontal overflow: ${overflowPx}px wider than the viewport`, Status.BROKEN);
      }
      if (consoleErrors.length > 0) {
        await logStep(`Browser console errors: ${consoleErrors.slice(0, 3).join(' | ')}`, Status.BROKEN);
      }
    });
  }

  async getBalanceText(): Promise<string> {
    return (await this.balanceContainer.textContent())?.trim() ?? '';
  }

  async expectBalanceVisible(): Promise<void> {
    await step('Verify the account balance is visible', async () => {
      await expect(this.balanceContainer).toBeVisible();
      await expect(this.balanceContainer).toContainText(/\$\s?[\d,]+/);
    });
  }

  async openDepositModal(): Promise<void> {
    await step('Open the Deposit modal', async () => {
      await this.dismissPromoPopupIfPresent();
      await this.depositButton.click();
      await expect(this.depositModal).toBeVisible();
    });
  }

  async expectDepositMethodsVisible(): Promise<void> {
    await step('Verify payment methods are listed (no payment submitted)', async () => {
      await expect(this.depositPaymentMethodsLabel).toBeVisible();
    });
  }

  async closeDepositModal(): Promise<void> {
    await step('Close the Deposit modal without depositing', async () => {
      await this.depositModalCloseButton.click();
      await expect(this.depositModal).toBeHidden();
    });
  }

  /**
   * Withdraw reuses the exact same `CashierModal_modalWrapper` popup as
   * Deposit — just entered via "Withdraw Now" on the Pending Withdrawals
   * page instead of the header's Deposit button. Confirmed live
   * 2026-08-26: 3 payment methods (Crypto, MuchBetter, Visa), amount
   * field ($100-$5000), a "Withdraw" submit button — never clicked.
   */
  async openWithdrawModal(): Promise<void> {
    await step('Open the Withdraw modal', async () => {
      await this.page.goto('/account/pending-withdrawals');
      await this.page.waitForLoadState('domcontentloaded');
      await this.dismissPromoPopupIfPresent();
      await this.page.getByRole('button', { name: 'Withdraw Now' }).click();
      await expect(this.depositModal).toBeVisible();
    });
  }

  async expectWithdrawMethodsVisible(): Promise<void> {
    await step('Verify payment methods are listed (no withdrawal submitted)', async () => {
      await expect(this.depositPaymentMethodsLabel).toBeVisible();
    });
  }

  async closeWithdrawModal(): Promise<void> {
    await step('Close the Withdraw modal without withdrawing', async () => {
      await this.depositModalCloseButton.click();
      await expect(this.depositModal).toBeHidden();
    });
  }

  /**
   * Opens the Change Password modal from the Profile Info tab. Its
   * "Update Password" button is only ever checked for staying disabled
   * (see `expectUpdatePasswordDisabled()`) — a real password change would
   * break every other suite's ability to log in via TEST_USER_PASSWORD,
   * so this page object has no method that actually clicks it.
   */
  async openChangePasswordModal(): Promise<void> {
    await step('Open the Change Password modal', async () => {
      await this.page.goto('/account/balance');
      await this.page.waitForLoadState('domcontentloaded');
      await this.dismissPromoPopupIfPresent();
      await this.changePasswordButton.click();
      await expect(this.oldPasswordInput).toBeVisible();
    });
  }

  async fillChangePasswordForm(data: { oldPassword: string; newPassword: string; confirmPassword: string }): Promise<void> {
    await step('Fill the change-password form', async () => {
      await this.oldPasswordInput.fill(data.oldPassword);
      await this.newPasswordInput.fill(data.newPassword);
      await this.confirmPasswordInput.fill(data.confirmPassword);
    });
  }

  async expectUpdatePasswordDisabled(): Promise<void> {
    await step('Verify Update Password stays disabled (no password change submitted)', async () => {
      await expect(this.updatePasswordButton).toBeDisabled();
    });
  }

  /**
   * Reads the Profile Info tab's current values for the fields this
   * suite treats as read-only (Username/Phone/Email) — never edited,
   * since changing Email in particular could break every other suite's
   * ability to log in as TEST_USER_EMAIL.
   */
  async getProfileInfo(): Promise<{ username: string; phone: string; email: string }> {
    await this.page.goto('/account/balance');
    await this.page.waitForLoadState('domcontentloaded');
    await this.dismissPromoPopupIfPresent();
    return {
      username: (await this.usernameInput.inputValue()) ?? '',
      phone: (await this.phoneInput.inputValue()) ?? '',
      email: (await this.emailInput.inputValue()) ?? '',
    };
  }

  /**
   * Fills and saves Street + Zip Code (City is deliberately left out — it
   * didn't persist in live testing 2026-08-26, unlike the other two,
   * possibly a country-linked autocomplete rather than free text; not
   * worth chasing further for this pass). Coordinate-based: the edit
   * pencil / save checkmark toggle in place with no distinguishing class
   * beyond the same generic `Icon_container` used everywhere on the site,
   * so there's no reliable locator — pinned to a 1280-wide viewport the
   * same way `AccountPage.spinKnownGame()` pins its own coordinates.
   *
   * Idempotent by design: once Street/Zip are saved, re-opening edit mode
   * leaves them disabled on a later visit (confirmed live 2026-08-26 —
   * looks like a one-time-edit lock, common for address fields tied to
   * KYC). If the current values already match `data`, editing is skipped
   * entirely and the current values are returned — persistence has
   * already been demonstrated by an earlier run, and re-attempting the
   * edit would just hang against the disabled inputs.
   */
  async updateAddressFields(data: { street: string; zipCode: string }): Promise<{ street: string; zipCode: string }> {
    return step('Update Street and Zip Code, then confirm they persisted', async () => {
      await this.page.goto('/account/balance');
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(2_000);
      await this.dismissPromoPopupIfPresent();

      const currentStreet = (await this.streetInput.inputValue()) ?? '';
      const currentZip = (await this.zipCodeInput.inputValue()) ?? '';
      if (currentStreet === data.street && currentZip === data.zipCode) {
        return { street: currentStreet, zipCode: currentZip };
      }

      await this.page.mouse.click(1141, 410); // edit pencil
      await this.page.waitForTimeout(1_000);
      // Street stayed disabled unless City is touched first too, even
      // though City's own value doesn't end up persisting — confirmed
      // live 2026-08-26. Filled anyway purely to unlock Street/Zip.
      await this.cityInput.fill('Dubai');
      await this.streetInput.fill(data.street);
      await this.zipCodeInput.fill(data.zipCode);
      await this.page.mouse.click(1141, 410); // save checkmark (same spot the pencil was)
      await this.page.waitForTimeout(2_000);

      await this.page.reload();
      await this.page.waitForLoadState('domcontentloaded');
      await this.dismissPromoPopupIfPresent();
      return {
        street: (await this.streetInput.inputValue()) ?? '',
        zipCode: (await this.zipCodeInput.inputValue()) ?? '',
      };
    });
  }

  async expectVerificationPageLoaded(): Promise<void> {
    await step('Open Verification and confirm the expected fields render', async () => {
      await this.page.goto('/account/verification');
      await this.page.waitForLoadState('domcontentloaded');
      await this.dismissPromoPopupIfPresent();
      await expect(this.page.getByText('Verification', { exact: true }).first()).toBeVisible();
      await expect(this.page.getByRole('button', { name: 'Next step' })).toBeVisible();
    });
  }

  /**
   * The Refer a Friend page (/refer_friend) shows a personal referral
   * link in a reusable "CopyTag" component — confirmed live 2026-08-26:
   * `<span class="CopyTag_value__<hash>">https://gcplaying0175.com/?modal=SignUp&c=...</span>`.
   * Checked for presence/format only — no click on the copy icon or the
   * social-share buttons, which would leave the page in a changed state
   * (clipboard, or an opened share dialog) for no test value.
   */
  async expectReferralLinkVisible(): Promise<void> {
    await step('Open Refer a Friend and confirm a referral link is shown', async () => {
      await this.page.goto('/refer_friend');
      await this.page.waitForLoadState('domcontentloaded');
      await this.dismissPromoPopupIfPresent();
      const referralLink = this.page.locator('[class*="CopyTag_value"]').first();
      await expect(referralLink).toBeVisible();
      await expect(referralLink).toContainText(/^https:\/\/.*\?modal=SignUp&c=/);
    });
  }

  async openNotifications(): Promise<void> {
    await step('Open the notifications panel', async () => {
      await this.dismissPromoPopupIfPresent();
      await this.notificationsButton.click();
    });
  }

  /**
   * The notifications panel is a third-party inbox widget rendered in its
   * own iframe (a Smartsupp-style CloudFront embed, `bridgeid="inboxWidget"`)
   * that stays open and covers its own trigger button, so re-clicking the
   * bell can't close it — confirmed live 2026-08-26. Removed the same way
   * as the promo popup: directly from the DOM. Must be called before
   * interacting with anything else in the header.
   */
  async closeNotifications(): Promise<void> {
    await step('Close the notifications panel', async () => {
      await this.page.evaluate(() => {
        document.querySelectorAll('iframe[bridgeid="inboxWidget"]').forEach((frame) => frame.remove());
      });
    });
  }

  async openAccountMenu(): Promise<void> {
    await step('Open the account menu', async () => {
      await this.dismissPromoPopupIfPresent();
      await this.avatarButton.click();
      await expect(this.accountMenu).toBeVisible();
    });
  }

  /**
   * Reads whatever account-menu sections are actually present (label +
   * href for each), rather than assuming a fixed list — see class-level
   * comment for what it showed live.
   */
  async getAccountMenuItems(): Promise<Array<{ label: string; href: string }>> {
    const links = await this.accountMenuLinks.all();
    const items: Array<{ label: string; href: string }> = [];
    for (const link of links) {
      const label = (await link.textContent())?.trim() ?? '';
      const href = (await link.getAttribute('href')) ?? '';
      if (label && href) items.push({ label, href });
    }
    return items;
  }

  /**
   * Navigates directly to an account-menu section's URL (rather than
   * re-opening the dropdown each time) — faster and avoids repeated
   * promo-popup interference for what's otherwise a simple page visit.
   */
  async visitAccountSection(href: string): Promise<void> {
    await step(`Visit account section: ${href}`, async () => {
      await this.page.goto(href);
      await this.page.waitForLoadState('domcontentloaded');
      await this.dismissPromoPopupIfPresent();
    });
  }

  /**
   * Clicks a main-nav pill by its visible label (Casino, Live Casino,
   * Jackpots, Providers, ... — confirmed live for the first 4; others in
   * the same row are attempted best-effort and skipped if not found,
   * since not every label was individually confirmed).
   */
  async openNavSection(label: string): Promise<boolean> {
    return step(`Open nav section: ${label}`, async () => {
      const item = this.page.locator('[class*="Navbar_navbar__container_item"]').filter({ hasText: label }).first();
      if (!(await item.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
      await this.dismissPromoPopupIfPresent();
      await item.click();
      await this.page.waitForTimeout(1_000);
      return true;
    });
  }

  /**
   * Reads game links from the current page (e.g. the lobby's Top Games
   * list, ~160 links confirmed live 2026-08-27) and returns the first
   * `limit` — discovery-driven rather than hardcoded, same idea as
   * `BrandContentPage.getProviderLinks()`. The link's own text is the
   * game's display name (confirmed live — not the "Play" overlay button's
   * accessible name, which is identical across every game).
   */
  async getGameLinks(limit: number): Promise<Array<{ name: string; href: string }>> {
    const links = this.page.locator('a[href*="/game/real/"]');
    const count = await links.count();
    const seen = new Set<string>();
    const results: Array<{ name: string; href: string }> = [];
    for (let i = 0; i < count && results.length < limit; i++) {
      const link = links.nth(i);
      const href = await link.getAttribute('href');
      if (href && !seen.has(href)) {
        seen.add(href);
        const name = (await link.textContent())?.trim() || href;
        results.push({ name, href });
      }
    }
    return results;
  }

  /**
   * Launches a game by href (from `getGameLinks()`).
   */
  async launchGame(href: string): Promise<void> {
    await step(`Launch game: ${href}`, async () => {
      await this.page.locator(`a[href="${href}"]`).first().click();
      await this.page.waitForTimeout(8_000);
      await this.dismissPromoPopupIfPresent();
    });
  }

  /**
   * Confirms the game reached a playable state: dismisses an HTML
   * intro/rules screen if one is shown (e.g. a "CONTINUE" button — this
   * part IS accessible DOM), then confirms the game iframe is visible.
   * Does NOT drive the game's own bet/spin controls, which render on an
   * opaque `<canvas>` — see class-level comment.
   */
  async expectGameReachedPlayableState(): Promise<void> {
    await step('Verify the game reached a playable state', async () => {
      const gameFrame = this.page.frameLocator('iframe').first();
      const continueButton = gameFrame.getByText('CONTINUE', { exact: false });
      if (await continueButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await continueButton.click();
        await this.page.waitForTimeout(2_000);
      }
      await expect(this.page.locator('iframe').first()).toBeVisible();
    });
  }

  /**
   * Places one real, minimum-bet spin on a specific, pre-confirmed game
   * ("Rock & Riches: Hold & Win", `/game/real/45933`) and reports the
   * balance before/after. Verified live 2026-08-26: reduces the default
   * $1.00 bet down to the game's $0.20 minimum via the "-" control, spins,
   * and the header balance moved from $100.00 to $99.80 — a real bet was
   * placed and paid out from the test account's actual balance.
   *
   * This is coordinate-based, not element-based — the game's bet/spin
   * controls render on an opaque `<canvas>` with no accessible DOM (same
   * constraint as `tests/game-providers.spec.ts`'s providers), so there's
   * no locator to click. The coordinates only hold for this exact game at
   * a 1280x800 viewport; a different game or a UI change would need new
   * coordinates, found the same way this page's own findings were: by
   * hand, screenshot-by-screenshot, not something generalizable to
   * "spin any game."
   */
  async spinKnownGame(): Promise<{ balanceBefore: string; balanceAfter: string }> {
    return step('Launch a known game and place one real minimum-bet spin', async () => {
      const balanceBefore = await this.getBalanceText();

      const gameLink = this.page.locator('a[href="/game/real/45933"]');
      await gameLink.click();
      await this.page.waitForTimeout(8_000);
      await this.dismissPromoPopupIfPresent();

      const gameFrame = this.page.frameLocator('iframe').first();
      const continueButton = gameFrame.getByText('CONTINUE', { exact: false });
      if (await continueButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await continueButton.click();
        await this.page.waitForTimeout(2_000);
      }

      // Reduce the bet to this game's minimum ($0.20) via the "-" control,
      // then spin — both coordinate-based, see method-level comment.
      for (let i = 0; i < 8; i++) {
        await this.page.mouse.click(636, 745);
        await this.page.waitForTimeout(300);
      }
      await this.page.mouse.click(1042, 745);
      await this.page.waitForTimeout(8_000);

      // The site header doesn't show a $ balance next to Deposit while a
      // game is open (only the game's own in-game counter does) —
      // navigate back to the lobby so balanceAfter reads from the same
      // header element balanceBefore did.
      await this.page.goBack();
      await this.page.waitForLoadState('domcontentloaded');
      await this.dismissPromoPopupIfPresent();
      const balanceAfter = await this.getBalanceText();
      return { balanceBefore, balanceAfter };
    });
  }
}
