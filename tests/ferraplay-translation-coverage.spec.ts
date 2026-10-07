import { devices } from '@playwright/test';
import { test, expect } from '../utils/testWithFerraplayAuth';
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
 * Per-page English-fallback baselines (`PAGE_ENGLISH_BASELINES` below)
 * added 2026-09-10, same discipline as Wildies': every phrase pulled
 * from that page's own content and cross-checked against ALL 6
 * non-English locales before being added. Found ONE real bug this way:
 * Casino Lobby's "TOP GAMES" section header stays in English on
 * Italiano/Português specifically (Ελληνικά/Español/Polski/Magyar all
 * translate it correctly) — deliberately kept IN the baseline (not
 * dropped) so this shows up as a real finding, same reasoning as
 * Wildies keeping "About Us" in its own footer baseline once confirmed
 * broken. Also found the Responsible Gambling policy's body text
 * literally says "Shelbyspin" instead of "FerraPlay" — confirmed in
 * ALL 7 locales including English itself (a copy-paste template bug in
 * the base content, not a translation gap), checked separately via
 * `BRAND_NAME_BUG_STRING` below since it isn't an English-fallback case.
 *
 * NOT yet built (documented gaps, not silent coverage):
 *  - Sportsbook — NOT covered at all, and per the user (2026-09-18,
 *    BQA-461) never will be: this brand won't ship a sportsbook. Confirmed
 *    live 2026-09-10 the `/sport` page rendered a blank content area even
 *    logged in (no odds widget iframe, unlike Wildies' genuinely
 *    re-embedding `88wplay` widget) — that was already a sign, now
 *    confirmed as permanent scope, so `/sport` isn't visited at all
 *    (removed from `ANONYMOUS_PAGES`, not just left without a baseline).
 *  - "Duplicate email" registration check uses a real account's email
 *    (`SEED_ACCOUNT`), same as Wildies.
 */

const ANONYMOUS_PAGES = [
  { path: '/', name: 'Home' },
  { path: '/casino', name: 'Casino Lobby' },
  { path: '/live-casino', name: 'Live Casino' },
  { path: '/buy_bonus', name: 'Buy Bonus' },
  // Wildies scans its Tournaments LISTING as its own page; FerraPlay only
  // visited it inside the per-tournament details block, whose final scanned
  // page is a detail page — so the listing itself was never scanned.
  { path: '/tournaments', name: 'Tournaments' },
  // Found by the 2026-10-07 site walk: a provider landing page reached from
  // a hero banner ("INOUT JUST JOINED"), and the providers index.
  { path: '/inout_games', name: 'Provider page (Inout)' },
  { path: '/providers', name: 'Providers' },
  { path: '/faq', name: 'FAQ' },
  { path: '/contact-us', name: 'Contact Us' },
  { path: '/terms-and-conditions', name: 'Terms and Conditions' },
  { path: '/privacy-policy', name: 'Privacy Policy' },
  { path: '/aml-policy', name: 'AML-KYC Policy' },
  { path: '/responsible-gambling', name: 'Responsible Gambling' },
];

/**
 * Per-page known-English baselines for `scanForEnglishFallback()` —
 * confirmed live 2026-09-10, each phrase pulled from that page's OWN
 * content and cross-checked against all 6 non-English locales (see the
 * class-level comment above for the one real bug this surfaced:
 * Casino Lobby's "TOP GAMES", deliberately kept in the list).
 *
 * "Buy Bonus" has no entry: its own content is too thin/generic to
 * build a safe baseline from. Sportsbook Lobby isn't in
 * `ANONYMOUS_PAGES` at all — see the class-level comment above.
 */
const PAGE_ENGLISH_BASELINES: Record<string, string[]> = {
  Home: [
    'TOP GAMES',
    'POPULAR GAMES',
    'PROVIDERS',
    'NEW GAMES',
    'LIVE GAMES',
    'ALL GAMES',
    // Category pill ("Top Games", mixed case — distinct from the all-caps
    // section header above). Confirmed live 2026-10-07 stuck in English on
    // Français only; it had been translated ("Meilleurs Jeux") on 2026-09-22.
    'Top Games',
    // Hero/promo banners — added 2026-10-07: the old baselines only covered
    // section headers, so a banner left in English was invisible to the suite
    // (a Wildies manual pass found exactly such banner defects). Every phrase
    // below was verified absent from ALL 7 non-English locales' text, so it
    // can only appear there as an untranslated fallback. Banners are CMS
    // content that rotates: a phrase whose banner is later retired just stops
    // matching (harmless), never false-flags. Banners are shared chrome across
    // pages, so they're checked here ONCE — not per page — to avoid the
    // one-bug-many-red-tests cascade (see the Wildies footer incident).
    'HACKSAW HAS ARRIVED!',
    'TRY YOUR LUCK TODAY',
    'INOUT JUST JOINED.',
    'FIRST DEPOSIT BONUS',
    'MONDAY CASHBACK',
    'WEEKEND POWER RELOAD',
    'Level up your points balance and unlock exclusive rewards!',
    'Enjoy the feeling of a reward with every single bet',
    // Real finding, kept on purpose: the "Mission Control" banner title is
    // left in English on Italiano and Français (translated in the others,
    // e.g. Magyar "Küldetésközpont") — confirmed live 2026-10-07.
    'Mission Control',
  ],
  'Casino Lobby': ['Casino Lobby', 'Instant Wins', 'Scratch Cards', 'TOP GAMES'],
  'Live Casino': ['Live Lobby', 'High stakes'],
  // FAQ/Contact Us baselines were STALE (found 2026-10-07): the site moved
  // the FAQ questions to Title Case and reworded Contact Us, so the old
  // phrases matched nothing and both pages were silently unchecked.
  FAQ: [
    'How to Register?',
    'I Have Forgotten My Password',
    'How Can I Close My Account?',
    'How Can I Set Deposit Limits?',
    'DEPOSITS AND WITHDRAWALS',
  ],
  'Contact Us': ['team is ready to assist you anytime'],
  Tournaments: ['Monthly Tournament'],
  'Terms and Conditions': ['TERMS AND CONDITIONS', 'GENERAL TERMS'],
  'Privacy Policy': ['PRIVACY POLICY', 'the lawful bases for such processing'],
  'AML-KYC Policy': [
    'ask for any KYC documentation it deems necessary',
    'restrict the service, payment, or withdrawal until identity is sufficiently determined',
  ],
  'Responsible Gambling': ['RESPONSIBLE GAMING POLICY', 'Avoid chasing losses'],
};

/**
 * Promotion card titles on `/promotions` (CMS content, verified 2026-10-07 to
 * appear in NONE of the 7 non-English locales' text except the two real
 * findings kept on purpose: "INSURANCE FEVER" is left in English on
 * Ελληνικά and Magyar (Polski translates it), and "77 FREE SPINS" on
 * Português next to an otherwise Portuguese card title).
 */
const PROMOTIONS_ENGLISH_BASELINE = [
  'CRYPTO WELCOME BONUS',
  'TUESDAY POWER RELOAD',
  'SUNDAY FREE SPINS',
  'FOURTH DEPOSIT BONUS',
  'Extra Free Spins on 50 €+',
  'INSURANCE FEVER',
  '77 FREE SPINS',
];

/**
 * NOT an English-fallback check — this string is wrong in EVERY locale
 * including English itself (confirmed live 2026-09-10 on the
 * Responsible Gambling page: the body text says "Shelbyspin is
 * committed to providing..." instead of "FerraPlay"). A copy-paste
 * template bug in the base legal content, same category as Wildies'
 * WILDIES_LEVEL_NAMES brand-identity guard — checked directly against
 * the page text rather than via `scanForEnglishFallback()`.
 */
const BRAND_NAME_BUG_STRING = 'Shelbyspin';

/**
 * Brand-identity regression guard for the "Loyalty" gamification widget's
 * Levels tab, same reasoning as Wildies' `WILDIES_LEVEL_NAMES` — a past
 * incident on the shared platform saw a locale rollout pull level names
 * from a DIFFERENT brand. Confirmed live 2026-09-18: 8 real names, same
 * count as Wildies' own 8, product-specific and not meant to translate.
 */
const FERRAPLAY_LEVEL_NAMES = [
  'Dreamer 1',
  'Dreamer 2',
  'Dreamer 3',
  'Dreamer 4',
  'Believer 1',
  'Achiever 1',
  'Elite 1',
  'Loyalty',
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

            const pageBaseline = PAGE_ENGLISH_BASELINES[p.name];
            if (pageBaseline && locale.code === 'en') {
              // Baseline health (non-failing): on the English page every baseline phrase
              // must exist, otherwise it can never match on another locale and this
              // page is silently unchecked — how FAQ/Contact Us went stale unnoticed.
              // Rotating CMS banners legitimately drop out over time, so this is
              // reported in Allure rather than failing the run.
              const stale = await ferraplayPage.missingBaselinePhrases(pageBaseline);
              allure.parameter('Stale baseline phrases (not on the English page)', stale.length ? stale.join(' | ') : 'none');
            }
            const englishFallbackFlagged =
              pageBaseline && locale.code !== 'en' ? await ferraplayPage.scanForEnglishFallback(pageBaseline) : [];
            // Wrong-brand-name check — NOT locale-gated, confirmed
            // present in English too (see BRAND_NAME_BUG_STRING's own
            // comment).
            const brandFlagged = await ferraplayPage.scanForEnglishFallback([BRAND_NAME_BUG_STRING]);
            const brandNameFindings = brandFlagged.map((f) =>
              f.replace(/^Still shows the English.*$/, `Page text says "${BRAND_NAME_BUG_STRING}" instead of "FerraPlay"`)
            );

            await ferraplayPage.verifyTranslation(
              `${p.name} (${locale.label}, anonymous, ${viewportName})`,
              ['Main page content', 'Side navigation menu', 'Language switcher panel', 'Footer'],
              [...englishFallbackFlagged, ...brandNameFindings]
            );
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
            if (locale.code !== 'en') {
              flagged.push(...(await ferraplayPage.scanForEnglishFallback(PROMOTIONS_ENGLISH_BASELINE)));
            }
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

      // BQA-461's first bullet: "the selected language persists while
      // navigating between pages and after page refresh/login". Not covered
      // by the Wildies suite either — added here first.
      test.describe('Language persistence (navigation, refresh, login, logout)', () => {
        test.skip(!hasCreds, 'No FerraPlay test accounts configured');

        for (const locale of EXISTING_LOCALES) {
          test(`Language persistence — ${locale.label}`, { tag: ['@localization', '@auth'] }, async ({ page }) => {
            test.setTimeout(180_000);
            allure.subSuite('Language persistence');
            allure.severity('critical');
            allure.description(
              `Starts on ${locale.label}, then confirms <html lang="${locale.code}"> AND the URL's locale prefix ` +
                'both survive a real in-app sidebar navigation, a page refresh, logging in, and logging out.'
            );

            const ferraplayPage = new FerraPlayPage(page);
            const otherPrefixes = EXISTING_LOCALES.filter((l) => l.path && l.code !== locale.code).map((l) => l.path);

            const expectStillLocalized = async (stage: string) => {
              await test.step(`Still ${locale.label} ${stage}`, async () => {
                expect(await ferraplayPage.getCurrentLocale(), `<html lang> ${stage}`).toBe(locale.code);
                const pathname = new URL(page.url()).pathname;
                if (locale.path) {
                  expect(pathname, `URL locale prefix ${stage}`).toMatch(new RegExp(`^/${locale.path}(/|$)`));
                } else {
                  expect(
                    otherPrefixes.some((p) => pathname === `/${p}` || pathname.startsWith(`/${p}/`)),
                    `English URL must not gain another locale's prefix ${stage} (got ${pathname})`
                  ).toBe(false);
                }
              });
            };

            // Screenshot in a finally so a failure at ANY stage still leaves visual
            // evidence (the stage that fails is exactly the one worth seeing).
            try {
              await ferraplayPage.open(locale.path);
              await expectStillLocalized('on first load');

              await ferraplayPage.navigateViaSidebar('/promotions');
              expect(new URL(page.url()).pathname, 'Sidebar link should land on Promotions').toMatch(/\/promotions$/);
              await expectStillLocalized('after in-app navigation');

              await page.reload();
              await page.waitForLoadState('domcontentloaded');
              await expectStillLocalized('after a page refresh');

              await loginWithFallback(ferraplayPage, nextPooledAccount());
              await expectStillLocalized('after logging in');

              const logoutDialogFlagged = await ferraplayPage.logout();
              await expectStillLocalized('after logging out');
              expect(logoutDialogFlagged, 'Raw/untranslated keys in the log-out confirmation dialog').toEqual([]);

            } finally {
              await ferraplayPage
                .captureScreenshot(`Language persistence — ${locale.label} (${viewportName})`, { fullPage: false })
                .catch(() => {});
            }
          });
        }
      });

      test.describe('Gamification (Loyalty)', () => {
        test.skip(!hasCreds, 'No FerraPlay test accounts configured');

        for (const locale of EXISTING_LOCALES) {
          test(`Gamification — ${locale.label}`, { tag: ['@localization', '@translation', '@auth'] }, async ({ page }) => {
            // Bumped from 90s (2026-09-18): openGamificationWidget()'s two
            // bounded 5-attempt Finances-modal retry loops (see its own
            // comment) can, in the worst case confirmed live on Mobile
            // Português, eat most of a 90s budget on their own before the
            // widget itself is even scanned.
            test.setTimeout(120_000);
            allure.subSuite('Gamification');
            allure.severity('normal');

            const ferraplayPage = new FerraPlayPage(page);
            const account = nextPooledAccount();
            await ferraplayPage.open(locale.path);
            await loginWithFallback(ferraplayPage, account);
            const modalFlagged = ferraplayPage.takePendingModalFindings();
            await ferraplayPage.openGamificationWidget();

            // 5 sections: Overview, Missions, Levels, Store, Inbox — see
            // `openGamificationSection()`'s comment for why this is
            // position-based. Missions and Store each have their own inner
            // sub-tabs; Overview and Inbox don't, `gamificationSubTabCount()`
            // is just 0 for those.
            const frameFlagged: string[] = [];
            const pushUnique = (findings: string[]) => {
              for (const f of findings) if (!frameFlagged.includes(f)) frameFlagged.push(f);
            };
            for (let section = 0; section < 5; section++) {
              await ferraplayPage.openGamificationSection(section);
              pushUnique(await ferraplayPage.scanFrameForUntranslatedText(ferraplayPage.gamificationFrame));
              if (section === 2) {
                // Levels — brand-identity regression guard, see
                // `FERRAPLAY_LEVEL_NAMES`'s own comment.
                const levelsText = await ferraplayPage.gamificationFrame.locator('body').innerText();
                const missingLevels = FERRAPLAY_LEVEL_NAMES.filter((name) => !levelsText.includes(name));
                pushUnique(
                  missingLevels.map(
                    (name) =>
                      `Levels tab is missing the expected level "${name}" — either broken or showing a ` +
                      "different brand's levels instead of FerraPlay's own"
                  )
                );
              }
              const subTabCount = await ferraplayPage.gamificationSubTabCount();
              for (let sub = 0; sub < subTabCount; sub++) {
                await ferraplayPage.openGamificationSubTab(sub);
                pushUnique(await ferraplayPage.scanFrameForUntranslatedText(ferraplayPage.gamificationFrame));
              }
            }

            await ferraplayPage.captureScreenshot(`Gamification — ${locale.label} (${viewportName})`, {
              fullPage: false,
            });
            await ferraplayPage.verifyTranslation(
              `Gamification (${locale.label}, logged in, ${viewportName})`,
              [
                'The "Loyalty" gamification widget\'s Overview/Missions/Levels/Store/Inbox sections and each ' +
                  "section's own sub-tabs — scanned for broken/leaking raw keys. Unlike Wildies' equivalent " +
                  "widget, this one DOES follow the site's own locale (confirmed live 2026-09-18), so a " +
                  'leaked English string here is a real, locale-specific finding. Inbox\'s own inner ' +
                  'categories are not drilled into.',
              ],
              [...modalFlagged, ...frameFlagged]
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
