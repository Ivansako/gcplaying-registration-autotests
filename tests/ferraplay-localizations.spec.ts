import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { FerraPlayPage } from '../pages/FerraPlayPage';
import { EXISTING_LOCALES } from '../utils/ferraplayLocales';

/**
 * ferraplay.com — locale switcher mechanics (URL scheme, dropdown
 * options, `<html lang>` updates). Direct port of
 * `wildies-localizations.spec.ts` — confirmed live 2026-09-10 the same
 * underlying platform and switcher mechanics. Covers the 7 locales this
 * suite is scoped to (see `ferraplayLocales.ts`) — Nederlands and
 * Français are excluded per explicit request even though the site
 * itself offers them.
 *
 * Site-wide translation *completeness* is a separate concern — see
 * `tests/ferraplay-translation-coverage.spec.ts`.
 *
 * A FRESH visit to bare "/" resolves by geo-IP (confirmed live
 * 2026-09-10: this environment landed on French) rather than always
 * English — same quirk already documented for Wildies. English is
 * excluded from the direct-URL loop below for the same reason; it's
 * covered instead by the dropdown-switch test, a client-side route
 * change confirmed NOT geo-redirected.
 */

test.describe('ferraplay.com — locale switching', () => {
  test.beforeEach(async () => {
    allure.parentSuite('FerraPlay');
    allure.subSuite('Localizations');
    allure.epic('FerraPlay');
    allure.feature('Localization');
    allure.owner('QA Automation');
  });

  for (const locale of EXISTING_LOCALES.filter((l) => l.label !== 'English')) {
    test(`Direct URL loads the correct locale — ${locale.label}`, { tag: ['@localization'] }, async ({ page }) => {
      allure.severity('critical');
      allure.description(
        `Navigates directly to "/${locale.path}" and confirms <html lang="${locale.code}"> is set and the ` +
          'page renders without breakage.'
      );

      const ferraplayPage = new FerraPlayPage(page);
      await ferraplayPage.open(locale.path);

      await test.step('Confirm the active locale', async () => {
        expect(await ferraplayPage.getCurrentLocale()).toBe(locale.code);
      });

      await ferraplayPage.captureScreenshot(`${locale.label} — direct URL`);
    });
  }

  test('Switcher lists every currently available locale', { tag: ['@localization'] }, async ({ page }) => {
    allure.severity('normal');
    allure.description('Reads the sidebar language dropdown and confirms it lists every locale this suite covers.');

    const ferraplayPage = new FerraPlayPage(page);
    await ferraplayPage.open();
    const labels = await ferraplayPage.getAvailableLocaleLabels();
    allure.parameter('Available locales', labels.join(', '));

    for (const locale of EXISTING_LOCALES) {
      expect(labels).toContain(locale.label);
    }
  });

  test.describe('Switch via the sidebar dropdown', () => {
    // Includes English here (unlike the direct-URL loop above) — the
    // dropdown switch is a client-side route change, confirmed live to
    // correctly land on English regardless of the environment's
    // geo-detected default.
    for (const locale of EXISTING_LOCALES) {
      test(`Selecting "${locale.label}" navigates and updates <html lang>`, { tag: ['@localization'] }, async ({ page }) => {
        allure.severity('normal');
        allure.description(
          `Opens the sidebar language dropdown, selects "${locale.label}", and confirms the URL and ` +
            `<html lang="${locale.code}"> both update — not just a direct URL visit.`
        );

        const ferraplayPage = new FerraPlayPage(page);
        await ferraplayPage.open();
        const lang = await ferraplayPage.switchLocale(locale.label);
        expect(lang).toBe(locale.code);
        await ferraplayPage.captureScreenshot(`${locale.label} — via dropdown`);
      });
    }
  });
});
