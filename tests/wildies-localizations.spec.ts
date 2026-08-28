import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { WildiesPage } from '../pages/WildiesPage';

/**
 * beta.wildies.com — locale coverage, written ahead of the
 * German/Finnish/Spanish/Swedish/Norwegian rollout (see the "Add German |
 * Finnish | Spanish | Swedish | Norwegian languages to the Drop Down and
 * deploy to Beta" ticket) so it's ready the moment they land. Exercised
 * meanwhile against the 6 locales already live — see `pages/WildiesPage.ts`
 * for how the switcher/URL scheme was confirmed.
 *
 * Separate brand from gcplaying0175.com — run via
 * `playwright.wildies.config.ts` (its own Allure results/report
 * directory, not gcplaying0175.com's), not the default `playwright.config.ts`.
 */

// English is the default locale (the switcher navigates it to bare "/",
// no path prefix) — every other locale gets a "/{code}" prefix. A FRESH
// visit (no prior cookie/preference) to EITHER bare "/" or the explicit
// "/en" resolves by geo-IP instead — confirmed live 2026-08-28: an
// isolated Playwright context landed on Italian both times, since this
// automation's network resolves to Italy (the same environment quirk
// already documented for gcplaying0175.com's country defaulting). Only
// non-default locales' explicit prefixes bypass this. Practical effect:
// English can't be reliably reached via a direct URL in this
// environment — it's covered instead by the dropdown-switch test below
// (a client-side route change, confirmed NOT geo-redirected). Labels are
// each language's own native display name, exactly as the dropdown
// shows it (confirmed live 2026-08-28) — not the English name
// ("Ελληνικά", not "Greek").
const EXISTING_LOCALES = [
  { label: 'English', code: 'en', path: 'en' },
  { label: 'Nederlands', code: 'nl', path: 'nl' },
  { label: 'Français', code: 'fr', path: 'fr' },
  { label: 'Italiano', code: 'it', path: 'it' },
  { label: 'Português', code: 'pt', path: 'pt' },
  { label: 'Ελληνικά', code: 'el', path: 'el' },
];

// Not yet deployed. Labels are a best guess at each language's native
// self-name, following the pattern above ("Nederlands" not "Dutch") —
// unconfirmed, since none of these exist in the live dropdown yet to
// check against. If the real label ships differently, the affected
// test below will just keep skipping (never false-fail) until the label
// here is corrected to match — worth a quick look the first time this
// suite runs after the rollout ships.
const PENDING_LOCALES = [
  { label: 'Deutsch', code: 'de', path: 'de' },
  { label: 'Suomi', code: 'fi', path: 'fi' },
  { label: 'Español', code: 'es', path: 'es' },
  { label: 'Svenska', code: 'sv', path: 'sv' },
  { label: 'Norsk', code: 'no', path: 'no' },
];

test.describe('beta.wildies.com — locale switching', () => {
  test.beforeEach(async () => {
    allure.parentSuite('Wildies');
    allure.subSuite('Localizations');
    allure.epic('Wildies');
    allure.feature('Localization');
    allure.owner('QA Automation');
  });

  // Excludes English — see the comment on EXISTING_LOCALES above; a
  // direct URL to the default locale isn't reliable in this environment
  // (geo-redirected), so it's covered by the dropdown-switch test instead.
  for (const locale of EXISTING_LOCALES.filter((l) => l.label !== 'English')) {
    test(`Direct URL loads the correct locale — ${locale.label}`, { tag: ['@localization'] }, async ({ page }) => {
      allure.severity('critical');
      allure.description(
        `Navigates directly to "/${locale.path}" and confirms <html lang="${locale.code}"> is set and the ` +
          'page renders without breakage.'
      );

      const wildiesPage = new WildiesPage(page);
      await wildiesPage.open(locale.path);

      await test.step('Confirm the active locale', async () => {
        expect(await wildiesPage.getCurrentLocale()).toBe(locale.code);
      });

      await wildiesPage.attachScreenshot(`${locale.label} — direct URL`);
    });
  }

  test('Switcher lists every currently available locale', { tag: ['@localization'] }, async ({ page }) => {
    allure.severity('normal');
    allure.description(
      'Reads the sidebar language dropdown and confirms it lists every locale known to already be live. Also ' +
        "records (as a parameter, without failing) which of the 5 pending locales — if any — are already in " +
        "the dropdown, so this test's own run history documents the rollout as it happens."
    );

    const wildiesPage = new WildiesPage(page);
    await wildiesPage.open();
    const labels = await wildiesPage.getAvailableLocaleLabels();
    allure.parameter('Available locales', labels.join(', '));

    for (const locale of EXISTING_LOCALES) {
      expect(labels).toContain(locale.label);
    }

    const nowLive = PENDING_LOCALES.filter((l) => labels.includes(l.label));
    allure.parameter('Pending locales already live', nowLive.length > 0 ? nowLive.map((l) => l.label).join(', ') : 'none yet');
  });

  test.describe('Switch via the sidebar dropdown', () => {
    // Includes English here (unlike the direct-URL loop above) — the
    // dropdown switch is a client-side route change, confirmed live
    // 2026-08-28 to correctly land on English regardless of the
    // environment's geo-detected default, unlike a direct URL visit.
    for (const locale of EXISTING_LOCALES) {
      test(`Selecting "${locale.label}" navigates and updates <html lang>`, { tag: ['@localization'] }, async ({ page }) => {
        allure.severity('normal');
        allure.description(
          `Opens the sidebar language dropdown, selects "${locale.label}", and confirms the URL and ` +
            `<html lang="${locale.code}"> both update — not just a direct URL visit.`
        );

        const wildiesPage = new WildiesPage(page);
        await wildiesPage.open();
        const lang = await wildiesPage.switchLocale(locale.label);
        expect(lang).toBe(locale.code);
        await wildiesPage.attachScreenshot(`${locale.label} — via dropdown`);
      });
    }
  });

  test.describe('Pending locales (German/Finnish/Spanish/Swedish/Norwegian rollout)', () => {
    for (const locale of PENDING_LOCALES) {
      test(`${locale.label} becomes available once deployed`, { tag: ['@localization', '@pending'] }, async ({ page }) => {
        allure.severity('normal');
        allure.description(
          `Not yet live as of 2026-08-28 — self-skips with a clear reason while "${locale.label}" is absent ` +
            `from the dropdown. Starts actually validating (URL "/${locale.path}", <html lang="${locale.code}">, ` +
            'a full UI check) automatically the moment it ships — no code change needed, just re-run this suite.'
        );

        const wildiesPage = new WildiesPage(page);
        await wildiesPage.open();
        const labels = await wildiesPage.getAvailableLocaleLabels();
        test.skip(!labels.includes(locale.label), `"${locale.label}" not yet in the dropdown — not deployed yet`);

        const lang = await wildiesPage.switchLocale(locale.label);
        expect(lang).toBe(locale.code);
        await wildiesPage.attachScreenshot(`${locale.label} — via dropdown`);
      });
    }
  });
});
