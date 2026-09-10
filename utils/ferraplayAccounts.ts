/**
 * Test account(s) for ferraplay.com — mirrors `wildiesAccounts.ts`'s
 * env-var-backed shape, kept to a single slot for now since no
 * credentials exist yet (the authenticated half of this suite is
 * stubbed out behind `hasCreds` until they're provided). Extend to a
 * pool the same way `wildiesAccounts.ts` did if/when more than one
 * account is needed.
 */
export interface FerraplayAccount {
  email: string;
  password: string;
}

const email = process.env.FERRAPLAY_TEST_USER_EMAIL;
const password = process.env.FERRAPLAY_TEST_USER_PASSWORD;

export const FERRAPLAY_ACCOUNT: FerraplayAccount | null = email && password ? { email, password } : null;

export const hasCreds = FERRAPLAY_ACCOUNT !== null;
