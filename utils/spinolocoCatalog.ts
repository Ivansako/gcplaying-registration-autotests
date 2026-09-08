/**
 * Shared types/helpers for scraping spinoloco7545.com's game catalog
 * (confirmed live 2026-09-08: ~4371 Slots + a separate, smaller Live
 * Casino catalog, no simple paginated REST endpoint — the grid loads via
 * a "Wczytaj więcej" (Load more) button, 42 cards per click). Every game
 * check scrapes the SAME way: click "Load more" until it's gone, read
 * every `[data-card="container"]` in the DOM.
 */
export interface GameEntry {
  /** Card's game-name text, e.g. "Sweet Bonanza". Not globally unique on its own — pair with provider. */
  name: string;
  provider: string;
  imageUrl: string;
}

export function gameKey(g: Pick<GameEntry, 'name' | 'provider'>): string {
  return `${g.provider}::${g.name}`;
}

/**
 * Default "Load more" click cap for `SpinolocoPage.collectFullCatalog()`
 * — overridable via `SPINOLOCO_MAX_LOAD_MORE_CLICKS` for local iteration
 * (e.g. `SPINOLOCO_MAX_LOAD_MORE_CLICKS=3` to sanity-check pagination
 * itself in seconds instead of scraping the full ~4371-game catalog).
 * `undefined` lets the caller fall back to its own default (250) rather
 * than forcing this value everywhere it's read.
 */
export function defaultMaxLoadMoreClicks(): number | undefined {
  const raw = Number(process.env.SPINOLOCO_MAX_LOAD_MORE_CLICKS);
  return raw > 0 ? raw : undefined;
}

/**
 * The site's category "See all" sections (confirmed live: e.g. "SLOTY"/
 * all-Slots, "Giochi Top"/Top Games, ...) mix genuine thematic groupings
 * (Jackpots, Megaways, Egyptian, Live Roulette, ...) with umbrella/system
 * tabs that contain almost the ENTIRE catalog by definition (an "all
 * Slots" or "all Live" listing). Counting membership in an umbrella tab
 * as "has a category" would make check #4 pass trivially for every
 * single game — excluded so the check actually verifies genre-level
 * discoverability, matching the brief's own example ("Sweet Bonanza is
 * in Video Slots", not just "is a slot").
 *
 * Detected by COVERAGE RATIO (this section's game count vs. the full
 * catalog), not by matching specific label text — the labels are
 * translated per locale (confirmed "SLOTY" in Polish, "Tutti i giochi"/
 * different wording in Italian) and this automation can't reliably force
 * one locale (see `SpinolocoPage`'s own comment on geo-IP locale
 * handling), so a hardcoded label list would silently stop working the
 * moment the session lands on a different locale than whichever it was
 * written against.
 */
export const UMBRELLA_CATEGORY_COVERAGE_RATIO = 0.85;

export function isUmbrellaCategory(sectionGameCount: number, fullCatalogSize: number): boolean {
  if (fullCatalogSize === 0) return false;
  return sectionGameCount / fullCatalogSize >= UMBRELLA_CATEGORY_COVERAGE_RATIO;
}

/**
 * Which shard of the full launch-check catalog to run today. Sharded
 * (per user decision 2026-09-08) because literally launching all ~4371+
 * Slots + Live Casino games in one run is many hours of real browser
 * navigation — this rotates through the whole catalog a fixed-size slice
 * at a time, one slice per calendar day, so repeated runs on the SAME day
 * cover the SAME slice (useful for re-checking a finding) while the
 * catalog is fully covered over `Math.ceil(catalogSize / shardSize)` days.
 * Deliberately stateless (no cursor file to persist across CI runs,
 * nothing to keep in sync) — the date IS the state.
 */
export function shardIndexForToday(shardCount: number): number {
  if (shardCount <= 0) return 0;
  const dayNumber = Math.floor(Date.now() / 86_400_000);
  return dayNumber % shardCount;
}

export function selectShard<T>(items: T[], shardSize: number): { shard: T[]; shardIndex: number; shardCount: number } {
  const shardCount = Math.max(1, Math.ceil(items.length / shardSize));
  const shardIndex = shardIndexForToday(shardCount);
  const start = shardIndex * shardSize;
  return { shard: items.slice(start, start + shardSize), shardIndex, shardCount };
}
