# Continue: Playwright registration autotests for gcplaying0175.com

## Context

This repo contains a Playwright + TypeScript test suite with Allure
reporting for the registration form on `https://gcplaying0175.com/` (an
online casino/betting site). It was scaffolded in a separate Claude
session that manually inspected the live registration form through a
browser extension (Chrome DevTools) but **could not execute an actual
Playwright run against the live site** from that sandbox (no outbound
internet access there — only via a browser bridge). You are running
locally via Claude Code and DO have real network access, so your job is
to finish validating and fixing this suite for real, against the live
site.

## Project structure

- `package.json` / `package-lock.json` — deps: `@playwright/test`,
  `allure-playwright`, `allure-js-commons`, `allure-commandline`,
  `@faker-js/faker`, `typescript`.
- `playwright.config.ts` — projects: chromium, firefox, mobile-chrome;
  reporters: list + allure-playwright + html; `baseURL` defaults to
  `https://gcplaying0175.com/` (override with `BASE_URL` env var).
- `pages/RegistrationPage.ts` — Page Object for the signup modal.
- `utils/test-data.ts` — test data generators (valid/invalid emails,
  passwords each violating exactly one requirement, phone numbers).
- `tests/registration.spec.ts` — 14 test cases (×3 browser projects = 42
  runs): successful registration, disabled submit button on empty form,
  6 invalid email formats, 5 password-requirement violations, duplicate
  email registration.
- `README.md` — setup/run instructions and a "Известные ограничения"
  (known limitations) section — read it, it overlaps with this file.

## Confirmed facts about the real form

Verified via DevTools on 2026-08-24 (but never exercised through an
actual Playwright run against the live site — do that now and fix
whatever breaks):

- Registration opens as a modal (`data-testid="signup-popup"`),
  triggered by a **Register** button in the header — only visible when
  logged out. If the browser session already has a login cookie, log
  out first via the "Log out" sidebar link, then confirm with the
  "Log Out" button in the confirmation dialog (`RegistrationPage.
  ensureLoggedOut()` already does this).
- Fields: Currency select (USD/EUR, default USD,
  `data-testid="currency-button"`), Country input (default "United Arab
  Emirates", `input[name="addressCountryAlfa2"]`), phone country code
  (default +971, `data-testid="phone-code-button"`), Phone
  (`input[name="phone"]`), Email (`input[name="email"]`), Password
  (`input[name="password"]`).
- No confirm-password field, no terms/18+ checkbox — consent is implied
  by a text line with a "Terms and Conditions" link. No CAPTCHA found in
  the DOM.
- Submit button (text "Sign up", inside `.SignUpForm_form` container,
  class contains `WizButton_primary-contained`) has a native `disabled`
  attribute that's only removed once every field is valid.
- Password live-validation checklist has 5 items with exact text:
  "Between 8-30 characters", "At least one number", "No spaces",
  "At least one lowercase", "At least one capital" — each item's
  container div gets a class substring `_true` (met) or `_false`
  (unmet).
- **Known ambiguity**: both the "Sign up" tab label and the submit
  button say exactly "Sign up". `RegistrationPage.ts` works around this
  via CSS class-prefix scoping (`AuthTabs_container_wrapper` for the
  tab, `SignUpForm_form` + `WizButton_primary-contained` for the submit
  button). If Playwright throws a strict-mode violation anywhere, this
  is the likely cause — check whether those class name prefixes still
  exist in the live markup.

## What was NOT verified for real — do this first

1. **What happens after a successful registration.**
   `RegistrationPage.expectSuccess()` currently guesses: modal closes +
   "Log out" text or a "Deposit" button appears. Run the
   `@smoke @positive` test (ideally `--headed` first), observe the real
   post-signup UI, and fix `expectSuccess()` to match reality — it could
   be a welcome/bonus modal, a redirect, an OTP/phone-verification step,
   etc. If there's a verification step, the flow may need real rework,
   not just a locator tweak.
2. **The error shown when registering with an already-used email.** The
   `@duplicate` test currently only asserts the modal stays open, not
   the actual error text/toast. Capture the real error and add a
   precise assertion for it.

## Task

1. `cd` into this folder, run `npm install`, then
   `npx playwright install --with-deps chromium firefox`.
2. Run the positive test first and watch it happen:
   `npx playwright test --project=chromium --headed -g "Успешная регистрация"`.
   Fix `RegistrationPage.expectSuccess()` based on what you actually see.
3. Run the full suite: `npx playwright test`. Fix any selector/timing
   issues that surface — this is a real production site, so expect some
   drift from what was captured manually via DevTools.
4. For the `@duplicate` test, capture the real "email already
   registered" (or similar) error and assert on it precisely instead of
   the current loose "modal didn't close" check.
5. Generate and open the Allure report (`npm run report`) and sanity
   check that steps/tags/severity render as expected.
6. Keep the existing tags (`@smoke`, `@positive`, `@negative`, `@email`,
   `@password`, `@duplicate`) — they let a future CI run exclude the
   form-submitting tests against prod if needed, e.g.
   `npx playwright test --grep-invert "@positive|@duplicate"` (see
   README).
7. **Heads up**: the `@positive` and `@duplicate` tests submit the form
   for real and create actual accounts on the live production site,
   using disposable `mailinator.com` addresses generated in
   `utils/test-data.ts` (`generateValidRegistrationData`). This is
   intentional, but flag it to the user if that's a concern before
   running them repeatedly or in CI.

Report back what you found and changed, especially regarding the two
unverified items above (success screen, duplicate-email error).
