import { faker } from '@faker-js/faker';

/**
 * Test data for the gcplaying0175.com registration form.
 * Confirmed live on 2026-08-24: the form only asks for
 * Currency (default USD) / Country (default United Arab Emirates,
 * +971) / Phone / Email / Password — there is no name, surname,
 * date of birth, promo code or password confirmation field.
 */
export interface RegistrationData {
  email: string;
  password: string;
  phone: string;
}

/**
 * Password requirements shown by the form's live checklist
 * (WizPasswordHints): 8-30 characters, a digit, no spaces, a
 * lowercase and an uppercase letter.
 */
export function generateValidPassword(): string {
  const digits = faker.string.numeric(3);
  return `Qa${faker.string.alpha({ length: 6, casing: 'lower' })}${digits}!`; // e.g. Qaabcdef123!
}

/**
 * Generates a valid, unique dataset for a successful registration.
 * The email is always unique (timestamp + random) so the test can be
 * run repeatedly without hitting an "already registered" conflict.
 */
export function generateValidRegistrationData(overrides: Partial<RegistrationData> = {}): RegistrationData {
  const unique = `${Date.now()}${faker.number.int({ min: 100, max: 999 })}`;

  return {
    email: `autotest.${unique}@mailinator.com`,
    password: generateValidPassword(),
    phone: generateValidPhone(),
    ...overrides,
  };
}

/**
 * Phone number without the country code (+971 for United Arab
 * Emirates is set by default in the form) — 9 digits starting with
 * 5, matching UAE mobile numbers.
 */
export function generateValidPhone(): string {
  return `5${faker.string.numeric(8)}`;
}

export function invalidEmailSamples(): string[] {
  return [
    'plainaddress',
    'missing-at-sign.com',
    '@missing-local.com',
    'spaces in@email.com',
    'trailing-dot@email.com.',
    'double@@email.com',
  ];
}

/**
 * Phone numbers that each violate a different formatting rule, to
 * verify the submit button stays disabled for malformed input.
 */
export function invalidPhoneSamples(): string[] {
  return [
    '123', // too short
    `5${'1'.repeat(15)}`, // too long
    'abcdefghi', // letters only, no digits
    '555-123-45', // contains non-digit separators
  ];
}

/**
 * Passwords, each violating exactly one checklist requirement, so
 * the negative tests are unambiguous.
 */
export function invalidPasswordSamples(): Array<{ password: string; violatedRequirement: string }> {
  return [
    { password: 'Qa1!', violatedRequirement: 'Between 8-30 characters' }, // shorter than 8 characters
    {
      password: `Qa${'a'.repeat(28)}1!`,
      violatedRequirement: 'Between 8-30 characters',
    }, // longer than 30 characters
    { password: 'Qawordsonly!', violatedRequirement: 'At least one number' }, // no digit
    { password: 'Qa word123!', violatedRequirement: 'No spaces' }, // contains a space
    { password: 'QA123456!', violatedRequirement: 'At least one lowercase' }, // no lowercase letter
    { password: 'qa123456!', violatedRequirement: 'At least one capital' }, // no uppercase letter
  ];
}
