'use strict';

/**
 * Turns `spinoloco345-pt-localization-report.json` (written by
 * `spinoloco345-provider-localization.spec.ts`) into a plain Markdown
 * table — same reasoning as `shelbyspin-language-report.js`.
 */
const fs = require('fs');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, '..', 'spinoloco345-pt-localization-report.json');

if (!fs.existsSync(RESULTS_FILE)) {
  console.log(`No report found at ${RESULTS_FILE} — run the spinoloco345-provider-localization suite first.`);
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));

const englishOnly = results.filter((r) => r.verdict === 'english');
const portuguese = results.filter((r) => r.verdict === 'target-locale');
const otherLanguage = results.filter((r) => r.verdict === 'other-language');
const inconclusive = results.filter((r) => r.verdict === 'inconclusive');

console.log(`# Spinoloco345 — Portuguese localization audit\n`);
console.log(
  `Checked ${results.length} providers. ${portuguese.length} confirmed Portuguese, ${englishOnly.length} still ` +
    `English-only, ${otherLanguage.length} launched with some other language, ${inconclusive.length} inconclusive.\n`
);

console.log(`## Providers to contact (launched with English instead of Portuguese)\n`);
if (englishOnly.length === 0) {
  console.log('None — every provider that exposed a language parameter showed Portuguese.\n');
} else {
  console.log('| Provider | Language parameter(s) seen |');
  console.log('|---|---|');
  for (const r of englishOnly) {
    console.log(`| ${r.provider} | ${r.languageParams.join(', ')} |`);
  }
  console.log('');
}

if (otherLanguage.length > 0) {
  console.log(`## Launched with a different (non-Portuguese, non-English) language (${otherLanguage.length})\n`);
  console.log('| Provider | Language parameter(s) seen |');
  console.log('|---|---|');
  for (const r of otherLanguage) {
    console.log(`| ${r.provider} | ${r.languageParams.join(', ')} |`);
  }
  console.log('');
}

if (inconclusive.length > 0) {
  console.log(`## Inconclusive — no language parameter found; check the attached screenshot by hand (${inconclusive.length})\n`);
  for (const r of inconclusive) {
    console.log(`- ${r.provider}${r.launched ? '' : ' (no game launched)'}`);
  }
  console.log('');
}

console.log(`## Confirmed Portuguese (${portuguese.length})\n`);
console.log(portuguese.map((r) => r.provider).join(', ') || 'none');
