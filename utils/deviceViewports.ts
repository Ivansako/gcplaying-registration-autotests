import { devices } from '@playwright/test';

function stripBrowserType(device: (typeof devices)[string]) {
  const { defaultBrowserType, ...rest } = device;
  return rest;
}

/**
 * Mobile-only, by explicit user decision 2026-09-08: most real players
 * are on mobile, and running every Provider Launch check on BOTH
 * viewports doubled an already-expensive full-catalog scan for no real
 * extra signal (a missing thumbnail/category/launch failure isn't a
 * viewport-dependent bug). Desktop dropped entirely across this suite —
 * including the real-bet check's pinned coordinate viewport, so any
 * future bet-recipe investigation (see `spinolocoBetCoordinates.ts`)
 * should be done at THIS exact viewport, not desktop.
 */
export const MOBILE_VIEWPORT = stripBrowserType(devices['Pixel 7']);
