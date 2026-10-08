/**
 * Classifier for "did this game launch with the target locale's language
 * parameter, or fall back to English" — shared by every brand's
 * provider-localization audit (`shelbyspin-provider-localization.spec.ts`,
 * `spinoloco345-provider-localization.spec.ts`, ...).
 *
 * NOT text-based: confirmed live 2026-09-21 most game engines on these
 * platforms render through `<canvas>` (Pragmatic, Novomatic, ...), so
 * there's no DOM text to read regardless of provider or wait time.
 * Instead this classifies whatever `language=`/`lang=`/`locale=` query-
 * parameter values were found on the game's own frame URLs. A provider
 * with NO such parameter at all isn't necessarily fine — it just means
 * this cheap signal can't tell, and the screenshot taken alongside every
 * check is the real evidence for a human to eyeball (see the ticket's
 * own goal: a shortlist to hand to providers, not a certified
 * translation checker).
 */
export type LanguageVerdict = 'target-locale' | 'english' | 'other-language' | 'inconclusive';

export interface LanguageClassification {
  verdict: LanguageVerdict;
  languageParams: string[];
}

const matchesLocale = (p: string, locale: string) => p === locale || p.startsWith(`${locale}-`) || p.startsWith(`${locale}_`);
const isEnglish = (p: string) => matchesLocale(p, 'en');

export function classifyGameLanguage(languageParams: string[], targetLocale: string): LanguageClassification {
  if (languageParams.length === 0) return { verdict: 'inconclusive', languageParams };
  if (languageParams.some((p) => matchesLocale(p, targetLocale))) return { verdict: 'target-locale', languageParams };
  if (languageParams.some(isEnglish)) return { verdict: 'english', languageParams };
  return { verdict: 'other-language', languageParams };
}
