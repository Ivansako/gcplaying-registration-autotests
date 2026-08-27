import { devices } from '@playwright/test';
import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { RegistrationPage } from '../pages/RegistrationPage';

/**
 * Forgot-password flow for gcplaying0175.com — anonymous (no login), part
 * of the "Full Brand test" regression. Confirmed live 2026-08-27:
 * `[data-testid="forgot-password-link"]` inside the login form opens
 * `[data-testid="forgot-password-popup"]`, a self-contained
 * email → submit → confirmation flow. Submitting a *registered* email is
 * safe to do for real — unlike Change Password, it only sends a reset
 * email and never completes a reset, so TEST_USER_EMAIL's actual password
 * never changes.
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

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL;

test.describe('gcplaying0175.com — forgot password', () => {
  for (const { name, config } of VIEWPORTS) {
    test.describe(name, () => {
      test.use({ ...config });

      test.beforeEach(async () => {
        allure.epic('Brand Test');
        allure.feature('Forgot password');
        allure.owner('QA Automation');
        allure.parameter('Viewport', name);
      });

      test(`Submit stays disabled only while the email field is empty — ${name}`, { tag: ['@brand', '@auth'] }, async ({ page }) => {
        test.setTimeout(90_000);

        allure.severity('normal');
        allure.description(
          'Confirms the Submit button is disabled while the email field is empty, and enabled once any ' +
            'text is entered — the client only checks for emptiness, not email format (confirmed live: an ' +
            'invalid-format value still enables it; the real format check happens server-side on submit).'
        );

        const registrationPage = new RegistrationPage(page);
        await registrationPage.open();
        await registrationPage.ensureLoggedOut();
        await registrationPage.openForgotPassword();

        await test.step('Empty email — Submit disabled', async () => {
          await expect(registrationPage.forgotPasswordSubmitButton).toBeDisabled();
          await registrationPage.attachScreenshot(`${name} — forgot password, empty email`);
        });

        await test.step('Non-empty email — Submit enabled', async () => {
          await registrationPage.forgotPasswordEmailInput.fill('not-an-email');
          await expect(registrationPage.forgotPasswordSubmitButton).toBeEnabled();
          await registrationPage.attachScreenshot(`${name} — forgot password, non-empty email`);
        });
      });

      test(`Submitting an unregistered email shows an error — ${name}`, { tag: ['@brand', '@auth'] }, async ({ page }) => {
        test.setTimeout(90_000);

        allure.severity('normal');
        allure.description(
          'Submits a unique, well-formed but unregistered email and confirms the "Please provide valid ' +
            'email" error is shown.'
        );

        const registrationPage = new RegistrationPage(page);
        await registrationPage.open();
        await registrationPage.ensureLoggedOut();
        await registrationPage.openForgotPassword();

        const unregisteredEmail = `qa-forgot-password-${Date.now()}@example.com`;
        await registrationPage.requestPasswordReset(unregisteredEmail);
        await registrationPage.expectPasswordResetError();
        await registrationPage.attachScreenshot(`${name} — forgot password, unregistered email error`);
      });

      test(`Submitting a registered email sends a reset link — ${name}`, { tag: ['@brand', '@auth'] }, async ({ page }) => {
        test.skip(!TEST_USER_EMAIL, 'TEST_USER_EMAIL not set');
        test.setTimeout(90_000);

        allure.severity('normal');
        allure.description(
          'Submits TEST_USER_EMAIL and confirms a reset-link confirmation is shown. Safe to submit for ' +
            "real: this only sends an email, it never completes a reset, so the account's actual password " +
            'never changes.'
        );

        const registrationPage = new RegistrationPage(page);
        await registrationPage.open();
        await registrationPage.ensureLoggedOut();
        await registrationPage.openForgotPassword();

        await registrationPage.requestPasswordReset(TEST_USER_EMAIL!);
        await registrationPage.expectPasswordResetSuccess(TEST_USER_EMAIL!);
        await registrationPage.attachScreenshot(`${name} — forgot password, reset link sent`);
      });

      test(`Back returns to the sign-up view — ${name}`, { tag: ['@brand', '@auth'] }, async ({ page }) => {
        test.setTimeout(90_000);

        allure.severity('minor');
        allure.description('Confirms the "Back" control returns from the forgot-password form to the sign-up view.');

        const registrationPage = new RegistrationPage(page);
        await registrationPage.open();
        await registrationPage.ensureLoggedOut();
        await registrationPage.openForgotPassword();

        await registrationPage.goBackToSignIn();
        await expect(registrationPage.countryInput).toBeVisible();
        await registrationPage.attachScreenshot(`${name} — forgot password, back to sign-up`);
      });
    });
  }
});
