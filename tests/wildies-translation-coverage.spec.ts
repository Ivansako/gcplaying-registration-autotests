import { devices } from '@playwright/test';
import { test, expect } from '../utils/testWithWildiesAuth';
import { allure } from 'allure-playwright';
import { WildiesPage } from '../pages/WildiesPage';
import { EXISTING_LOCALES, PENDING_LOCALES, WildiesLocale } from '../utils/wildiesLocales';
import { SEED_ACCOUNT, ACCOUNT_POOL, WildiesAccount, nextPooledAccount } from '../utils/wildiesAccounts';

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

/**
 * Logs in with `account`, falling back to the next pooled account once if
 * the login itself never completes (the balance never appears — see
 * `WildiesPage.login()`) — confirmed live 2026-08-30 that a pooled account
 * can come back from a prior run still flagged by the site's own
 * anti-fraud/rate-limit system (login form submits fine, backend answers
 * 401, page stays on the logged-out header), which otherwise fails every
 * single test that happens to draw that account. A second consecutive
 * failure is a real problem (not just one flagged account) and is allowed
 * to fail the test normally. No-op fallback when only one account is
 * configured — retrying the same flagged credentials wouldn't help.
 */
async function loginWithFallback(wildiesPage: WildiesPage, account: WildiesAccount): Promise<WildiesAccount> {
  try {
    await wildiesPage.login(account.email, account.password);
    return account;
  } catch (err) {
    if (ACCOUNT_POOL.length < 2) throw err;
    const fallback = nextPooledAccount();
    await wildiesPage.login(fallback.email, fallback.password);
    return fallback;
  }
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

const hasCreds = !!SEED_ACCOUNT && ACCOUNT_POOL.length > 0;

/**
 * beta.wildies.com — translation completeness across the whole brand:
 * every anonymous-access page, the Cashier, the Login/Sign Up popups
 * (including Forgot Password and a real duplicate-email registration
 * attempt), the account avatar dropdown, every tournament's own detail
 * page, a non-existent-page error boundary, then every authenticated
 * account page, checked in every locale currently live PLUS every
 * pending locale (self-skipping until each one actually ships — see
 * `ensureLocaleLive` above), for raw/untranslated text leaking into the
 * UI (see `WildiesPage.verifyTranslation()` for the detection heuristic
 * and how it writes its own Description) AND for a translated string
 * breaking the page's layout (checked at both a desktop and a mobile
 * viewport — see `VIEWPORTS` above). Complements
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
 * to Desktop, always on `SEED_ACCOUNT`), then every locale × viewport
 * combination for Game History and Sportsbook My Bets just navigates to
 * that already-seeded entry and checks its labels are translated — the
 * entry's own data doesn't change per locale, only the labels/date
 * formatting around it do, so re-betting per locale would only multiply
 * real-money spend for no extra signal.
 *
 * Every OTHER authenticated check (Authenticated pages, Cashier, Forgot
 * Password, duplicate-email registration, account menu) rotates through
 * `ACCOUNT_POOL` via `nextPooledAccount()` instead of always using
 * `SEED_ACCOUNT` — added 2026-08-29 after a full run's ~90 sequential
 * logins on one account started tripping the site's own anti-fraud
 * rate-limit ("Credenziali errate" on genuinely correct credentials).
 * Spreading logins across multiple real accounts, none of which need any
 * balance (these checks never place a bet or spin), avoids concentrating
 * that load on any single one.
 *
 * A reactive popup (a "Level Up Reward Unlocked" toast was confirmed live
 * 2026-08-29 right after a real bet) is scanned by
 * `dismissModalIfPresent()` BEFORE it's closed, not just discarded — see
 * `WildiesPage.takePendingModalFindings()`, drained into `extraFlagged`
 * everywhere a test logs in or otherwise might trigger one.
 *
 * Page catalog confirmed live 2026-08-28/29 via the anonymous nav,
 * footer, and (logged in) the account menu. Not exhaustive of literally
 * every URL on the brand — individual game pages and each of the ~50
 * provider pages are out of scope (third-party content, not this brand's
 * own translations), and so is the "Notifications" panel from the
 * account menu specifically (confirmed live 2026-08-29 to be a
 * cross-origin third-party widget with no evidence it re-embeds per site
 * locale, unlike the sportsbook widget — see
 * `WildiesPage`'s note on `openAccountMenu()`) — but covers every
 * distinct page template a real visitor actually navigates through,
 * including drilling into each promotion's AND each tournament's own
 * details on their listing pages, the sportsbook's own odds/bet-slip
 * widget (a cross-origin iframe, confirmed to genuinely re-embed in the
 * site's own locale — real, checkable content, not a third-party black
 * box), and the Cashier's Deposit/Withdraw tabs (never submitted for
 * real, same safety pattern as every other form check in this repo).
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

// Confirmed live 2026-08-28 by opening the avatar menu while logged in.
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
  // why this only happens once per run, always on `SEED_ACCOUNT`.
  test.describe('Seed real-money history (runs once, not per locale)', () => {
    test.skip(!hasCreds, 'No Wildies test accounts configured');
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
      await wildiesPage.login(SEED_ACCOUNT!.email, SEED_ACCOUNT!.password);
      const { balanceBefore, balanceAfter } = await wildiesPage.spinFirstAvailableGame();
      allure.parameter('Balance before', balanceBefore);
      allure.parameter('Balance after', balanceAfter);
      // NOT asserted on: confirmed live 2026-08-29 that a spin can
      // legitimately win back exactly the bet amount, leaving the balance
      // unchanged — that's a real result, not evidence the spin failed to
      // register. What actually matters for the locale checks downstream
      // is a fresh row in Game History, confirmed here instead.
      await wildiesPage.visitPage('/account/game-history');
      const rows = page.locator('table tbody tr');
      await rows.first().waitFor({ timeout: 15_000 }).catch(() => {});
      const rowCount = await rows.count().catch(() => 0);
      allure.parameter('Game History rows found', String(rowCount));
      expect(rowCount, 'Game History should show at least one row after the seed spin').toBeGreaterThan(0);
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
      await wildiesPage.login(SEED_ACCOUNT!.email, SEED_ACCOUNT!.password);
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
            // Screenshot BEFORE the assertion: verifyTranslation() throws on
            // a real finding, and a screenshot taken only after it would
            // never run for exactly the tests where visual evidence matters
            // most (a red/failed one) — confirmed live 2026-08-30 that this
            // was silently the case for every failing test in the suite.
            await wildiesPage.captureScreenshot(`${p.name} — ${locale.label} (anonymous, ${viewportName})`);
            await wildiesPage.verifyTranslation(`${p.name} (${locale.label}, anonymous, ${viewportName})`, [
              'Main page content',
              'Side navigation menu',
              'Language switcher panel',
              'Footer',
            ]);
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
            await wildiesPage.captureScreenshot(`Sportsbook Lobby — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(
              `Sportsbook Lobby (${locale.label}, anonymous, ${viewportName})`,
              [
                'Main page content and navigation',
                "The odds/events widget itself (sport tabs, match cards, market names) — a cross-origin " +
                  'third-party widget confirmed to re-embed in this same locale',
              ],
              frameFlagged
            );
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
            const { found, opened, flagged } = await wildiesPage.verifyAllPromotionTerms();
            // A found-but-opened-none result means the "More info" buttons
            // exist but every single attempt to open one failed — almost
            // certainly a broken selector/interaction (a real regression to
            // investigate), not an honest "nothing here" — so this is
            // surfaced as its own red finding rather than silently
            // reported the same way as a page with no promotions at all.
            if (found > 0 && opened === 0) {
              flagged.push(
                `Found ${found} promotion "More info" button(s) but couldn't open any of them — the ` +
                  'interaction may be broken (selector or markup change), not an honest absence of promotions'
              );
            }
            await wildiesPage.captureScreenshot(`Promotions — ${locale.label} (${viewportName})`);
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
          });
        }
      });

      test.describe("Tournaments (including each tournament's own detail page)", () => {
        for (const locale of ALL_LOCALES) {
          test(`Tournament details — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Tournaments');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            const { found, opened, flagged } = await wildiesPage.verifyAllTournamentDetails(locale.path);
            // Same reasoning as the Promotions check above: found-but-
            // opened-none means the interaction is broken, not that there
            // are honestly no tournaments.
            if (found > 0 && opened === 0) {
              flagged.push(
                `Found ${found} tournament "More info" button(s) but couldn't open any of them — the ` +
                  'interaction may be broken (selector or markup change), not an honest absence of tournaments'
              );
            }
            await wildiesPage.captureScreenshot(`Tournament details — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(
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
        for (const locale of ALL_LOCALES) {
          test(`Login popup — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            await wildiesPage.openAuthModal('login');
            await wildiesPage.captureScreenshot(`Login popup — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(`Login popup (${locale.label}, ${viewportName})`, [
              'Login form fields and labels',
              'Remember me / Forgot password',
              'Submit and social-login buttons',
            ]);
          });

          test(`Sign Up popup — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            await wildiesPage.openAuthModal('register');
            await wildiesPage.captureScreenshot(`Sign Up popup — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(`Sign Up popup (${locale.label}, ${viewportName})`, [
              'Sign Up form fields and labels',
              'Password strength hints',
              'Consent checkboxes',
              'Submit and social-signup buttons',
            ]);
          });

          test(`Forgot Password — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            await wildiesPage.openForgotPasswordForm();
            const requestFormFlagged = await wildiesPage.scanForUntranslatedText();
            // Falls back to a fixed address rather than asserting on
            // SEED_ACCOUNT — confirmed via independent code review
            // 2026-08-30 that this test previously crashed with a
            // TypeError (not a clean skip) whenever no Wildies account was
            // configured, unlike every other credential-dependent test in
            // this file. This check doesn't actually need a real,
            // deliverable email either way — it's checking the form/
            // confirmation screen's translated text, not deliverability.
            await wildiesPage.submitForgotPassword(SEED_ACCOUNT?.email ?? 'wiztest008@gmail.com');
            await wildiesPage.captureScreenshot(`Forgot Password — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(
              `Forgot Password (${locale.label}, ${viewportName})`,
              ['Request form (title, description, email field, submit button)', 'Confirmation screen after submitting'],
              requestFormFlagged
            );
          });
        }
      });

      test.describe('Registration errors', () => {
        test.skip(!hasCreds, 'No Wildies test accounts configured');

        for (const locale of ALL_LOCALES) {
          test(`Duplicate email error — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            const { attempted } = await wildiesPage.attemptDuplicateEmailRegistration(SEED_ACCOUNT!.email);
            if (!attempted) {
              await wildiesPage.captureScreenshot(`Duplicate email error — ${locale.label} (${viewportName}, not attempted)`);
              allure.description(
                `<p>⚠️ The Sign Up submit button never enabled for this locale, even with a fully valid-looking ` +
                  `form (a known, unresolved limitation — see <code>attemptDuplicateEmailRegistration()</code>'s ` +
                  `comment). The real, server-side "email already registered" error could not be triggered or ` +
                  `checked this run — see the attached screenshot for the form's actual state.</p>`
              );
              return;
            }
            await wildiesPage.captureScreenshot(`Duplicate email error — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(`Duplicate email registration error (${locale.label}, ${viewportName})`, [
              'The server-side error shown after submitting Sign Up with an already-registered email',
            ]);
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
            await wildiesPage.expectLoginFailure(SEED_ACCOUNT?.email ?? 'wiztest008@gmail.com', 'not-the-real-password');
            await wildiesPage.captureScreenshot(`Login error — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(`Login error message (${locale.label}, ${viewportName})`, [
              'Login form error notification',
            ]);
          });
        }
      });

      test.describe('Non-existent page (error boundary)', () => {
        for (const locale of ALL_LOCALES) {
          test(`404 / error boundary — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Error boundary');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.visitNonExistentPage(locale.path);
            await wildiesPage.captureScreenshot(`404 — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(`Non-existent page (${locale.label}, ${viewportName})`, [
              'The generic error boundary this site shows for any unknown route (heading, message, ' +
                '"Try again"/"Go back" buttons) — confirmed live 2026-08-29 there is no dedicated themed 404 page',
            ]);
          });
        }
      });

      test.describe('Account menu (avatar dropdown)', () => {
        test.skip(!hasCreds, 'No Wildies test accounts configured');

        for (const locale of ALL_LOCALES) {
          test(`Account menu — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Account menu');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            const account = nextPooledAccount();
            await wildiesPage.open(locale.path);
            await loginWithFallback(wildiesPage, account);
            const modalFlagged = wildiesPage.takePendingModalFindings();
            await wildiesPage.openAccountMenu();
            await wildiesPage.captureScreenshot(`Account menu — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(
              `Account menu (${locale.label}, logged in, ${viewportName})`,
              [
                'The avatar dropdown\'s own items (Profile Info, Notifications, Verification, My Promotions, ' +
                  'Game History, Transaction History, Log out) — its "Notifications" entry opens a cross-origin ' +
                  'third-party widget not deep-scanned here, see the class-level comment for why',
              ],
              modalFlagged
            );
          });
        }
      });

      test.describe('Authenticated account pages', () => {
        test.skip(!hasCreds, 'No Wildies test accounts configured');

        for (const p of AUTHENTICATED_PAGES) {
          for (const locale of ALL_LOCALES) {
            test(`${p.name} — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
              allure.subSuite(p.name);
              allure.severity('normal');

              const wildiesPage = new WildiesPage(page);
              await ensureLocaleLive(wildiesPage, locale);
              const account = nextPooledAccount();
              await wildiesPage.open(locale.path);
              await loginWithFallback(wildiesPage, account);
              const modalFlagged = wildiesPage.takePendingModalFindings();
              await wildiesPage.visitPage(p.path, locale.path);
              await wildiesPage.openSideMenu();
              await wildiesPage.captureScreenshot(`${p.name} — ${locale.label} (logged in, ${viewportName})`);
              await wildiesPage.verifyTranslation(
                `${p.name} (${locale.label}, logged in, ${viewportName})`,
                ['Main page content', 'Side navigation menu', 'Language switcher panel'],
                modalFlagged
              );
            });
          }
        }
      });

      test.describe('Cashier (Deposit / Withdraw)', () => {
        test.skip(!hasCreds, 'No Wildies test accounts configured');

        for (const locale of ALL_LOCALES) {
          test(`Cashier — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Cashier');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            const account = nextPooledAccount();
            await wildiesPage.open(locale.path);
            await loginWithFallback(wildiesPage, account);
            const modalFlagged = wildiesPage.takePendingModalFindings();
            await wildiesPage.openCashier();
            modalFlagged.push(...wildiesPage.takePendingModalFindings());
            const depositFlagged = await wildiesPage.scanForUntranslatedText();
            await wildiesPage.switchCashierTab('withdraw');
            await wildiesPage.captureScreenshot(`Cashier — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(
              `Cashier (${locale.label}, logged in, ${viewportName})`,
              [
                'Deposit tab: payment methods, amount field, preset amounts, bonus/promo code section',
                'Withdraw tab: same fields',
              ],
              [...modalFlagged, ...depositFlagged]
            );
            // UI-only, by design — never submits a real deposit/withdrawal
            // (same safety pattern as every other cashier check in this repo).
          });
        }
      });

      test.describe('Game History (after the seeded real spin)', () => {
        test.skip(!hasCreds, 'No Wildies test accounts configured');

        for (const locale of ALL_LOCALES) {
          test(`Game History — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Game History');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            await wildiesPage.login(SEED_ACCOUNT!.email, SEED_ACCOUNT!.password);
            const modalFlagged = wildiesPage.takePendingModalFindings();
            await wildiesPage.visitPage('/account/game-history', locale.path);
            await wildiesPage.captureScreenshot(`Game History — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(
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

      test.describe('Sportsbook My Bets (after the seeded real bet)', () => {
        test.skip(!hasCreds, 'No Wildies test accounts configured');

        for (const locale of ALL_LOCALES) {
          test(`Sportsbook My Bets — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Sportsbook My Bets');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await ensureLocaleLive(wildiesPage, locale);
            await wildiesPage.open(locale.path);
            await wildiesPage.login(SEED_ACCOUNT!.email, SEED_ACCOUNT!.password);
            const modalFlagged = wildiesPage.takePendingModalFindings();
            await wildiesPage.openSportsbookMyBets();
            const frameFlagged = await wildiesPage.scanFrameForUntranslatedText(wildiesPage.sportsbookFrame);
            await wildiesPage.captureScreenshot(`Sportsbook My Bets — ${locale.label} (${viewportName})`);
            await wildiesPage.verifyTranslation(
              `Sportsbook My Bets (${locale.label}, logged in, ${viewportName})`,
              [
                'The sportsbook widget\'s own "My Bets" tab, showing the bet placed at the start of this suite run',
              ],
              [...modalFlagged, ...frameFlagged]
            );
          });
        }
      });
    });
  }
});
