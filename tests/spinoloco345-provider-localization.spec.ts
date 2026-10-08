import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { attachment, ContentType, step } from 'allure-js-commons';
import * as fs from 'fs';
import * as path from 'path';
import { Spinoloco345Page } from '../pages/Spinoloco345Page';
import { classifyGameLanguage, LanguageClassification } from '../utils/gameLanguageHeuristic';

/**
 * spinoloco345.com — one representative game per provider, on the
 * Portuguese (pt) locale, to find which providers' own in-game UI is
 * still English-only (per explicit request 2026-09-21 — same discovery
 * goal as `shelbyspin-provider-localization.spec.ts`, different brand,
 * different platform, different target language).
 *
 * This brand has NO manual language switcher (see `Spinoloco345Page`'s
 * class comment) — locale is geo-IP only. Confirmed live 2026-09-21 the
 * ambient network already resolves to `pt` with no VPN; `confirmLocale()`
 * fails fast with an actionable message if that's no longer true when
 * this runs.
 *
 * Same language-detection approach and its same limits as the ShelbySpin
 * suite: most game engines render through `<canvas>` (confirmed live on
 * this brand's own Novomatic games, same `yavuno.com` wrapper), so this
 * checks the game's own frame URL(s) for a language parameter first and
 * always attaches a screenshot as the fallback a human checks by hand.
 */
const EMAIL = process.env.SPINOLOCO345_TEST_USER_EMAIL;
const PASSWORD = process.env.SPINOLOCO345_TEST_USER_PASSWORD;
const TARGET_LOCALE = 'pt';
const RESULTS_FILE = path.join(__dirname, '..', 'spinoloco345-pt-localization-report.json');
const SCREENSHOT_DIR = path.join(__dirname, '..', 'spinoloco345-screenshots');

interface ProviderResult {
  provider: string;
  launched: boolean;
  verdict: LanguageClassification['verdict'];
  languageParams: string[];
}

test.describe('spinoloco345.com — Provider Portuguese-localization audit', () => {
  test.skip(!EMAIL || !PASSWORD, 'No Spinoloco345 test account configured (SPINOLOCO345_TEST_USER_EMAIL/SPINOLOCO345_TEST_USER_PASSWORD)');

  test.beforeEach(async () => {
    allure.parentSuite('Spinoloco345');
    allure.suite('Provider Portuguese-localization audit');
    allure.epic('Spinoloco345');
    allure.feature('Provider language check');
    allure.owner('QA Automation');
  });

  test(
    'Launch one game per provider on pt locale and flag English-only UIs',
    { tag: ['@spinoloco345', '@localization'] },
    async ({ page }) => {
      test.setTimeout(90 * 60_000);
      allure.severity('normal');
      allure.description(
        'Discovery check, not a regression gate: launches one game from every provider in the live catalog ' +
          "while the session is on the Portuguese (pt) locale, and checks the game's own frame URL(s) for a " +
          "language parameter (most game engines here render via <canvas>, so there's no on-screen DOM text " +
          'to read). Flags providers that launched with English instead of Portuguese. Every provider also ' +
          'gets a screenshot attached, since a missing language parameter (verdict "inconclusive") still ' +
          'needs a human glance to actually confirm the UI language.'
      );

      const spinoloco = new Spinoloco345Page(page);
      await spinoloco.open();
      await spinoloco.confirmLocale(TARGET_LOCALE);
      await spinoloco.login(EMAIL!, PASSWORD!);

      let providers = await spinoloco.getProviderSlugs();
      allure.parameter('Providers discovered', String(providers.length));

      const cap = Number(process.env.SPINOLOCO345_MAX_PROVIDERS);
      if (cap > 0) providers = providers.slice(0, cap);

      // Re-check pass, e.g. for providers a first run couldn't visually
      // confirm (stuck on their own loading screen) — case-insensitive,
      // comma-separated, matched against the live-discovered slugs so a
      // slightly different capitalization/spacing still hits.
      const only = process.env.SPINOLOCO345_ONLY_PROVIDERS;
      if (only) {
        const wanted = new Set(only.split(',').map((p) => p.trim().toLowerCase()));
        providers = providers.filter((p) => wanted.has(p.toLowerCase()));
        allure.parameter('Providers filtered to', providers.join(', '));
      }

      const results: ProviderResult[] = [];

      // Written after EVERY provider, not just once at the end — a run
      // this long (72 providers × ~35-40s) hit a transient network
      // timeout on a single `page.goto` twice already (confirmed live
      // 2026-09-22), and losing 27+ minutes of already-computed results
      // to one provider's hiccup is worse than the extra disk writes.
      const saveResults = () => fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

      for (const provider of providers) {
        await step(`Provider: ${provider}`, async () => {
          // A single provider's transient failure (network timeout,
          // page crash, ...) must not take down the other 71 — caught
          // per-provider and recorded as its own result instead of
          // letting it propagate and abort the whole suite.
          try {
            const { launched } = await spinoloco.launchFirstGameForProvider(provider);

            if (!launched) {
              results.push({ provider, launched: false, verdict: 'inconclusive', languageParams: [] });
              saveResults();
              await step('No game launched for this provider — skipping language check', async () => {});
              return;
            }

            await page.waitForTimeout(2_000);
            const languageParams = await spinoloco.getGameFrameLanguageParams();
            const classification = classifyGameLanguage(languageParams, TARGET_LOCALE);

            results.push({ provider, launched: true, verdict: classification.verdict, languageParams });
            saveResults();

            // 8s wasn't enough for a good chunk of providers on the first
            // full run (still on their own branding/loading screen at
            // that point) — confirmed live 2026-09-21 several of them
            // (Evolution, Onlyplay, Pgsoft, ...) needed closer to 20-25s
            // total. Bumped, with the env override below for a targeted
            // re-check pass that can afford to wait even longer per
            // provider since it's checking far fewer of them.
            const extraWaitMs = Number(process.env.SPINOLOCO345_SCREENSHOT_DELAY_MS) || 20_000;
            await page.waitForTimeout(extraWaitMs);
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
          } catch (err) {
            results.push({ provider, launched: false, verdict: 'inconclusive', languageParams: [] });
            saveResults();
            await step(`Provider errored, recorded as inconclusive and moving on: ${(err as Error).message.split('\n')[0]}`, async () => {});
          }
        });
      }

      fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
      await attachment('Full results (JSON)', JSON.stringify(results, null, 2), ContentType.JSON);

      const englishOnly = results.filter((r) => r.verdict === 'english');
      const portuguese = results.filter((r) => r.verdict === 'target-locale');
      const otherLanguage = results.filter((r) => r.verdict === 'other-language');
      const inconclusive = results.filter((r) => r.verdict === 'inconclusive');

      allure.parameter('Portuguese-confirmed providers', String(portuguese.length));
      allure.parameter('English-only providers', String(englishOnly.length));
      allure.parameter('Other-language providers', String(otherLanguage.length));
      allure.parameter('Inconclusive (no game launched / no language param)', String(inconclusive.length));

      const summaryHtml = `<div style="font-family: sans-serif; font-size: 13px;">
        <p><strong>${englishOnly.length}</strong> provider(s) launched with an English language parameter instead of Portuguese:</p>
        <ul>${englishOnly.map((r) => `<li>${r.provider} — ${r.languageParams.join(', ')}</li>`).join('')}</ul>
        <p>${portuguese.length} confirmed Portuguese, ${otherLanguage.length} launched with some other language,
        ${inconclusive.length} inconclusive (game didn't launch, or no language parameter was found in any
        frame URL — check that provider's attached screenshot by hand). See the full JSON attachment for
        every provider's raw language-parameter findings.</p>
      </div>`;
      await allure.descriptionHtml(summaryHtml);

      expect(results.length).toBeGreaterThan(0);
    }
  );
});
