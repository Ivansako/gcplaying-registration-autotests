const fs = require('fs');
const data = JSON.parse(fs.readFileSync(__dirname + '/capture.json', 'utf8'));
const NON_EN = ['it', 'pt', 'el', 'es', 'pl', 'hu', 'fr'];

const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const lines = (t) => [...new Set(t.split('\n').map((l) => l.trim()).filter(Boolean))];

// 1) every capture really in the requested language?
for (const [page, byLoc] of Object.entries(data)) {
  for (const [loc, v] of Object.entries(byLoc)) if (v.lang !== loc) console.log(`LANG MISMATCH ${page} wanted=${loc} got=${v.lang}`);
}

const out = { suspicious: {}, baseline: {} };
for (const [page, byLoc] of Object.entries(data)) {
  const en = byLoc.en;
  if (!en) continue;
  const locSets = Object.fromEntries(NON_EN.map((l) => [l, new Set(lines(byLoc[l]?.text || '').map(norm))]));
  const locFull = Object.fromEntries(NON_EN.map((l) => [l, norm(byLoc[l]?.text || '')]));
  for (const line of lines(en.text)) {
    const n = norm(line);
    if (n.length < 8 || !/[a-z]{3}/i.test(n)) continue; // skip numbers/short labels
    const exact = NON_EN.filter((l) => locSets[l].has(n));
    const contained = NON_EN.filter((l) => locFull[l].includes(n));
    if (exact.length >= 1 && exact.length <= 6) (out.suspicious[page] ||= []).push({ line, locales: exact });
    if (contained.length === 0 && n.split(' ').length >= 2 && n.length >= 14 && n.length <= 90) (out.baseline[page] ||= []).push(line);
  }
}
console.log('\n===== SUSPICIOUS: English line present verbatim in only SOME non-English locales =====');
for (const [page, arr] of Object.entries(out.suspicious)) {
  console.log(`\n## ${page}  (${arr.length})`);
  for (const s of arr.slice(0, 40)) console.log(`  [${s.locales.join(',')}] ${s.line.slice(0, 90)}`);
}
console.log('\n===== BASELINE CANDIDATES (in English, in NO other locale) — counts per page =====');
for (const [page, arr] of Object.entries(out.baseline)) console.log(`${page}: ${arr.length}`);
fs.writeFileSync(__dirname + '/analysis.json', JSON.stringify(out, null, 1));
