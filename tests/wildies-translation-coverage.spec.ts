import { test, expect } from '../utils/testWithWildiesAuth';
import { allure } from 'allure-playwright';
import { WildiesPage } from '../pages/WildiesPage';
import { EXISTING_LOCALES } from '../utils/wildiesLocales';

const WILDIES_TEST_USER_EMAIL = process.env.WILDIES_TEST_USER_EMAIL;
const WILDIES_TEST_USER_PASSWORD = process.env.WILDIES_TEST_USER_PASSWORD;

/**
 * beta.wildies.com — translation completeness across the whole brand:
 * every anonymous-access page, then every authenticated account page,
 * checked in every locale currently live, for raw/untranslated text
 * leaking into the UI (see `WildiesPage.verifyTranslation()` for the
 * detection heuristic and how it writes its own Description). Complements
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
 * Page catalog confirmed live 2026-08-28 via the anonymous nav, footer,
 * and (logged in as WILDIES_TEST_USER_EMAIL) the account menu. Not
 * exhaustive of literally every URL on the brand — individual game
 * pages and each of the ~50 provider pages are out of scope (third-party
 * content, not this brand's own translations) — but covers every
 * distinct page template a real visitor actually navigates through,
 * including drilling into each promotion's own Terms & Conditions on
 * the Promotions page.
 */

const ANONYMOUS_PAGES = [
  { path: '/', name: 'Home' },
  { path: '/casino', name: 'Casino Lobby' },
  { path: '/live-casino', name: 'Live Casino' },
  { path: '/buy_bonus', name: 'Buy Bonus' },
  { path: '/sport', name: 'Sportsbook Lobby' },
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

  for (const p of ANONYMOUS_PAGES) {
    for (const locale of EXISTING_LOCALES) {
      test(`${p.name} — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
        allure.subSuite(p.name);
        allure.severity('normal');

        const wildiesPage = new WildiesPage(page);
        await wildiesPage.visitPage(p.path, locale.path);
        await wildiesPage.openSideMenu(); // opens the nav drawer + language switcher panel too
        await wildiesPage.verifyTranslation(`${p.name} (${locale.label}, anonymous)`, [
          'Main page content',
          'Side navigation menu',
          'Language switcher panel',
          'Footer',
        ]);
        await wildiesPage.captureScreenshot(`${p.name} — ${locale.label} (anonymous)`);
      });
    }
  }

  test.describe('Promotions (including each promotion\'s own Terms & Conditions)', () => {
    for (const locale of EXISTING_LOCALES) {
      test(`Promotions — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
        allure.subSuite('Promotions');
        allure.severity('normal');

        const wildiesPage = new WildiesPage(page);
        await wildiesPage.visitPage('/promotions', locale.path);
        const { opened, flagged } = await wildiesPage.verifyAllPromotionTerms();
        await wildiesPage.verifyTranslation(
          `Promotions (${locale.label}, anonymous)`,
          [
            'Promotions listing page',
            opened > 0
              ? `Details/Terms & Conditions of ${opened} individual promotion(s), each opened and scanned separately`
              : 'No individual promotion "More info" buttons were found on this page',
          ],
          flagged
        );
        await wildiesPage.captureScreenshot(`Promotions — ${locale.label}`);
      });
    }
  });

  test.describe('Authenticated account pages', () => {
    test.skip(
      !WILDIES_TEST_USER_EMAIL || !WILDIES_TEST_USER_PASSWORD,
      'WILDIES_TEST_USER_EMAIL / WILDIES_TEST_USER_PASSWORD not set'
    );

    for (const p of AUTHENTICATED_PAGES) {
      for (const locale of EXISTING_LOCALES) {
        test(`${p.name} — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
          allure.subSuite(p.name);
          allure.severity('normal');

          const wildiesPage = new WildiesPage(page);
          await wildiesPage.open(locale.path);
          await wildiesPage.login(WILDIES_TEST_USER_EMAIL!, WILDIES_TEST_USER_PASSWORD!);
          await wildiesPage.visitPage(p.path, locale.path);
          await wildiesPage.openSideMenu();
          await wildiesPage.verifyTranslation(`${p.name} (${locale.label}, logged in)`, [
            'Main page content',
            'Side navigation menu',
            'Language switcher panel',
          ]);
          await wildiesPage.captureScreenshot(`${p.name} — ${locale.label} (logged in)`);
        });
      }
    }
  });

  test.describe('Error messages and notifications', () => {
    test('Login error — English', { tag: ['@localization', '@translation'] }, async ({ page }) => {
      allure.subSuite('Login');
      allure.severity('normal');

      const wildiesPage = new WildiesPage(page);
      await wildiesPage.open('en');
      await wildiesPage.expectLoginFailure(WILDIES_TEST_USER_EMAIL || 'wiztest008@gmail.com', 'not-the-real-password');
      await wildiesPage.verifyTranslation('Login error message (English)', ['Login form error notification']);
      await wildiesPage.captureScreenshot('Login error — English');
    });
  });

  test.describe('Real gameplay and Game History', () => {
    test.skip(
      !WILDIES_TEST_USER_EMAIL || !WILDIES_TEST_USER_PASSWORD,
      'WILDIES_TEST_USER_EMAIL / WILDIES_TEST_USER_PASSWORD not set'
    );

    for (const locale of EXISTING_LOCALES) {
      test(`Game History after a real spin — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
        test.setTimeout(75_000);
        allure.subSuite('Game History (after a real spin)');
        allure.severity('critical');

        const wildiesPage = new WildiesPage(page);
        await wildiesPage.open(locale.path);
        await wildiesPage.login(WILDIES_TEST_USER_EMAIL!, WILDIES_TEST_USER_PASSWORD!);

        const gameLink = page.locator('a[href*="/game/real/"]').first();
        const href = await gameLink.getAttribute('href');
        await wildiesPage.launchGame(href!);
        await wildiesPage.expectGameReachedPlayableState();
        const spun = await wildiesPage.spinMinimumBet();

        await wildiesPage.visitPage('/account/game-history', locale.path);
        await wildiesPage.verifyTranslation(`Game History (${locale.label}, logged in)`, [
          spun
            ? 'The game history entry produced by the real spin just placed on this page'
            : "The existing game history list (a fresh spin could not be confirmed this run — see the " +
              'Description for why; this still validates whatever entries are present)',
        ]);
        await wildiesPage.captureScreenshot(`Game History — ${locale.label}`);
      });
    }
  });
});
