import { expect, Locator, Page } from '@playwright/test';
import { step } from 'allure-js-commons';
import { RegistrationData } from '../utils/test-data';

/**
 * Page Object for the gcplaying0175.com registration form.
 *
 * Markup confirmed live (via Chrome DevTools) on 2026-08-24:
 *  - Registration opens as a modal (data-testid="signup-popup") over
 *    the landing page, triggered by the "Register" button in the
 *    header.
 *  - The modal is a React app (classes look like *_hash), so the main
 *    locators are built on stable attributes: data-testid, name, type,
 *    placeholder — not generated CSS classes.
 *  - There is no "Confirm password" field and no terms-agreement
 *    checkbox. Agreement with the Terms & Conditions and being 18+ is
 *    implied by a text line under the submit button linking to
 *    /terms-and-conditions.
 *  - No CAPTCHA (reCAPTCHA/hCaptcha/Turnstile) found in the form
 *    markup.
 *  - Validation is fully client-side and "live": the "Sign up" button
 *    has a native disabled attribute, removed only once ALL fields
 *    (currency, country, code, phone, email, password) are valid.
 *    There are no separate inline error texts under fields (other
 *    than the password) in the DOM — so negative scenarios are
 *    verified through the button's disabled/enabled state rather than
 *    error text.
 *  - Password requirements are shown via a live checklist of 5 items
 *    (see PASSWORD_REQUIREMENTS below), each marked ✓/✗ as the user
 *    types.
 */

export const PASSWORD_REQUIREMENTS = [
  'Between 8-30 characters',
  'At least one number',
  'No spaces',
  'At least one lowercase',
  'At least one capital',
] as const;

export class RegistrationPage {
  readonly page: Page;

  readonly registerButton: Locator;
  readonly modal: Locator;
  readonly closeButton: Locator;
  readonly signUpTab: Locator;
  readonly logInTab: Locator;

  readonly currencyButton: Locator;
  readonly countryInput: Locator;
  readonly phoneCodeButton: Locator;
  readonly phoneInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly passwordVisibilityToggle: Locator;
  readonly passwordHints: Locator;
  readonly submitButton: Locator;
  readonly googleSignUpButton: Locator;
  readonly termsLink: Locator;

  constructor(page: Page) {
    this.page = page;

    // IMPORTANT: both the tab switcher and the form's submit button are
    // labeled exactly "Sign up" — getByRole with exact:true would match
    // both elements (a Playwright strict-mode violation), so both
    // locators are deliberately scoped via a CSS-module class prefix
    // that doesn't depend on the generated hash (*_hash*).
    this.registerButton = page.getByRole('button', { name: 'Register' });
    this.modal = page.getByTestId('signup-popup');
    this.closeButton = this.modal.getByTestId('close-button');
    this.signUpTab = this.modal.locator('[class*="AuthTabs_container_wrapper"]', { hasText: 'Sign up' });
    this.logInTab = this.modal.locator('[class*="AuthTabs_container_wrapper"]', { hasText: 'Log In' });

    this.currencyButton = this.modal.getByTestId('currency-button');
    this.countryInput = this.modal.locator('input[name="addressCountryAlfa2"]');
    this.phoneCodeButton = this.modal.getByTestId('phone-code-button');
    this.phoneInput = this.modal.locator('input[name="phone"]');
    this.emailInput = this.modal.locator('input[name="email"]');
    this.passwordInput = this.modal.locator('input[name="password"]');
    this.passwordVisibilityToggle = this.modal.locator('input[name="password"] ~ button, input[name="password"] + button');
    this.passwordHints = this.modal.locator('[class*="WizPasswordHints_text"]');
    this.submitButton = this.modal.locator('[class*="SignUpForm_form"] button[class*="WizButton_primary-contained"]');
    this.googleSignUpButton = this.modal.getByRole('button', { name: /sign up with google/i });
    this.termsLink = this.modal.getByRole('link', { name: /terms and conditions/i });
  }

  async open(): Promise<void> {
    await step('Open the site home page', async () => {
      await this.page.goto('/');
      await this.page.waitForLoadState('domcontentloaded');
    });
  }

  /**
   * The site keeps a persistent authenticated browser session (cookie)
   * — if the user is logged in, the "Register"/"Log in" buttons in the
   * header disappear and are replaced with the balance and "Log out".
   * For stable registration test runs the session must be anonymous
   * (a clean Playwright/incognito context, WITHOUT reusing a logged-in
   * user's storageState).
   */
  async ensureLoggedOut(): Promise<void> {
    const logoutLink = this.page.getByText('Log out', { exact: true });
    if (await logoutLink.isVisible().catch(() => false)) {
      await step('Log out the active session before the registration test', async () => {
        await logoutLink.click();
        await this.page.getByRole('button', { name: 'Log Out', exact: true }).click();
        await expect(this.registerButton).toBeVisible();
      });
    }
  }

  async openRegistrationForm(): Promise<void> {
    await step('Open the registration form', async () => {
      await this.registerButton.click();
      await expect(this.modal).toBeVisible();
      await expect(this.signUpTab).toBeVisible();
    });
  }

  async fillEmail(email: string): Promise<void> {
    await step(`Fill in email: ${email}`, async () => {
      await this.emailInput.fill(email);
    });
  }

  async fillPassword(password: string): Promise<void> {
    await step('Fill in password', async () => {
      await this.passwordInput.fill(password);
    });
  }

  async fillPhone(phone: string): Promise<void> {
    await step(`Fill in phone: ${phone}`, async () => {
      await this.phoneInput.fill(phone);
    });
  }

  /**
   * Default currency is USD and default country is United Arab
   * Emirates (+971), so an explicit selection is only needed for a
   * different value. Kept for potential multi-currency/multi-country
   * scenarios (not part of the base test suite).
   */
  async selectCurrency(currency: 'USD' | 'EUR'): Promise<void> {
    await step(`Select currency: ${currency}`, async () => {
      await this.currencyButton.click();
      await this.modal.getByText(currency, { exact: true }).last().click();
    });
  }

  async submit(): Promise<void> {
    await step('Submit the registration form', async () => {
      await this.submitButton.click();
    });
  }

  /**
   * Fills the form with a full dataset WITHOUT submitting it — useful
   * for negative scenarios that check the button/hints state before
   * submit.
   */
  async fillForm(data: RegistrationData): Promise<void> {
    await this.fillPhone(data.phone);
    await this.fillEmail(data.email);
    await this.fillPassword(data.password);
  }

  async registerWith(data: RegistrationData): Promise<void> {
    await this.openRegistrationForm();
    await this.fillForm(data);
    await this.submit();
  }

  async expectSubmitEnabled(): Promise<void> {
    await expect(this.submitButton).toBeEnabled();
  }

  async expectSubmitDisabled(): Promise<void> {
    await expect(this.submitButton).toBeDisabled();
  }

  /**
   * Returns the state of the live password hints as
   * { "Between 8-30 characters": true/false, ... }.
   * true — requirement met (check mark), false — unmet (cross mark).
   *
   * Determined from the CSS-module class on the hint element:
   * "WizPasswordHints_true__<hash>" (met) /
   * "WizPasswordHints_false__<hash>" (unmet) — confirmed via DevTools.
   * Matched by the "_true"/"_false" substring since the hash suffix is
   * build-generated and may change between releases.
   */
  async getPasswordHintsState(): Promise<Record<string, boolean>> {
    const count = await this.passwordHints.count();
    const result: Record<string, boolean> = {};
    for (let i = 0; i < count; i++) {
      const hint = this.passwordHints.nth(i);
      const text = (await hint.textContent())?.trim() ?? '';
      const cls = (await hint.getAttribute('class')) ?? '';
      result[text] = /_true/.test(cls) && !/_false/.test(cls);
    }
    return result;
  }

  async expectPasswordRequirementMet(requirement: string): Promise<void> {
    await expect(this.passwordHints.filter({ hasText: requirement })).toHaveClass(/_true/);
  }

  async expectPasswordRequirementUnmet(requirement: string): Promise<void> {
    await expect(this.passwordHints.filter({ hasText: requirement })).toHaveClass(/_false/);
  }

  /**
   * Checks that registration succeeded. Since the exact "success
   * screen" (welcome modal / deposit prompt / just closing the popup)
   * wasn't pinned down without performing a real registration, this
   * checks a combination of signs of an authenticated state.
   */
  async expectSuccess(): Promise<void> {
    await step('Verify successful registration', async () => {
      await expect(this.modal).toBeHidden({ timeout: 15_000 });
      await expect(
        this.page.getByText('Log out', { exact: true }).or(this.page.getByRole('button', { name: 'Deposit' }))
      ).toBeVisible({ timeout: 15_000 });
    });
  }
}
