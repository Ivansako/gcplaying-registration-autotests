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

const GH_API = 'https://api.github.com';
const ghHeaders = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

let currentRun = null; // { runId, status, conclusion, htmlUrl, reportReady, startedAt, dispatchedAt }

const SUITES = [
  { value: 'registration', label: 'Registration (gcplaying0175.com)' },
  { value: 'game-providers', label: 'Game providers (ferraplay.com) — findings ledger, no live browser' },
  { value: 'all', label: 'All suites' },
];

function html() {
  const options = SUITES.map((s) => `<option value="${s.value}">${s.label}</option>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Autotests — run &amp; results</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.3rem; }
  fieldset { border: 1px solid #ddd; border-radius: 8px; margin-bottom: 1rem; padding: 1rem; }
  legend { font-weight: 600; padding: 0 .4rem; }
  select { width: 100%; padding: .5rem; box-sizing: border-box; }
  button { padding: .6rem 1.2rem; font-size: 1rem; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .6; }
  .status { font-weight: 600; margin-top: 1rem; }
  .status--success { color: #2a2; }
  .status--failure { color: #a22; }
  .report-link { display: inline-block; margin-top: .6rem; }
  p.hint { color: #666; font-size: .9rem; }
</style>
</head>
<body>
  <h1>gcplaying / ferraplay — autotest suite</h1>
  <p class="hint">Click Run — this triggers the suite on GitHub Actions, no GitHub account needed. When it
  finishes, the Allure report opens right here.</p>

  <fieldset>
    <legend>Suite</legend>
    <select id="suite">${options}</select>
  </fieldset>

  <button id="run-button">Run tests</button>
  <p class="status" id="status"></p>
  <p id="report-area"></p>

<script>
const runButton = document.getElementById('run-button');
const statusEl = document.getElementById('status');
const reportArea = document.getElementById('report-area');
const suiteSelect = document.getElementById('suite');

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  statusEl.textContent = 'Starting run on GitHub Actions...';
  statusEl.className = 'status';
  reportArea.textContent = '';
  reportWaitAttempts = 0;

  const res = await fetch('/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suite: suiteSelect.value }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    statusEl.textContent = 'Could not start: ' + (body.error || res.statusText);
    statusEl.className = 'status status--failure';
    runButton.disabled = false;
    return;
  }

  poll();
});

let reportWaitAttempts = 0;
const MAX_REPORT_WAIT_ATTEMPTS = 20; // ~60s of extra waiting after the run itself completes

async function poll() {
  const res = await fetch('/status');
  const data = await res.json();

  if (!data.runId) {
    setTimeout(poll, 2000);
    return;
  }

  if (data.status !== 'completed') {
    statusEl.textContent = 'Running on GitHub Actions (' + data.status + ')... this usually takes 1-3 minutes.';
    statusEl.className = 'status';
    setTimeout(poll, 4000);
    return;
  }

  statusEl.textContent = 'Finished — conclusion: ' + data.conclusion;
  statusEl.className = 'status status--' + (data.conclusion === 'success' ? 'success' : 'failure');
  runButton.disabled = false;

  if (data.reportReady) {
    reportArea.innerHTML = '<a class="report-link" href="/report/index.html" target="_blank">Open Allure report</a>' +
      ' &nbsp;·&nbsp; <a href="' + data.htmlUrl + '" target="_blank">View raw run on GitHub</a>';
    return;
  }

  // The run finished, but the server may still be downloading/unpacking the
  // report artifact — keep polling for a bit before giving up.
  if (reportWaitAttempts < MAX_REPORT_WAIT_ATTEMPTS) {
    reportWaitAttempts++;
    reportArea.textContent = 'Run finished — fetching the Allure report...';
    setTimeout(poll, 3000);
    return;
  }

  reportArea.innerHTML = '<a href="' + data.htmlUrl + '" target="_blank">View run on GitHub</a> (report not available)';
}

// If a run is already in flight when the page loads, pick up polling.
poll();
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
    } catch (err) {
      console.error('Failed to fetch report artifact:', err);
      currentRun.reportReady = false;
    }
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
    });
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
        currentRun = { runId, status: 'queued', reportFetched: false, reportReady: false };
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

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Autotest run button listening on port ${PORT}`);
});
