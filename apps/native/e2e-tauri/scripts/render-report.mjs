import path from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const E2E_TAURI_DIR = path.resolve(THIS_DIR, '..');
const ARTIFACT_ROOT = path.join(E2E_TAURI_DIR, 'artifacts');
const MANIFEST_PATH = path.join(E2E_TAURI_DIR, 'scenarios', 'manifest.json');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const CAPTURE_LIMITATION_LABELS = new Map([
  [
    'full_mac_runner_unavailable',
    'Full-Mac runner was unreachable or did not produce a scenario report',
  ],
  [
    'screen_recording_invalid',
    'Screen recording was produced but failed validation',
  ],
  ['screen_recording_missing', 'No screen recording was captured for this run'],
]);

function humanizeCaptureLimitation(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return CAPTURE_LIMITATION_LABELS.get(raw) ?? raw.replaceAll('_', ' ');
}

function normalizeDiagnosticText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function diagnosticLines(value) {
  const normalized = normalizeDiagnosticText(value)
    .replace(/\s+(\[[a-z]+\]\s+)/gi, '\n$1')
    .replace(
      /\s+(?=(?:ERROR|Error|error|fatal|Failed|failed|End-of-central-directory|unzip:|find:|bash:)\b)/g,
      '\n',
    );
  return normalized
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function isSignalLine(line) {
  return /(\bERROR\b|\berror\b|\bfatal\b|\bfailed\b|No \.app bundle|End-of-central-directory|cannot find zipfile|Terminated:|timed out|Missing full-Mac E2E GitHub secrets)/i.test(
    line,
  );
}

function tail(value, maxLength) {
  const text = String(value ?? '');
  return text.length > maxLength ? `...${text.slice(-maxLength)}` : text;
}

function truncate(value, maxLength) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function summarizeError(error) {
  const raw = normalizeDiagnosticText(error);
  if (!raw) {
    return {
      summary: 'No error message captured.',
      detail: '',
      signals: [],
      isLong: false,
    };
  }

  const lines = diagnosticLines(raw);
  const signals = lines.filter(isSignalLine);
  const summaryLine = signals.at(-1) ?? lines.at(-1) ?? raw;
  const summary = summaryLine
    .replace(/^\[[a-z]+\]\s+/i, '')
    .replace(/^(?:ERROR|Error|error):\s*/, '')
    .trim();
  const detail = lines.length > 1 ? lines.join('\n') : raw;

  return {
    summary: summary.length > 220 ? `${summary.slice(0, 217)}...` : summary,
    detail,
    signals: signals.slice(-3),
    isLong: raw.length > 260 || lines.length > 4,
  };
}

function nextActionForError(error, report) {
  const text = String(error ?? '');
  if (/Missing full-Mac E2E GitHub secrets/i.test(text)) {
    return 'Add the missing MAC_E2E_* GitHub secrets, then rerun the E2E gate.';
  }
  if (/No \.app bundle in artifact|End-of-central-directory|cannot find zipfile/i.test(text)) {
    return 'Verify the Build macOS App artifact for this commit, then rerun once artifact download and extraction succeed.';
  }
  if (/Full-Mac runner did not produce|full_mac_runner_unavailable|SSH status/i.test(text)) {
    return 'Check the configured Mac runner reachability and scenario log, then rerun the full-Mac lane.';
  }
  if (/WDIO scenario command failed|Failed to create a session|plugin request failed|no window/i.test(text)) {
    return 'Inspect the WDIO diagnostic log and confirm the hosted runner built and launched the Tauri debug app before rerunning.';
  }
  if (/screen_recording_(invalid|missing)|recording/i.test(text)) {
    return 'Inspect screenshots and confirm Screen Recording permission on the Mac runner.';
  }
  if (report?.htmlReportUrl) {
    return 'Open the full report and workflow logs for the failing phase, then rerun the replay command after fixing the cause.';
  }
  return 'Inspect the workflow logs for the failing phase, then rerun the replay command after fixing the cause.';
}

function relativeArtifactPath(filePath, fromDir = ARTIFACT_ROOT) {
  if (!filePath) return null;
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(ARTIFACT_ROOT, filePath);
  return path.relative(fromDir, absolutePath).split(path.sep).join('/');
}

function encodeUriPath(value) {
  return String(value)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function readReports() {
  let entries = [];
  try {
    entries = await readdir(ARTIFACT_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const reports = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const reportPath = path.join(ARTIFACT_ROOT, entry.name, 'e2e-report.json');
    try {
      const report = JSON.parse(await readFile(reportPath, 'utf-8'));
      reports.push({ ...report, reportPath, artifactDir: path.dirname(reportPath) });
    } catch {
      // Ignore partial scenario dirs; the aggregate gate will validate required reports later.
    }
  }

  return reports.sort((a, b) => a.scenario.localeCompare(b.scenario));
}

async function readScenarioManifest() {
  try {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf-8'));
    return new Map((manifest.scenarios ?? []).map((scenario) => [scenario.name, scenario]));
  } catch {
    return new Map();
  }
}

function renderBullets(items, className = '') {
  const values = (items ?? []).map((item) => String(item).trim()).filter(Boolean);
  if (!values.length) return '';
  return `
    <ul${className ? ` class="${escapeHtml(className)}"` : ''}>
      ${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
    </ul>
  `;
}

function renderScenarioScope(metadata) {
  if (!metadata) return '';
  return `
    <div class="scenario-scope">
      <h3>What this checks</h3>
      <p>${escapeHtml(metadata.summary ?? 'Scenario coverage metadata unavailable.')}</p>
      <div class="scope-grid">
        <div>
          <strong>Coverage</strong>
          ${renderBullets(metadata.coverage)}
        </div>
        <div>
          <strong>Known gaps / not covered</strong>
          ${renderBullets(metadata.knownGaps)}
        </div>
      </div>
    </div>
  `;
}

function renderProof(proof, { fromDir = ARTIFACT_ROOT } = {}) {
  if (!proof) return '<span class="muted">none</span>';

  const relativePath = relativeArtifactPath(proof.path, fromDir);
  const encodedPath = relativePath ? encodeUriPath(relativePath) : null;
  if (proof.kind === 'screenshot' && relativePath) {
    return `
      <a href="${escapeHtml(encodedPath)}">
        <img class="thumb" src="${escapeHtml(encodedPath)}" alt="${escapeHtml(proof.caption)}">
      </a>
    `;
  }

  if (proof.kind === 'video' && relativePath) {
    return `
      <video class="video-proof" controls preload="metadata" src="${escapeHtml(encodedPath)}"></video>
      <p><a href="${escapeHtml(encodedPath)}">${escapeHtml(proof.caption || 'Flow recording')}</a></p>
    `;
  }

  if (proof.kind === 'log' && relativePath) {
    return `<p class="log-link"><a href="${escapeHtml(encodedPath)}">${escapeHtml(proof.caption || 'Diagnostic log')}</a></p>`;
  }

  return relativePath
    ? `<a href="${escapeHtml(encodedPath)}">${escapeHtml(proof.caption || proof.kind)}</a>`
    : `<span>${escapeHtml(proof.caption || proof.kind)}</span>`;
}

function renderCaptureLimitations(limitations) {
  if (!limitations?.length) return '';
  return `
    <div class="capture-limitations">
      <strong>Capture limitations</strong>
      <ul>
        ${limitations
          .map(
            (limitation) =>
              `<li title="${escapeHtml(limitation)}">${escapeHtml(humanizeCaptureLimitation(limitation))}</li>`,
          )
          .join('')}
      </ul>
    </div>
  `;
}

function renderFailure(report, phase, failureProof, diagnosticLog, { fromDir }) {
  const analysis = summarizeError(phase?.error);
  const nextAction = nextActionForError(phase?.error, report);
  const signalList =
    analysis.signals.length > 1
      ? `<ul class="diagnostic-signals">${analysis.signals
          .map((line) => `<li>${escapeHtml(truncate(line, 240))}</li>`)
          .join('')}</ul>`
      : '';
  const rawDetails =
    analysis.isLong && analysis.detail
      ? `<details class="diagnostic-details">
          <summary>Raw diagnostic detail</summary>
          <pre>${escapeHtml(tail(analysis.detail, 3000))}</pre>
        </details>`
      : '';

  return `
    <div class="failure">
      <h3>Failure: ${escapeHtml(phase?.name ?? report.scenario)}</h3>
      <dl class="failure-summary">
        <dt>What happened</dt>
        <dd>${escapeHtml(analysis.summary)}</dd>
        <dt>Next action</dt>
        <dd>${escapeHtml(nextAction)}</dd>
      </dl>
      ${signalList}
      ${failureProof ? renderProof(failureProof, { fromDir }) : ''}
      ${diagnosticLog && diagnosticLog !== failureProof ? renderProof(diagnosticLog, { fromDir }) : ''}
      ${rawDetails}
    </div>
  `;
}

function renderPhaseError(error) {
  if (!error) return '';
  return escapeHtml(summarizeError(error).summary);
}

function renderReport(report, { fromDir = ARTIFACT_ROOT, manifest = new Map() } = {}) {
  const phases = report.phases ?? [];
  const proof = report.proof ?? [];
  const firstFailure = phases.find((phase) => phase.status !== 'passed');
  const failureProof = proof.find((entry) => entry.isFailureProof);
  const diagnosticLog = proof.find((entry) => entry.kind === 'log');
  const primaryProof = proof.find((entry) => entry.isPrimary) ?? proof[0] ?? null;
  const metadata = manifest.get(report.scenario);

  return `
    <section class="scenario ${escapeHtml(report.status)}">
      <header>
        <div>
          <h2>${escapeHtml(metadata?.title ?? report.scenario)}</h2>
          <p><code>${escapeHtml(report.scenario)}</code></p>
          <p>${escapeHtml(report.lane)} on ${escapeHtml(report.runnerId)} (${escapeHtml(report.runnerKind)})</p>
        </div>
        <strong>${escapeHtml(report.status)}</strong>
      </header>
      <dl>
        <dt>Commit</dt><dd><code>${escapeHtml(report.headSha)}</code></dd>
        <dt>Duration</dt><dd>${Math.round((report.durationMs ?? 0) / 1000)}s</dd>
        <dt>Replay</dt><dd><code>${escapeHtml(report.replayCommand)}</code></dd>
      </dl>
      ${renderScenarioScope(metadata)}
      ${renderCaptureLimitations(report.captureLimitations)}
      ${
        firstFailure
          ? renderFailure(report, firstFailure, failureProof, diagnosticLog, { fromDir })
          : `<div class="proof">${renderProof(primaryProof, { fromDir })}</div>`
      }
      <table>
        <thead><tr><th>Phase</th><th>Status</th><th>Duration</th><th>Summary</th></tr></thead>
        <tbody>
          ${phases
            .map(
              (phase) => `
                <tr>
                  <td>${escapeHtml(phase.name)}</td>
                  <td><span class="status-pill ${escapeHtml(phase.status)}">${escapeHtml(phase.status)}</span></td>
                  <td>${Math.round((phase.durationMs ?? 0) / 1000)}s</td>
                  <td>${renderPhaseError(phase.error)}</td>
                </tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    </section>
  `;
}

function renderPage(reports, { fromDir = ARTIFACT_ROOT, manifest = new Map() } = {}) {
  const failed = reports.filter((report) => report.status !== 'passed').length;
  const passed = reports.length - failed;
  const scenarioPage = reports.length === 1 && reports[0]?.artifactDir !== undefined && fromDir !== ARTIFACT_ROOT;
  const pageTitle = scenarioPage
    ? `nixmac E2E Report - ${reports[0].scenario}`
    : 'nixmac E2E Report';
  const backLink = scenarioPage
    ? '<p class="muted"><a href="../index.html">View all scenarios</a></p>'
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #1f2933; background: #f7f8fa; }
    main { max-width: 1120px; margin: 0 auto; }
    h1 { margin-bottom: 4px; }
    .muted { color: #687483; }
    .muted a { color: inherit; }
    .scenario { background: #fff; border: 1px solid #d8dee8; border-radius: 8px; margin: 20px 0; padding: 20px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
    .scenario > header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; border-bottom: 1px solid #edf0f5; padding-bottom: 12px; }
    .scenario h2 { margin: 0; font-size: 18px; }
    .scenario p { margin: 4px 0 0; color: #687483; }
    .passed > header strong { color: #11845b; }
    .failed > header strong, .infra_failed > header strong { color: #b42318; }
    dl { display: grid; grid-template-columns: 90px 1fr; gap: 6px 12px; }
    dt { font-weight: 600; color: #52606d; }
    dd { margin: 0; }
    code { background: #f1f4f8; padding: 2px 4px; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; border-top: 1px solid #edf0f5; padding: 8px; vertical-align: top; }
    th { color: #52606d; font-weight: 600; }
    td:last-child { color: #52606d; }
    .failure { border: 1px solid #f2b8b5; background: #fff5f5; border-radius: 8px; padding: 12px; }
    .failure h3 { margin: 0 0 10px; }
    .failure-summary { grid-template-columns: 120px 1fr; margin: 0 0 10px; }
    .scenario-scope { margin: 14px 0; border: 1px solid #d8dee8; border-radius: 8px; padding: 12px; background: #fbfcfe; }
    .scenario-scope h3 { margin: 0 0 6px; font-size: 14px; }
    .scenario-scope p { margin: 0 0 10px; color: #52606d; }
    .scope-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .scope-grid strong { display: block; margin-bottom: 4px; color: #384250; }
    .scope-grid ul { margin: 0; padding-left: 18px; color: #52606d; }
    .diagnostic-signals { margin: 10px 0; color: #5f6b7a; padding-left: 20px; }
    .diagnostic-details { margin-top: 10px; color: #52606d; }
    .diagnostic-details summary { cursor: pointer; font-weight: 600; }
    .diagnostic-details pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #1f2933; color: #edf0f5; border-radius: 6px; padding: 12px; max-height: 360px; overflow: auto; }
    .capture-limitations { color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 8px 10px; }
    .capture-limitations strong { display: block; margin-bottom: 4px; }
    .capture-limitations ul { margin: 0; padding-left: 18px; }
    .status-pill { display: inline-block; border-radius: 999px; padding: 2px 8px; font-weight: 600; font-size: 12px; }
    .status-pill.passed { background: #e9f8f1; color: #0f6f4f; }
    .status-pill.failed, .status-pill.infra_failed { background: #fdecec; color: #a61b13; }
    .thumb { display: block; max-width: 520px; max-height: 320px; border: 1px solid #d8dee8; border-radius: 6px; background: #fff; }
    .video-proof { display: block; width: min(720px, 100%); max-height: 480px; border: 1px solid #d8dee8; border-radius: 6px; background: #000; }
    .log-link { margin-top: 8px; }
    @media (max-width: 720px) {
      .scope-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(pageTitle)}</h1>
    ${backLink}
    <p class="muted">${passed} passed, ${failed} failed, ${reports.length} total</p>
    ${reports.length ? reports.map((report) => renderReport(report, { fromDir, manifest })).join('') : '<p>No scenario reports found.</p>'}
  </main>
</body>
</html>
`;
}

async function main() {
  const reports = await readReports();
  const manifest = await readScenarioManifest();

  await mkdir(ARTIFACT_ROOT, { recursive: true });
  await writeFile(
    path.join(ARTIFACT_ROOT, 'index.html'),
    renderPage(reports, { fromDir: ARTIFACT_ROOT, manifest }),
    'utf-8',
  );

  await Promise.all(
    reports.map((report) =>
      writeFile(
        path.join(report.artifactDir, 'index.html'),
        renderPage([report], { fromDir: report.artifactDir, manifest }),
        'utf-8',
      ),
    ),
  );

  console.log(`Wrote ${path.join(ARTIFACT_ROOT, 'index.html')}`);
}

await main();
