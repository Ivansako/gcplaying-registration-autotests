import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { attachment, ContentType } from 'allure-js-commons';
import { SpinolocoPage } from '../pages/SpinolocoPage';
import { GameEntry, gameKey, selectShard } from '../utils/spinolocoCatalog';
import { recordIssue } from '../utils/issueTracker';

/**
 * spinoloco7545.com — Provider Launch check #2: every Casino/Live Casino
 * game reaches a playable state (or its "Press anywhere to start" splash)
 * with no tech error (geo-block, 500, "Failed", ...).
 *
 * Mobile-only (2026-09-08 decision — see `utils/deviceViewports.ts`).
 *
 * Sharded by calendar day (see `spinolocoCatalog.ts`'s
 * `shardIndexForToday()`): the catalog is ~4371+ Slots games alone, and
 * literally launching every single one every run would take many hours.
 * Each run covers one day's slice; running the suite daily cycles through
 * the FULL catalog over `ceil(catalogSize / SHARD_SIZE)` days.
 *
 * Launches games CONCURRENTLY across several browser tabs within this one
 * test (2026-09-08 decision, after a first real CI run showed this check
 * would otherwise dominate the suite's runtime) — NOT via Playwright's
 * own `--workers`, since the shard itself is only known by scraping the
 * LIVE catalog at runtime, and `--workers` parallelism needs every test
 * case statically known before the run starts. `context.newPage()` per
 * lane sidesteps that: one test, N real tabs, no separate pre-fetch step
 * needed, and the rest of the suite (thumbnails/categories/real-bet)
 * keeps running single-threaded exactly as before.
 *
 * Red-or-green only (2026-09-08 decision) — a game failing to launch IS
 * what this check exists to catch, so any failure in the shard fails the
 * test red, with the full list in the Description and an attached JSON.
 * A per-game screenshot is ALSO attached for every game (not just
 * failures) — see `SpinolocoPage.attachGameScreenshot()` — since no
 * automated check can confirm the game's own Spin/Play button actually
 * rendered (opaque canvas, no accessible DOM); a human scans the
 * screenshots to catch that specifically.
 */
const SHARD_SIZE = Number(process.env.SPINOLOCO_SHARD_SIZE) || 200;
const CONCURRENCY = Number(process.env.SPINOLOCO_LAUNCH_CONCURRENCY) || 10;

test.describe('spinoloco7545.com — Game Launch', () => {
  test.beforeEach(async () => {
    allure.parentSuite('Spinoloco');
    allure.subSuite('Provider Launch');
    allure.epic('Spinoloco');
    allure.feature('Provider Launch');
    allure.owner('QA Automation');
  });

  test(
    "Launch check — today's shard of the catalog opens with no tech errors",
    { tag: ['@provider-launch'] },
    async ({ page, context }) => {
      test.setTimeout(30 * 60_000);
      allure.severity('critical');
      allure.description(
        `Launches today's shard of the full Slots + Live Casino catalog across ${CONCURRENCY} concurrent tabs and ` +
          'confirms each game either reaches the third-party iframe (playable, or the "Press anywhere to start" ' +
          'splash) or surfaces an explicit error — a game that does neither within 30s is flagged as a launch ' +
          'failure. A screenshot is attached for every game so a human can confirm the Spin/Play button actually ' +
          "rendered — that specific check can't be automated (opaque canvas, no accessible DOM)."
      );

      const spinoloco = new SpinolocoPage(page);
      await spinoloco.open();

      // Tracks which page (Slots vs Live Casino) each game came from —
      // needed because launching a game navigates away, and each lane
      // must know which lobby to reopen before re-finding the next card.
      const origin = new Map<string, 'slots' | 'live'>();
      const seen = new Map<string, GameEntry>();
      for (const [goTo, tag] of [
        ['goToSlots', 'slots'],
        ['goToLiveCasino', 'live'],
      ] as const) {
        await spinoloco[goTo]();
        const { games } = await spinoloco.collectFullCatalog();
        for (const g of games) {
          const key = gameKey(g);
          seen.set(key, g);
          origin.set(key, tag);
        }
      }
      const fullCatalog = [...seen.values()];

      const { shard, shardIndex, shardCount } = selectShard(fullCatalog, SHARD_SIZE);
      allure.parameter('Shard', `${shardIndex + 1} / ${shardCount} (${shard.length} games)`);
      allure.parameter('Full catalog size', String(fullCatalog.length));
      allure.parameter('Concurrency', String(CONCURRENCY));

      // Round-robin the shard across lanes so each lane gets a similar
      // mix of Slots/Live Casino games rather than one lane getting all
      // of one type.
      const lanes: GameEntry[][] = Array.from({ length: Math.min(CONCURRENCY, Math.max(1, shard.length)) }, () => []);
      shard.forEach((g, i) => lanes[i % lanes.length].push(g));

      const failures: Array<GameEntry & { reason?: string }> = [];

      async function runLane(lanePage: typeof page, laneGames: GameEntry[]): Promise<void> {
        const laneSpinoloco = new SpinolocoPage(lanePage);
        for (const [goTo, games] of [
          ['goToSlots', laneGames.filter((g) => origin.get(gameKey(g)) === 'slots')],
          ['goToLiveCasino', laneGames.filter((g) => origin.get(gameKey(g)) === 'live')],
        ] as const) {
          if (games.length === 0) continue;
          for (const game of games) {
            // Explicitly re-open the lobby before EVERY game, rather
            // than trusting `launchGameAndCheck()`'s internal
            // `page.goBack()` to land back on it — confirmed live
            // 2026-09-09 that back navigation can land on the site's
            // HOMEPAGE instead of `/it/slots`/`/it/live-games`, silently
            // breaking every subsequent card lookup in the lane (2 of 3
            // games in one run failed only because of this, not because
            // the games themselves were broken).
            await laneSpinoloco[goTo]();
            await laneSpinoloco.loadMoreUntilAll();
            const result = await laneSpinoloco.launchGameAndCheck(game);
            if (!result.ok) failures.push({ ...game, reason: result.reason });
            await laneSpinoloco.attachGameScreenshot(`${game.provider} — ${game.name}${result.ok ? '' : ' (FAILED)'}`);
          }
        }
      }

      const extraPages = await Promise.all(lanes.slice(1).map(() => context.newPage()));
      try {
        await Promise.all(lanes.map((laneGames, i) => runLane(i === 0 ? page : extraPages[i - 1], laneGames)));
      } finally {
        await Promise.all(extraPages.map((p) => p.close().catch(() => {})));
      }

      await attachment('Launch failures', JSON.stringify(failures, null, 2), ContentType.JSON);

      if (failures.length > 0) {
        recordIssue({
          where: 'Game launch failures',
          severity: 'High',
          whatChecked: `${shard.length} games (shard ${shardIndex + 1}/${shardCount} of the full ${fullCatalog.length}-game catalog), ${CONCURRENCY} concurrent tabs.`,
          rootCause: `${failures.length} game(s) didn't reach a playable state / showed an error: ${failures
            .slice(0, 15)
            .map((g) => `${g.provider}/${g.name} (${g.reason})`)
            .join('; ')}${failures.length > 15 ? ', ...(see attached JSON)' : ''}.`,
          whatToCheck: 'Open each listed game directly and confirm whether it genuinely fails to launch (geo-block, 500, timeout) or this was a one-off network blip. Also scan the per-game screenshots for a missing Spin/Play button — that failure mode passes the automated check by design.',
          explainsFailure: true,
        });
      }

      expect(shard.length, 'The catalog scrape found zero games for this shard — likely a selector/pagination break').toBeGreaterThan(0);
      expect(failures, 'Game(s) that failed to launch cleanly — see Description and the attached JSON for the full list').toEqual([]);
    }
  );
});
