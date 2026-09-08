/**
 * Per-provider "how to place one real minimum-bet spin" recipes for
 * `tests/spinoloco-real-bet.spec.ts`. Each provider's game client renders
 * on an opaque `<canvas>` inside a cross-origin iframe with no accessible
 * DOM (same constraint as `WildiesPage.spinFirstAvailableGame()`, which
 * needed a one-time manual coordinate investigation for its ONE game) —
 * there is no generic "click here" that works across different game
 * engines, so this is filled in incrementally, one provider at a time, by
 * actually opening a representative game from that provider and noting
 * where its bet-reduce and spin controls land at the pinned 1280x800
 * viewport `spinoloco-real-bet.spec.ts` uses.
 *
 * A provider with no entry here is SKIPPED by the real-bet check (not
 * silently — it's listed in that test's "pending investigation" finding)
 * rather than guessed at with unconfirmed coordinates that could place a
 * much larger bet than intended or click the wrong control entirely.
 */
export interface BetRecipe {
  /** One representative game's `/pl/game/real/{id}` path for this provider, confirmed live. */
  gamePath: string;
  /** Coordinates to click, in order, once the game has reached a playable state. */
  steps: Array<{ x: number; y: number; description: string; clicks?: number; delayMs?: number }>;
  /** Extra settle time (ms) after the provider's loading screen before `steps` starts clicking. */
  loadWaitMs?: number;
}

/**
 * Keyed by the provider label exactly as it renders on the game card
 * (`WizGameCard_..._providerName`'s text) — case-sensitive, matching the
 * site's own casing (e.g. "Pragmatic", "EGT", "PRAGMATIC LIVE").
 */
export const BET_RECIPES: Record<string, BetRecipe> = {
  // Populated incrementally — see this file's own comment above.
};
