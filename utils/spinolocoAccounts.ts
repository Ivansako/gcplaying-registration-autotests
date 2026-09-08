/**
 * spinoloco7545.com has two real, funded test accounts — one per
 * currency, NOT an interchangeable pool like `wildiesAccounts.ts`. Which
 * account a check uses is a deliberate choice (does it need to prove EUR
 * behavior, PLN behavior, or both), not round-robin load spreading.
 */
export interface SpinolocoAccount {
  email: string;
  password: string;
  currency: 'EUR' | 'PLN';
}

function accountFromEnv(emailVar: string, passwordVar: string, currency: 'EUR' | 'PLN'): SpinolocoAccount | null {
  const email = process.env[emailVar];
  const password = process.env[passwordVar];
  return email && password ? { email, password, currency } : null;
}

export const EUR_ACCOUNT: SpinolocoAccount | null = accountFromEnv(
  'SPINOLOCO_TEST_USER_EMAIL_EUR',
  'SPINOLOCO_TEST_USER_PASSWORD_EUR',
  'EUR'
);

export const PLN_ACCOUNT: SpinolocoAccount | null = accountFromEnv(
  'SPINOLOCO_TEST_USER_EMAIL_PLN',
  'SPINOLOCO_TEST_USER_PASSWORD_PLN',
  'PLN'
);

export const SPINOLOCO_ACCOUNTS: SpinolocoAccount[] = [EUR_ACCOUNT, PLN_ACCOUNT].filter(
  (a): a is SpinolocoAccount => a !== null
);
