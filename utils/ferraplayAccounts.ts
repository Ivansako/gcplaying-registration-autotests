/**
 * A pool of real, funded test accounts for ferraplay.com — mirrors
 * `wildiesAccounts.ts` exactly (same env-var naming scheme, same
 * SEED_ACCOUNT/ACCOUNT_POOL/nextPooledAccount() shape), added
 * 2026-09-10 once the user provided 3 real accounts, each funded with
 * ~€100, explicitly cleared for minimum-stake real spins/bets.
 *
 * `SEED_ACCOUNT` is deliberately NOT rotated — it's always index 0, and
 * is the only account real money ever moves through (one seed slot spin
 * + one seed sportsbook bet per full suite run), and the only one Game
 * History / Sportsbook My Bets checks log into, since they need to see
 * that seeded data specifically. Every other authenticated check (no
 * bet/spin involved) rotates through the whole pool via
 * `nextPooledAccount()` to spread login load, same reasoning as Wildies.
 */
export interface FerraplayAccount {
  email: string;
  password: string;
}

function accountFromEnv(emailVar: string, passwordVar: string): FerraplayAccount | null {
  const email = process.env[emailVar];
  const password = process.env[passwordVar];
  return email && password ? { email, password } : null;
}

const RAW_ACCOUNTS: (FerraplayAccount | null)[] = [
  accountFromEnv('FERRAPLAY_TEST_USER_EMAIL', 'FERRAPLAY_TEST_USER_PASSWORD'),
  accountFromEnv('FERRAPLAY_TEST_USER_EMAIL_2', 'FERRAPLAY_TEST_USER_PASSWORD_2'),
  accountFromEnv('FERRAPLAY_TEST_USER_EMAIL_3', 'FERRAPLAY_TEST_USER_PASSWORD_3'),
];

export const SEED_ACCOUNT: FerraplayAccount | null = RAW_ACCOUNTS[0];

export const ACCOUNT_POOL: FerraplayAccount[] = RAW_ACCOUNTS.filter((a): a is FerraplayAccount => a !== null);

export const hasCreds = ACCOUNT_POOL.length > 0;

let poolCursor = 0;

/**
 * Round-robins through whichever accounts are actually configured.
 * Plain module-level counter, not tied to Playwright's worker index —
 * this suite runs `--workers=1` (see project convention), so there's no
 * concurrent-access race to worry about.
 */
export function nextPooledAccount(): FerraplayAccount {
  if (ACCOUNT_POOL.length === 0) {
    throw new Error('No FerraPlay test accounts configured (FERRAPLAY_TEST_USER_EMAIL/PASSWORD missing)');
  }
  const account = ACCOUNT_POOL[poolCursor % ACCOUNT_POOL.length];
  poolCursor++;
  return account;
}
