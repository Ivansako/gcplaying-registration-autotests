import { expect, Locator, Page } from '@playwright/test';
import { attachment, step } from 'allure-js-commons';
import { ContentType } from 'allure-js-commons';
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

  // Login tab — confirmed live 2026-08-25. Same modal, a separate
  // `LoginForm_form` container that only renders while the Log In tab
  // is active, so scoping to it avoids any ambiguity with the signup
  // form's identically-named `email`/`password` inputs.
  readonly loginForm: Locator;
  readonly loginEmailInput: Locator;
  readonly loginPasswordInput: Locator;
  readonly loginSubmitButton: Locator;
  readonly loginErrorText: Locator;

  // Third-party promo popup (e.g. "Golden League is live!") — renders in
  // an injected `iframe.__btgPromoHolder` right after registration/login
  // and covers the header, blocking clicks on Log out / Deposit / etc.
  readonly promoPopupCloseButton: Locator;

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

    this.loginForm = this.modal.locator('form[class*="LoginForm_form"]');
    this.loginEmailInput = this.loginForm.locator('input[name="email"]');
    this.loginPasswordInput = this.loginForm.locator('input[name="password"]');
    this.loginSubmitButton = this.loginForm.locator('button[type="submit"]');
    this.loginErrorText = this.modal.getByTestId('account-error-text');

    this.promoPopupCloseButton = page.frameLocator('iframe.__btgPromoHolder').locator('[data-ao-hide-popup="true"]');
  }

  /**
   * Removes the third-party promo popup's iframe if it's currently
   * shown; a no-op otherwise. Must be called before interacting with
   * the header (Log out, Deposit, etc.) right after a registration or
   * login, since the popup otherwise intercepts those clicks — and can
   * resurface (a new iframe instance) even after being closed once.
   * Removed directly via the DOM rather than clicking its in-iframe
   * close button, which proved unreliable (the click didn't reliably
   * dismiss the popup, possibly due to a forced minimum display time).
   */
  async dismissPromoPopupIfPresent(): Promise<void> {
    const removedCount = await this.page.evaluate(() => {
      const frames = document.querySelectorAll('iframe.__btgPromoHolder');
      frames.forEach((frame) => frame.remove());
      return frames.length;
    });
    if (removedCount > 0) {
      await step('Dismiss the promo popup, if shown', async () => {});
    }
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
    await this.dismissPromoPopupIfPresent();
    const logoutLink = this.page.getByText('Log out', { exact: true });
    if (await logoutLink.isVisible().catch(() => false)) {
      await step('Log out the active session before the registration test', async () => {
        await this.clickDespitePromoPopup(logoutLink);
        await this.clickDespitePromoPopup(this.page.getByRole('button', { name: 'Log Out', exact: true }));
        await expect(this.registerButton).toBeVisible();
      });
    }
  }

  /**
   * Clicks a locator, retrying if the promo popup's iframe reappears
   * mid-flow and intercepts the click — it can resurface a few seconds
   * after being dismissed (a new iframe instance, so a one-time check
   * up front isn't enough).
   */
  private async clickDespitePromoPopup(locator: Locator): Promise<void> {
    for (let attempt = 1; attempt <= 5; attempt++) {
      await this.dismissPromoPopupIfPresent();
      try {
        await locator.click({ timeout: 3_000 });
        return;
      } catch (error) {
        if (attempt === 5) throw error;
      }
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
        this.page.getByText('Log out', { exact: true }).or(this.page.getByRole('button', { name: 'Deposit' })).first()
      ).toBeVisible({ timeout: 15_000 });
      await this.dismissPromoPopupIfPresent();
    });
  }

  /**
   * Attaches a full-page screenshot to the Allure report at the exact
   * point it's called — used after each meaningful check in the brand
   * test so every step has visual evidence, on both desktop and
   * mobile viewports.
   */
  async attachScreenshot(name: string): Promise<void> {
    const buffer = await this.page.screenshot({ fullPage: true });
    await attachment(name, buffer, ContentType.PNG);
  }

  async openLoginForm(): Promise<void> {
    await step('Open the login form', async () => {
      await this.registerButton.click();
      await expect(this.modal).toBeVisible();
      await this.logInTab.click();
      await expect(this.loginForm).toBeVisible();
    });
  }

  async fillLoginForm(email: string, password: string): Promise<void> {
    await step(`Fill in login form for: ${email}`, async () => {
      await this.loginEmailInput.fill(email);
      await this.loginPasswordInput.fill(password);
    });
  }

  async submitLogin(): Promise<void> {
    await step('Submit the login form', async () => {
      await this.loginSubmitButton.click();
    });
  }

  async loginWith(email: string, password: string): Promise<void> {
    await this.openLoginForm();
    await this.fillLoginForm(email, password);
    await this.submitLogin();
  }

  /**
   * The login form shows a single generic error for both an unknown
   * email and a wrong password — "Invalid Login or Password" — it
   * does not distinguish which field was wrong, confirmed live
   * 2026-08-25.
   */
  async expectLoginError(): Promise<void> {
    await step('Verify the "Invalid Login or Password" error is shown', async () => {
      await expect(this.loginErrorText).toBeVisible();
      await expect(this.loginErrorText).toHaveText('Invalid Login or Password');
    });
  }
}
