/**
 * Shared locale data for beta.wildies.com — single source of truth for
 * both `tests/wildies-localizations.spec.ts` (switcher mechanics) and
 * `tests/wildies-translation-coverage.spec.ts` (site-wide translation
 * completeness), so the two suites can't drift out of sync on what
 * locales exist.
 *
 * English is the default locale (the switcher navigates it to bare "/",
 * no path prefix) — every other locale gets a "/{code}" prefix. Labels
 * are each language's own native display name, exactly as the dropdown
 * shows it (confirmed live 2026-08-28) — not the English name
 * ("Ελληνικά", not "Greek").
 */
export interface WildiesLocale {
  label: string;
  code: string;
  path: string;
}

export const EXISTING_LOCALES: WildiesLocale[] = [
  { label: 'English', code: 'en', path: 'en' },
  { label: 'Nederlands', code: 'nl', path: 'nl' },
  { label: 'Français', code: 'fr', path: 'fr' },
  { label: 'Italiano', code: 'it', path: 'it' },
  { label: 'Português', code: 'pt', path: 'pt' },
  { label: 'Ελληνικά', code: 'el', path: 'el' },
];

// Not yet deployed — see "Add German | Finnish | Spanish | Swedish |
// Norwegian languages to the Drop Down" ticket. Labels are a best guess
// at each language's native self-name, following the pattern above
// ("Nederlands" not "Dutch") — unconfirmed, since none of these exist in
// the live dropdown yet to check against.
export const PENDING_LOCALES: WildiesLocale[] = [
  { label: 'Deutsch', code: 'de', path: 'de' },
  { label: 'Suomi', code: 'fi', path: 'fi' },
  { label: 'Español', code: 'es', path: 'es' },
  { label: 'Svenska', code: 'sv', path: 'sv' },
  { label: 'Norsk', code: 'no', path: 'no' },
];
