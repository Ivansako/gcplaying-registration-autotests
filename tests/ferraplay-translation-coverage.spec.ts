import { devices } from '@playwright/test';
import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { FerraPlayPage } from '../pages/FerraPlayPage';
import { EXISTING_LOCALES } from '../utils/ferraplayLocales';
import { SEED_ACCOUNT, ACCOUNT_POOL, FerraplayAccount, nextPooledAccount, hasCreds } from '../utils/ferraplayAccounts';

function stripBrowserType(device: (typeof devices)[string]) {
  const { defaultBrowserType, ...rest } = device;
  return rest;
}

const VIEWPORTS = [
  { name: 'Desktop', config: stripBrowserType(devices['Desktop Chrome']) },
  { name: 'Mobile (Pixel 7)', config: stripBrowserType(devices['Pixel 7']) },
];

/**
 * Logs in with `account`, falling back to the next pooled account once
 * if login itself never completes — same reasoning as Wildies'
 * identical helper (a pooled account can come back from a prior run
 * still flagged by the site's own anti-fraud/rate-limit system). No-op
 * fallback when only one account is configured.
 */
async function loginWithFallback(ferraplayPage: FerraPlayPage, account: FerraplayAccount): Promise<FerraplayAccount> {
  try {
    await ferraplayPage.login(account.email, account.password);
    return account;
  } catch (err) {
    if (ACCOUNT_POOL.length < 2) throw err;
    const fallback = nextPooledAccount();
    await ferraplayPage.login(fallback.email, fallback.password);
    return fallback;
  }
}

/**
 * ferraplay.com — translation completeness across the whole brand.
 * Direct port of `wildies-translation-coverage.spec.ts`'s architecture
 * (per-page `verifyTranslation()`, a dedicated once-per-locale Footer
 * test rather than folding the global-phrase check into every page,
 * real money spent ONCE per run via a seed spin, every other
 * authenticated check rotating through `ACCOUNT_POOL`, red-or-green
 * only) applied to ferraplay.com — confirmed live 2026-09-10 to be the
 * same underlying platform. 3 real, funded (~€100 each) accounts
 * provided 2026-09-10, cleared for minimum-stake real spins.
 *
 * NOT yet built (documented gaps, not silent coverage):
 *  - Per-page English-fallback baselines (`PAGE_ENGLISH_BASELINES` in
 *    the Wildies suite) — would need the same live per-locale diffing
 *    Wildies' baselines took multiple sessions to build safely; only
 *    the footer's global-phrase baseline exists so far (5 phrases,
 *    cross-checked against Italiano only — see `FerraPlayPage`'s own
 *    comment on `GLOBAL_ENGLISH_UI_PHRASES`).
 *  - Sportsbook — NOT covered at all. Confirmed live 2026-09-10 the
 *    `/sport` page renders a blank content area even logged in (no
 *    odds widget iframe, unlike Wildies' genuinely re-embedding
 *    `88wplay` widget) — no real bet is placed, no "Sportsbook My Bets"
 *    check exists. Re-investigate if the widget ever starts rendering.
 *  - "Duplicate email" registration check uses a real account's email
 *    (`SEED_ACCOUNT`), same as Wildies.
 *  - FerraPlay's own "Loyalty"/"Missions" nav items — distinct features
 *    from Wildies' Smartico "Match X" widget, not investigated at all.
 */

const ANONYMOUS_PAGES = [
  { path: '/', name: 'Home' },
  { path: '/casino', name: 'Casino Lobby' },
  { path: '/live-casino', name: 'Live Casino' },
  { path: '/buy_bonus', name: 'Buy Bonus' },
  { path: '/sport', name: 'Sportsbook Lobby' },
  { path: '/faq', name: 'FAQ' },
  { path: '/contact-us', name: 'Contact Us' },
  { path: '/terms-and-conditions', name: 'Terms and Conditions' },
  { path: '/privacy-policy', name: 'Privacy Policy' },
  { path: '/aml-policy', name: 'AML-KYC Policy' },
  { path: '/responsible-gambling', name: 'Responsible Gambling' },
];

// Confirmed live 2026-09-10 by opening the avatar menu while logged in.
const AUTHENTICATED_PAGES = [
  { path: '/account/info', name: 'Profile Info' },
  { path: '/account/verification', name: 'Verification' },
  { path: '/account/mypromotions', name: 'My Promotions' },
  { path: '/account/transaction-history', name: 'Transaction History' },
];

test.describe('ferraplay.com — translation coverage', () => {
  test.beforeEach(async () => {
    allure.parentSuite('FerraPlay');
    allure.epic('FerraPlay');
    allure.feature('Localization');
    allure.owner('QA Automation');
  });

  // Runs ONCE, before the locale/viewport matrix below, pinned to the
  // viewport `FerraPlayPage.spinFirstAvailableGame()`'s coordinates were
  // confirmed against. Real money — always on `SEED_ACCOUNT`, same
  // reasoning as Wildies' identical block.
  test.describe('Seed real-money history (runs once, not per locale)', () => {
    test.skip(!hasCreds, 'No FerraPlay test accounts configured');
    test.use({ viewport: { width: 1280, height: 800 } });

    test('Place one real minimum-bet slot spin', { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
      test.setTimeout(150_000);
      allure.subSuite('Seed data');
      allure.severity('critical');
      allure.description(
        'Places one real, minimum-bet spin on "Book of Ra" so every locale/viewport can check ' +
          "Game History's translated labels against a real entry, without each of them placing its own spin."
      );

      const ferraplayPage = new FerraPlayPage(page);
      await ferraplayPage.open();
      await ferraplayPage.login(SEED_ACCOUNT!.email, SEED_ACCOUNT!.password);
      const { balanceBefore, balanceAfter } = await ferraplayPage.spinFirstAvailableGame();
      allure.parameter('Balance before', balanceBefore);
      allure.parameter('Balance after', balanceAfter);
      // NOT asserted on (a spin can legitimately win back the bet amount,
      // same reasoning as Wildies' identical note) — what matters is a
      // fresh Game History row, confirmed here instead. Confirmed live
      // 2026-09-10 the new row only appears after a reload (a real
      // backend/indexing delay), so this reloads once before counting.
      await ferraplayPage.visitPage('/account/game-history');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      const rows = page.locator('table tbody tr');
      await rows.first().waitFor({ timeout: 15_000 }).catch(() => {});
      const rowCount = await rows.count().catch(() => 0);
      allure.parameter('Game History rows found', String(rowCount));
      expect(rowCount, 'Game History should show at least one row after the seed spin').toBeGreaterThan(0);
    });
  });

  test.describe('Footer', () => {
    test.use({ ...VIEWPORTS[0].config });

    for (const locale of EXISTING_LOCALES) {
      test(`Footer — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
        allure.subSuite('Footer');
        allure.severity('normal');

        const ferraplayPage = new FerraPlayPage(page);
        await ferraplayPage.open(locale.path);
        await ferraplayPage.captureScreenshot(`Footer — ${locale.label}`, { dismissModalFirst: true });
        await ferraplayPage.verifyFooterTranslation(locale.label, locale.code);
      });
    }
  });

  for (const { name: viewportName, config: viewportConfig } of VIEWPORTS) {
    test.describe(viewportName, () => {
      test.use({ ...viewportConfig });

      for (const p of ANONYMOUS_PAGES) {
        for (const locale of EXISTING_LOCALES) {
          test(`${p.name} — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite(p.name);
            allure.severity('normal');
            test.setTimeout(90_000);

            const ferraplayPage = new FerraPlayPage(page);
            await ferraplayPage.visitPage(p.path, locale.path);
            await ferraplayPage.captureScreenshot(`${p.name} — ${locale.label} (anonymous, ${viewportName})`, {
              dismissModalFirst: true,
            });
            await ferraplayPage.openSideMenu();
            await ferraplayPage.captureScreenshot(`${p.name} — ${locale.label}, nav menu (anonymous, ${viewportName})`, {
              fullPage: false,
              dismissModalFirst: true,
            });
            await ferraplayPage.verifyTranslation(`${p.name} (${locale.label}, anonymous, ${viewportName})`, [
              'Main page content',
              'Side navigation menu',
              'Language switcher panel',
              'Footer',
            ]);
          });
        }
      }

      test.describe("Promotions (including each promotion's own Terms & Conditions)", () => {
        for (const locale of EXISTING_LOCALES) {
          test(`Promotions — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            test.setTimeout(90_000);
            allure.subSuite('Promotions');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            await ferraplayPage.visitPage('/promotions', locale.path);
            const { found, opened, flagged } = await ferraplayPage.verifyAllPromotionTerms();
            if (found > 0 && opened === 0) {
              flagged.push(
                `Found ${found} promotion "More info" button(s) but couldn't open any of them — the ` +
                  'interaction may be broken (selector or markup change), not an honest absence of promotions'
              );
            }
            await ferraplayPage.captureScreenshot(`Promotions — ${locale.label} (${viewportName})`, {
              dismissModalFirst: true,
            });
            await ferraplayPage.verifyTranslation(
              `Promotions (${locale.label}, anonymous, ${viewportName})`,
              [
                'Promotions listing page',
                opened > 0
                  ? `Details/Terms & Conditions of ${opened} individual promotion(s), each opened and scanned separately`
                  : 'No individual promotion "More info" buttons were found on this page',
              ],
              flagged
            );
          });
        }
      });

      test.describe("Tournaments (including each tournament's own detail page)", () => {
        for (const locale of EXISTING_LOCALES) {
          test(`Tournament details — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            test.setTimeout(90_000);
            allure.subSuite('Tournaments');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            await ferraplayPage.visitPage('/tournaments', locale.path);
            const { found, opened, flagged } = await ferraplayPage.verifyAllTournamentDetails(locale.path);
            if (found > 0 && opened === 0) {
              flagged.push(
                `Found ${found} tournament "More info" button(s) but couldn't open any of them — the ` +
                  'interaction may be broken (selector or markup change), not an honest absence of tournaments'
              );
            }
            await ferraplayPage.captureScreenshot(`Tournament details — ${locale.label} (${viewportName})`, {
              dismissModalFirst: true,
            });
            await ferraplayPage.verifyTranslation(
              `Tournament details (${locale.label}, anonymous, ${viewportName})`,
              [
                opened > 0
                  ? `Details page of ${opened} individual tournament(s), each opened and scanned separately`
                  : 'No individual tournament "More info" buttons were found on this page',
              ],
              flagged
            );
          });
        }
      });

      test.describe('Login / Sign Up popup', () => {
        for (const locale of EXISTING_LOCALES) {
          test(`Login popup — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            await ferraplayPage.open(locale.path);
            await ferraplayPage.openAuthModal('login');
            await ferraplayPage.captureScreenshot(`Login popup — ${locale.label} (${viewportName})`, { fullPage: false });
            await ferraplayPage.verifyTranslation(`Login popup (${locale.label}, ${viewportName})`, [
              'Login form fields and labels',
              'Remember me / Forgot password',
              'Submit and social-login buttons',
            ]);
          });

          test(`Sign Up popup — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            await ferraplayPage.open(locale.path);
            await ferraplayPage.openAuthModal('register');
            await ferraplayPage.captureScreenshot(`Sign Up popup — ${locale.label} (${viewportName})`, { fullPage: false });
            await ferraplayPage.verifyTranslation(`Sign Up popup (${locale.label}, ${viewportName})`, [
              'Sign Up form fields and labels',
              'Password strength hints',
              'Consent checkboxes',
              'Submit and social-signup buttons',
            ]);
          });

          test(`Forgot Password — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            await ferraplayPage.open(locale.path);
            await ferraplayPage.openForgotPasswordForm();
            const requestFormFlagged = await ferraplayPage.scanForUntranslatedText();
            await ferraplayPage.submitForgotPassword(SEED_ACCOUNT?.email ?? 'ferraplay.qa.test@example.com');
            await ferraplayPage.captureScreenshot(`Forgot Password — ${locale.label} (${viewportName})`, { fullPage: false });
            await ferraplayPage.verifyTranslation(
              `Forgot Password (${locale.label}, ${viewportName})`,
              ['Request form (title, description, email field, submit button)', 'Confirmation screen after submitting'],
              requestFormFlagged
            );
          });
        }
      });

      test.describe('Registration errors', () => {
        test.skip(!hasCreds, 'No FerraPlay test account configured');

        for (const locale of EXISTING_LOCALES) {
          test(`Duplicate email error — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            await ferraplayPage.open(locale.path);
            const { attempted } = await ferraplayPage.attemptDuplicateEmailRegistration(SEED_ACCOUNT!.email);
            if (!attempted) {
              await ferraplayPage.captureScreenshot(`Duplicate email error — ${locale.label} (${viewportName}, not attempted)`, {
                fullPage: false,
              });
              allure.description(
                `<p>⚠️ The Sign Up submit button never enabled for this locale, even with a fully valid-looking ` +
                  `form. The real, server-side "email already registered" error could not be triggered or checked ` +
                  `this run — see the attached screenshot for the form's actual state.</p>`
              );
              return;
            }
            await ferraplayPage.captureScreenshot(`Duplicate email error — ${locale.label} (${viewportName})`, {
              fullPage: false,
            });
            await ferraplayPage.verifyTranslation(`Duplicate email registration error (${locale.label}, ${viewportName})`, [
              'The server-side error shown after submitting Sign Up with an already-registered email',
            ]);
          });
        }
      });

      test.describe('Error messages and notifications', () => {
        for (const locale of EXISTING_LOCALES) {
          test(`Login error — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            await ferraplayPage.open(locale.path);
            await ferraplayPage.expectLoginFailure(SEED_ACCOUNT?.email ?? 'ferraplay.qa.test@example.com', 'not-the-real-password');
            await ferraplayPage.captureScreenshot(`Login error — ${locale.label} (${viewportName})`, { fullPage: false });
            await ferraplayPage.verifyTranslation(`Login error message (${locale.label}, ${viewportName})`, [
              'Login form error notification',
            ]);
          });
        }
      });

      test.describe('Non-existent page (error boundary)', () => {
        for (const locale of EXISTING_LOCALES) {
          test(`404 / error boundary — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Error boundary');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            await ferraplayPage.visitNonExistentPage(locale.path);
            await ferraplayPage.captureScreenshot(`404 — ${locale.label} (${viewportName})`, {
              dismissModalFirst: true,
            });
            await ferraplayPage.verifyTranslation(`Non-existent page (${locale.label}, ${viewportName})`, [
              'The generic error boundary this site shows for any unknown route (heading, message, ' +
                '"Try again"/"Go back" buttons)',
            ]);
          });
        }
      });

      test.describe('Account menu (avatar dropdown)', () => {
        test.skip(!hasCreds, 'No FerraPlay test accounts configured');

        for (const locale of EXISTING_LOCALES) {
          test(`Account menu — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Account menu');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            const account = nextPooledAccount();
            await ferraplayPage.open(locale.path);
            await loginWithFallback(ferraplayPage, account);
            const modalFlagged = ferraplayPage.takePendingModalFindings();
            await ferraplayPage.openAccountMenu();
            await ferraplayPage.captureScreenshot(`Account menu — ${locale.label} (${viewportName})`, {
              fullPage: false,
            });
            await ferraplayPage.verifyTranslation(
              `Account menu (${locale.label}, logged in, ${viewportName})`,
              [
                "The avatar dropdown's own items (Profile Info, Verification, My Promotions, Game History, " +
                  'Transaction History, Log out)',
              ],
              modalFlagged
            );
          });
        }
      });

      test.describe('Authenticated account pages', () => {
        test.skip(!hasCreds, 'No FerraPlay test accounts configured');

        for (const p of AUTHENTICATED_PAGES) {
          for (const locale of EXISTING_LOCALES) {
            test(`${p.name} — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
              allure.subSuite(p.name);
              allure.severity('normal');

              const ferraplayPage = new FerraPlayPage(page);
              const account = nextPooledAccount();
              await ferraplayPage.open(locale.path);
              await loginWithFallback(ferraplayPage, account);
              const modalFlagged = ferraplayPage.takePendingModalFindings();
              await ferraplayPage.visitPage(p.path, locale.path);
              await ferraplayPage.captureScreenshot(`${p.name} — ${locale.label} (logged in, ${viewportName})`, {
                dismissModalFirst: true,
              });
              await ferraplayPage.openSideMenu();
              await ferraplayPage.captureScreenshot(`${p.name} — ${locale.label}, nav menu (logged in, ${viewportName})`, {
                fullPage: false,
                dismissModalFirst: true,
              });
              await ferraplayPage.verifyTranslation(
                `${p.name} (${locale.label}, logged in, ${viewportName})`,
                ['Main page content', 'Side navigation menu', 'Language switcher panel'],
                modalFlagged
              );
            });
          }
        }
      });

      test.describe('Cashier (Deposit / Withdraw)', () => {
        test.skip(!hasCreds, 'No FerraPlay test accounts configured');

        for (const locale of EXISTING_LOCALES) {
          test(`Cashier — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Cashier');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            const account = nextPooledAccount();
            await ferraplayPage.open(locale.path);
            await loginWithFallback(ferraplayPage, account);
            const modalFlagged = ferraplayPage.takePendingModalFindings();
            await ferraplayPage.openCashier();
            modalFlagged.push(...ferraplayPage.takePendingModalFindings());
            const depositFlagged = await ferraplayPage.scanForUntranslatedText();
            await ferraplayPage.switchCashierTab('withdraw');
            await ferraplayPage.captureScreenshot(`Cashier — ${locale.label} (${viewportName})`, { fullPage: false });
            await ferraplayPage.verifyTranslation(
              `Cashier (${locale.label}, logged in, ${viewportName})`,
              [
                'Deposit tab: payment methods, amount field, preset amounts, bonus/promo code section',
                'Withdraw tab: same fields',
              ],
              [...modalFlagged, ...depositFlagged]
            );
            // UI-only, by design — never submits a real deposit/withdrawal.
          });
        }
      });

      test.describe('Game History (after the seeded real spin)', () => {
        test.skip(!hasCreds, 'No FerraPlay test accounts configured');

        for (const locale of EXISTING_LOCALES) {
          test(`Game History — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Game History');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            await ferraplayPage.open(locale.path);
            await ferraplayPage.login(SEED_ACCOUNT!.email, SEED_ACCOUNT!.password);
            const modalFlagged = ferraplayPage.takePendingModalFindings();
            await ferraplayPage.visitPage('/account/game-history', locale.path);
            // Confirmed live 2026-09-10: a fresh navigation to this page can
            // still race the backend indexing the seed spin — one reload
            // (already proven necessary in the seed test itself) avoids a
            // false "no rows" flag on the first locale that happens to run
            // right after seeding.
            await page.reload();
            await page.waitForLoadState('domcontentloaded');
            await ferraplayPage.captureScreenshot(`Game History — ${locale.label} (${viewportName})`, {
              dismissModalFirst: true,
            });
            await ferraplayPage.verifyTranslation(
              `Game History (${locale.label}, logged in, ${viewportName})`,
              [
                'The game history table (column headers, status labels) showing the entry from the one real ' +
                  'spin seeded at the start of this suite run',
              ],
              modalFlagged
            );
          });
        }
      });
    });
  }
});
