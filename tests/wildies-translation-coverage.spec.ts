import { devices } from '@playwright/test';
import { test, expect } from '../utils/testWithWildiesAuth';
import { allure } from 'allure-playwright';
import { WildiesPage } from '../pages/WildiesPage';
import { EXISTING_LOCALES, PENDING_LOCALES, WildiesLocale } from '../utils/wildiesLocales';

// Covers the 5 pending locales too, not just the 6 already live — each
// pending-locale test self-skips (see `ensureLocaleLive` below) until the
// site actually offers it, then starts running for real with no code
// change, same "ready ahead of time" design as
// `tests/wildies-localizations.spec.ts`. Caveat inherited from that file:
// `PENDING_LOCALES`' labels are an unconfirmed best guess (e.g. "Deutsch")
// — if the real dropdown ever shows a different native name, the
// live-check below would keep skipping even after deployment; re-confirm
// the label against `wildies-localizations.spec.ts`'s "Switcher lists
// every currently available locale" test output once each locale ships.
const ALL_LOCALES = [...EXISTING_LOCALES, ...PENDING_LOCALES];

/**
 * For a not-yet-live locale, skips the test with a clear reason instead of
 * navigating straight to its URL prefix (e.g. `/de/casino`) — that path's
 * behavior before the locale is deployed is unconfirmed (could 404, could
 * redirect), so this checks the dropdown from a known-good page (the
 * default-locale home) first. No-op for an already-live locale.
 */
async function ensureLocaleLive(wildiesPage: WildiesPage, locale: WildiesLocale): Promise<void> {
  if (!PENDING_LOCALES.some((p) => p.code === locale.code)) return;
  await wildiesPage.open();
  const labels = await wildiesPage.getAvailableLocaleLabels();
  test.skip(
    !labels.includes(locale.label),
    `"${locale.label}" not yet deployed — this test activates automatically once it ships, no code change needed`
  );
}

function stripBrowserType(device: (typeof devices)[string]) {
  const { defaultBrowserType, ...rest } = device;
  return rest;
}

// One representative mobile device, not the full 2-device spread
// `brand-content-pages.spec.ts` uses on gcplaying0175.com — this suite is
// already large (every page × every locale), and the goal here is
// specifically to catch a translated string breaking mobile layout, which
// one mobile viewport is enough to surface.
const VIEWPORTS = [
  { name: 'Desktop', config: stripBrowserType(devices['Desktop Chrome']) },
  { name: 'Mobile (Pixel 7)', config: stripBrowserType(devices['Pixel 7']) },
];

const WILDIES_TEST_USER_EMAIL = process.env.WILDIES_TEST_USER_EMAIL;
const WILDIES_TEST_USER_PASSWORD = process.env.WILDIES_TEST_USER_PASSWORD;
const hasCreds = !!WILDIES_TEST_USER_EMAIL && !!WILDIES_TEST_USER_PASSWORD;

/**
 * beta.wildies.com — translation completeness across the whole brand:
 * every anonymous-access page, the Cashier, the Login/Sign Up popups, then
 * every authenticated account page, checked in every locale currently
 * live PLUS every pending locale (self-skipping until each one actually
 * ships — see `ensureLocaleLive` above), for raw/untranslated text
 * leaking into the UI (see `WildiesPage.verifyTranslation()` for the
 * detection heuristic and how it writes its own Description) AND for a
 * translated string breaking the page's layout (checked at both a
 * desktop and a mobile viewport — see `VIEWPORTS` above). Complements
 * `tests/wildies-localizations.spec.ts` (which checks the switcher
 * mechanics itself — URL scheme, dropdown options, `<html lang>` — not
 * page content).
 *
 * UI/i18n content only, by explicit request (2026-08-28) — no orange/
 * Broken status anywhere in this suite (a generic technical finding like
 * a console error isn't what this suite exists to catch), and every
 * test's Description always states what was actually examined before
 * stating any problem found, whether the test passes or fails.
 *
 * Suites tree is grouped by PAGE (`allure.subSuite(pageName)` set
 * per-test), not lumped under one flat "Localizations" bucket — so
 * "Casino Lobby", "Promotions", etc. each show every locale check
 * together, matching how a person would actually want to browse this
 * report.
 *
 * Real money, spent ONCE per suite run, not once per locale (2026-08-29):
 * one minimum-bet slot spin and one minimum-stake sportsbook bet are
 * placed up front (see the "Seed real-money history" block below, pinned
 * to Desktop), then every locale × viewport combination for Game History
 * and Sportsbook My Bets just navigates to that already-seeded entry and
 * checks its labels are translated — the entry's own data doesn't change
 * per locale, only the labels/date formatting around it do, so re-betting
 * per locale would only multiply real-money spend for no extra signal.
 *
 * Page catalog confirmed live 2026-08-28/29 via the anonymous nav,
 * footer, and (logged in as WILDIES_TEST_USER_EMAIL) the account menu.
 * Not exhaustive of literally every URL on the brand — individual game
 * pages and each of the ~50 provider pages are out of scope (third-party
 * content, not this brand's own translations) — but covers every
 * distinct page template a real visitor actually navigates through,
 * including drilling into each promotion's own Terms & Conditions on the
 * Promotions page, the sportsbook's own odds/bet-slip widget (a
 * cross-origin iframe, confirmed to genuinely re-embed in the site's own
 * locale — real, checkable content, not a third-party black box), and
 * the Cashier's Deposit/Withdraw tabs (never submitted for real, same
 * safety pattern as every other form check in this repo).
 */

const ANONYMOUS_PAGES = [
  { path: '/', name: 'Home' },
  { path: '/casino', name: 'Casino Lobby' },
  { path: '/live-casino', name: 'Live Casino' },
  { path: '/buy_bonus', name: 'Buy Bonus' },
  { path: '/tournaments', name: 'Tournaments' },
  { path: '/faq', name: 'FAQ' },
  { path: '/contact-us', name: 'Contact Us' },
  { path: '/terms-and-conditions', name: 'Terms and Conditions' },
  { path: '/privacy-policy', name: 'Privacy Policy' },
  { path: '/aml-policy', name: 'AML-KYC Policy' },
  { path: '/responsible-gambling', name: 'Responsible Gambling' },
];

// Confirmed live 2026-08-28 by opening the avatar menu while logged in as
// WILDIES_TEST_USER_EMAIL.
const AUTHENTICATED_PAGES = [
  { path: '/account/info', name: 'Profile Info' },
  { path: '/account/verification', name: 'Verification' },
  { path: '/account/mypromotions', name: 'My Promotions' },
  { path: '/account/transaction-history', name: 'Transaction History' },
];

test.describe('beta.wildies.com — translation coverage', () => {
  test.beforeEach(async () => {
    allure.parentSuite('Wildies');
    allure.epic('Wildies');
    allure.feature('Translation coverage');
    allure.owner('QA Automation');
  });

  // Runs ONCE, before the locale/viewport matrix below, pinned to the
  // viewport `WildiesPage.spinFirstAvailableGame()`'s coordinates were
  // confirmed against. Real money — see the class-level comment above for
  // why this only happens once per run.
  test.describe('Seed real-money history (runs once, not per locale)', () => {
    test.skip(!hasCreds, 'WILDIES_TEST_USER_EMAIL / WILDIES_TEST_USER_PASSWORD not set');
    test.use({ viewport: { width: 1280, height: 800 } });

    test('Place one real minimum-bet slot spin', { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
      test.setTimeout(90_000);
      allure.subSuite('Seed data');
      allure.severity('critical');
      allure.description(
        'Places one real, minimum-bet spin on the first available slot so every locale/viewport can check ' +
          "Game History's translated labels against a real entry, without each of them placing its own spin."
      );

      const wildiesPage = new WildiesPage(page);
      await wildiesPage.open();
      await wildiesPage.login(WILDIES_TEST_USER_EMAIL!, WILDIES_TEST_USER_PASSWORD!);
      const { balanceBefore, balanceAfter } = await wildiesPage.spinFirstAvailableGame();
      allure.parameter('Balance before', balanceBefore);
      allure.parameter('Balance after', balanceAfter);
      expect(balanceAfter, 'Balance should change after a real spin').not.toBe(balanceBefore);
    });

    test('Place one real minimum-stake sportsbook bet', { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
      test.setTimeout(60_000);
      allure.subSuite('Seed data');
      allure.severity('critical');
      allure.description(
        'Places one real, minimum-stake bet on a pre-match sportsbook event so every locale/viewport can check ' +
          "the sportsbook widget's own \"My Bets\" tab against a real entry, without each of them placing its own bet."
      );

      const wildiesPage = new WildiesPage(page);
      await wildiesPage.open();
      await wildiesPage.login(WILDIES_TEST_USER_EMAIL!, WILDIES_TEST_USER_PASSWORD!);
      const { event } = await wildiesPage.placeMinimumSportsbookBet();
      allure.parameter('Event backed', event ?? 'none found');
      expect(event, 'A non-live event should have been found and bet on').not.toBeNull();
    });
  });

  for (const { name: viewportName, config: viewportConfig } of VIEWPORTS) {
    test.describe(viewportName, () => {
      test.use({ ...viewportConfig });

      for (const p of ANONYMOUS_PAGES) {
        for (const locale of ALL_LOCALES) {
          test(`${p.name} — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite(p.name);
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.visitPage(p.path, locale.path);
            await wildiesPage.openSideMenu(); // opens the nav drawer + language switcher panel too
            await wildiesPage.verifyTranslation(`${p.name} (${locale.label}, anonymous, ${viewportName})`, [
              'Main page content',
              'Side navigation menu',
              'Language switcher panel',
              'Footer',
            ]);
            await wildiesPage.captureScreenshot(`${p.name} — ${locale.label} (anonymous, ${viewportName})`);
          });
        }
      }

      test.describe("Sportsbook lobby (including the odds widget)", () => {
        for (const locale of ALL_LOCALES) {
          test(`Sportsbook Lobby — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Sportsbook Lobby');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.visitPage('/sport', locale.path);
            await page.waitForTimeout(8_000); // the widget iframe is slow to hydrate
            const frameFlagged = await wildiesPage.scanFrameForUntranslatedText(wildiesPage.sportsbookFrame);
            // No openSideMenu() here — confirmed live 2026-08-29: this
            // page type hides the header's burger icon on mobile (its own
            // bottom nav takes over instead), unlike every other page in
            // this suite. The side menu itself is already covered by every
            // other page's check; this test's own focus is the sportsbook
            // widget.
            await wildiesPage.verifyTranslation(
              `Sportsbook Lobby (${locale.label}, anonymous, ${viewportName})`,
              [
                'Main page content and navigation',
                "The odds/events widget itself (sport tabs, match cards, market names) — a cross-origin " +
                  'third-party widget confirmed to re-embed in this same locale',
              ],
              frameFlagged
            );
            await wildiesPage.captureScreenshot(`Sportsbook Lobby — ${locale.label} (${viewportName})`);
          });
        }
      });

      test.describe("Promotions (including each promotion's own Terms & Conditions)", () => {
        for (const locale of ALL_LOCALES) {
          test(`Promotions — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Promotions');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.visitPage('/promotions', locale.path);
            const { opened, flagged } = await wildiesPage.verifyAllPromotionTerms();
            await wildiesPage.verifyTranslation(
              `Promotions (${locale.label}, anonymous, ${viewportName})`,
              [
                'Promotions listing page',
                opened > 0
                  ? `Details/Terms & Conditions of ${opened} individual promotion(s), each opened and scanned separately`
                  : 'No individual promotion "More info" buttons were found on this page',
              ],
              flagged
            );
            await wildiesPage.captureScreenshot(`Promotions — ${locale.label} (${viewportName})`);
          });
        }
      });

      test.describe('Login / Sign Up popup', () => {
        for (const locale of ALL_LOCALES) {
          test(`Login popup — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            await wildiesPage.openAuthModal('login');
            await wildiesPage.verifyTranslation(`Login popup (${locale.label}, ${viewportName})`, [
              'Login form fields and labels',
              'Remember me / Forgot password',
              'Submit and social-login buttons',
            ]);
            await wildiesPage.captureScreenshot(`Login popup — ${locale.label} (${viewportName})`);
          });

          test(`Sign Up popup — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            await wildiesPage.openAuthModal('register');
            await wildiesPage.verifyTranslation(`Sign Up popup (${locale.label}, ${viewportName})`, [
              'Sign Up form fields and labels',
              'Password strength hints',
              'Consent checkboxes',
              'Submit and social-signup buttons',
            ]);
            await wildiesPage.captureScreenshot(`Sign Up popup — ${locale.label} (${viewportName})`);
          });
        }
      });

      test.describe('Error messages and notifications', () => {
        for (const locale of ALL_LOCALES) {
          test(`Login error — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            await wildiesPage.expectLoginFailure(WILDIES_TEST_USER_EMAIL || 'wiztest008@gmail.com', 'not-the-real-password');
            await wildiesPage.verifyTranslation(`Login error message (${locale.label}, ${viewportName})`, [
              'Login form error notification',
            ]);
            await wildiesPage.captureScreenshot(`Login error — ${locale.label} (${viewportName})`);
          });
        }
      });

      test.describe('Authenticated account pages', () => {
        test.skip(!hasCreds, 'WILDIES_TEST_USER_EMAIL / WILDIES_TEST_USER_PASSWORD not set');

        for (const p of AUTHENTICATED_PAGES) {
          for (const locale of ALL_LOCALES) {
            test(`${p.name} — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
              allure.subSuite(p.name);
              allure.severity('normal');

              const wildiesPage = new WildiesPage(page);
              await ensureLocaleLive(wildiesPage, locale);
              await wildiesPage.open(locale.path);
              await wildiesPage.login(WILDIES_TEST_USER_EMAIL!, WILDIES_TEST_USER_PASSWORD!);
              await wildiesPage.visitPage(p.path, locale.path);
              await wildiesPage.openSideMenu();
              await wildiesPage.verifyTranslation(`${p.name} (${locale.label}, logged in, ${viewportName})`, [
                'Main page content',
                'Side navigation menu',
                'Language switcher panel',
              ]);
              await wildiesPage.captureScreenshot(`${p.name} — ${locale.label} (logged in, ${viewportName})`);
            });
          }
        }
      });

      test.describe('Cashier (Deposit / Withdraw)', () => {
        test.skip(!hasCreds, 'WILDIES_TEST_USER_EMAIL / WILDIES_TEST_USER_PASSWORD not set');

        for (const locale of ALL_LOCALES) {
          test(`Cashier — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Cashier');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            await wildiesPage.login(WILDIES_TEST_USER_EMAIL!, WILDIES_TEST_USER_PASSWORD!);
            await wildiesPage.openCashier();
            const depositFlagged = await wildiesPage.scanForUntranslatedText();
            await wildiesPage.switchCashierTab('withdraw');
            await wildiesPage.verifyTranslation(
              `Cashier (${locale.label}, logged in, ${viewportName})`,
              [
                'Deposit tab: payment methods, amount field, preset amounts, bonus/promo code section',
                'Withdraw tab: same fields',
              ],
              depositFlagged
            );
            await wildiesPage.captureScreenshot(`Cashier — ${locale.label} (${viewportName})`);
            // UI-only, by design — never submits a real deposit/withdrawal
            // (same safety pattern as every other cashier check in this repo).
          });
        }
      });

      test.describe('Game History (after the seeded real spin)', () => {
        test.skip(!hasCreds, 'WILDIES_TEST_USER_EMAIL / WILDIES_TEST_USER_PASSWORD not set');

        for (const locale of ALL_LOCALES) {
          test(`Game History — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Game History');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            await wildiesPage.login(WILDIES_TEST_USER_EMAIL!, WILDIES_TEST_USER_PASSWORD!);
            await wildiesPage.visitPage('/account/game-history', locale.path);
            await wildiesPage.verifyTranslation(`Game History (${locale.label}, logged in, ${viewportName})`, [
              'The game history table (column headers, status labels) showing the entry from the one real ' +
                'spin seeded at the start of this suite run',
            ]);
            await wildiesPage.captureScreenshot(`Game History — ${locale.label} (${viewportName})`);
          });
        }
      });

      test.describe('Sportsbook My Bets (after the seeded real bet)', () => {
        test.skip(!hasCreds, 'WILDIES_TEST_USER_EMAIL / WILDIES_TEST_USER_PASSWORD not set');

        for (const locale of ALL_LOCALES) {
          test(`Sportsbook My Bets — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Sportsbook My Bets');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            await wildiesPage.login(WILDIES_TEST_USER_EMAIL!, WILDIES_TEST_USER_PASSWORD!);
            await wildiesPage.openSportsbookMyBets();
            const frameFlagged = await wildiesPage.scanFrameForUntranslatedText(wildiesPage.sportsbookFrame);
            await wildiesPage.verifyTranslation(
              `Sportsbook My Bets (${locale.label}, logged in, ${viewportName})`,
              [
                'The sportsbook widget\'s own "My Bets" tab, showing the bet placed at the start of this suite run',
              ],
              frameFlagged
            );
            await wildiesPage.captureScreenshot(`Sportsbook My Bets — ${locale.label} (${viewportName})`);
          });
        }
      });
    });
  }
});
