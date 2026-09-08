import { test, expect } from '../utils/testWithIssueAnalysis';
import { allure } from 'allure-playwright';
import { attachment, ContentType } from 'allure-js-commons';
import { SpinolocoPage } from '../pages/SpinolocoPage';
import { VIEWPORTS } from '../utils/deviceViewports';
import { GameEntry, gameKey, selectShard } from '../utils/spinolocoCatalog';
import { recordIssue } from '../utils/issueTracker';

/**
 * spinoloco7545.com — Provider Launch check #2: every Casino/Live Casino
 * game reaches a playable state (or its "Press anywhere to start" splash)
 * with no tech error (geo-block, 500, "Failed", ...).
 *
 * Sharded by calendar day (per user decision 2026-09-08 — see
 * `spinolocoCatalog.ts`'s `shardIndexForToday()`): the catalog is ~4371+
 * Slots games alone, and literally launching every single one every run
 * would take many hours. Each run covers one day's slice; running the
 * suite daily cycles through the FULL catalog over
 * `ceil(catalogSize / SHARD_SIZE)` days. Red-or-green only (2026-09-08
 * decision) — a game failing to launch IS what this check exists to
 * catch, so any failure in the shard fails the test red, with the full
 * list in the Description and an attached JSON.
 */
const SHARD_SIZE = 200;

test.describe('spinoloco7545.com — Game Launch', () => {
  test.beforeEach(async () => {
    allure.parentSuite('Spinoloco');
    allure.subSuite('Provider Launch');
    allure.epic('Spinoloco');
    allure.feature('Provider Launch');
    allure.owner('QA Automation');
  });

  for (const { name: viewportName, config: viewportConfig } of VIEWPORTS) {
    test.describe(viewportName, () => {
      test.use({ ...viewportConfig });

      test(
        `Launch check — today's shard of the catalog opens with no tech errors — ${viewportName}`,
        { tag: ['@provider-launch'] },
        async ({ page }) => {
          test.setTimeout(30 * 60_000);
          allure.severity('critical');
          allure.description(
            "Launches today's shard of the full Slots + Live Casino catalog, one game at a time, and confirms " +
              'each either reaches the third-party iframe (playable, or the "Press anywhere to start" splash) or ' +
              'surfaces an explicit error — a game that does neither within 30s is flagged as a launch failure.'
          );

          const spinoloco = new SpinolocoPage(page);
          await spinoloco.open();

          // Tracks which page (Slots vs Live Casino) each game came from
          // — needed because launching a game navigates away, and this
          // check must know which lobby to reopen before re-finding the
          // card for the NEXT game in its shard.
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

          const failures: Array<GameEntry & { reason?: string }> = [];
          // Grouped by lobby (not launched in shard order) to avoid
          // switching between Slots/Live Casino per game. Whether
          // `page.goBack()` after a launch preserves "Load more"
          // pagination state or resets to the first 42 wasn't confirmed
          // live (this environment got network-blocked mid-investigation
          // — see SpinolocoPage's class comment) — `loadMoreUntilAll()`
          // is cheap (near-instant) when the button's already gone, so
          // calling it again before every launch is correct either way:
          // a no-op if state persisted, the necessary re-pagination if it
          // didn't.
          for (const [goTo, games] of [
            ['goToSlots', shard.filter((g) => origin.get(gameKey(g)) === 'slots')],
            ['goToLiveCasino', shard.filter((g) => origin.get(gameKey(g)) === 'live')],
          ] as const) {
            if (games.length === 0) continue;
            await spinoloco[goTo]();
            await spinoloco.loadMoreUntilAll();
            for (const game of games) {
              const result = await spinoloco.launchGameAndCheck(game);
              if (!result.ok) failures.push({ ...game, reason: result.reason });
              await spinoloco.loadMoreUntilAll();
            }
          }

          await attachment('Launch failures', JSON.stringify(failures, null, 2), ContentType.JSON);
          await spinoloco.attachScreenshot(`Launch check — lobby after the shard finished — ${viewportName}`);

          if (failures.length > 0) {
            recordIssue({
              where: `Game launch failures — ${viewportName}`,
              severity: 'High',
              whatChecked: `${shard.length} games (shard ${shardIndex + 1}/${shardCount} of the full ${fullCatalog.length}-game catalog).`,
              rootCause: `${failures.length} game(s) didn't reach a playable state / showed an error: ${failures
                .slice(0, 15)
                .map((g) => `${g.provider}/${g.name} (${g.reason})`)
                .join('; ')}${failures.length > 15 ? ', ...(see attached JSON)' : ''}.`,
              whatToCheck: 'Open each listed game directly and confirm whether it genuinely fails to launch (geo-block, 500, timeout) or this was a one-off network blip.',
              explainsFailure: true,
            });
          }

          expect(shard.length, 'The catalog scrape found zero games for this shard — likely a selector/pagination break').toBeGreaterThan(0);
          expect(failures, `Game(s) that failed to launch cleanly — see Description and the attached JSON for the full list`).toEqual([]);
        }
      );
    });
  }
});
