import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { attachment, ContentType } from 'allure-js-commons';
import { SpinolocoPage } from '../pages/SpinolocoPage';
import { GameEntry, gameKey, isUmbrellaCategory } from '../utils/spinolocoCatalog';
import { recordIssue } from '../utils/issueTracker';

/**
 * spinoloco7545.com — Provider Launch checks #1 (every Casino/Live Casino
 * game has a real thumbnail, not a stub) and #4 (every game is assigned
 * to at least one thematic category). Both scan the FULL catalog on every
 * run (no sharding — unlike the launch check, this never opens an
 * individual game, just reads the lobby grid + follows category
 * "Zobacz wszystkie" links, cheap enough to do in full each time).
 *
 * Mobile-only (2026-09-08 decision — see `utils/deviceViewports.ts` and
 * `playwright.spinoloco.config.ts`'s project): most real players are on
 * mobile, and a missing thumbnail/category isn't a viewport-dependent
 * bug, so running the full catalog scan twice (once per viewport) bought
 * nothing but double the runtime.
 *
 * Red-or-green only, by explicit request (2026-09-08) — unlike Wildies'
 * orange `broken` pattern (which exists for INCIDENTAL findings
 * alongside what a test is really checking), a broken thumbnail or an
 * uncategorized game here IS the exact thing this check exists to catch,
 * not a side note next to it. A finding fails the test red, with a
 * human-readable "what went wrong" / "what to recheck manually" writeup
 * in the test's own Description (via `recordIssue`, visible on Overview,
 * no step-drilling needed) plus the full list as a JSON attachment.
 */
test.describe('spinoloco7545.com — Thumbnails & Categories', () => {
  test.beforeEach(async () => {
    allure.parentSuite('Spinoloco — Provider Launch');
    allure.epic('Spinoloco — Provider Launch');
    allure.owner('QA Automation');
  });

  test('Thumbnail check — every Casino & Live Casino game has a real image', { tag: ['@provider-launch'] }, async ({ page }) => {
    test.setTimeout(45 * 60_000);
    allure.suite('1. Thumbnail Check');
    allure.feature('1. Thumbnail Check');
    allure.severity('normal');
    allure.description(
      'What this checks, in plain terms: every game tile on the brand (both regular Casino slots and Live ' +
        'Casino tables) must show its OWN real artwork, not a broken image or a generic placeholder. ' +
        'How: loads the entire Slots and Live Casino catalogs (via "Wczytaj więcej" pagination) and forces every ' +
        'thumbnail to actually load, flagging any whose image never resolves to real pixel data.'
    );

    const spinoloco = new SpinolocoPage(page);
    await spinoloco.open();

    const broken: GameEntry[] = [];
    let totalGames = 0;
    let cappedAny = false;

    for (const [goTo, humanName] of [
      ['goToSlots', 'Casino (Slots)'],
      ['goToLiveCasino', 'Live Casino'],
    ] as const) {
      await test.step(`Scan every ${humanName} thumbnail for a real image`, async () => {
        await spinoloco[goTo]();
        const { games, cappedOut } = await spinoloco.collectFullCatalog();
        totalGames += games.length;
        cappedAny = cappedAny || cappedOut;
        const brokenHere = await spinoloco.findBrokenThumbnails();
        broken.push(...brokenHere);
        allure.parameter(`${humanName} — games scanned`, String(games.length));
        allure.parameter(`${humanName} — broken thumbnails found`, String(brokenHere.length));
      });
    }

    allure.parameter('Total games scanned', String(totalGames));
    await attachment('Broken thumbnails', JSON.stringify(broken, null, 2), ContentType.JSON);
    await spinoloco.attachScreenshot('Thumbnail check');

    if (cappedAny) {
      recordIssue({
        where: 'Thumbnail check',
        severity: 'Low',
        rootCause: 'Hit the "Load more" pagination cap before reaching the end of the catalog — this run did not scan every game.',
        whatToCheck: 'Re-run, or raise the pagination cap in loadMoreUntilAll() if the catalog has grown past it.',
        explainsFailure: true,
      });
    }
    if (broken.length > 0) {
      recordIssue({
        where: 'Broken thumbnails',
        severity: 'Medium',
        whatChecked: `${totalGames} games across Slots + Live Casino.`,
        rootCause: `${broken.length} game(s) served a thumbnail URL that never resolved to real image data (naturalWidth stayed 0): ${broken
          .slice(0, 15)
          .map((g) => `${g.provider}/${g.name}`)
          .join(', ')}${broken.length > 15 ? ', ...(see attached JSON)' : ''}.`,
        whatToCheck: 'Open each listed game card and confirm whether it shows a broken-image icon / generic placeholder instead of real art.',
        explainsFailure: true,
      });
    }

    expect(totalGames, 'The catalog scrape found zero games — likely a selector/pagination break, not a real empty catalog').toBeGreaterThan(0);
    expect(cappedAny, 'Pagination cap reached before the full catalog loaded — see Description').toBe(false);
    expect(broken, 'Game(s) with a broken/stub thumbnail — see Description and the attached JSON for the full list').toEqual([]);
  });

  test('Category check — every game is assigned at least one category', { tag: ['@provider-launch'] }, async ({ page }) => {
    test.setTimeout(45 * 60_000);
    allure.suite('4. Category Check');
    allure.feature('4. Category Check');
    allure.severity('normal');
    allure.description(
      'What this checks, in plain terms: every game must be filed under at least one real, browsable category ' +
        '(e.g. Sweet Bonanza → Video Slots) — not just findable via the raw "all Slots"/"all Live" list — so a ' +
        "player can actually discover it while browsing by genre, not only by scrolling the entire catalog. How: " +
        "cross-references the full Slots + Live Casino catalog against every category chip on the site's " +
        'homepage (Jackpots, Egyptian, Crash Games, ...) and flags any game that doesn\'t show up in at least one ' +
        "thematic category — a chip covering almost the entire catalog by itself (an \"all games\" umbrella) " +
        "doesn't count toward this."
    );

    const spinoloco = new SpinolocoPage(page);
    await spinoloco.open();

    const masterCatalog = new Map<string, GameEntry>();
    await test.step('Collect the full Casino + Live Casino game list (the master list every game must appear in a category from)', async () => {
      for (const goTo of ['goToSlots', 'goToLiveCasino'] as const) {
        await spinoloco[goTo]();
        const { games } = await spinoloco.collectFullCatalog();
        for (const g of games) masterCatalog.set(gameKey(g), g);
      }
      allure.parameter('Total games in master catalog', String(masterCatalog.size));
    });

    const categorized = new Set<string>();
    let uniqueSections: Array<{ label: string; games: GameEntry[] }> = [];
    let brokenSections: string[] = [];
    await test.step("Discover every category chip on the brand's homepage and record which games each one lists", async () => {
      const result = await spinoloco.getCategorySections();
      uniqueSections = result.sections;
      brokenSections = result.failedLabels;
    });
    allure.parameter('Category sections discovered', uniqueSections.map((s) => s.label).join(', ') || '(none)');

    const umbrellaSections: string[] = [];
    for (const section of uniqueSections) {
      // A chip covering almost the ENTIRE catalog by itself (an "all
      // games" umbrella listing) doesn't count as a real thematic
      // placement — see `isUmbrellaCategory()`'s own comment for why this
      // is a coverage-ratio check, not a label match.
      if (isUmbrellaCategory(section.games.length, masterCatalog.size)) {
        umbrellaSections.push(section.label);
        continue;
      }
      for (const g of section.games) categorized.add(gameKey(g));
    }
    allure.parameter('Umbrella (excluded) sections', umbrellaSections.join(', ') || '(none)');

    const uncategorized = [...masterCatalog.values()].filter((g) => !categorized.has(gameKey(g)));
    await attachment('Uncategorized games', JSON.stringify(uncategorized, null, 2), ContentType.JSON);
    await spinoloco.attachScreenshot('Category check');

    if (uniqueSections.length === 0) {
      recordIssue({
        where: 'Category discovery',
        severity: 'Needs triage',
        rootCause: 'getCategorySections() found zero homepage category chips, so no category membership could be verified this run.',
        whatToCheck: 'Open the homepage by hand and confirm the category chip row (Jackpots, Egyptian, Crash Games, ...) is still present with the same markup this check expects.',
        explainsFailure: true,
      });
    }
    if (brokenSections.length > 0) {
      recordIssue({
        where: 'Category chips',
        severity: 'Medium',
        rootCause: `${brokenSections.length} category chip(s) failed to filter/scrape: ${brokenSections.join(', ')}.`,
        whatToCheck: 'Open the homepage directly, click each listed chip, and confirm whether it genuinely fails to filter the grid.',
        explainsFailure: true,
      });
    }
    if (uncategorized.length > 0 && uniqueSections.length > 0) {
      recordIssue({
        where: 'Uncategorized games',
        severity: 'Medium',
        whatChecked: `${masterCatalog.size} games against ${uniqueSections.length} category chip(s): ${uniqueSections.map((s) => s.label).join(', ')}.`,
        rootCause: `${uncategorized.length} game(s) don't appear under any of the discovered category chips: ${uncategorized
          .slice(0, 15)
          .map((g) => `${g.provider}/${g.name}`)
          .join(', ')}${uncategorized.length > 15 ? ', ...(see attached JSON)' : ''}.`,
        whatToCheck: 'Confirm in the backoffice/CMS whether these games are genuinely missing a category assignment.',
        explainsFailure: true,
      });
    }

    expect(masterCatalog.size, 'The catalog scrape found zero games — likely a selector/pagination break, not a real empty catalog').toBeGreaterThan(0);
    expect(uniqueSections.length, 'No category chips were discovered — see Description').toBeGreaterThan(0);
    expect(brokenSections, 'Category chip(s) failed to filter/scrape — see Description').toEqual([]);
    expect(uncategorized, 'Game(s) with no thematic category — see Description and the attached JSON for the full list').toEqual([]);
  });
});
