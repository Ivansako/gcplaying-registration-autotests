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

let currentRun = null; // { runId, suite, status, conclusion, htmlUrl, reportReady, statistic, dispatchedAt }
const history = []; // most recent first, capped at MAX_HISTORY

// `category` groups suites in the page's Category dropdown: tests that
// exercise the site's actual product behavior (game providers) are
// "Product"; tests that exercise the codebase's own auth/registration
// flows are "Development". "all" gets its own catch-all category rather
// than living in either, since it runs both.
const SUITES = [
  {
    value: 'registration',
    label: 'Registration',
    sub: 'gcplaying0175.com — live browser, real form checks',
    category: 'development',
  },
  {
    value: 'brand-gcplaying',
    label: 'Brand test — gcplaying0175.com',
    sub: 'Desktop + mobile, registration + login, screenshot on every check — creates a real account every run',
    category: 'development',
  },
  {
    value: 'game-providers',
    label: 'Game providers',
    sub: 'ferraplay.com — findings ledger, no live browser',
    category: 'product',
  },
  { value: 'all', label: 'All suites', sub: 'Everything above', category: 'all' },
];

const CATEGORIES = [
  { value: 'development', label: 'Development' },
  { value: 'product', label: 'Product' },
  { value: 'all', label: 'All suites' },
];

function suiteLabel(value) {
  const s = SUITES.find((x) => x.value === value);
  return s ? s.label : value;
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
          <input type="radio" name="suite" value="${s.value}" ${s.value === 'registration' ? 'checked' : ''}>
          <span class="suite-card__title">${s.label}</span>
          <span class="suite-card__sub">${s.sub}</span>
        </label>`
  ).join('\n');

  const categoryOptions = CATEGORIES.map((c) => `<option value="${c.value}">${c.label}</option>`).join('\n');

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
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(circle at top, var(--bg-2), var(--bg) 55%);
    color: var(--text);
    margin: 0;
    padding: 2.5rem 1.25rem 4rem;
  }
  .page { max-width: 640px; margin: 0 auto; }
  .brand { display: flex; align-items: center; margin-bottom: 1.5rem; }
  .brand__logo { height: 30px; width: auto; display: block; }
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
  select#category-select {
    appearance: none;
    -webkit-appearance: none;
    background: var(--bg-2) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%239aa1b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right .7rem center;
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: .4rem 1.8rem .4rem .7rem;
    font-family: inherit;
    font-size: .85rem;
    font-weight: 500;
    cursor: pointer;
  }
  select#category-select:focus { outline: none; border-color: var(--purple); }
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
  <div class="brand"><img class="brand__logo" src="/assets/aloplay-logo-white.svg" alt="Aloplay"></div>
  <h1>Aloplay Automation QA Test Suites</h1>
  <p class="hint">Dear Aloplayers, pick a suite and click Run. This triggers the selected suite on GitHub
  Actions — no GitHub account needed — and the results show up right here once it finishes (usually 1-3
  minutes).</p>

  <div class="card">
    <div class="card-header">
      <h2>Suite</h2>
      <select id="category-select">
        ${categoryOptions}
      </select>
    </div>
    ${cards}
    <div style="margin-top: 1rem;">
      <button id="run-button">Run tests</button>
      <div class="run-status" id="run-status"></div>
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

function suiteRadio() {
  return document.querySelector('input[name="suite"]:checked').value;
}

const categorySelect = document.getElementById('category-select');

function applyCategoryFilter() {
  const category = categorySelect.value;
  let firstVisibleInput = null;
  let checkedIsVisible = false;

  document.querySelectorAll('.suite-card').forEach((card) => {
    const matches = card.dataset.category === category;
    card.hidden = !matches;
    if (!matches) return;
    const input = card.querySelector('input');
    if (!firstVisibleInput) firstVisibleInput = input;
    if (input.checked) checkedIsVisible = true;
  });

  if (!checkedIsVisible && firstVisibleInput) firstVisibleInput.checked = true;
}

categorySelect.addEventListener('change', applyCategoryFilter);
applyCategoryFilter();

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
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
      data.status + ')... usually 1-3 minutes.</span>';
    setTimeout(poll, 4000);
    return;
  }

  const isSuccess = data.conclusion === 'success';
  runStatusEl.innerHTML = '<span class="run-status__text run-status__text--' + (isSuccess ? 'success' : 'failure') + '">' +
    (isSuccess ? 'All good' : 'Finished with failures') + '</span>';
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
      conclusion: currentRun.conclusion,
      statistic: currentRun.statistic,
      htmlUrl: currentRun.htmlUrl,
      finishedAt: new Date().toISOString(),
    });
    history.length = Math.min(history.length, MAX_HISTORY);
  }
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
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/history') {
    sendJson(res, 200, history);
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
      const suite = SUITES.some((s) => s.value === payload.suite) ? payload.suite : 'registration';

      try {
        const runId = await dispatchWorkflow(suite);
        currentRun = { runId, suite, status: 'queued', reportFetched: false, reportReady: false };
        sendJson(res, 202, { started: true, runId });

        const interval = setInterval(async () => {
          await pollRun();
          if (currentRun && currentRun.status === 'completed') clearInterval(interval);
        }, 5000);
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
