'use strict';

/**
 * Keeps only the LATEST (by start timestamp) result per unique test
 * identity (historyId) in allure-results-wildies, deleting older
 * duplicates. Needed when ad-hoc verification runs (e.g. spot-checking
 * one fix live) got run into the same results directory as a "final"
 * full run without cleaning first — Allure's Suites tab shows every
 * individual result file as its own row rather than deduplicating, so a
 * stale run from BEFORE a fix landed can still show up (and outrank the
 * fresh, correct one) alongside the new one.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', process.argv[2] || 'allure-results-wildies');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('-result.json'));

const latestByHistoryId = new Map();
for (const f of files) {
  const full = path.join(dir, f);
  const j = JSON.parse(fs.readFileSync(full, 'utf8'));
  const key = j.historyId || j.name;
  const existing = latestByHistoryId.get(key);
  if (!existing || j.start > existing.start) {
    latestByHistoryId.set(key, { file: f, start: j.start });
  }
}

const keepFiles = new Set([...latestByHistoryId.values()].map((v) => v.file));
let removed = 0;
for (const f of files) {
  if (!keepFiles.has(f)) {
    fs.unlinkSync(path.join(dir, f));
    removed++;
  }
}

console.log(`kept ${keepFiles.size} latest result(s), removed ${removed} stale duplicate(s)`);
