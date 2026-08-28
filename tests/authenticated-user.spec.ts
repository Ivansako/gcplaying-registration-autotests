import { test } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { RegistrationPage } from '../pages/RegistrationPage';

/**
 * Logs in with a pre-existing test account (not created by this suite) so
 * we can inspect what an already-authenticated user sees. Credentials come
 * from TEST_USER_EMAIL / TEST_USER_PASSWORD env vars — see .env (gitignored
 * locally) and the matching GitHub Actions secret for CI; never hardcoded
 * here.
 */
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;

test.describe('gcplaying0175.com — authenticated test user', () => {
  test.skip(!TEST_USER_EMAIL || !TEST_USER_PASSWORD, 'TEST_USER_EMAIL / TEST_USER_PASSWORD not set');

  test.beforeEach(async () => {
    allure.parentSuite('2. Account');
    allure.subSuite('Session');
    allure.epic('Brand Test');
    allure.feature('Authenticated session');
    allure.owner('QA Automation');
  });

  test('Log in with the test account and inspect the authenticated session', { tag: ['@auth'] }, async ({ page }) => {
    allure.severity('normal');
    allure.description(
      'Logs in with a pre-existing test account and captures the authenticated state ' +
        '(header, balance, account menu) for visual inspection. No assertions on the ' +
        'specific balance shown, since that can change between runs.'
    );

    const registrationPage = new RegistrationPage(page);

    await test.step('Open the site anonymously', async () => {
      await registrationPage.open();
      await registrationPage.ensureLoggedOut();
    });

    await test.step('Log in with the test account', async () => {
      await registrationPage.loginWith(TEST_USER_EMAIL!, TEST_USER_PASSWORD!);
      await registrationPage.expectSuccess();
      await registrationPage.attachScreenshot('Authenticated — home page');
    });
  });
});
