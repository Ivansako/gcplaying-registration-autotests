import * as fs from 'fs';
import * as path from 'path';

/**
 * Cross-process pacing for real registrations. `RegistrationPage.submit()`'s
 * old fixed 12s wait only paced consecutive submissions *within one test
 * run* — it did nothing to stop a person (or Claude, debugging) from
 * launching several separate `npx playwright test` invocations a couple
 * of minutes apart, which is exactly what triggered the site's own 429
 * "Too many requests" on 2026-08-26 despite the in-run pacing being in
 * place. This persists the last real-registration timestamp to a local
 * file so *every* invocation — regardless of which spec file, which
 * process — waits out the same minimum gap since the last one, anywhere.
 *
 * Local-only: the throttle file isn't committed (see .gitignore) and
 * doesn't exist in a fresh CI checkout, so it has no effect there — CI's
 * protection is the separate 5-minute cross-dispatch cooldown in
 * hosted/server.js. This is specifically for local/iterative runs.
 */
const THROTTLE_FILE = path.join(__dirname, '..', '.registration-throttle.json');
const MIN_GAP_MS = 60_000;

export async function waitForRegistrationSlot(): Promise<void> {
  let lastRegistrationAt = 0;
  try {
    const raw = fs.readFileSync(THROTTLE_FILE, 'utf8');
    lastRegistrationAt = JSON.parse(raw).lastRegistrationAt ?? 0;
  } catch {
    // No throttle file yet (first registration ever) or it's unreadable —
    // treat as "no prior registration", nothing to wait for.
  }

  const elapsed = Date.now() - lastRegistrationAt;
  if (elapsed < MIN_GAP_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS - elapsed));
  }

  fs.writeFileSync(THROTTLE_FILE, JSON.stringify({ lastRegistrationAt: Date.now() }), 'utf8');
}
