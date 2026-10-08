'use strict';

/**
 * Turns `shelbyspin-dutch-localization-report.json` (written by
 * `shelbyspin-provider-localization.spec.ts`) into a plain Markdown
 * table — the actual thing to paste into an email/ticket when reaching
 * out to a provider about missing Dutch support, since the raw JSON /
 * Allure report aren't meant to be read by someone outside the team.
 */
const fs = require('fs');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, '..', 'shelbyspin-dutch-localization-report.json');

if (!fs.existsSync(RESULTS_FILE)) {
  console.log(`No report found at ${RESULTS_FILE} — run the shelbyspin-provider-localization suite first.`);
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));

const englishOnly = results.filter((r) => r.verdict === 'english');
const dutch = results.filter((r) => r.verdict === 'target-locale');
const otherLanguage = results.filter((r) => r.verdict === 'other-language');
const inconclusive = results.filter((r) => r.verdict === 'inconclusive');

console.log(`# ShelbySpin3322 — Dutch localization audit\n`);
console.log(
  `Checked ${results.length} providers. ${dutch.length} confirmed Dutch, ${englishOnly.length} still ` +
    `English-only, ${otherLanguage.length} launched with some other language, ${inconclusive.length} inconclusive.\n`
);

console.log(`## Providers to contact (launched with English instead of Dutch)\n`);
if (englishOnly.length === 0) {
  console.log('None — every provider that exposed a language parameter showed Dutch.\n');
} else {
  console.log('| Provider | Language parameter(s) seen | Game URL |');
  console.log('|---|---|---|');
  for (const r of englishOnly) {
    console.log(`| ${r.provider} | ${r.languageParams.join(', ')} | ${r.gameUrl ?? '-'} |`);
  }
  console.log('');
}

if (otherLanguage.length > 0) {
  console.log(`## Launched with a different (non-Dutch, non-English) language (${otherLanguage.length})\n`);
  console.log('| Provider | Language parameter(s) seen | Game URL |');
  console.log('|---|---|---|');
  for (const r of otherLanguage) {
    console.log(`| ${r.provider} | ${r.languageParams.join(', ')} | ${r.gameUrl ?? '-'} |`);
  }
  console.log('');
}

if (inconclusive.length > 0) {
  console.log(`## Inconclusive — no language parameter found; check the attached Allure screenshot by hand (${inconclusive.length})\n`);
  for (const r of inconclusive) {
    console.log(`- ${r.provider}${r.launched ? '' : ' (no game launched)'}`);
  }
  console.log('');
}

console.log(`## Confirmed Dutch (${dutch.length})\n`);
console.log(dutch.map((r) => r.provider).join(', ') || 'none');
