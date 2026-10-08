/**
 * One-off extraction script: pulls specific named screenshots out of
 * allure-results-wildies (by matching the attachment's own step name)
 * and copies them to a scratch folder with a readable filename, so they
 * can be visually reviewed without opening the Allure UI one test at a
 * time. Not part of the suite.
 */
const fs = require('fs');
const path = require('path');

const RESULTS_DIR = process.argv[4] || 'allure-results-wildies';
const OUT_DIR = process.argv[2] || 'scratch-screenshots';
const NAME_FILTER = process.argv[3]; // substring to match in the attachment name

fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith('-result.json'));
let count = 0;

function walkSteps(steps, testName) {
  for (const s of steps || []) {
    for (const a of s.attachments || []) {
      if (a.type !== 'image/png') continue;
      if (NAME_FILTER && !a.name.toLowerCase().includes(NAME_FILTER.toLowerCase())) continue;
      const src = path.join(RESULTS_DIR, a.source);
      if (!fs.existsSync(src)) continue;
      const safeName = a.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 150);
      const dest = path.join(OUT_DIR, `${safeName}.png`);
      fs.copyFileSync(src, dest);
      count++;
    }
    walkSteps(s.steps, testName);
  }
}

for (const f of files) {
  const result = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f)));
  walkSteps(result.steps, result.name);
}

console.log(`Copied ${count} matching screenshots to ${OUT_DIR}/`);
