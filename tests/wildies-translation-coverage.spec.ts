import { devices } from '@playwright/test';
import { test, expect } from '../utils/testWithWildiesAuth';
import { allure } from 'allure-playwright';
import { WildiesPage } from '../pages/WildiesPage';
import { EXISTING_LOCALES } from '../utils/wildiesLocales';
import { SEED_ACCOUNT, ACCOUNT_POOL, WildiesAccount, nextPooledAccount } from '../utils/wildiesAccounts';

// Fixed English UI strings from the Sportsbook "My Bets" tab — confirmed
// live 2026-08-30 that under Español the whole widget renders these
// verbatim instead of translating (see `scanFrameForEnglishFallback`'s
// comment for why `scanFrameForUntranslatedText` alone can't catch this).
// Multi-word only, to rule out coincidental overlap with another locale's
// real translation.
const SPORTSBOOK_ENGLISH_BASELINE = [
  'Bet Slip',
  'My Bets',
  'Repeat Selections',
  'Total Odds',
  'Total Stake',
  'Total Return',
  'Cash Out',
];

// Gamification widget's Levels tab — the Smartico integration is shared
// infrastructure across multiple brands, and per an internal reference
// doc (2026-09-02) there was a past incident where adding a new locale
// pulled level names from a DIFFERENT brand instead of Wildies' own —
// explicitly called out as never acceptable. Confirmed live 2026-09-02
// across all 9 currently-live locales (en/de/es/el/nl/fr/it/pt/fi) that
// the real names are exactly this list right now, unchanged regardless
// of locale (see `WildiesPage`'s own note on `openGamificationSection()`/
// `gamificationFrame` for why this widget doesn't follow site locale at
// all — that's a separate, already-known integration gap, not what this
// checks). This is a brand-identity regression guard, not a translation
// check: every name here is a literal product name, expected verbatim in
// every locale — if even one goes missing, the tab is either broken or
// has reverted to showing another brand's levels.
const WILDIES_LEVEL_NAMES = [
  'Wild Entry',
  'Wild Entry 2',
  'Wild Entry 3',
  'Wild Entry 4',
  'Wild Rising',
  'Wild Power',
  'Wild Supreme',
  'Ultimate Wild',
];

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
 * account page, checked in every locale currently live (all 10 from the
 * original rollout ticket, minus Norwegian, which was confirmed
 * 2026-09-02 to not be shipping), for raw/untranslated text leaking into
 * the UI (see `WildiesPage.verifyTranslation()` for the detection heuristic
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

/**
 * Per-page known-English baselines for `scanForEnglishFallback()` —
 * confirmed live 2026-09-02: each phrase was pulled from that page's OWN
 * content (never the shared header/footer, which is `GLOBAL_ENGLISH_UI_PHRASES`'
 * job via the separate "Footer" test above) and cross-checked against ALL
 * 9 non-English locales before being added, specifically to avoid a repeat
 * of the footer incident — a phrase that's identical-by-design across
 * locales (a retained loanword or industry term) would falsely flag every
 * locale as broken. Two candidates were dropped this way: "Live Lobby" /
 * "Game Shows" (Nederlands/Svenska genuinely keep these in English) and
 * "Customer/Enhanced Due Diligence" (Nederlands keeps standard compliance
 * terminology in English) — real, correct behavior, not translation bugs.
 *
 * "Buy Bonus" and "Tournaments" have no entry — confirmed live their own
 * content is too thin/generic (a handful of single common words like
 * "Active"/"Finished") to build a safe multi-word baseline from; adding
 * one would risk false positives rather than catch anything real.
 */
const PAGE_ENGLISH_BASELINES: Record<string, string[]> = {
  Home: ['Go Wild!', 'Finish your missions, grab your points'],
  'Casino Lobby': ['Casino Lobby', 'Instant Wins', 'Scratch Cards'],
  'Live Casino': ['High stakes'],
  FAQ: ['How to register?', 'I have forgotten my password', 'How can i see game history?'],
  'Contact Us': ['Live Chat whenever available', 'You can send us your questions 24 hours a day'],
  'Terms and Conditions': ['TERMS AND CONDITIONS', 'GENERAL TERMS'],
  'Privacy Policy': ['PRIVACY POLICY', 'LAWFUL BASIS FOR PROCESSING'],
  'AML-KYC Policy': [
    'ask for any KYC documentation it deems necessary',
    'restrict the service, payment, or withdrawal until identity is sufficiently determined',
  ],
  'Responsible Gambling': ['RESPONSIBLE GAMING POLICY', 'Player Protection Tools'],
};

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
      // Confirmed live 2026-08-31/09-01: `spinFirstAvailableGame()` already
      // has ~35s of deliberate fixed waits baked in (20s provider splash +
      // intro/bet-reduction/reel-settle), plus login and the post-spin
      // Game History check — under normal conditions that's already
      // ~55-60s before any real-world slowness. One run measured the spin
      // step alone at 71.8s (the underlying spin/money-spend/Game-History
      // update all succeeded — this was purely Playwright's own timeout
      // killing an otherwise-fine test), so 90s left almost no margin.
      test.setTimeout(150_000);
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

  // ONE test per locale, not folded into every page check below — see
  // `WildiesPage.GLOBAL_ENGLISH_UI_PHRASES`'s comment for why: the footer
  // is present on every page, so running this scan inside
  // `verifyTranslation()` turned one real missing translation into ~50
  // duplicate red tests (confirmed live 2026-09-02, a genuinely bad
  // report to hand anyone). Desktop only — footer copy doesn't depend on
  // viewport, so a second Mobile pass would just be more duplicate noise
  // for the same root cause.
  test.describe('Footer', () => {
    test.use({ ...VIEWPORTS[0].config });

    for (const locale of EXISTING_LOCALES) {
      test(`Footer — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
        allure.subSuite('Footer');
        allure.severity('normal');

        const wildiesPage = new WildiesPage(page);
        await wildiesPage.open(locale.path);
        await wildiesPage.captureScreenshot(`Footer — ${locale.label}`, { dismissModalFirst: true });
        await wildiesPage.verifyFooterTranslation(locale.label, locale.code);
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

            // Confirmed live 2026-09-02: bare "Test timeout of 45000ms
            // exceeded" with no other explanation, on a page that had
            // actually rendered completely correctly (e.g. Home, Live
            // Casino) — content-heavy pages (100+ games/providers listed)
            // now routinely take longer than the 45s default across
            // navigate + 2 screenshots + side menu + the translation scan.
            // Same fix already applied to Promotions/Tournaments below for
            // the same reason.
            test.setTimeout(90_000);

            const wildiesPage = new WildiesPage(page);
            await wildiesPage.visitPage(p.path, locale.path);
            // Screenshot BEFORE the assertion: verifyTranslation() throws on
            // a real finding, and a screenshot taken only after it would
            // never run for exactly the tests where visual evidence matters
            // most (a red/failed one) — confirmed live 2026-08-30 that this
            // was silently the case for every failing test in the suite.
            //
            // Two separate screenshots, content THEN nav — confirmed live
            // 2026-08-31: on mobile the nav drawer is a full-screen overlay,
            // so a single screenshot taken after `openSideMenu()` (the old
            // behavior) showed only the drawer and never the page content
            // it was supposed to be evidence for, on every single page ×
            // locale combination. `verifyTranslation()` itself was never
            // affected (it scans the DOM, not pixels — a covered element is
            // still "visible" in CSS terms) — this only fixes what a human
            // reviewing the report can actually see.
            await wildiesPage.captureScreenshot(`${p.name} — ${locale.label} (anonymous, ${viewportName})`, {
              dismissModalFirst: true,
            });
            await wildiesPage.openSideMenu(); // opens the nav drawer + language switcher panel too
            await wildiesPage.captureScreenshot(`${p.name} — ${locale.label}, nav menu (anonymous, ${viewportName})`, {
              fullPage: false,
              dismissModalFirst: true,
            });
            // Page-specific English-fallback check — see
            // `PAGE_ENGLISH_BASELINES`' own comment for how each baseline
            // was built and verified. Not every page has one (too little
            // distinctive content on Buy Bonus/Tournaments to check
            // safely); skipped for English itself, same reasoning as
            // every other baseline comparison in this suite.
            const pageBaseline = PAGE_ENGLISH_BASELINES[p.name];
            const englishFallbackFlagged =
              pageBaseline && locale.code !== 'en' ? await wildiesPage.scanForEnglishFallback(pageBaseline) : [];

            await wildiesPage.verifyTranslation(
              `${p.name} (${locale.label}, anonymous, ${viewportName})`,
              ['Main page content', 'Side navigation menu', 'Language switcher panel', 'Footer'],
              englishFallbackFlagged
            );
          });
        }
      }

      test.describe("Sportsbook lobby (including the odds widget)", () => {
        for (const locale of EXISTING_LOCALES) {
          test(`Sportsbook Lobby — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Sportsbook Lobby');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await wildiesPage.visitPage('/sport', locale.path);
            await page.waitForTimeout(8_000); // the widget iframe is slow to hydrate
            const frameFlagged = await wildiesPage.scanFrameForUntranslatedText(wildiesPage.sportsbookFrame);
            // No openSideMenu() here — confirmed live 2026-08-29: this
            // page type hides the header's burger icon on mobile (its own
            // bottom nav takes over instead), unlike every other page in
            // this suite. The side menu itself is already covered by every
            // other page's check; this test's own focus is the sportsbook
            // widget.
            await wildiesPage.captureScreenshot(`Sportsbook Lobby — ${locale.label} (${viewportName})`, {
              dismissModalFirst: true,
            });
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
        for (const locale of EXISTING_LOCALES) {
          test(`Promotions — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            // Confirmed live 2026-08-31: this discovery-driven check opens
            // EVERY promotion's own T&C, and the site now has enough of
            // them to exceed the config's default 45s on every locale —
            // a real timing issue, not a translation one (same reasoning
            // as Tournaments' identical bump below).
            test.setTimeout(90_000);
            allure.subSuite('Promotions');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
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
            await wildiesPage.captureScreenshot(`Promotions — ${locale.label} (${viewportName})`, {
              dismissModalFirst: true,
            });
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
        for (const locale of EXISTING_LOCALES) {
          test(`Tournament details — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            // Same reasoning as Promotions' identical bump above.
            test.setTimeout(90_000);
            allure.subSuite('Tournaments');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
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
            await wildiesPage.captureScreenshot(`Tournament details — ${locale.label} (${viewportName})`, {
              dismissModalFirst: true,
            });
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

      // None of this block's screenshots pass `dismissModalFirst` —
      // deliberately: Login/Sign Up/Forgot Password/the duplicate-email
      // and login-error states are ALL the same `[data-modal-overlay]`
      // dialog `dismissModalIfPresent()` would close, since it can't tell
      // "the intended modal" from "an unwanted one". They DO all pass
      // `fullPage: false` — confirmed live 2026-09-01 this modal doesn't
      // lock the page's own scroll, so `fullPage: true` scrolled past it
      // and pasted unrelated background page content below the fold
      // instead of the modal's own (dimmed) backdrop.
      test.describe('Login / Sign Up popup', () => {
        for (const locale of EXISTING_LOCALES) {
          test(`Login popup — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await wildiesPage.open(locale.path);
            await wildiesPage.openAuthModal('login');
            await wildiesPage.captureScreenshot(`Login popup — ${locale.label} (${viewportName})`, { fullPage: false });
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
            await wildiesPage.open(locale.path);
            await wildiesPage.openAuthModal('register');
            await wildiesPage.captureScreenshot(`Sign Up popup — ${locale.label} (${viewportName})`, { fullPage: false });
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
            await wildiesPage.captureScreenshot(`Forgot Password — ${locale.label} (${viewportName})`, { fullPage: false });
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

        for (const locale of EXISTING_LOCALES) {
          test(`Duplicate email error — ${locale.label}`, { tag: ['@localization', '@translation'] }, async ({ page }) => {
            allure.subSuite('Login / Sign Up');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await wildiesPage.open(locale.path);
            const { attempted } = await wildiesPage.attemptDuplicateEmailRegistration(SEED_ACCOUNT!.email);
            if (!attempted) {
              await wildiesPage.captureScreenshot(`Duplicate email error — ${locale.label} (${viewportName}, not attempted)`, {
                fullPage: false,
              });
              allure.description(
                `<p>⚠️ The Sign Up submit button never enabled for this locale, even with a fully valid-looking ` +
                  `form (a known, unresolved limitation — see <code>attemptDuplicateEmailRegistration()</code>'s ` +
                  `comment). The real, server-side "email already registered" error could not be triggered or ` +
                  `checked this run — see the attached screenshot for the form's actual state.</p>`
              );
              return;
            }
            await wildiesPage.captureScreenshot(`Duplicate email error — ${locale.label} (${viewportName})`, {
              fullPage: false,
            });
            await wildiesPage.verifyTranslation(`Duplicate email registration error (${locale.label}, ${viewportName})`, [
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

            const wildiesPage = new WildiesPage(page);
            await wildiesPage.open(locale.path);
            await wildiesPage.expectLoginFailure(SEED_ACCOUNT?.email ?? 'wiztest008@gmail.com', 'not-the-real-password');
            await wildiesPage.captureScreenshot(`Login error — ${locale.label} (${viewportName})`, { fullPage: false });
            await wildiesPage.verifyTranslation(`Login error message (${locale.label}, ${viewportName})`, [
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

            const wildiesPage = new WildiesPage(page);
            await wildiesPage.visitNonExistentPage(locale.path);
            await wildiesPage.captureScreenshot(`404 — ${locale.label} (${viewportName})`, {
              dismissModalFirst: true,
            });
            await wildiesPage.verifyTranslation(`Non-existent page (${locale.label}, ${viewportName})`, [
              'The generic error boundary this site shows for any unknown route (heading, message, ' +
                '"Try again"/"Go back" buttons) — confirmed live 2026-08-29 there is no dedicated themed 404 page',
            ]);
          });
        }
      });

      test.describe('Account menu (avatar dropdown)', () => {
        test.skip(!hasCreds, 'No Wildies test accounts configured');

        for (const locale of EXISTING_LOCALES) {
          test(`Account menu — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Account menu');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            const account = nextPooledAccount();
            await wildiesPage.open(locale.path);
            await loginWithFallback(wildiesPage, account);
            const modalFlagged = wildiesPage.takePendingModalFindings();
            await wildiesPage.openAccountMenu();
            // NOT `dismissModalFirst` — confirmed live 2026-09-02 the
            // dropdown itself IS a `[data-modal-overlay="true"]` element on
            // mobile, same reasoning as Login popup/Cashier below: the
            // modal is the screenshot's own subject, dismissing it first
            // would close the very thing this screenshot exists to show.
            await wildiesPage.captureScreenshot(`Account menu — ${locale.label} (${viewportName})`, {
              fullPage: false,
            });
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

      test.describe('Gamification (Match X)', () => {
        test.skip(!hasCreds, 'No Wildies test accounts configured');

        for (const locale of EXISTING_LOCALES) {
          test(`Gamification — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            test.setTimeout(90_000);
            allure.subSuite('Gamification');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            const account = nextPooledAccount();
            await wildiesPage.open(locale.path);
            await loginWithFallback(wildiesPage, account);
            const modalFlagged = wildiesPage.takePendingModalFindings();
            await wildiesPage.openGamificationWidget();

            // 5 sections: Overview, Missions, Levels, Store, Inbox — see
            // `openGamificationSection()`'s comment for why this is
            // position-based. Missions and Store each have their own inner
            // sub-tabs (e.g. Missions' Overview/Available/Locked/
            // Completed); Overview and Inbox don't, `gamificationSubTabCount()`
            // is just 0 for those.
            const frameFlagged: string[] = [];
            const pushUnique = (findings: string[]) => {
              for (const f of findings) if (!frameFlagged.includes(f)) frameFlagged.push(f);
            };
            for (let section = 0; section < 5; section++) {
              await wildiesPage.openGamificationSection(section);
              pushUnique(await wildiesPage.scanFrameForUntranslatedText(wildiesPage.gamificationFrame));
              if (section === 2) {
                // Levels — brand-identity regression guard, see
                // `WILDIES_LEVEL_NAMES`'s own comment.
                const levelsText = await wildiesPage.gamificationFrame.locator('body').innerText();
                const missingLevels = WILDIES_LEVEL_NAMES.filter((name) => !levelsText.includes(name));
                pushUnique(
                  missingLevels.map(
                    (name) =>
                      `Levels tab is missing the expected level "${name}" — either broken or showing a ` +
                      "different brand's levels instead of Wildies' own"
                  )
                );
              }
              const subTabCount = await wildiesPage.gamificationSubTabCount();
              for (let sub = 0; sub < subTabCount; sub++) {
                await wildiesPage.openGamificationSubTab(sub);
                pushUnique(await wildiesPage.scanFrameForUntranslatedText(wildiesPage.gamificationFrame));
              }
            }

            await wildiesPage.captureScreenshot(`Gamification — ${locale.label} (${viewportName})`, {
              fullPage: false,
              dismissModalFirst: true,
            });
            await wildiesPage.verifyTranslation(
              `Gamification (${locale.label}, logged in, ${viewportName})`,
              [
                'The "Match X" gamification widget\'s Overview/Missions/Levels/Store/Inbox sections and each ' +
                  'section\'s own sub-tabs — scanned for broken/leaking raw keys only, not for matching this ' +
                  'test\'s own locale (confirmed live 2026-08-31 this widget\'s displayed language follows its ' +
                  'own per-account setting rather than the site\'s current locale — see the class-level comment ' +
                  'on `gamificationFrame`). Inbox\'s own inner "All"/"Favorite" categories are not drilled into.',
              ],
              [...modalFlagged, ...frameFlagged]
            );
          });
        }
      });

      test.describe('Authenticated account pages', () => {
        test.skip(!hasCreds, 'No Wildies test accounts configured');

        for (const p of AUTHENTICATED_PAGES) {
          for (const locale of EXISTING_LOCALES) {
            test(`${p.name} — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
              allure.subSuite(p.name);
              allure.severity('normal');

              const wildiesPage = new WildiesPage(page);
              const account = nextPooledAccount();
              await wildiesPage.open(locale.path);
              await loginWithFallback(wildiesPage, account);
              const modalFlagged = wildiesPage.takePendingModalFindings();
              await wildiesPage.visitPage(p.path, locale.path);
              // Content screenshot before opening the nav drawer — see the
              // ANONYMOUS_PAGES loop's identical comment above for why
              // (mobile's drawer is a full-screen overlay that otherwise
              // hides the very content this screenshot exists to show).
              await wildiesPage.captureScreenshot(`${p.name} — ${locale.label} (logged in, ${viewportName})`, {
                dismissModalFirst: true,
              });
              await wildiesPage.openSideMenu();
              await wildiesPage.captureScreenshot(`${p.name} — ${locale.label}, nav menu (logged in, ${viewportName})`, {
                fullPage: false,
                dismissModalFirst: true,
              });
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

        for (const locale of EXISTING_LOCALES) {
          test(`Cashier — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Cashier');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            const account = nextPooledAccount();
            await wildiesPage.open(locale.path);
            await loginWithFallback(wildiesPage, account);
            const modalFlagged = wildiesPage.takePendingModalFindings();
            await wildiesPage.openCashier();
            modalFlagged.push(...wildiesPage.takePendingModalFindings());
            const depositFlagged = await wildiesPage.scanForUntranslatedText();
            await wildiesPage.switchCashierTab('withdraw');
            // No `dismissModalFirst` here, deliberately — the Cashier IS a
            // `[data-modal-overlay="true"][data-modal="Finances"]` dialog
            // itself, the exact thing `dismissModalIfPresent()` closes.
            // `fullPage: false` still applies, same as every other
            // modal/dropdown/widget screenshot in this file.
            await wildiesPage.captureScreenshot(`Cashier — ${locale.label} (${viewportName})`, { fullPage: false });
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

        for (const locale of EXISTING_LOCALES) {
          test(`Game History — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Game History');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await wildiesPage.open(locale.path);
            await wildiesPage.login(SEED_ACCOUNT!.email, SEED_ACCOUNT!.password);
            const modalFlagged = wildiesPage.takePendingModalFindings();
            await wildiesPage.visitPage('/account/game-history', locale.path);
            await wildiesPage.captureScreenshot(`Game History — ${locale.label} (${viewportName})`, {
              dismissModalFirst: true,
            });
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

        for (const locale of EXISTING_LOCALES) {
          test(`Sportsbook My Bets — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            allure.subSuite('Sportsbook My Bets');
            allure.severity('normal');

            const wildiesPage = new WildiesPage(page);
            await wildiesPage.open(locale.path);
            await wildiesPage.login(SEED_ACCOUNT!.email, SEED_ACCOUNT!.password);
            const modalFlagged = wildiesPage.takePendingModalFindings();
            await wildiesPage.openSportsbookMyBets();
            const frameFlagged = await wildiesPage.scanFrameForUntranslatedText(wildiesPage.sportsbookFrame);
            if (locale.code !== 'en') {
              frameFlagged.push(
                ...(await wildiesPage.scanFrameForEnglishFallback(wildiesPage.sportsbookFrame, SPORTSBOOK_ENGLISH_BASELINE))
              );
            }
            await wildiesPage.captureScreenshot(`Sportsbook My Bets — ${locale.label} (${viewportName})`, {
              dismissModalFirst: true,
            });
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
