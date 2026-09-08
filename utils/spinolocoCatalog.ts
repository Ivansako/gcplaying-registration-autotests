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
 * The 26 CMS "categories" (confirmed live 2026-09-08 via `pageProps.categories`
 * on `/pl/slots`) mix genuine thematic groupings (JACKPOTS, MEGAWAYS,
 * EGYPTIAN, LIVE ROULETTE, ...) with umbrella/system tabs that either
 * contain the ENTIRE catalog by definition (SLOTS = literally the full
 * Slots listing, LIVE = the full Live Casino listing) or are time/rank
 * based rather than a real placement (NEW, TOP PL, FEATURED, New
 * Provider). Counting membership in an umbrella tab as "has a category"
 * would make check #4 pass trivially for every single game — excluded so
 * the check actually verifies genre-level discoverability, matching the
 * brief's own example ("Sweet Bonanza is in Video Slots", not just "is a
 * slot").
 */
export const NON_THEMATIC_CATEGORY_LABELS = new Set(['SLOTY', 'LIVE GAMES', 'NEW GAMES', 'TOP PL', 'FEATURED', 'New Provider']);

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
