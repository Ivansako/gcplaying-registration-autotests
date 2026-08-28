import { devices } from '@playwright/test';
import { test } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { RegistrationPage } from '../pages/RegistrationPage';
import { generateBrandTestRegistrationData } from '../utils/test-data';

/**
 * Full brand test for gcplaying0175.com — registration + login, across
 * desktop and popular mobile resolutions, with a screenshot attached
 * to every meaningful check.
 *
 * `defaultBrowserType` is stripped from each device preset below: CI
 * only installs the Chromium browser (`npx playwright install
 * chromium`), and `--project=chromium` already fixes the engine — we
 * only want the viewport/touch/user-agent emulation from the preset,
 * not a WebKit/Firefox engine switch.
 *
 * Every "Register a new account" test creates a REAL account on the
 * live production site using a `wiztest<letter><digit>@gmail.com`
 * address (per explicit request) — this suite is NOT safe to run
 * unattended on a schedule; it's meant for deliberate, on-demand runs.
 */

function stripBrowserType(device: (typeof devices)[string]) {
  const { defaultBrowserType, ...rest } = device;
  return rest;
}

const VIEWPORTS = [
  { name: 'Desktop', config: stripBrowserType(devices['Desktop Chrome']) },
  { name: 'Mobile (iPhone 13)', config: stripBrowserType(devices['iPhone 13']) },
  { name: 'Mobile (Pixel 7)', config: stripBrowserType(devices['Pixel 7']) },
];

test.describe('gcplaying0175.com — full brand test (registration + login)', () => {
  // A CI retry would re-run a whole viewport's test from scratch — including
  // a fresh real sign-up POST — right after the first attempt. Disabled here
  // for the same reason as registration.spec.ts's real-registration tests
  // (see RegistrationPage.submit()'s pacing comment).
  test.describe.configure({ retries: 0 });

  for (const { name, config } of VIEWPORTS) {
    test.describe(name, () => {
      test.use({ ...config });

      test.beforeEach(async () => {
        allure.parentSuite('1. Registration & Login');
        allure.subSuite('Registration + Login Flow');
        allure.epic('Brand Test');
        allure.feature('Registration + Login');
        allure.owner('QA Automation');
        allure.parameter('Viewport', name);
      });

      test(
        `Register a new account and log back in — ${name}`,
        { tag: ['@brand', '@positive'] },
        async ({ page }) => {
          // The rate-limit pacing wait in RegistrationPage.submit() can now
          // be up to 60s (cross-run throttle, see utils/registrationThrottle.ts)
          // on top of 2 full auth flows (register + log back in) across 6+
          // screenshots.
          test.setTimeout(150_000);

          allure.severity('critical');
          allure.description(
            'Full flow: register a new account with a `wiztest<letter><digit>@gmail.com` address, verify ' +
              'the registration succeeded, log out, log back in with the exact same credentials, and verify ' +
              `the session is authenticated again after login. Runs on the "${name}" viewport. This test ` +
              'creates a real account on the live production site every run.'
          );

          const registrationPage = new RegistrationPage(page);
          const data = generateBrandTestRegistrationData();

          await test.step('Open the site anonymously', async () => {
            await registrationPage.open();
            await registrationPage.ensureLoggedOut();
            await registrationPage.attachScreenshot(`${name} — anonymous home page`);
          });

          await test.step('Register a new account', async () => {
            await registrationPage.openRegistrationForm();
            await registrationPage.attachScreenshot(`${name} — registration form opened`);

            await registrationPage.fillForm(data);
            await registrationPage.attachScreenshot(`${name} — registration form filled`);
            await registrationPage.expectSubmitEnabled();

            await registrationPage.submit();
            await registrationPage.expectSuccess();
            await registrationPage.attachScreenshot(`${name} — registration succeeded`);
          });

          await test.step('Log out, then log back in with the same credentials', async () => {
            await registrationPage.ensureLoggedOut();
            await registrationPage.attachScreenshot(`${name} — logged out after registering`);

            await registrationPage.openLoginForm();
            await registrationPage.attachScreenshot(`${name} — login form opened`);

            await registrationPage.fillLoginForm(data.email, data.password);
            await registrationPage.attachScreenshot(`${name} — login form filled`);

            await registrationPage.submitLogin();
            await registrationPage.expectSuccess();
            await registrationPage.attachScreenshot(`${name} — login succeeded`);
          });
        }
      );

      test(
        `Logging in with a wrong password shows an error — ${name}`,
        { tag: ['@brand', '@negative'] },
        async ({ page }) => {
          allure.severity('normal');
          allure.description(
            'Attempts to log in with a made-up email and password and verifies the generic ' +
              '"Invalid Login or Password" error is shown. Does not create or touch any real account. ' +
              `Runs on the "${name}" viewport.`
          );

          const registrationPage = new RegistrationPage(page);
          const bogusEmail = `nonexistent.${Date.now()}@gmail.com`;

          await test.step('Open the site anonymously', async () => {
            await registrationPage.open();
            await registrationPage.ensureLoggedOut();
            await registrationPage.attachScreenshot(`${name} — anonymous home page`);
          });

          await test.step('Attempt to log in with invalid credentials', async () => {
            await registrationPage.openLoginForm();
            await registrationPage.fillLoginForm(bogusEmail, 'WrongPass123!');
            await registrationPage.attachScreenshot(`${name} — invalid login filled`);

            await registrationPage.submitLogin();
            await registrationPage.expectLoginError();
            await registrationPage.attachScreenshot(`${name} — invalid login error shown`);
          });
        }
      );
    });
  }
});
