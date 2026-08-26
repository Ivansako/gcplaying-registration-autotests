import { test } from '@playwright/test';
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
    // Default 45s doesn't leave room for 6 section visits + screenshots.
    test.setTimeout(90_000);

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
    // Default 45s doesn't leave room for ~7 section visits + screenshots.
    test.setTimeout(90_000);

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
});
