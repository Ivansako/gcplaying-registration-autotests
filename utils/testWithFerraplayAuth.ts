import { test as base } from './testWithIssueAnalysis';

const CF_ACCESS_CLIENT_ID = process.env.FERRAPLAY_CF_ACCESS_CLIENT_ID;
const CF_ACCESS_CLIENT_SECRET = process.env.FERRAPLAY_CF_ACCESS_CLIENT_SECRET;
const FERRAPLAY_HOSTNAME = 'ferraplay.com';

/**
 * Wraps `testWithIssueAnalysis`'s `test` with a Cloudflare Access service
 * token for ferraplay.com — added 2026-09-11 after the site's own
 * Cloudflare Access gate ("Log in to Market Perimeter"... no, "Sign in ·
 * Cloudflare Access") started blocking ALL traffic outright, confirmed
 * live from both GitHub Actions AND this local machine (not just CI) —
 * same mechanism Wildies already needed `testWithWildiesAuth.ts` for,
 * different Cloudflare Access application/token (deliberately
 * FERRAPLAY_-prefixed secret names, not shared with Wildies' own
 * `CF_ACCESS_CLIENT_ID`/`SECRET`).
 *
 * Deliberately NOT set via Playwright's global `use.extraHTTPHeaders` —
 * that sends the header pair to EVERY origin the page talks to,
 * including third-party game providers, analytics, and chat widgets,
 * which would leak the secret well beyond this one site. Routed
 * per-request instead, scoped to exactly `FERRAPLAY_HOSTNAME`, so the
 * credential only ever reaches ferraplay.com itself.
 */
export const test = base.extend<{ _ferraplayAuth: void }>({
  _ferraplayAuth: [
    async ({ page }, use) => {
      if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (url.hostname === FERRAPLAY_HOSTNAME) {
            await route.continue({
              headers: {
                ...route.request().headers(),
                'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
                'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
              },
            });
          } else {
            await route.continue();
          }
        });
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect } from './testWithIssueAnalysis';
