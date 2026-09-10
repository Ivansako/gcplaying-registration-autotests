import { devices } from '@playwright/test';
import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { FerraPlayPage } from '../pages/FerraPlayPage';
import { EXISTING_LOCALES } from '../utils/ferraplayLocales';
import { FERRAPLAY_ACCOUNT, hasCreds } from '../utils/ferraplayAccounts';

function stripBrowserType(device: (typeof devices)[string]) {
  const { defaultBrowserType, ...rest } = device;
  return rest;
}

const VIEWPORTS = [
  { name: 'Desktop', config: stripBrowserType(devices['Desktop Chrome']) },
  { name: 'Mobile (Pixel 7)', config: stripBrowserType(devices['Pixel 7']) },
];

/**
 * ferraplay.com — translation completeness across the whole brand,
 * anonymous-access scope. Direct port of
 * `wildies-translation-coverage.spec.ts`'s architecture (per-page
 * `verifyTranslation()`, a dedicated once-per-locale Footer test rather
 * than folding the global-phrase check into every page, red-or-green
 * only) applied to ferraplay.com — confirmed live 2026-09-10 to be the
 * same underlying platform.
 *
 * Scope (2026-09-10, first version): everything reachable WITHOUT a
 * login. Authenticated pages (account area, cashier, game history) are
 * NOT covered yet — no FerraPlay test account exists
 * (`FERRAPLAY_TEST_USER_EMAIL`/`PASSWORD` unset); add that section the
 * same way Wildies' `AUTHENTICATED_PAGES` block works once credentials
 * arrive. "Duplicate email" needs a real registered email to test
 * against and is skipped until then too.
 *
 * NOT yet built (documented gaps, not silent coverage):
 *  - Per-page English-fallback baselines (`PAGE_ENGLISH_BASELINES` in
 *    the Wildies suite) — would need the same live per-locale diffing
 *    Wildies' baselines took multiple sessions to build safely; only
 *    the footer's global-phrase baseline exists so far (5 phrases,
 *    cross-checked against Italiano only — see `FerraPlayPage`'s own
 *    comment on `GLOBAL_ENGLISH_UI_PHRASES`).
 *  - Sportsbook widget iframe content (no iframe was found loaded on
 *    `/sport` during discovery — the outer page is checked, the odds
 *    widget itself is not).
 *  - Tournaments' own per-tournament detail-page discovery
 *    (`verifyAllTournamentDetails()` equivalent) — the listing page
 *    itself is checked as a generic page instead for now.
 *  - FerraPlay's own "Loyalty"/"Missions" nav items — distinct features
 *    from Wildies' Smartico "Match X" widget, not investigated at all.
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

test.describe('ferraplay.com — translation coverage', () => {
  test.beforeEach(async () => {
    allure.parentSuite('FerraPlay');
    allure.epic('FerraPlay');
    allure.feature('Localization');
    allure.owner('QA Automation');
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
            await ferraplayPage.submitForgotPassword(FERRAPLAY_ACCOUNT?.email ?? 'ferraplay.qa.test@example.com');
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
            const { attempted } = await ferraplayPage.attemptDuplicateEmailRegistration(FERRAPLAY_ACCOUNT!.email);
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
            await ferraplayPage.expectLoginFailure(FERRAPLAY_ACCOUNT?.email ?? 'ferraplay.qa.test@example.com', 'not-the-real-password');
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
    });
  }
});
