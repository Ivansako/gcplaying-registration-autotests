import { test as base } from './testWithIssueAnalysis';

const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;
const WILDIES_HOSTNAME = 'beta.wildies.com';

/**
 * Wraps `testWithIssueAnalysis`'s `test` with a Cloudflare Access service
 * token for beta.wildies.com — added 2026-08-28 after the site's
 * pre-launch Access gate ("Log in to beta.wildies.com pre-launch gate")
 * started blocking all automated traffic outright, a standing
 * protection unrelated to this repo's own test volume (a real, distinct
 * finding from the earlier, separate "Not available in your country"
 * app-level geo message — see project memory for both).
 *
 * Deliberately NOT set via Playwright's global `use.extraHTTPHeaders` —
 * that sends the header pair to EVERY origin the page talks to,
 * including third-party game providers, analytics, and chat widgets,
 * which would leak the secret well beyond this one site. Routed
 * per-request instead, scoped to exactly `WILDIES_HOSTNAME`, so the
 * credential only ever reaches beta.wildies.com itself.
 */
export const test = base.extend<{ _wildiesAuth: void }>({
  _wildiesAuth: [
    async ({ page }, use) => {
      if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url());
          if (url.hostname === WILDIES_HOSTNAME) {
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
