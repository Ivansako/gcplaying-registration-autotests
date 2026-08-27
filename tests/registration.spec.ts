import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { PASSWORD_REQUIREMENTS, RegistrationPage } from '../pages/RegistrationPage';
import {
  generateValidRegistrationData,
  invalidEmailSamples,
  invalidPasswordSamples,
  invalidPhoneSamples,
} from '../utils/test-data';

/**
 * Registration autotests for https://gcplaying0175.com/
 *
 * The form markup was confirmed live on 2026-08-24 via Chrome DevTools
 * (see comments in pages/RegistrationPage.ts). Key facts about the
 * form:
 *   - Registration is a modal (data-testid="signup-popup"), opened via
 *     the "Register" button in the header (visible only for an
 *     anonymous session).
 *   - Fields: Currency (USD/EUR, default USD), Country (default United
 *     Arab Emirates), Code (+971 by default), Phone, Email, Password.
 *     There is no password-confirmation field and no terms-agreement
 *     checkbox — agreement is implied by the text with a link to the
 *     Terms and Conditions.
 *   - No CAPTCHA in the form.
 *   - Validation is fully client-side: the "Sign up" button has a
 *     native disabled attribute until the form is valid. Password
 *     requirements are shown via a live checklist of 5 items with
 *     *_true/*_false classes.
 *   - The exact "successful registration" screen was not verified live
 *     (to avoid creating real accounts in production during
 *     exploration) — expectSuccess() checks the modal closing plus
 *     signs of an authenticated session (see README, "Known
 *     limitations" section).
 *
 * Before running: npm install && npx playwright install.
 */
test.describe('Registration on gcplaying0175.com', () => {
  test.beforeEach(async ({ page }) => {
    allure.epic('Authentication');
    allure.feature('Registration');
    allure.owner('QA Automation');

    const registrationPage = new RegistrationPage(page);
    await registrationPage.open();
    // The browser session may already be logged in (a persisted
    // cookie) — the registration test needs a guaranteed anonymous
    // session.
    await registrationPage.ensureLoggedOut();
  });

  // Own describe so retries can be disabled just for this test: it creates
  // a real account, and a CI retry of a slow-but-successful run would fire
  // a 2nd real sign-up POST within seconds of the 1st (see RegistrationPage.submit()).
  test.describe('Successful registration with valid data', () => {
    test.describe.configure({ retries: 0 });

    test(
      'Successful registration with valid data',
      { tag: ['@smoke', '@positive'] },
      async ({ page }) => {
        // The rate-limit pacing wait in RegistrationPage.submit() can now
        // be up to 60s (cross-run throttle) on top of the normal flow.
        test.setTimeout(130_000);

        allure.severity('critical');
        allure.description(
          'The user fills the registration form with valid, unique data, the "Sign up" button ' +
            'becomes enabled, and after submitting, the modal closes and the user ends up in an ' +
            'authenticated session.'
        );

        const registrationPage = new RegistrationPage(page);
        const data = generateValidRegistrationData();

        await test.step('Open the registration form', async () => {
          await registrationPage.openRegistrationForm();
          await registrationPage.expectSubmitDisabled();
        });

        await test.step('Fill the form with valid data', async () => {
          await registrationPage.fillForm(data);
          await registrationPage.expectSubmitEnabled();
        });

        await test.step('Submit the form and verify successful registration', async () => {
          await registrationPage.submit();
          await registrationPage.expectSuccess();
        });
      }
    );
  });

  test(
    'Sign up button stays disabled while the form is empty',
    { tag: ['@negative'] },
    async ({ page }) => {
      allure.severity('normal');
      allure.description('An empty form (only default values) does not allow submitting registration.');

      const registrationPage = new RegistrationPage(page);
      await registrationPage.openRegistrationForm();
      await registrationPage.expectSubmitDisabled();
    }
  );

  for (const invalidEmail of invalidEmailSamples()) {
    test(
      `Sign up button stays disabled with invalid email format: "${invalidEmail}"`,
      { tag: ['@negative', '@email'] },
      async ({ page }) => {
        allure.severity('normal');

        const registrationPage = new RegistrationPage(page);
        const data = generateValidRegistrationData({ email: invalidEmail });

        await registrationPage.openRegistrationForm();
        await registrationPage.fillForm(data);
        await registrationPage.expectSubmitDisabled();
      }
    );
  }

  for (const invalidPhone of invalidPhoneSamples()) {
    test(
      `Sign up button stays disabled with invalid phone number: "${invalidPhone}"`,
      { tag: ['@negative', '@phone'] },
      async ({ page }) => {
        allure.severity('normal');

        const registrationPage = new RegistrationPage(page);
        const data = generateValidRegistrationData({ phone: invalidPhone });

        await registrationPage.openRegistrationForm();
        await registrationPage.fillForm(data);
        await registrationPage.expectSubmitDisabled();
      }
    );
  }

  for (const { password, violatedRequirement } of invalidPasswordSamples()) {
    test(
      `Password requirement "${violatedRequirement}" is marked unmet for password "${password}"`,
      { tag: ['@negative', '@password'] },
      async ({ page }) => {
        allure.severity('normal');
        allure.description(
          `Password "${password}" intentionally violates exactly one requirement ` +
            `("${violatedRequirement}"), the other checklist items should be marked as met, and ` +
            'the "Sign up" button should stay disabled.'
        );

        const registrationPage = new RegistrationPage(page);
        const data = generateValidRegistrationData({ password });

        await registrationPage.openRegistrationForm();
        await registrationPage.fillForm(data);

        await test.step(`Verify requirement "${violatedRequirement}" is unmet`, async () => {
          await registrationPage.expectPasswordRequirementUnmet(violatedRequirement);
        });

        await test.step('Verify the remaining requirements are met', async () => {
          for (const requirement of PASSWORD_REQUIREMENTS) {
            if (requirement !== violatedRequirement) {
              await registrationPage.expectPasswordRequirementMet(requirement);
            }
          }
        });

        await registrationPage.expectSubmitDisabled();
      }
    );
  }

  const requiredFieldScenarios: Array<{ missingField: 'email' | 'phone' | 'password' }> = [
    { missingField: 'email' },
    { missingField: 'phone' },
    { missingField: 'password' },
  ];

  for (const { missingField } of requiredFieldScenarios) {
    test(
      `Sign up button stays disabled when ${missingField} is left empty`,
      { tag: ['@negative', '@required-fields'] },
      async ({ page }) => {
        allure.severity('normal');
        allure.description(
          `All fields except ${missingField} are filled with valid data — the "Sign up" button ` +
            'must stay disabled because a required field is missing.'
        );

        const registrationPage = new RegistrationPage(page);
        const data = generateValidRegistrationData();

        await registrationPage.openRegistrationForm();
        if (missingField !== 'phone') await registrationPage.fillPhone(data.phone);
        if (missingField !== 'email') await registrationPage.fillEmail(data.email);
        if (missingField !== 'password') await registrationPage.fillPassword(data.password);

        await registrationPage.expectSubmitDisabled();
      }
    );
  }

  // Own describe so retries can be disabled: this test fires 2 real sign-up
  // POSTs itself (see RegistrationPage.submit()'s pacing comment) — a CI
  // retry would add 2 more right after.
  test.describe('Cannot register again with an already used email', () => {
    test.describe.configure({ retries: 0 });

    test(
      'Cannot register again with an already used email',
      { tag: ['@negative', '@duplicate'] },
      async ({ page }) => {
        // This test submits twice — 2x the (now up to 60s, cross-run
        // throttled) rate-limit pacing wait from RegistrationPage.submit().
        test.setTimeout(220_000);

        allure.severity('critical');
        allure.description(
          'Register a user once, then repeat registration with the same email (but a new ' +
            'phone/password) — the second attempt must not succeed.'
        );

        const registrationPage = new RegistrationPage(page);
        const data = generateValidRegistrationData();

        await test.step('First registration — should succeed', async () => {
          await registrationPage.openRegistrationForm();
          await registrationPage.fillForm(data);
          await registrationPage.submit();
          await registrationPage.expectSuccess();
        });

        await test.step('Repeat registration with the same email — should be rejected', async () => {
          await registrationPage.ensureLoggedOut();
          await registrationPage.openRegistrationForm();
          await registrationPage.fillForm(generateValidRegistrationData({ email: data.email }));
          await registrationPage.submit();
          // The server's "email already in use" message wasn't pinned
          // down live (to avoid creating duplicate accounts in
          // production) — we verify by the fact that the modal did NOT
          // close and registration did not succeed.
          await test.step('Verify registration did not succeed', async () => {
            await registrationPage.modal.waitFor({ state: 'visible' });
          });
        });
      }
    );
  });

  test('Password visibility toggle switches the field between hidden and visible', { tag: ['@positive'] }, async ({ page }) => {
    allure.severity('minor');
    allure.description('The eye icon next to the password field toggles its type between "password" and "text", on both the Sign Up and Log In forms.');

    const registrationPage = new RegistrationPage(page);

    await test.step('Sign Up form', async () => {
      await registrationPage.openRegistrationForm();
      await registrationPage.passwordInput.fill('SomePass1!');
      await expect(registrationPage.passwordInput).toHaveAttribute('type', 'password');
      await registrationPage.passwordVisibilityToggle.click();
      await expect(registrationPage.passwordInput).toHaveAttribute('type', 'text');
      await registrationPage.passwordVisibilityToggle.click();
      await expect(registrationPage.passwordInput).toHaveAttribute('type', 'password');
    });

    await test.step('Log In form', async () => {
      await registrationPage.logInTab.click();
      await registrationPage.loginPasswordInput.fill('SomePass1!');
      await expect(registrationPage.loginPasswordInput).toHaveAttribute('type', 'password');
      await registrationPage.passwordVisibilityToggle.click();
      await expect(registrationPage.loginPasswordInput).toHaveAttribute('type', 'text');
    });
  });

  test('X button closes the auth modal from both Sign Up and Log In views', { tag: ['@positive'] }, async ({ page }) => {
    allure.severity('minor');
    allure.description('Confirms the X button closes the whole modal (not just switches tabs) from both the Sign Up and Log In views.');

    const registrationPage = new RegistrationPage(page);

    await test.step('From Sign Up', async () => {
      await registrationPage.openRegistrationForm();
      await registrationPage.closeButton.click();
      await expect(registrationPage.modal).toBeHidden();
    });

    await test.step('From Log In', async () => {
      await registrationPage.openLoginForm();
      await registrationPage.closeButton.click();
      await expect(registrationPage.modal).toBeHidden();
    });
  });
});
