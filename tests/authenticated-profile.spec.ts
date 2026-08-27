import { test, expect } from '@playwright/test';
import { allure } from 'allure-playwright';
import { RegistrationPage } from '../pages/RegistrationPage';
import { AccountPage } from '../pages/AccountPage';

/**
 * Deeper checks for the authenticated test user's Cashier (Withdraw —
 * Deposit is covered in authenticated-account.spec.ts), password change,
 * and profile — logging in with TEST_USER_EMAIL / TEST_USER_PASSWORD
 * (see .env, gitignored locally).
 *
 * Safety-driven scope (confirmed with the user 2026-08-26):
 *  - Withdraw is UI-only, same as Deposit — payment methods and the
 *    amount field are checked, the modal is closed, "Withdraw" is never
 *    clicked.
 *  - Change Password is validated but never submitted — a real password
 *    change would break every other suite that logs in via
 *    TEST_USER_PASSWORD.
 *  - Profile editing is split by risk: City/Street/Zip are actually
 *    saved and reloaded to confirm persistence (currently empty, don't
 *    affect login). Username/Phone/Email/Date of Birth are read-only
 *    checks — confirming the displayed value, never edited, since
 *    changing Email could break every other suite's ability to log in
 *    as TEST_USER_EMAIL.
 */
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;

test.describe('gcplaying0175.com — cashier, password, and profile checks', () => {
  test.describe.configure({ retries: 0 });
  test.skip(!TEST_USER_EMAIL || !TEST_USER_PASSWORD, 'TEST_USER_EMAIL / TEST_USER_PASSWORD not set');

  test.beforeEach(async () => {
    allure.epic('Brand Test');
    allure.feature('Authenticated session');
    allure.owner('QA Automation');
  });

  async function loginAsTestUser(registrationPage: RegistrationPage): Promise<void> {
    await test.step('Log in with the test account', async () => {
      await registrationPage.open();
      await registrationPage.ensureLoggedOut();
      await registrationPage.loginWith(TEST_USER_EMAIL!, TEST_USER_PASSWORD!);
      await registrationPage.expectSuccess();
    });
  }

  test('Withdraw modal shows payment methods (UI only)', { tag: ['@auth'] }, async ({ page }) => {
    allure.severity('normal');
    allure.description(
      'Opens the Withdraw modal from Pending Withdrawals and confirms payment methods and the amount ' +
        'field render. Never clicks Withdraw — no real withdrawal is requested.'
    );

    const registrationPage = new RegistrationPage(page);
    const accountPage = new AccountPage(page);
    await loginAsTestUser(registrationPage);

    await test.step('Open Withdraw and verify payment methods', async () => {
      await accountPage.openWithdrawModal();
      await accountPage.expectWithdrawMethodsVisible();
      await accountPage.attachScreenshot('Withdraw modal — payment methods');
      await accountPage.closeWithdrawModal();
    });
  });

  test('Withdraw amount field validation', { tag: ['@auth'] }, async ({ page }) => {
    // 3 checks, each with a UI-check screenshot.
    test.setTimeout(90_000);

    allure.severity('normal');
    allure.description(
      'Confirms the Withdraw amount field ($100-$5000, confirmed live) rejects non-numeric input and ' +
        'shows FE errors for below-min/above-max values. Never clicks Withdraw.'
    );

    const registrationPage = new RegistrationPage(page);
    const accountPage = new AccountPage(page);
    await loginAsTestUser(registrationPage);

    await accountPage.openWithdrawModal();

    await test.step('Non-numeric input is rejected', async () => {
      await accountPage.expectAmountFieldRejectsNonNumeric();
      await accountPage.attachScreenshot('Withdraw amount — non-numeric rejected');
    });

    await test.step('Below-min shows an error', async () => {
      await accountPage.expectAmountFieldError('50', 'Minimum amount is 100 $');
      await accountPage.attachScreenshot('Withdraw amount — below minimum');
    });

    // Reopen the modal before the next check — confirmed live 2026-08-27:
    // the error message doesn't re-validate after an error is already
    // showing (a real site quirk — typing a valid-range value afterward
    // still shows the stale first error), so a below-min check
    // immediately followed by an above-max check on the same field
    // instance leaves the "Minimum" message stuck instead of switching
    // to "Maximum". A fresh modal avoids it.
    await accountPage.closeWithdrawModal();
    await accountPage.openWithdrawModal();

    await test.step('Above-max shows an error', async () => {
      await accountPage.expectAmountFieldError('99999', 'Maximum amount is 5000 $');
      await accountPage.attachScreenshot('Withdraw amount — above maximum');
    });

    await accountPage.closeWithdrawModal();
  });

  test('Change password validation', { tag: ['@auth'] }, async ({ page }) => {
    // 3 cases, each with a UI check waiting out a 3s networkidle cap.
    test.setTimeout(75_000);

    allure.severity('critical');
    allure.description(
      'Fills the change-password form with several invalid combinations and confirms "Update Password" ' +
        'stays disabled for each. Never submits a real password change.'
    );

    const registrationPage = new RegistrationPage(page);
    const accountPage = new AccountPage(page);
    await loginAsTestUser(registrationPage);

    const invalidCases: Array<{ label: string; oldPassword: string; newPassword: string; confirmPassword: string }> = [
      { label: 'empty old password', oldPassword: '', newPassword: 'Qanewpass1!', confirmPassword: 'Qanewpass1!' },
      { label: 'weak new password (no capital)', oldPassword: TEST_USER_PASSWORD!, newPassword: 'qanewpass1!', confirmPassword: 'qanewpass1!' },
      { label: 'confirm does not match', oldPassword: TEST_USER_PASSWORD!, newPassword: 'Qanewpass1!', confirmPassword: 'Qadifferent2!' },
    ];

    for (const testCase of invalidCases) {
      await test.step(`Invalid case: ${testCase.label}`, async () => {
        await accountPage.openChangePasswordModal();
        await accountPage.fillChangePasswordForm(testCase);
        await accountPage.expectUpdatePasswordDisabled();
        await accountPage.attachScreenshot(`Change password — ${testCase.label}`);
      });
    }
  });

  test("Profile Info shows the account's current data", { tag: ['@auth'] }, async ({ page }) => {
    allure.severity('normal');
    allure.description(
      'Reads Username/Phone/Email from the Profile Info tab and confirms each matches the known ' +
        'TEST_USER_EMAIL account — read-only, never edited.'
    );

    const registrationPage = new RegistrationPage(page);
    const accountPage = new AccountPage(page);
    await loginAsTestUser(registrationPage);

    await test.step('Read and verify profile fields', async () => {
      const info = await accountPage.getProfileInfo();
      allure.parameter('Username', info.username);
      allure.parameter('Phone', info.phone);
      allure.parameter('Email', info.email);
      await accountPage.attachScreenshot('Profile Info');

      expect(info.email).toBe(TEST_USER_EMAIL);
      expect(info.username).not.toBe('');
      expect(info.phone).not.toBe('');
    });
  });

  // Personal Details — confirmed live 2026-08-27, from the Jira/Xray
  // "Personal Details" manual test folder. First Name/Last Name/City/DOB
  // are permanently locked on this account after an earlier save (see
  // project memory), so nothing here attempts to actually edit+save any
  // field — only the edit-mode toggle itself, the DOB month-picker
  // widget, the Communication Language options' presence, and a
  // confirmed real bug (see below).
  test.describe('Personal Details', () => {
    test('Edit mode opens and Cancel reverts it', { tag: ['@auth'] }, async ({ page }) => {
      allure.severity('minor');
      allure.description('Confirms the edit pencil opens edit mode (Cancel/Save icons appear) and Cancel closes it again.');

      const registrationPage = new RegistrationPage(page);
      const accountPage = new AccountPage(page);
      await loginAsTestUser(registrationPage);

      await test.step('Open and cancel edit mode', async () => {
        await accountPage.openProfileEdit();
        await accountPage.attachScreenshot('Personal Details — edit mode open');
        await accountPage.cancelProfileEdit();
      });
    });

    // No DOB month-picker test: confirmed live 2026-08-27 that on this
    // account the whole react-calendar DOB widget is disabled (First
    // Name/Last Name/City/DOB are permanently locked from an earlier
    // save — see AccountPage.ts's Personal Details locators comment),
    // so its month-navigation control never renders. Would need a
    // fresh, never-saved account to exercise.

    test('Communication Language options are present', { tag: ['@auth'] }, async ({ page }) => {
      allure.severity('minor');
      allure.description('Confirms both Communication Language radio options render with the expected labels. Never actually switched here — see the site-wide language switcher test for that.');

      const registrationPage = new RegistrationPage(page);
      const accountPage = new AccountPage(page);
      await loginAsTestUser(registrationPage);

      await test.step('Open edit mode and verify language options', async () => {
        await accountPage.openProfileEdit();
        await expect(accountPage.languageEnglishRadio).toBeVisible();
        await expect(accountPage.languageArabicRadio).toBeVisible();
        await accountPage.attachScreenshot('Personal Details — Communication Language');
      });
    });

    test('Saving with no changes shows a real bug (untranslated "nothing.to.update")', { tag: ['@auth'] }, async ({ page }) => {
      allure.severity('minor');
      allure.description(
        'Confirmed real defect (2026-08-27): saving Personal Details with no changes shows a literal ' +
          'untranslated i18n key instead of a real message. Documented as a genuine failing check, not ' +
          'silenced — same treatment as this project\'s other confirmed-but-unfixed defects.'
      );

      const registrationPage = new RegistrationPage(page);
      const accountPage = new AccountPage(page);
      await loginAsTestUser(registrationPage);

      await test.step('Save with no changes and check the notification text', async () => {
        await accountPage.openProfileEdit();
        const toastText = await accountPage.saveProfileEditWithNoChanges();
        allure.parameter('Toast text', toastText);
        await accountPage.attachScreenshot('Personal Details — save with no changes');

        expect(toastText).not.toBe('nothing.to.update');
      });
    });
  });

  // Own describe: pins the viewport AccountPage.updateAddressFields()'s
  // click coordinates were confirmed against (see its comment) — at the
  // default 1280x720 project viewport, Street stayed disabled even after
  // clicking the edit pencil, for reasons not fully understood; the
  // taller 1280x900 viewport used during live discovery worked reliably.
  test.describe('Address update', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('Address fields can be updated and persist', { tag: ['@auth'] }, async ({ page }) => {
      // Includes a page reload on top of the login flow.
      test.setTimeout(75_000);

      allure.severity('normal');
      allure.description(
        'Updates Street and Zip Code (City is excluded — see AccountPage.updateAddressFields()), reloads ' +
          'the page, and confirms the saved values persisted.'
      );

      const registrationPage = new RegistrationPage(page);
      const accountPage = new AccountPage(page);
      await loginAsTestUser(registrationPage);

      await test.step('Update the address fields and verify persistence', async () => {
        const saved = await accountPage.updateAddressFields({ street: 'Sheikh Zayed Road', zipCode: '00000' });
        allure.parameter('Street after reload', saved.street);
        allure.parameter('Zip Code after reload', saved.zipCode);
        await accountPage.attachScreenshot('Address fields after reload');

        expect(saved.street).toBe('Sheikh Zayed Road');
        expect(saved.zipCode).toBe('00000');
      });
    });
  });

  test('Verification page loads with the expected fields', { tag: ['@auth'] }, async ({ page }) => {
    allure.severity('normal');
    allure.description(
      'Confirms the Verification page loads and shows its expected fields. Does not proceed past ' +
        '"Next step" — that leads into a document-upload KYC flow this suite has no real ID documents for.'
    );

    const registrationPage = new RegistrationPage(page);
    const accountPage = new AccountPage(page);
    await loginAsTestUser(registrationPage);

    await test.step('Open Verification and verify it loads', async () => {
      await accountPage.expectVerificationPageLoaded();
      await accountPage.attachScreenshot('Verification page');
    });
  });

  test('Refer a Friend shows a personal referral link', { tag: ['@auth'] }, async ({ page }) => {
    allure.severity('normal');
    allure.description(
      'Confirms the Refer a Friend page shows a personal referral link in the expected format. Does not ' +
        'click the copy icon or any social-share button — no test value, and it would leave the page in a ' +
        "changed state (clipboard, or an opened share dialog)."
    );

    const registrationPage = new RegistrationPage(page);
    const accountPage = new AccountPage(page);
    await loginAsTestUser(registrationPage);

    await test.step('Open Refer a Friend and verify the referral link', async () => {
      await accountPage.expectReferralLinkVisible();
      await accountPage.attachScreenshot('Refer a Friend');
    });
  });
});
