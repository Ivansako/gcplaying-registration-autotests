/**
 * Shared locale data for ferraplay.com — mirrors `wildiesLocales.ts`
 * (same underlying "Wiz" platform, same sidebar language-switcher
 * mechanics, confirmed live 2026-09-10). Single source of truth for both
 * `tests/ferraplay-localizations.spec.ts` and
 * `tests/ferraplay-translation-coverage.spec.ts`.
 *
 * English is the default locale (bare "/", no path prefix, confirmed
 * live — visiting "/en" itself redirects back to "/"); every other
 * locale gets a "/{code}" prefix. Labels are each language's own native
 * display name, exactly as the sidebar dropdown shows it.
 *
 * Confirmed live 2026-09-10: the dropdown actually lists 9 locales
 * (adds Nederlands and Français to the 7 below). Per explicit request,
 * this suite deliberately excludes Nederlands and Français — if that
 * scope ever changes, re-add them here from `getAvailableLocaleLabels()`
 * output rather than guessing codes.
 */
export interface FerraplayLocale {
  label: string;
  code: string;
  path: string;
}

export const EXISTING_LOCALES: FerraplayLocale[] = [
  { label: 'English', code: 'en', path: '' },
  { label: 'Italiano', code: 'it', path: 'it' },
  { label: 'Português', code: 'pt', path: 'pt' },
  { label: 'Ελληνικά', code: 'el', path: 'el' },
  { label: 'Español', code: 'es', path: 'es' },
  { label: 'Polski', code: 'pl', path: 'pl' },
  { label: 'Magyar', code: 'hu', path: 'hu' },
];

/** Every locale the site's own switcher currently offers — used only by
 * "Switcher lists every currently available locale" to confirm the
 * dropdown hasn't silently dropped one of the 7 above, not to assert
 * the excluded 2 are absent. */
export const ALL_SITE_LOCALE_LABELS = [
  'English',
  'Nederlands',
  'Français',
  'Italiano',
  'Português',
  'Ελληνικά',
  'Español',
  'Polski',
  'Magyar',
];
