/**
 * A pool of real, disposable test accounts for beta.wildies.com — added
 * 2026-08-29 after the original single shared account (`wiztest008`,
 * `WILDIES_TEST_USER_EMAIL`/`WILDIES_TEST_USER_PASSWORD`) started hitting
 * the site's own anti-fraud login rate-limit under a full suite run's
 * volume of real logins (~90+ in a row). Every check that just needs
 * "some logged-in session" (Profile Info, Verification, Cashier UI, ...)
 * now rotates through this whole pool via `nextPooledAccount()`, spreading
 * the login load instead of concentrating it on one account.
 *
 * `SEED_ACCOUNT` is deliberately NOT rotated — it's always index 0 (the
 * original account), and is the only account real money ever moves
 * through (the seed slot spin + sportsbook bet) and the only one Game
 * History / Sportsbook My Bets checks log into, since they need to see
 * that seeded data specifically.
 */
export interface WildiesAccount {
  email: string;
  password: string;
}

function accountFromEnv(emailVar: string, passwordVar: string): WildiesAccount | null {
  const email = process.env[emailVar];
  const password = process.env[passwordVar];
  return email && password ? { email, password } : null;
}

const RAW_ACCOUNTS: (WildiesAccount | null)[] = [
  accountFromEnv('WILDIES_TEST_USER_EMAIL', 'WILDIES_TEST_USER_PASSWORD'),
  accountFromEnv('WILDIES_TEST_USER_EMAIL_2', 'WILDIES_TEST_USER_PASSWORD_2'),
  accountFromEnv('WILDIES_TEST_USER_EMAIL_3', 'WILDIES_TEST_USER_PASSWORD_3'),
  accountFromEnv('WILDIES_TEST_USER_EMAIL_4', 'WILDIES_TEST_USER_PASSWORD_4'),
];

export const SEED_ACCOUNT: WildiesAccount | null = RAW_ACCOUNTS[0];

export const ACCOUNT_POOL: WildiesAccount[] = RAW_ACCOUNTS.filter((a): a is WildiesAccount => a !== null);

let poolCursor = 0;

/**
 * Round-robins through whichever accounts are actually configured — 1 if
 * only the original is set, up to 4 with the full pool. Deliberately a
 * plain module-level counter, not tied to Playwright's worker/parallel
 * index: this suite runs `--workers=1` (see project convention), so
 * there's no concurrent-access race to worry about — this just needs to
 * spread sequential logins across accounts, not guarantee any one test a
 * specific account.
 */
export function nextPooledAccount(): WildiesAccount {
  if (ACCOUNT_POOL.length === 0) {
    throw new Error('No Wildies test accounts configured (WILDIES_TEST_USER_EMAIL/PASSWORD missing)');
  }
  const account = ACCOUNT_POOL[poolCursor % ACCOUNT_POOL.length];
  poolCursor++;
  return account;
}
