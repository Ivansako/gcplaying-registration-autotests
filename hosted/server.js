'use strict';

/**
 * Public "run button" for the autotest suite — meant to be deployed to a
 * free host (Render, Fly.io, etc.) and shared as a plain link with
 * teammates. They never need GitHub access: this server holds the
 * GitHub token, triggers the existing "Run autotests" GitHub Actions
 * workflow via the REST API, waits for it to finish, downloads the
 * Allure report artifact it produces, and serves it as a normal web
 * page.
 *
 * Required environment variables (set on the hosting platform, never
 * committed):
 *   GITHUB_TOKEN  — a token with `actions: read/write` on the repo
 *                   (a fine-grained PAT scoped to just this repo is enough)
 *   GITHUB_OWNER  — e.g. "Ivansako"
 *   GITHUB_REPO   — e.g. "gcplaying-registration-autotests"
 *   PORT          — provided automatically by most hosts
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const WORKFLOW_FILE = 'tests.yml';
const REF = process.env.GITHUB_REF || 'master';

if (!TOKEN || !OWNER || !REPO) {
  console.error('Missing required env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO');
  process.exit(1);
}

const REPORT_DIR = path.join(os.tmpdir(), 'allure-report-cache');
const ASSETS_DIR = path.join(__dirname, 'assets');
const MAX_HISTORY = 10;

const GH_API = 'https://api.github.com';
const ghHeaders = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

// currentRun/history used to live only in this process's memory, so a
// restart (crash, idle spin-down/wake, or a redeploy triggered by an
// unrelated `git push`) silently wiped an in-flight run's progress and the
// whole "Recent runs" table. Persisted to disk so a restart that keeps the
// same filesystem picks the tracking back up; a full redeploy on a host
// with an ephemeral filesystem still loses it (no host-independent store
// here), but the /status adoption fallback below covers that case by
// re-discovering the run directly from GitHub instead of trusting local
// state.
const STATE_FILE = path.join(os.tmpdir(), 'aloplay-qa-state.json');
let pollInterval = null;

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { currentRun: parsed.currentRun || null, history: parsed.history || [] };
  } catch {
    return { currentRun: null, history: [] };
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ currentRun, history }));
  } catch (err) {
    console.error('Failed to persist state:', err.message);
  }
}

const loaded = loadState();
let currentRun = loaded.currentRun; // { runId, suite, status, conclusion, htmlUrl, reportReady, statistic, dispatchedAt }
const history = loaded.history; // most recent first, capped at MAX_HISTORY

// Suites whose positive tests register a real account on the live site.
// GitHub's own sign-up endpoint rate-limits (429s) bursts of registrations
// from the same source in a short window — we hit this ourselves while
// iterating on the brand test suite. A plain cooldown between dispatches
// keeps the button's usage pattern close to "a person clicking it now and
// then" rather than a burst, without needing any change on the site side.
const ACCOUNT_CREATING_SUITES = new Set(['brand-gcplaying', 'all']);
const REGISTRATION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
let lastRegistrationRunAt = null;

// `category` groups suites in the page's Category dropdown: tests that
// exercise the site's actual product behavior (game providers) are
// "Product"; tests that exercise the codebase's own auth/registration
// flows are "Development". "all" gets its own catch-all category rather
// than living in either, since it runs both.
const SUITES = [
  {
    value: 'brand-gcplaying',
    label: 'Full Brand test — gcplaying0175.com',
    sub: 'Desktop + Mobile, Complete user flow',
    category: 'development',
  },
  {
    value: 'authenticated-account',
    label: 'Authenticated account — gcplaying0175.com',
    sub: 'Logs in as a test user: header, deposit/withdraw UI, navigation, account menu, profile, password change validation, and one real game spin — desktop only',
    category: 'product',
  },
  {
    value: 'game-providers',
    label: 'Game providers',
    sub: 'ferraplay.com — findings ledger, no live browser',
    category: 'product',
  },
  {
    value: 'wildies-i18n',
    label: 'I18N Testing — Beta Wildies',
    sub:
      'Checks language switching and translated content across every page — the Cashier, Login/Sign Up, a real ' +
      'slot spin + sportsbook bet, and Game/Bet History — on both desktop and mobile, for every language ' +
      'currently live on the site (Spanish included, since it shipped 2026-08-30). Checks for German, Finnish, ' +
      'Swedish, and Norwegian are already written and switch on by themselves the moment those languages ship, ' +
      'no code changes needed. Each run spends real money once, on the seed account below (one minimum-bet slot ' +
      'spin + one minimum-stake sportsbook bet).' +
      '<br><br><strong>Test accounts:</strong><br>' +
      'wiztest008@gmail.com / Wiztest008 — seed account, the one real money moves through<br>' +
      'wiztest911z@gmail.com / Wiztest911z<br>' +
      'wiztest909z@gmail.com / Wiztest909z<br>' +
      'wiztest910z@gmail.com / Wiztest910z',
    category: 'localization',
  },
  {
    value: 'ferraplay-i18n',
    label: 'I18N Testing — FerraPlay',
    sub:
      'Checks language switching and translated content across every page — Home, Casino Lobby, Live Casino, Buy ' +
      'Bonus, Sportsbook Lobby, Promotions, Tournaments, legal pages, Login/Sign Up, Forgot Password, the 404 ' +
      'error boundary, the account menu, Cashier, Profile Info, Verification, My Promotions, Transaction ' +
      'History, and Game History — on both desktop and mobile, for every language currently live on the site ' +
      'except Nederlands and Français. Each run spends real money once, on the seed account below (one ' +
      'minimum-bet slot spin). The sportsbook (/sport) isn\'t checked — it doesn\'t render any betting widget on ' +
      'this brand.' +
      '<br><br><strong>Test accounts:</strong><br>' +
      'wiztest+zest1@gmail.com / Wiztestzest1 — seed account, the one real money moves through<br>' +
      'wiztest+kak1@gmail.com / Wiztestkak1<br>' +
      'wiztest+lal1@gmail.com / Wiztestlal1',
    category: 'localization',
  },
  {
    value: 'spinoloco-provider-launch',
    label: 'Provider (Vendor) Launch — spinoloco7545.com',
    sub:
      'Checks that the whole game catalog is actually launch-ready: every Casino & Live Casino game has a real ' +
      'thumbnail (not a placeholder), opens without a tech error (geo-block, 500, timeout) with a screenshot of ' +
      'every game for a human to confirm its Spin/Play button actually rendered, is filed under at least one ' +
      'findable category, and — for providers already investigated — that a real minimum-bet spin goes through ' +
      'cleanly in EUR or PLN. Mobile viewport only (where most real players are). The full catalog is thousands ' +
      "of games, so the launch check covers one day's slice per run (several games launch in parallel tabs to " +
      'keep this fast) and cycles through everything over repeated runs; thumbnails/categories are checked in ' +
      'full every time. Real money moves only on the real-bet check, once per already-investigated provider.' +
      '<br><br><strong>Test accounts:</strong><br>' +
      'wiztest+it@gmail.com / Wiztestit — EUR balance<br>' +
      'wiztest+pl@gmail.com / Wiztestpl — PLN (zł) balance',
    category: 'provider-launch',
  },
  { value: 'all', label: 'All suites', sub: 'Everything above', category: 'all' },
];

const CATEGORIES = [
  { value: 'development', label: 'Development' },
  { value: 'product', label: 'Product' },
  { value: 'localization', label: 'Localization' },
  { value: 'payments', label: 'Payments' },
  { value: 'provider-launch', label: 'Provider Launch' },
  { value: 'brand-launch', label: 'Brand Launch' },
  { value: 'legal-check', label: 'Legal Check' },
  { value: 'all', label: 'All suites' },
];

function suiteLabel(value) {
  if (value === 'external') return 'Run started outside this page';
  const s = SUITES.find((x) => x.value === value);
  return s ? s.label : value;
}

// Rough ETA for the progress bar: mean of the last 5 completed runs of the
// same suite we've seen since this server process started. GitHub Actions
// doesn't expose an ETA itself, and suite runtimes vary a lot (a few
// minutes vs. hours for wildies-i18n), so this is only ever a same-suite
// historical estimate, not a promise — the front end labels it "est.".
function averageDurationMs(suiteValue) {
  const durations = history
    .filter((h) => h.suiteValue === suiteValue && h.durationMs)
    .slice(0, 5)
    .map((h) => h.durationMs);
  if (!durations.length) return null;
  return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function html() {
  const cards = SUITES.map(
    (s) => `
        <label class="suite-card" data-category="${s.category}">
          <input type="radio" name="suite" value="${s.value}" ${s.value === 'brand-gcplaying' ? 'checked' : ''}>
          <span class="suite-card__title">${s.label}</span>
          <span class="suite-card__sub">${s.sub}</span>
        </label>`
  ).join('\n');

  const categoryItems = CATEGORIES.map(
    (c) => `<li class="dropdown__item" data-value="${c.value}" role="option">${c.label}</li>`
  ).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aloplay Automation QA Test Suites</title>
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #07080f;
    --bg-2: #0b0d18;
    --card: #12141f;
    --border: rgba(255, 255, 255, .08);
    --text: #ffffff;
    --muted: #9aa1b8;
    --purple: #8b5cf6;
    --pink: #ec1e79;
    --cyan: #22d3ee;
    --accent: var(--purple);
    --grad: linear-gradient(90deg, #8b5cf6, #ec1e79);
    --green: #22c55e;
    --green-bg: rgba(34, 197, 94, .14);
    --red: #f75a6a;
    --red-bg: rgba(247, 90, 106, .14);
    --radius: 12px;
    --shadow: 0 12px 32px rgba(0, 0, 0, .35);
  }
  :root[data-theme="light"] {
    --bg: #f4f4fa;
    --bg-2: #ffffff;
    --card: #ffffff;
    --border: rgba(20, 18, 40, .1);
    --text: #14121f;
    --muted: #6b7080;
    --green-bg: rgba(34, 197, 94, .12);
    --red-bg: rgba(247, 90, 106, .12);
    --shadow: 0 12px 28px rgba(20, 18, 40, .12);
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(circle at top, var(--bg-2), var(--bg) 55%);
    color: var(--text);
    margin: 0;
    padding: 2.5rem 1.25rem 4rem;
    transition: background .2s ease, color .2s ease;
  }
  .page { max-width: 640px; margin: 0 auto; }
  .header-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
  .brand { display: flex; align-items: center; }
  .brand__logo { height: 30px; width: auto; display: block; }
  :root[data-theme="light"] .brand__logo { filter: invert(9%) sepia(20%) saturate(1200%) hue-rotate(220deg); }
  .theme-toggle {
    width: 36px; height: 36px; flex: none;
    display: flex; align-items: center; justify-content: center;
    background: var(--card); border: 1px solid var(--border); color: var(--text);
    border-radius: 10px; cursor: pointer; transition: border-color .15s, background .15s;
  }
  .theme-toggle:hover { border-color: var(--purple); }
  .theme-toggle svg { display: block; }
  h1 {
    font-size: 1.5rem;
    margin: 0 0 .4rem;
    background: var(--grad);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  p.hint { color: var(--muted); margin: 0 0 1.75rem; line-height: 1.5; }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    margin-bottom: 1.25rem;
  }
  .card h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 .9rem; }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: .9rem;
  }
  .card-header h2 { margin: 0; }
  .dropdown { position: relative; }
  .dropdown__trigger {
    display: flex;
    align-items: center;
    gap: .55rem;
    background: var(--bg-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: .45rem .8rem;
    font-family: inherit;
    font-size: .85rem;
    font-weight: 500;
    cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  .dropdown__trigger:hover, .dropdown__trigger[aria-expanded="true"] { border-color: var(--purple); }
  .dropdown__chevron { flex: none; color: var(--muted); transition: transform .2s ease; }
  .dropdown__trigger[aria-expanded="true"] .dropdown__chevron { transform: rotate(180deg); }
  .dropdown__menu {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    min-width: 190px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: .35rem;
    margin: 0;
    list-style: none;
    box-shadow: var(--shadow);
    opacity: 0;
    transform: translateY(-6px) scale(.98);
    pointer-events: none;
    transition: opacity .16s ease, transform .16s ease;
    z-index: 20;
  }
  .dropdown__menu--open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
  .dropdown__item {
    padding: .5rem .65rem;
    border-radius: 7px;
    font-size: .85rem;
    font-weight: 500;
    color: var(--text);
    cursor: pointer;
    transition: background .12s ease;
  }
  .dropdown__item:hover { background: rgba(139, 92, 246, .12); }
  .dropdown__item--active { background: rgba(139, 92, 246, .18); color: var(--purple); }
  .empty-category {
    color: var(--muted);
    font-size: .9rem;
    padding: 1.25rem .5rem;
    text-align: center;
    border: 1.5px dashed var(--border);
    border-radius: 10px;
  }
  .suite-card {
    display: block;
    border: 1.5px solid var(--border);
    border-radius: 10px;
    padding: .75rem .9rem;
    margin-bottom: .6rem;
    cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  .suite-card:last-child { margin-bottom: 0; }
  .suite-card:has(input:checked) { border-color: var(--purple); background: rgba(139, 92, 246, .1); }
  .suite-card[hidden] { display: none; }
  .suite-card input { margin-right: .5rem; accent-color: var(--purple); }
  .suite-card__title { font-weight: 600; }
  .suite-card__sub { display: block; color: var(--muted); font-size: .85rem; margin-left: 1.4rem; }
  button#run-button {
    width: 100%;
    padding: .85rem;
    font-size: 1rem;
    font-weight: 600;
    color: #fff;
    background: var(--grad);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: filter .15s;
  }
  button#run-button:hover:not(:disabled) { filter: brightness(1.12); }
  button#run-button:disabled { cursor: not-allowed; opacity: .55; }
  .run-status { display: flex; align-items: center; gap: .6rem; margin-top: 1rem; min-height: 1.4rem; }
  .spinner {
    width: 16px; height: 16px; border-radius: 50%;
    border: 2.5px solid rgba(139, 92, 246, .25); border-top-color: var(--purple);
    animation: spin .8s linear infinite; flex: none;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .run-status__text { font-weight: 500; }
  .run-status__text--success { color: var(--green); }
  .run-status__text--failure { color: var(--red); }
  .progress-wrap { margin-top: .85rem; }
  .progress-bar {
    position: relative; height: 8px; border-radius: 999px; overflow: hidden;
    background: var(--bg-2); border: 1px solid var(--border);
  }
  .progress-bar__fill {
    position: absolute; top: 0; left: 0; height: 100%; width: 0%;
    background: var(--grad); border-radius: 999px; transition: width 1s linear;
  }
  .progress-bar--indeterminate .progress-bar__fill {
    width: 35%; transition: none; animation: progress-indeterminate 1.3s ease-in-out infinite;
  }
  @keyframes progress-indeterminate {
    0% { left: -35%; }
    100% { left: 100%; }
  }
  .progress-meta { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-top: .5rem; }
  .progress-meta__text { color: var(--muted); font-size: .82rem; }
  button#cancel-button {
    flex: none;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 8px;
    padding: .35rem .75rem;
    font-family: inherit;
    font-size: .8rem;
    font-weight: 600;
    cursor: pointer;
    transition: border-color .15s, color .15s;
  }
  button#cancel-button:hover:not(:disabled) { border-color: var(--red); color: var(--red); }
  button#cancel-button:disabled { opacity: .55; cursor: not-allowed; }
  .result-row { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: 1rem; }
  .pill { border-radius: 999px; padding: .3rem .75rem; font-size: .85rem; font-weight: 600; }
  .pill--passed { background: var(--green-bg); color: var(--green); }
  .pill--failed { background: var(--red-bg); color: var(--red); }
  .pill--skipped { background: rgba(255, 255, 255, .06); color: var(--muted); }
  .links { margin-top: 1rem; display: flex; gap: 1rem; flex-wrap: wrap; }
  .links a {
    color: var(--cyan); text-decoration: none; font-weight: 600; font-size: .92rem;
  }
  .links a:hover { text-decoration: underline; }
  table.history { width: 100%; border-collapse: collapse; font-size: .88rem; }
  table.history th, table.history td { text-align: left; padding: .5rem .4rem; border-bottom: 1px solid var(--border); }
  table.history th { color: var(--muted); font-weight: 500; font-size: .78rem; text-transform: uppercase; }
  table.history tr:last-child td { border-bottom: none; }
  .conclusion-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: .5rem; }
  .conclusion-dot--success { background: var(--green); }
  .conclusion-dot--failure { background: var(--red); }
  .empty { color: var(--muted); font-size: .9rem; }
  table.history a { color: var(--text); text-decoration: none; }
  table.history a:hover { color: var(--cyan); }
</style>
</head>
<body>
<div class="page">
  <div class="header-row">
    <div class="brand"><img class="brand__logo" src="/assets/aloplay-logo-white.svg" alt="Aloplay"></div>
    <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle light/dark theme">
      <svg id="theme-icon-moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
      <svg id="theme-icon-sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
    </button>
  </div>
  <h1>Aloplay Automation QA Test Suites</h1>
  <p class="hint">Dear Aloplayers, pick a suite and click Run. This triggers the selected suite on GitHub
  Actions — no GitHub account needed — and the results show up right here once it finishes (usually 1-3
  minutes).</p>

  <div class="card">
    <div class="card-header">
      <h2>Suite</h2>
      <div class="dropdown" id="category-dropdown">
        <button type="button" class="dropdown__trigger" id="category-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span id="category-trigger-label">Development</span>
          <svg class="dropdown__chevron" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <ul class="dropdown__menu" id="category-menu" role="listbox">
          ${categoryItems}
        </ul>
      </div>
    </div>
    ${cards}
    <p class="empty-category" id="empty-category-msg" hidden>No suites in this category yet.</p>
    <div style="margin-top: 1rem;">
      <button id="run-button">Run tests</button>
      <div class="run-status" id="run-status"></div>
      <div class="progress-wrap" id="progress-wrap" hidden>
        <div class="progress-bar" id="progress-bar"><div class="progress-bar__fill" id="progress-fill"></div></div>
        <div class="progress-meta">
          <span class="progress-meta__text" id="progress-elapsed"></span>
          <button id="cancel-button" type="button" hidden>Cancel run</button>
        </div>
      </div>
      <div class="result-row" id="result-row"></div>
      <div class="links" id="links"></div>
    </div>
  </div>

  <div class="card">
    <h2>Recent runs</h2>
    <div id="history"></div>
  </div>
</div>

<script>
const runButton = document.getElementById('run-button');
const runStatusEl = document.getElementById('run-status');
const resultRowEl = document.getElementById('result-row');
const linksEl = document.getElementById('links');
const historyEl = document.getElementById('history');
const progressWrapEl = document.getElementById('progress-wrap');
const progressBarEl = document.getElementById('progress-bar');
const progressFillEl = document.getElementById('progress-fill');
const progressElapsedEl = document.getElementById('progress-elapsed');
const cancelButtonEl = document.getElementById('cancel-button');

function suiteRadio() {
  return document.querySelector('input[name="suite"]:checked').value;
}

// --- Category dropdown (custom, animated — replaces a native <select>) ---
const categoryDropdown = document.getElementById('category-dropdown');
const categoryTrigger = document.getElementById('category-trigger');
const categoryTriggerLabel = document.getElementById('category-trigger-label');
const categoryMenu = document.getElementById('category-menu');
const categoryItems = Array.from(categoryMenu.querySelectorAll('.dropdown__item'));
const emptyCategoryMsg = document.getElementById('empty-category-msg');

let currentCategory = 'development';
let isRunInProgress = false;
let progressTimer = null;
let progressDispatchedAtMs = null;
let progressAvgDurationMs = null;
let tickingForRunId = null;

function formatClock(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function tickProgress() {
  const elapsed = Date.now() - progressDispatchedAtMs;
  if (progressAvgDurationMs) {
    const pct = Math.min(97, Math.round((elapsed / progressAvgDurationMs) * 100));
    progressFillEl.style.width = pct + '%';
    const remaining = progressAvgDurationMs - elapsed;
    progressElapsedEl.textContent = 'Elapsed ' + formatClock(elapsed) +
      (remaining > 0 ? ' — about ' + formatClock(remaining) + ' left (est.)' : ' — should finish any moment now');
  } else {
    progressElapsedEl.textContent = 'Elapsed ' + formatClock(elapsed) + ' — no time estimate yet for this suite';
  }
}

function startProgressTicker(dispatchedAtIso, avgDurationMs) {
  progressDispatchedAtMs = dispatchedAtIso ? new Date(dispatchedAtIso).getTime() : Date.now();
  progressAvgDurationMs = avgDurationMs || null;
  progressWrapEl.hidden = false;
  progressBarEl.classList.toggle('progress-bar--indeterminate', !progressAvgDurationMs);
  if (!progressAvgDurationMs) progressFillEl.style.width = '';
  cancelButtonEl.hidden = false;
  cancelButtonEl.disabled = false;
  cancelButtonEl.textContent = 'Cancel run';
  tickProgress();
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(tickProgress, 1000);
}

function stopProgressTicker() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
  progressWrapEl.hidden = true;
  cancelButtonEl.hidden = true;
  tickingForRunId = null;
}

cancelButtonEl.addEventListener('click', async () => {
  if (!confirm('Cancel the run in progress? This stops it on GitHub Actions right away.')) return;
  cancelButtonEl.disabled = true;
  cancelButtonEl.textContent = 'Cancelling...';
  const res = await fetch('/cancel', { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    alert('Could not cancel: ' + (body.error || res.statusText));
    cancelButtonEl.disabled = false;
    cancelButtonEl.textContent = 'Cancel run';
  }
  // On success, keep polling as usual — the run will show up as "cancelled" once GitHub finishes tearing it down.
});

function openCategoryMenu() {
  categoryMenu.classList.add('dropdown__menu--open');
  categoryTrigger.setAttribute('aria-expanded', 'true');
}
function closeCategoryMenu() {
  categoryMenu.classList.remove('dropdown__menu--open');
  categoryTrigger.setAttribute('aria-expanded', 'false');
}

categoryTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  categoryMenu.classList.contains('dropdown__menu--open') ? closeCategoryMenu() : openCategoryMenu();
});
categoryItems.forEach((item) => {
  item.addEventListener('click', () => {
    setCategory(item.dataset.value);
    closeCategoryMenu();
  });
});
document.addEventListener('click', (e) => {
  if (!categoryDropdown.contains(e.target)) closeCategoryMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCategoryMenu();
});

function setCategory(value) {
  currentCategory = value;
  const match = categoryItems.find((i) => i.dataset.value === value);
  categoryTriggerLabel.textContent = match ? match.textContent : value;
  categoryItems.forEach((i) => i.classList.toggle('dropdown__item--active', i.dataset.value === value));
  applyCategoryFilter();
}

function applyCategoryFilter() {
  let firstVisibleInput = null;
  let checkedIsVisible = false;

  document.querySelectorAll('.suite-card').forEach((card) => {
    const matches = card.dataset.category === currentCategory;
    card.hidden = !matches;
    if (!matches) return;
    const input = card.querySelector('input');
    if (!firstVisibleInput) firstVisibleInput = input;
    if (input.checked) checkedIsVisible = true;
  });

  if (!checkedIsVisible && firstVisibleInput) firstVisibleInput.checked = true;

  const isEmpty = !firstVisibleInput;
  emptyCategoryMsg.hidden = !isEmpty;
  if (!isRunInProgress) runButton.disabled = isEmpty;
}

setCategory(currentCategory);

// --- Light/dark theme toggle ---
const themeToggle = document.getElementById('theme-toggle');
const themeIconMoon = document.getElementById('theme-icon-moon');
const themeIconSun = document.getElementById('theme-icon-sun');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeIconMoon.style.display = theme === 'light' ? 'none' : 'block';
  themeIconSun.style.display = theme === 'light' ? 'block' : 'none';
}

applyTheme(localStorage.getItem('aloplay-qa-theme') || 'dark');

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  localStorage.setItem('aloplay-qa-theme', next);
});

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  isRunInProgress = true;
  reportWaitAttempts = 0;
  runStatusEl.innerHTML = '<div class="spinner"></div><span class="run-status__text">Starting run on GitHub Actions...</span>';
  resultRowEl.innerHTML = '';
  linksEl.innerHTML = '';

  const res = await fetch('/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suite: suiteRadio() }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    runStatusEl.innerHTML = '<span class="run-status__text run-status__text--failure">Could not start: ' +
      (body.error || res.statusText) + '</span>';
    isRunInProgress = false;
    runButton.disabled = false;
    return;
  }

  poll();
});

let reportWaitAttempts = 0;
const MAX_REPORT_WAIT_ATTEMPTS = 20; // ~60s of extra waiting after the run itself completes

function renderPills(statistic) {
  if (!statistic) return;
  const parts = [];
  if (statistic.passed) parts.push('<span class="pill pill--passed">' + statistic.passed + ' passed</span>');
  if (statistic.failed || statistic.broken) {
    parts.push('<span class="pill pill--failed">' + ((statistic.failed || 0) + (statistic.broken || 0)) + ' failed</span>');
  }
  if (statistic.skipped) parts.push('<span class="pill pill--skipped">' + statistic.skipped + ' skipped</span>');
  resultRowEl.innerHTML = parts.join('');
}

async function poll() {
  const res = await fetch('/status');
  const data = await res.json();

  if (!data.runId) {
    setTimeout(poll, 2000);
    return;
  }

  if (data.status !== 'completed') {
    runStatusEl.innerHTML = '<div class="spinner"></div><span class="run-status__text">Running on GitHub Actions (' +
      data.status + ')...</span>';
    if (tickingForRunId !== data.runId) {
      tickingForRunId = data.runId;
      startProgressTicker(data.dispatchedAt, data.avgDurationMs);
    }
    setTimeout(poll, 4000);
    return;
  }

  stopProgressTicker();

  const isSuccess = data.conclusion === 'success';
  const isCancelled = data.conclusion === 'cancelled';
  const statusClass = isCancelled ? 'failure' : (isSuccess ? 'success' : 'failure');
  const statusText = isCancelled ? 'Run cancelled' : (isSuccess ? 'All good' : 'Finished with failures');
  runStatusEl.innerHTML = '<span class="run-status__text run-status__text--' + statusClass + '">' + statusText + '</span>';
  isRunInProgress = false;
  runButton.disabled = false;
  renderPills(data.statistic);
  loadHistory();

  if (data.reportReady) {
    linksEl.innerHTML = '<a href="/report/index.html" target="_blank">Open full Allure report →</a>' +
      '<a href="' + data.htmlUrl + '" target="_blank">Raw run on GitHub</a>';
    return;
  }

  if (reportWaitAttempts < MAX_REPORT_WAIT_ATTEMPTS) {
    reportWaitAttempts++;
    linksEl.innerHTML = '<span class="empty">Fetching the Allure report...</span>';
    setTimeout(poll, 3000);
    return;
  }

  linksEl.innerHTML = '<a href="' + data.htmlUrl + '" target="_blank">View run on GitHub</a> (report not available)';
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.round(hours / 24) + 'd ago';
}

async function loadHistory() {
  const res = await fetch('/history');
  const data = await res.json();
  if (!data.length) {
    historyEl.innerHTML = '<p class="empty">No runs yet.</p>';
    return;
  }
  const rows = data.map((r) => {
    const dot = '<span class="conclusion-dot conclusion-dot--' + (r.conclusion === 'success' ? 'success' : 'failure') + '"></span>';
    const counts = r.statistic
      ? (r.statistic.passed || 0) + ' passed / ' + ((r.statistic.failed || 0) + (r.statistic.broken || 0)) + ' failed'
      : '—';
    return '<tr><td>' + dot + r.suite + '</td><td>' + counts + '</td><td>' + timeAgo(r.finishedAt) +
      '</td><td><a href="' + r.htmlUrl + '" target="_blank">GitHub ↗</a></td></tr>';
  }).join('');
  historyEl.innerHTML = '<table class="history"><thead><tr><th>Suite</th><th>Result</th><th>When</th><th></th></tr></thead><tbody>' +
    rows + '</tbody></table>';
}

// Pick up an in-flight run if the page is reloaded mid-run, and always show history on load.
poll();
loadHistory();
</script>
</body>
</html>`;
}

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function ghFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...ghHeaders, ...(options.headers || {}) } });
  return res;
}

async function dispatchWorkflow(suite) {
  const dispatchedAt = new Date().toISOString();
  const res = await ghFetch(`${GH_API}/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({
      ref: REF,
      inputs: {
        spec: suite,
        include_form_submitting: 'false', // never exposed on the public page
      },
    }),
  });
  if (res.status !== 204) {
    throw new Error(`Dispatch failed: ${res.status} ${await res.text()}`);
  }

  // The dispatch endpoint doesn't return a run id — poll the runs list for
  // the newest workflow_dispatch run created after we fired the request.
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    const listRes = await ghFetch(
      `${GH_API}/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5`
    );
    const listData = await listRes.json();
    const match = (listData.workflow_runs || []).find((r) => r.created_at >= dispatchedAt);
    if (match) return match.id;
  }
  throw new Error('Could not find the dispatched run — check the Actions tab on GitHub.');
}

async function pollRun() {
  if (!currentRun || !currentRun.runId) return;
  const res = await ghFetch(`${GH_API}/repos/${OWNER}/${REPO}/actions/runs/${currentRun.runId}`);
  const data = await res.json();
  currentRun.status = data.status;
  currentRun.conclusion = data.conclusion;
  currentRun.htmlUrl = data.html_url;

  if (data.status === 'completed' && !currentRun.reportFetched) {
    currentRun.reportFetched = true;
    try {
      await fetchAndExtractReport(currentRun.runId);
      currentRun.reportReady = true;
      currentRun.statistic = readSummaryStatistic();
    } catch (err) {
      console.error('Failed to fetch report artifact:', err);
      currentRun.reportReady = false;
    }

    history.unshift({
      suite: suiteLabel(currentRun.suite),
      suiteValue: currentRun.suite,
      conclusion: currentRun.conclusion,
      statistic: currentRun.statistic,
      htmlUrl: currentRun.htmlUrl,
      finishedAt: new Date().toISOString(),
      durationMs: currentRun.dispatchedAt ? Date.now() - new Date(currentRun.dispatchedAt).getTime() : null,
    });
    history.length = Math.min(history.length, MAX_HISTORY);
  }

  saveState();
}

// Shared by a fresh dispatch and by resuming/adopting a run found on disk
// or on GitHub after a restart — avoids two overlapping poll loops for the
// same run.
function startPolling(runId) {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    await pollRun();
    if (currentRun && currentRun.status === 'completed') {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }, 5000);
}

// If this process has no in-flight run tracked (fresh boot, or the disk
// state was lost along with everything else on a full redeploy), ask
// GitHub directly whether a workflow_dispatch run is currently in flight
// and pick it up — this is what makes a run started elsewhere (another
// process, a direct GitHub Actions dispatch, or one this instance lost
// track of) show up here instead of being permanently invisible.
async function adoptExternalRunIfAny() {
  if (currentRun) return;
  try {
    const res = await ghFetch(
      `${GH_API}/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5`
    );
    const data = await res.json();
    const inFlight = (data.workflow_runs || []).find((r) => r.status !== 'completed');
    if (!inFlight) return;
    currentRun = {
      runId: inFlight.id,
      suite: 'external',
      status: inFlight.status,
      conclusion: null,
      htmlUrl: inFlight.html_url,
      reportFetched: false,
      reportReady: false,
      dispatchedAt: inFlight.run_started_at || inFlight.created_at,
    };
    saveState();
    startPolling(currentRun.runId);
  } catch (err) {
    console.error('Failed to check for an external in-flight run:', err.message);
  }
}

// Resume tracking whatever was persisted before this process started.
if (currentRun && currentRun.runId && currentRun.status !== 'completed') {
  pollRun().then(() => {
    if (currentRun && currentRun.status !== 'completed') startPolling(currentRun.runId);
  });
}

function readSummaryStatistic() {
  try {
    const raw = fs.readFileSync(path.join(REPORT_DIR, 'widgets', 'summary.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.statistic || null;
  } catch {
    return null;
  }
}

async function fetchAndExtractReport(runId) {
  const artifactsRes = await ghFetch(`${GH_API}/repos/${OWNER}/${REPO}/actions/runs/${runId}/artifacts`);
  const artifactsData = await artifactsRes.json();
  const artifact = (artifactsData.artifacts || []).find((a) => a.name === 'allure-report');
  if (!artifact) throw new Error('No allure-report artifact found on this run.');

  const zipRes = await ghFetch(`${GH_API}/repos/${OWNER}/${REPO}/actions/artifacts/${artifact.id}/zip`, {
    redirect: 'follow',
  });
  if (!zipRes.ok) throw new Error(`Artifact download failed: ${zipRes.status}`);
  const buffer = Buffer.from(await zipRes.arrayBuffer());

  fs.rmSync(REPORT_DIR, { recursive: true, force: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const zip = new AdmZip(buffer);
  zip.extractAllTo(REPORT_DIR, true);
}

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.csv': 'text/csv',
};

function serveAssetFile(req, res) {
  const urlWithoutQuery = req.url.split('?')[0];
  const relPath = decodeURIComponent(urlWithoutQuery.replace(/^\/assets\/?/, ''));
  const filePath = path.join(ASSETS_DIR, relPath);
  if (!filePath.startsWith(ASSETS_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
    res.end(data);
  });
}

function serveReportFile(req, res) {
  const urlWithoutQuery = req.url.split('?')[0];
  const relPath = decodeURIComponent(urlWithoutQuery.replace(/^\/report\/?/, '')) || 'index.html';
  const filePath = path.join(REPORT_DIR, relPath);
  if (!filePath.startsWith(REPORT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    const body = html();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    (async () => {
      if (!currentRun) await adoptExternalRunIfAny();
      if (!currentRun) {
        sendJson(res, 200, { runId: null });
        return;
      }
      sendJson(res, 200, {
        runId: currentRun.runId,
        status: currentRun.status,
        conclusion: currentRun.conclusion,
        htmlUrl: currentRun.htmlUrl,
        reportReady: !!currentRun.reportReady,
        statistic: currentRun.statistic || null,
        dispatchedAt: currentRun.dispatchedAt || null,
        avgDurationMs: averageDurationMs(currentRun.suite),
      });
    })();
    return;
  }

  if (req.method === 'GET' && req.url === '/history') {
    sendJson(res, 200, history);
    return;
  }

  if (req.method === 'POST' && req.url === '/cancel') {
    (async () => {
      if (!currentRun || !currentRun.runId || currentRun.status === 'completed') {
        sendJson(res, 409, { error: 'No run in progress to cancel.' });
        return;
      }
      try {
        const cancelRes = await ghFetch(
          `${GH_API}/repos/${OWNER}/${REPO}/actions/runs/${currentRun.runId}/cancel`,
          { method: 'POST' }
        );
        if (cancelRes.status === 202) {
          sendJson(res, 202, { cancelling: true });
        } else {
          const text = await cancelRes.text();
          sendJson(res, 500, { error: `Cancel failed: ${cancelRes.status} ${text}` });
        }
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
    })();
    return;
  }

  if (req.method === 'POST' && req.url === '/run') {
    if (currentRun && currentRun.status && currentRun.status !== 'completed') {
      sendJson(res, 409, { error: 'A run is already in progress.' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body.' });
        return;
      }
      const suite = SUITES.some((s) => s.value === payload.suite) ? payload.suite : 'brand-gcplaying';

      if (ACCOUNT_CREATING_SUITES.has(suite) && lastRegistrationRunAt) {
        const elapsed = Date.now() - lastRegistrationRunAt;
        if (elapsed < REGISTRATION_COOLDOWN_MS) {
          const waitSeconds = Math.ceil((REGISTRATION_COOLDOWN_MS - elapsed) / 1000);
          sendJson(res, 429, {
            error: `This suite registers a real account on the live site. Please wait ${waitSeconds}s before running it again — the site rate-limits sign-ups from repeated runs.`,
          });
          return;
        }
      }

      try {
        const runId = await dispatchWorkflow(suite);
        if (ACCOUNT_CREATING_SUITES.has(suite)) lastRegistrationRunAt = Date.now();
        currentRun = {
          runId,
          suite,
          status: 'queued',
          reportFetched: false,
          reportReady: false,
          dispatchedAt: new Date().toISOString(),
        };
        saveState();
        sendJson(res, 202, { started: true, runId });
        startPolling(runId);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/report')) {
    serveReportFile(req, res);
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/assets/')) {
    serveAssetFile(req, res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Autotest run button listening on port ${PORT}`);
});
