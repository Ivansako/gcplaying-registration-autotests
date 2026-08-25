'use strict';

/**
 * Local "run button" for the registration test suite.
 *
 * Serves a single HTML page where you pick a target environment
 * (base URL) and which test tags to run, click "Run", and watch the
 * output; when the run finishes it regenerates the Allure report and
 * gives you a link to open it. No CI, no extra npm dependencies —
 * plain Node http/child_process, meant to run on a QA engineer's own
 * machine.
 *
 * Usage: npm run ui   (then open http://localhost:5050)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 5050;
const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'allure-report');

// A local JRE was found at this path when Allure needed Java but none
// was on PATH (see README). Prepended to the report-generation child
// process's PATH only; harmless if it doesn't exist.
const FALLBACK_JAVA_BIN = 'C:\\Program Files (x86)\\Java\\jre1.8.0_503\\bin';

const TAGS = [
  { key: '@smoke', label: 'Successful registration (submits the form for real)', formSubmitting: true },
  { key: '@negative', label: 'All negative scenarios' },
  { key: '@email', label: 'Invalid email formats' },
  { key: '@phone', label: 'Invalid phone formats' },
  { key: '@password', label: 'Password requirements' },
  { key: '@required-fields', label: 'Missing required fields' },
  { key: '@duplicate', label: 'Duplicate email registration (submits the form for real)', formSubmitting: true },
];
const KNOWN_TAG_KEYS = new Set(TAGS.map((t) => t.key));
const FORM_SUBMITTING_TAGS = new Set(TAGS.filter((t) => t.formSubmitting).map((t) => t.key));

let currentRun = null; // { proc, log: string[], status: 'running'|'passed'|'failed', startedAt, baseUrl, tags }

function html() {
  const tagCheckboxes = TAGS.map(
    (t) => `
      <label class="tag${t.formSubmitting ? ' tag--danger' : ''}">
        <input type="checkbox" name="tag" value="${t.key}" data-form-submitting="${!!t.formSubmitting}">
        ${t.key} — ${t.label}
      </label>`
  ).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Registration suite — test runner</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.3rem; }
  fieldset { border: 1px solid #ddd; border-radius: 8px; margin-bottom: 1rem; padding: 1rem; }
  legend { font-weight: 600; padding: 0 .4rem; }
  .tag { display: block; margin: .35rem 0; font-size: .95rem; }
  .tag--danger { color: #a33; }
  input[type="text"] { width: 100%; padding: .4rem; box-sizing: border-box; }
  .confirm { background: #fff3f3; border: 1px solid #e3a; padding: .6rem; border-radius: 6px; margin-top: .6rem; font-size: .9rem; }
  button { padding: .6rem 1.2rem; font-size: 1rem; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .6; }
  pre { background: #111; color: #ddd; padding: 1rem; border-radius: 8px; height: 320px; overflow: auto; white-space: pre-wrap; font-size: .8rem; }
  .status { font-weight: 600; }
  .status--passed { color: #2a2; }
  .status--failed { color: #a22; }
  .report-link { display: inline-block; margin-top: .6rem; }
</style>
</head>
<body>
  <h1>gcplaying0175.com registration suite — test runner</h1>

  <form id="run-form">
    <fieldset>
      <legend>Environment</legend>
      <input type="text" id="baseUrl" value="https://gcplaying0175.com/" required>
    </fieldset>

    <fieldset>
      <legend>Tests to run (none checked = run everything)</legend>
      ${tagCheckboxes}
    </fieldset>

    <div id="confirm-box" class="confirm" hidden>
      <label>
        <input type="checkbox" id="confirmFormSubmission">
        I understand the selected tests submit the registration form for real and create an
        actual account on the environment above.
      </label>
    </div>

    <p><button type="submit" id="run-button">Run tests</button></p>
  </form>

  <p class="status" id="status"></p>
  <pre id="log" hidden></pre>
  <p id="report-area"></p>

<script>
const form = document.getElementById('run-form');
const runButton = document.getElementById('run-button');
const confirmBox = document.getElementById('confirm-box');
const confirmCheckbox = document.getElementById('confirmFormSubmission');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const reportArea = document.getElementById('report-area');

function selectedTags() {
  return Array.from(form.querySelectorAll('input[name="tag"]:checked')).map((el) => el.value);
}

function hasFormSubmittingTag() {
  return Array.from(form.querySelectorAll('input[name="tag"]:checked'))
    .some((el) => el.dataset.formSubmitting === 'true');
}

form.addEventListener('change', () => {
  confirmBox.hidden = !hasFormSubmittingTag();
  if (confirmBox.hidden) confirmCheckbox.checked = false;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const baseUrl = document.getElementById('baseUrl').value.trim();
  const tags = selectedTags();
  const confirmFormSubmission = confirmCheckbox.checked;

  if (hasFormSubmittingTag() && !confirmFormSubmission) {
    statusEl.textContent = 'Check the confirmation box before running form-submitting tests.';
    statusEl.className = 'status status--failed';
    return;
  }

  runButton.disabled = true;
  statusEl.textContent = 'Starting...';
  statusEl.className = 'status';
  logEl.hidden = false;
  logEl.textContent = '';
  reportArea.textContent = '';

  const res = await fetch('/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, tags, confirmFormSubmission }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    statusEl.textContent = 'Could not start: ' + (body.error || res.statusText);
    statusEl.className = 'status status--failed';
    runButton.disabled = false;
    return;
  }

  poll();
});

async function poll() {
  const res = await fetch('/status');
  const data = await res.json();
  logEl.textContent = (data.log || []).join('\\n');
  logEl.scrollTop = logEl.scrollHeight;

  if (data.status === 'running') {
    statusEl.textContent = 'Running against ' + data.baseUrl + ' (' + (data.tags.length ? data.tags.join(', ') : 'all tests') + ')...';
    statusEl.className = 'status';
    setTimeout(poll, 1500);
    return;
  }

  statusEl.textContent = data.status === 'passed' ? 'All tests passed.' : 'Some tests failed — see log below.';
  statusEl.className = 'status status--' + data.status;
  runButton.disabled = false;
  if (data.reportReady) {
    reportArea.innerHTML = '<a class="report-link" href="/report/index.html" target="_blank">Open Allure report</a>';
  }
}
</script>
</body>
</html>`;
}

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function runTests(baseUrl, tags) {
  currentRun = { log: [], status: 'running', startedAt: Date.now(), baseUrl, tags };

  const args = ['playwright', 'test', '--project=chromium', '--workers=1'];
  if (tags.length) args.push('--grep', tags.join('|'));

  const proc = spawn('npx', args, {
    cwd: ROOT,
    env: { ...process.env, BASE_URL: baseUrl },
    shell: true,
  });
  currentRun.proc = proc;

  const onData = (chunk) => {
    currentRun.log.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('close', (code) => {
    currentRun.status = code === 0 ? 'passed' : 'failed';
    generateReport();
  });
}

function generateReport() {
  currentRun.log.push('--- generating Allure report ---');
  const javaBin = fs.existsSync(FALLBACK_JAVA_BIN) ? FALLBACK_JAVA_BIN : null;
  const env = { ...process.env };
  if (javaBin) env.PATH = javaBin + path.delimiter + env.PATH;

  const proc = spawn('npx', ['allure', 'generate', 'allure-results', '--clean', '-o', 'allure-report'], {
    cwd: ROOT,
    env,
    shell: true,
  });
  const onData = (chunk) => {
    currentRun.log.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', (code) => {
    currentRun.reportReady = code === 0 && fs.existsSync(path.join(REPORT_DIR, 'index.html'));
  });
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
  const relPath = decodeURIComponent(req.url.replace(/^\/report\/?/, '')) || 'index.html';
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
      sendJson(res, 200, { status: 'idle', log: [] });
      return;
    }
    sendJson(res, 200, {
      status: currentRun.status,
      log: currentRun.log,
      baseUrl: currentRun.baseUrl,
      tags: currentRun.tags,
      reportReady: !!currentRun.reportReady,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/run') {
    if (currentRun && currentRun.status === 'running') {
      sendJson(res, 409, { error: 'A test run is already in progress.' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body.' });
        return;
      }

      const { baseUrl, tags, confirmFormSubmission } = payload;
      let parsedUrl;
      try {
        parsedUrl = new URL(baseUrl);
      } catch {
        sendJson(res, 400, { error: 'baseUrl must be a valid URL.' });
        return;
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        sendJson(res, 400, { error: 'baseUrl must use http or https.' });
        return;
      }

      const cleanTags = Array.isArray(tags) ? tags.filter((t) => KNOWN_TAG_KEYS.has(t)) : [];
      const needsConfirmation = cleanTags.some((t) => FORM_SUBMITTING_TAGS.has(t)) || cleanTags.length === 0;
      if (needsConfirmation && !confirmFormSubmission) {
        sendJson(res, 400, {
          error:
            'Running with no tag filter (or a form-submitting tag) creates a real account on the ' +
            'target environment — check the confirmation box first.',
        });
        return;
      }

      runTests(baseUrl, cleanTags);
      sendJson(res, 202, { started: true });
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
  console.log(`Test runner UI: http://localhost:${PORT}`);
});
