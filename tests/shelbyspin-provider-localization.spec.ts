import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { attachment, ContentType, step } from 'allure-js-commons';
import * as fs from 'fs';
import * as path from 'path';
import { ShelbySpinPage } from '../pages/ShelbySpinPage';
import { classifyGameLanguage, LanguageClassification } from '../utils/gameLanguageHeuristic';

const TARGET_LOCALE = 'nl';

/**
 * shelbyspin3322.com — one representative game per provider, on the
 * Dutch (nl) locale, to find which providers still launch with an
 * English `language` parameter instead of Dutch (per explicit request
 * 2026-09-21: a discovery list to hand to those providers, not a
 * pass/fail regression gate — a provider showing English isn't a bug in
 * THIS brand's own code). Every game engine here renders through
 * `<canvas>` (confirmed live 2026-09-21 across Pragmatic, Novomatic,
 * ...) — there is no on-screen DOM text to read, so this checks the
 * game's own frame URL(s) for a language parameter instead (see
 * `ShelbySpinPage.getGameFrameLanguageParams()`), falling back to a
 * screenshot for a human to check when no such parameter is found.
 *
 * Switches to Dutch via the site's own sidebar language switcher — NOT
 * a VPN (see `ShelbySpinPage`'s class comment: a Netherlands-IP also
 * trips a regulatory game-access block on this brand, so VPN'ing to get
 * Dutch would make every single game launch fail).
 *
 * One long test, not one-test-per-provider: the provider list itself is
 * only known by scraping the LIVE homepage at runtime (61 confirmed
 * 2026-09-21, may change), which Playwright can't turn into statically
 * discovered test cases — same reasoning `spinoloco-game-launch.spec.ts`
 * already documents for its own runtime-discovered shard. One login,
 * one continuous session, one `step()` per provider (each renders as
 * its own row in Allure with its screenshot + extracted text attached).
 *
 * The practical deliverable is `shelbyspin-dutch-localization-report.json`
 * at the repo root (rewritten fresh each run) — see
 * `scripts/shelbyspin-language-report.js` for turning it into a plain
 * Markdown table to actually send to providers.
 */
const EMAIL = process.env.SHELBYSPIN_TEST_USER_EMAIL;
const PASSWORD = process.env.SHELBYSPIN_TEST_USER_PASSWORD;
const RESULTS_FILE = path.join(__dirname, '..', 'shelbyspin-dutch-localization-report.json');
const SCREENSHOT_DIR = path.join(__dirname, '..', 'shelbyspin-screenshots');

interface ProviderResult {
  provider: string;
  launched: boolean;
  gameUrl?: string;
  verdict: LanguageClassification['verdict'];
  languageParams: string[];
}

test.describe('shelbyspin3322.com — Provider Dutch-localization audit', () => {
  test.skip(!EMAIL || !PASSWORD, 'No ShelbySpin test account configured (SHELBYSPIN_TEST_USER_EMAIL/SHELBYSPIN_TEST_USER_PASSWORD)');

  test.beforeEach(async () => {
    allure.parentSuite('ShelbySpin3322');
    allure.suite('Provider Dutch-localization audit');
    allure.epic('ShelbySpin3322');
    allure.feature('Provider language check');
    allure.owner('QA Automation');
  });

  test(
    'Launch one game per provider on nl locale and flag English-only UIs',
    { tag: ['@shelbyspin', '@localization'] },
    async ({ page }) => {
      test.setTimeout(90 * 60_000);
      allure.severity('normal');
      allure.description(
        'Discovery check, not a regression gate: launches one game from every provider in the live catalog ' +
          "while the session is on the Dutch (nl) locale, and checks the game's own frame URL(s) for a " +
          "language parameter (game engines here render via <canvas>, so there's no on-screen DOM text to " +
          'read — see `ShelbySpinPage.getGameFrameLanguageParams()`). Flags providers that launched with ' +
          "English instead of Dutch. The resulting shortlist is meant to be handed to those providers to " +
          "request Dutch support — an English hit here is a finding about the PROVIDER, not a bug in this " +
          "brand's own code. Every provider also gets a screenshot attached, since a missing language " +
          'parameter (verdict "inconclusive") still needs a human glance to actually confirm the UI language.'
      );

      const shelbySpin = new ShelbySpinPage(page);
      await shelbySpin.open();
      await shelbySpin.switchLocale('Nederlands');
      await shelbySpin.login(EMAIL!, PASSWORD!);

      let providers = await shelbySpin.getProviderSlugs();
      allure.parameter('Providers discovered', String(providers.length));

      // Debug/smoke-test cap, mirrors `SPINOLOCO_MAX_LOAD_MORE_CLICKS`'s
      // own reasoning — sanity-check the whole flow against a handful of
      // providers in under a minute instead of the full ~61-provider,
      // tens-of-minutes sweep. Unset in normal use.
      const cap = Number(process.env.SHELBYSPIN_MAX_PROVIDERS);
      if (cap > 0) providers = providers.slice(0, cap);

      const results: ProviderResult[] = [];

      for (const provider of providers) {
        await step(`Provider: ${provider}`, async () => {
          const { launched, gameUrl } = await shelbySpin.launchFirstGameForProvider(provider);

          if (!launched) {
            results.push({ provider, launched: false, verdict: 'inconclusive', languageParams: [] });
            await step('No game launched for this provider — skipping language check', async () => {});
            return;
          }

          await page.waitForTimeout(2_000); // let the game engine finish its own launch handshake
          const languageParams = await shelbySpin.getGameFrameLanguageParams();
          const classification = classifyGameLanguage(languageParams, TARGET_LOCALE);

          results.push({
            provider,
            launched: true,
            gameUrl,
            verdict: classification.verdict,
            languageParams,
          });

          // A visible/attached iframe is NOT the same as a visually
          // rendered game — confirmed live 2026-09-21 a screenshot taken
          // only ~2s after launch is still solid black for slower
          // engines (Pragmatic in particular). This extra wait is only
          // for screenshot quality (the language-param check above
          // already ran) — always captured, even when the language
          // param is missing or already confirms Dutch, as the fallback
          // evidence a human checks for every "inconclusive" row,
          // and a sanity double-check for the rest. Saved to disk (not
          // just the Allure attachment) so they're trivial to open and
          // eyeball afterward without generating the Allure HTML report.
          await page.waitForTimeout(8_000);
          const screenshot = await page.screenshot();
          const safeName = provider.replace(/[^a-z0-9-]+/gi, '_');
          fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
          fs.writeFileSync(path.join(SCREENSHOT_DIR, `${safeName}.png`), screenshot);
          await attachment(`${provider} — screenshot (${classification.verdict})`, screenshot, ContentType.PNG);
          await attachment(
            `${provider} — language params found`,
            languageParams.length ? languageParams.join(', ') : '(none found in any frame URL)',
            ContentType.TEXT
          );
        });
      }

      fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
      await attachment('Full results (JSON)', JSON.stringify(results, null, 2), ContentType.JSON);

      const englishOnly = results.filter((r) => r.verdict === 'english');
      const dutch = results.filter((r) => r.verdict === 'target-locale');
      const otherLanguage = results.filter((r) => r.verdict === 'other-language');
      const inconclusive = results.filter((r) => r.verdict === 'inconclusive');

      allure.parameter('Dutch-confirmed providers', String(dutch.length));
      allure.parameter('English-only providers', String(englishOnly.length));
      allure.parameter('Other-language providers', String(otherLanguage.length));
      allure.parameter('Inconclusive (no game launched / no language param)', String(inconclusive.length));

      const summaryHtml = `<div style="font-family: sans-serif; font-size: 13px;">
        <p><strong>${englishOnly.length}</strong> provider(s) launched with an English language parameter instead of Dutch:</p>
        <ul>${englishOnly.map((r) => `<li>${r.provider} — ${r.languageParams.join(', ')}</li>`).join('')}</ul>
        <p>${dutch.length} confirmed Dutch, ${otherLanguage.length} launched with some other language,
        ${inconclusive.length} inconclusive (game didn't launch, or no language parameter was found in any
        frame URL — check that provider's attached screenshot by hand). See the full JSON attachment for
        every provider's raw language-parameter findings.</p>
      </div>`;
      await allure.descriptionHtml(summaryHtml);

      // Discovery tool, not a gate (see class comment) — always green as
      // long as the sweep itself ran; the findings live in the report,
      // not in red/green.
      expect(results.length).toBeGreaterThan(0);
    }
  );
});
