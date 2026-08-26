import { test, expect } from '@playwright/test';
import { allure } from 'allure-playwright';
import { RegistrationPage } from '../pages/RegistrationPage';
import { AccountPage } from '../pages/AccountPage';

/**
 * Comprehensive checks for an authenticated gcplaying0175.com session,
 * logging in with a pre-existing test account (TEST_USER_EMAIL /
 * TEST_USER_PASSWORD env vars — see .env, gitignored locally). Covers the
 * header (balance/deposit/notifications/account menu), main navigation,
 * the account menu's own sections (discovered live, not hardcoded — see
 * AccountPage.getAccountMenuItems()), and launching a game.
 *
 * Game launch can only confirm the game reaches a playable state — its
 * own bet/spin controls render on an opaque `<canvas>` inside a
 * cross-origin iframe with no accessible DOM (confirmed live 2026-08-26,
 * the same constraint already documented in tests/game-providers.spec.ts
 * for ferraplay.com's providers). A real spin needs the same one-time
 * manual investigation as that suite, not generic Playwright automation.
 */
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;

test.describe('gcplaying0175.com — authenticated account checks', () => {
  test.describe.configure({ retries: 0 });
  test.skip(!TEST_USER_EMAIL || !TEST_USER_PASSWORD, 'TEST_USER_EMAIL / TEST_USER_PASSWORD not set');

  test.beforeEach(async () => {
    allure.epic('Brand Test');
    allure.feature('Authenticated session');
    allure.owner('QA Automation');
  });

  async function loginAsTestUser(registrationPage: RegistrationPage): Promise<void> {
    await test.step('Log in with the test account', async () => {
      await registrationPage.open();
      await registrationPage.ensureLoggedOut();
      await registrationPage.loginWith(TEST_USER_EMAIL!, TEST_USER_PASSWORD!);
      await registrationPage.expectSuccess();
    });
  }

  test('Header shows balance, deposit, notifications, and account menu', { tag: ['@auth'] }, async ({ page }) => {
    // 4 UI checks, each waiting out a 3s networkidle cap (persistent
    // websocket keeps the authenticated session from ever going idle).
    test.setTimeout(75_000);

    allure.severity('critical');
    allure.description(
      'Balance is visible, Deposit opens a payment-methods list (never submitted — no real payment ' +
        'placed), the notifications panel opens, and the account menu opens.'
    );

    const registrationPage = new RegistrationPage(page);
    const accountPage = new AccountPage(page);
    await loginAsTestUser(registrationPage);

    await test.step('Balance is visible', async () => {
      await accountPage.expectBalanceVisible();
      await accountPage.attachScreenshot('Header — balance visible');
    });

    await test.step('Deposit modal shows payment methods (UI only)', async () => {
      await accountPage.openDepositModal();
      await accountPage.expectDepositMethodsVisible();
      await accountPage.attachScreenshot('Deposit modal — payment methods');
      await accountPage.closeDepositModal();
    });

    await test.step('Notifications panel opens', async () => {
      await accountPage.openNotifications();
      await accountPage.attachScreenshot('Notifications panel');
      await accountPage.closeNotifications();
    });

    await test.step('Account menu opens', async () => {
      await accountPage.openAccountMenu();
      await accountPage.attachScreenshot('Account menu open');
    });
  });

  test('Main navigation sections load for a logged-in user', { tag: ['@auth'] }, async ({ page }) => {
    // Default 45s doesn't leave room for 6 section visits + screenshots,
    // each now waiting out a 3s networkidle cap (persistent websocket).
    test.setTimeout(150_000);

    allure.severity('normal');
    allure.description(
      'Clicks through the main nav pills (Casino, Live Casino, Jackpots, Providers, Favorites, Recently ' +
        'Played) and screenshots each. Favorites/Recently Played are attempted best-effort and skipped if ' +
        "not found, since only the first four were individually confirmed live."
    );

    const registrationPage = new RegistrationPage(page);
    const accountPage = new AccountPage(page);
    await loginAsTestUser(registrationPage);

    const sections = ['Casino', 'Live Casino', 'Jackpots', 'Providers', 'Favorites', 'Recently Played'];
    for (const label of sections) {
      await test.step(`Open nav section: ${label}`, async () => {
        const opened = await accountPage.openNavSection(label);
        if (opened) {
          await accountPage.attachScreenshot(`Nav section — ${label}`);
        }
      });
    }
  });

  test('Account menu sections are reachable', { tag: ['@auth'] }, async ({ page }) => {
    // Default 45s doesn't leave room for ~7 section visits + screenshots,
    // each now waiting out a 3s networkidle cap (persistent websocket).
    test.setTimeout(150_000);

    allure.severity('normal');
    allure.description(
      'Opens the account menu, discovers whatever sections are actually listed (not hardcoded), and ' +
        'visits each one, screenshotting it.'
    );

    const registrationPage = new RegistrationPage(page);
    const accountPage = new AccountPage(page);
    await loginAsTestUser(registrationPage);

    const items = await test.step('Discover account menu sections', async () => {
      await accountPage.openAccountMenu();
      const found = await accountPage.getAccountMenuItems();
      allure.parameter('Discovered sections', found.map((i) => i.label).join(', '));
      return found;
    });

    for (const item of items) {
      await test.step(`Visit account section: ${item.label}`, async () => {
        await accountPage.visitAccountSection(item.href);
        await accountPage.attachScreenshot(`Account — ${item.label}`);
      });
    }
  });

  test('Launching a game reaches a playable state', { tag: ['@auth'] }, async ({ page }) => {
    // Game launch + the UI check's networkidle wait (a live game iframe
    // rarely goes idle, so it reliably eats the full 3s cap).
    test.setTimeout(60_000);

    allure.severity('normal');
    allure.description(
      "Launches a game from the lobby as the logged-in test user and confirms it reaches a playable " +
        "(canvas-rendered) state. Does not drive the game's own bet/spin controls — see file header comment."
    );

    const registrationPage = new RegistrationPage(page);
    const accountPage = new AccountPage(page);
    await loginAsTestUser(registrationPage);

    await test.step('Launch a game and verify it loads', async () => {
      const href = await accountPage.launchFirstGame();
      allure.parameter('Game', href);
      await accountPage.expectGameReachedPlayableState();
      await accountPage.attachScreenshot('Game — playable state reached');
    });
  });

  // Own describe: pins the viewport the spin's click coordinates were
  // confirmed against (see AccountPage.spinKnownGame()'s comment).
  test.describe('Real spin', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('A real spin decreases the balance (Rock & Riches: Hold & Win)', { tag: ['@auth'] }, async ({ page }) => {
      // Login + game load (8s) + bet-reduce clicks + spin wait (8s) don't
      // fit the default 45s.
      test.setTimeout(75_000);

      allure.severity('normal');
      allure.description(
        'Places one real, minimum-bet ($0.20) spin on a specific pre-confirmed game and verifies the ' +
          "test account's balance actually decreases — not just that the game opens. Coordinate-based " +
          '(the game renders on an opaque canvas), so scoped to this one game/viewport — see ' +
          'AccountPage.spinKnownGame() for why this approach is not generalizable to other games.'
      );

      const registrationPage = new RegistrationPage(page);
      const accountPage = new AccountPage(page);
      await loginAsTestUser(registrationPage);

      await test.step('Place a real spin and compare balance before/after', async () => {
        const { balanceBefore, balanceAfter } = await accountPage.spinKnownGame();
        allure.parameter('Balance before', balanceBefore);
        allure.parameter('Balance after', balanceAfter);
        await accountPage.attachScreenshot('After the spin');

        const parse = (text: string) => parseFloat(text.replace(/[^\d.]/g, ''));
        expect(parse(balanceAfter)).toBeLessThan(parse(balanceBefore));
      });
    });
  });
});
