import { expect, Locator, Page } from '@playwright/test';
import { attachment, step } from 'allure-js-commons';
import { ContentType } from 'allure-js-commons';

/**
 * Page object for everything that exists only *after* logging in — header
 * (balance/notifications/account menu), site navigation, the account
 * menu's own sub-sections, the deposit modal, and launching a game.
 * `RegistrationPage` owns the auth modal itself (signup/login); this page
 * object picks up from an already-authenticated session.
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

  constructor(page: Page) {
    this.page = page;

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

  async attachScreenshot(name: string): Promise<void> {
    const buffer = await this.page.screenshot({ fullPage: true });
    await attachment(name, buffer, ContentType.PNG);
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
   * Launches the first game link found on the current page (e.g. the
   * lobby's Top Games list) and returns its href for reporting.
   */
  async launchFirstGame(): Promise<string> {
    return step('Launch a game', async () => {
      const gameLink = this.page.locator('a[href*="/game/real/"]').first();
      const href = (await gameLink.getAttribute('href')) ?? '';
      await gameLink.click();
      await this.page.waitForTimeout(8_000);
      await this.dismissPromoPopupIfPresent();
      return href;
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
}
