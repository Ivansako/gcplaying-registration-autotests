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

// Deutsch/Suomi/Español/Svenska confirmed live in the dropdown 2026-09-02
// — their guessed labels from the "Add German | Finnish | Spanish |
// Swedish | Norwegian languages to the Drop Down" ticket turned out to
// match the real dropdown exactly. Norwegian, the 5th language from that
// same ticket, was confirmed 2026-09-02 to not be shipping — dropped
// rather than kept as a permanently-skipping placeholder.
export const EXISTING_LOCALES: WildiesLocale[] = [
  { label: 'English', code: 'en', path: 'en' },
  { label: 'Nederlands', code: 'nl', path: 'nl' },
  { label: 'Français', code: 'fr', path: 'fr' },
  { label: 'Italiano', code: 'it', path: 'it' },
  { label: 'Português', code: 'pt', path: 'pt' },
  { label: 'Ελληνικά', code: 'el', path: 'el' },
  { label: 'Deutsch', code: 'de', path: 'de' },
  { label: 'Suomi', code: 'fi', path: 'fi' },
  { label: 'Español', code: 'es', path: 'es' },
  { label: 'Svenska', code: 'sv', path: 'sv' },
];
