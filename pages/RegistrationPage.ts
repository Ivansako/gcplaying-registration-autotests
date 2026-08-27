import { expect, Locator, Page } from '@playwright/test';
import { attachment, logStep, step } from 'allure-js-commons';
import { ContentType, Status } from 'allure-js-commons';
import { RegistrationData } from '../utils/test-data';
import { waitForRegistrationSlot } from '../utils/registrationThrottle';

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
 *
 * KNOWN SITE BUG (see AccountPage.ts's file header for the full writeup):
 * post-login screenshots ("registration succeeded", "login succeeded")
 * pick up a recurring "em: INSUFFICIENT_PATH" JS error via
 * `attachScreenshot()`'s console-error check — reported as an orange
 * "broken" Allure step, not a red test failure. Left in deliberately,
 * not filtered out.
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

  // Forgot-password — confirmed live 2026-08-27. The link lives inside
  // LoginForm itself; clicking it swaps `signup-popup` out entirely for a
  // sibling `forgot-password-popup` (not nested inside the old modal) —
  // so `forgotPasswordPopup` is scoped to `page`, not `this.modal`.
  readonly forgotPasswordLink: Locator;
  readonly forgotPasswordPopup: Locator;
  readonly forgotPasswordEmailInput: Locator;
  readonly forgotPasswordSubmitButton: Locator;
  readonly forgotPasswordBackButton: Locator;
  readonly notificationPopupTitle: Locator;

  // Third-party promo popup (e.g. "Golden League is live!") — renders in
  // an injected `iframe.__btgPromoHolder` right after registration/login
  // and covers the header, blocking clicks on Log out / Deposit / etc.
  readonly promoPopupCloseButton: Locator;

  private consoleErrors: string[] = [];

  constructor(page: Page) {
    this.page = page;
    this.page.on('console', (msg) => {
      // Excludes 429s specifically — see BrandContentPage.ts's constructor
      // comment for why (test-speed noise, not a real defect).
      if (msg.type() === 'error' && !/status of 429/.test(msg.text())) this.consoleErrors.push(msg.text());
    });

    // IMPORTANT: both the tab switcher and the form's submit button are
    // labeled exactly "Sign up" — getByRole with exact:true would match
    // both elements (a Playwright strict-mode violation), so both
    // locators are deliberately scoped via a CSS-module class prefix
    // that doesn't depend on the generated hash (*_hash*).
    this.registerButton = page.getByRole('button', { name: 'Register' });
    this.modal = page.getByTestId('signup-popup');
    // `getByTestId('close-button')` itself resolves to a 0×0 wrapper —
    // confirmed live 2026-08-27 — the actual clickable target is its
    // icon-button child.
    this.closeButton = this.modal.getByTestId('close-button').locator('div[class*="IconButton_iconButton"]');
    this.signUpTab = this.modal.locator('[class*="AuthTabs_container_wrapper"]', { hasText: 'Sign up' });
    this.logInTab = this.modal.locator('[class*="AuthTabs_container_wrapper"]', { hasText: 'Log In' });

    this.currencyButton = this.modal.getByTestId('currency-button');
    this.countryInput = this.modal.locator('input[name="addressCountryAlfa2"]');
    this.phoneCodeButton = this.modal.getByTestId('phone-code-button');
    this.phoneInput = this.modal.locator('input[name="phone"]');
    this.emailInput = this.modal.locator('input[name="email"]');
    this.passwordInput = this.modal.locator('input[name="password"]');
    // Confirmed live 2026-08-27: the toggle is a <div>, not a <button> —
    // the old selector matched zero elements.
    this.passwordVisibilityToggle = this.modal.locator('input[name="password"] ~ div[class*="Input_input__button_password"]');
    this.passwordHints = this.modal.locator('[class*="WizPasswordHints_text"]');
    this.submitButton = this.modal.locator('[class*="SignUpForm_form"] button[class*="WizButton_primary-contained"]');
    this.googleSignUpButton = this.modal.getByRole('button', { name: /sign up with google/i });
    this.termsLink = this.modal.getByRole('link', { name: /terms and conditions/i });

    this.loginForm = this.modal.locator('form[class*="LoginForm_form"]');
    this.loginEmailInput = this.loginForm.locator('input[name="email"]');
    this.loginPasswordInput = this.loginForm.locator('input[name="password"]');
    this.loginSubmitButton = this.loginForm.locator('button[type="submit"]');
    this.loginErrorText = this.modal.getByTestId('account-error-text');

    this.forgotPasswordLink = this.loginForm.getByTestId('forgot-password-link');
    this.forgotPasswordPopup = page.getByTestId('forgot-password-popup');
    this.forgotPasswordEmailInput = this.forgotPasswordPopup.locator('input[name="email"]');
    this.forgotPasswordSubmitButton = this.forgotPasswordPopup.locator('button[type="submit"]');
    this.forgotPasswordBackButton = this.forgotPasswordPopup.locator('span', { hasText: 'Back' }).first();
    this.notificationPopupTitle = page.getByTestId('notification-popup-title');

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
        await this.openMobileMenuIfNeeded(logoutLink);
        await this.clickDespitePromoPopup(logoutLink);
        await this.clickDespitePromoPopup(this.page.getByRole('button', { name: 'Log Out', exact: true }));
        await expect(this.registerButton).toBeVisible();
      });
    }
  }

  /**
   * "Log out" lives inside the site's left `SideMenu` — always open on
   * desktop (so it's directly clickable there), but collapsed into an
   * off-canvas drawer on mobile. Playwright's `isVisible()` reports true
   * either way (correct CSS, just positioned off-screen via a negative
   * `translateX` when closed), so the miss shows up later as "element is
   * outside of the viewport" on click rather than a clean not-visible
   * check — confirmed live 2026-08-26. Opening it needs the bottom-nav
   * "Menu" button, which only exists on mobile; a no-op on desktop where
   * the target's bounding box is already on-screen.
   */
  private async openMobileMenuIfNeeded(target: Locator): Promise<void> {
    const box = await target.boundingBox();
    if (box && box.x >= 0) return;
    const mobileMenuButton = this.page.getByText('Menu', { exact: true });
    if (await mobileMenuButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await mobileMenuButton.click();
      await this.page.waitForTimeout(500);
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
   * Default currency is USD, so an explicit selection is only needed for
   * a different value. Kept for potential multi-currency scenarios (not
   * part of the base test suite).
   */
  async selectCurrency(currency: 'USD' | 'EUR'): Promise<void> {
    await step(`Select currency: ${currency}`, async () => {
      await this.currencyButton.click();
      await this.modal.getByText(currency, { exact: true }).last().click();
    });
  }

  /**
   * The form's default country is geolocation-based, not a fixed value —
   * confirmed live 2026-08-26 (it showed Italy from this session's IP,
   * instead of the United Arab Emirates seen when the suite was first
   * built), which silently broke registration since every generated
   * phone number is a UAE mobile number (see generateValidPhone()) and
   * gets rejected under any other country's format. Country is a
   * searchable autocomplete: typing filters a list of clickable rows
   * (`Select_list__container_element`, a CSS-module class so matched by
   * prefix) rather than a simple click-to-open dropdown like Currency/Code.
   */
  async selectCountry(query: string, optionText: string): Promise<void> {
    await step(`Select country: ${optionText}`, async () => {
      await this.countryInput.fill(query);
      await this.modal.locator('[class*="Select_list__container_element"]', { hasText: optionText }).click();
    });
  }

  /**
   * The site's own sign-up endpoint (behind Cloudflare) rate-limits (429)
   * bursts of registrations from the same source — hit this even with an
   * in-run pacing wait, from separate `npx playwright test` invocations
   * run close together while debugging. `waitForRegistrationSlot()`
   * persists the last-registration timestamp to disk, so *every*
   * invocation waits out the same minimum gap since the last real
   * registration, anywhere — not just within this one run. See
   * utils/registrationThrottle.ts.
   */
  async submit(): Promise<void> {
    await step('Wait before submitting (rate-limit pacing, cross-run)', async () => {
      await waitForRegistrationSlot();
    });
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
    await this.selectCountry('United Arab', 'United Arab Emirates');
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

  private async waitForImagesLoaded(timeoutMs = 4_000): Promise<void> {
    await this.page
      .waitForFunction(() => Array.from(document.querySelectorAll('img')).every((img) => img.complete), undefined, {
        timeout: timeoutMs,
      })
      .catch(() => {});
  }

  private async getBrokenImages(): Promise<string[]> {
    return this.page.evaluate(() =>
      Array.from(document.querySelectorAll('img'))
        .filter((img) => img.complete && img.naturalWidth === 0 && img.src)
        .map((img) => img.src)
    );
  }

  private async getHorizontalOverflow(): Promise<number> {
    return this.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  }

  /**
   * Second-stage UI check, used after each meaningful check in the brand
   * test so every step has visual evidence, on both desktop and mobile
   * viewports. Waits for the page to genuinely finish rendering
   * (networkidle, capped short at 3s so a persistent websocket/polling
   * connection — expected once logged in — doesn't burn the full
   * default timeout on every single check + every <img> settled), then
   * checks for broken images, JS console errors, and horizontal layout
   * overflow before attaching the screenshot and a JSON report.
   *
   * Findings here are reported via `logStep(..., Status.BROKEN)` rather
   * than a failing `expect()` — deliberately: the functional check
   * already passed (that's what actually failing the test is for), a UI
   * finding is a real thing worth flagging but shouldn't turn the whole
   * regression run red on its own. `logStep` writes directly into
   * Allure's step model without throwing, so it shows as an orange
   * "broken" line nested under this step while the test itself, and this
   * step, both still report as passed.
   */
  async attachScreenshot(name: string): Promise<void> {
    await step(`UI check: ${name}`, async () => {
      await this.page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
      await this.waitForImagesLoaded();

      const consoleErrors = this.consoleErrors.splice(0);
      const brokenImages = await this.getBrokenImages();
      const overflowPx = await this.getHorizontalOverflow();

      await attachment(
        `UI report — ${name}`,
        JSON.stringify({ brokenImages, overflowPx, consoleErrors }, null, 2),
        ContentType.JSON
      );
      // Explicit timeout (default actionTimeout of 15s isn't always enough)
      // — confirmed live 2026-08-27: a full-page screenshot with a modal
      // open over a very long homepage occasionally needs longer to
      // stabilize before Playwright will snap it.
      const buffer = await this.page.screenshot({ fullPage: true, timeout: 30_000 });
      await attachment(name, buffer, ContentType.PNG);

      if (brokenImages.length > 0) {
        await logStep(`Broken images: ${brokenImages.join(', ')}`, Status.BROKEN);
      }
      if (overflowPx > 0) {
        await logStep(`Horizontal overflow: ${overflowPx}px wider than the viewport`, Status.BROKEN);
      }
      if (consoleErrors.length > 0) {
        await logStep(`Browser console errors: ${consoleErrors.slice(0, 3).join(' | ')}`, Status.BROKEN);
      }
    });
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

  async openForgotPassword(): Promise<void> {
    await step('Open the forgot-password form', async () => {
      await this.openLoginForm();
      await this.forgotPasswordLink.click();
      await expect(this.forgotPasswordPopup).toBeVisible();
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    await step(`Request a password reset for: ${email}`, async () => {
      await this.forgotPasswordEmailInput.fill(email);
      await this.forgotPasswordSubmitButton.click();
    });
  }

  /**
   * Confirms live 2026-08-27: submitting any well-formed but unregistered
   * email shows this exact error — not just malformed input. Worth noting
   * as a mild account-enumeration side-channel (a registered email gets a
   * different, "check your email" response — see
   * `expectPasswordResetSuccess()`), but not something to build a failing
   * assertion around here.
   */
  async expectPasswordResetError(): Promise<void> {
    await step('Verify the "Please provide valid email" error is shown', async () => {
      await expect(this.notificationPopupTitle).toBeVisible();
      await expect(this.notificationPopupTitle).toHaveText('Please provide valid email');
    });
  }

  /**
   * Confirms the reset email was actually sent — safe to submit for real
   * (unlike Change Password): this only sends an email with a reset link,
   * it never completes a reset, so the live account's password never
   * changes unless that link is also opened and completed, which this
   * suite never does.
   */
  async expectPasswordResetSuccess(email: string): Promise<void> {
    await step('Verify the reset-email confirmation is shown', async () => {
      await expect(this.notificationPopupTitle).toBeVisible();
      await expect(this.notificationPopupTitle).toHaveText('Success');
      await expect(this.forgotPasswordPopup).toContainText(email);
    });
  }

  async goBackToSignIn(): Promise<void> {
    await step('Go back to the sign-up view', async () => {
      await this.forgotPasswordBackButton.click();
      await expect(this.modal).toBeVisible();
    });
  }
}
