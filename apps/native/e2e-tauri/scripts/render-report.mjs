import path from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { analyzeReportVisualProofs } from './visual-analysis.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const E2E_TAURI_DIR = path.resolve(THIS_DIR, '..');
const DEFAULT_ARTIFACT_ROOT = path.join(E2E_TAURI_DIR, 'artifacts');
const ARTIFACT_ROOT = path.resolve(process.env.NIXMAC_E2E_ARTIFACT_ROOT ?? DEFAULT_ARTIFACT_ROOT);
const MANIFEST_PATH = path.join(E2E_TAURI_DIR, 'scenarios', 'manifest.json');
const PROVIDER_ENVIRONMENT_TEXT_PATTERN =
  /provider_environment_failed|out of credits|billing limit|provider'?s billing|insufficient[_ -]?quota|payment required|(?:provider|api|account|openrouter|openai|billing|quota|rate limit|status|error|code).{0,48}\b(?:402|429)\b|\b(?:402|429)\b.{0,48}(?:provider|api|account|openrouter|openai|billing|quota|rate limit)|(?:provider|api|account|openrouter|openai).{0,48}rate limit|rate limit.{0,48}(?:provider|api|account|openrouter|openai|billing|quota)/i;

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
    'scenario_report_missing',
    'Selected scenario did not produce e2e-report.json',
  ],
  [
    'pre_scenario_setup_failed',
    'Scenario did not run because setup failed before the test command',
  ],
  [
    'provider_environment_failed',
    'Live provider/API account failed before product assertions could complete',
  ],
  [
    'screen_recording_invalid',
    'Screen recording was produced but failed validation',
  ],
  ['screen_recording_missing', 'No screen recording was captured for this run'],
  [
    'webview_recording_invalid',
    'Legacy webview frame-replay MP4 was produced but failed validation',
  ],
  ['webview_recording_missing', 'No legacy webview frame-replay MP4 was captured for this run'],
  [
    'webview_frame_timeline_invalid',
    'Webview frame timeline proof could not be built for this run',
  ],
  [
    'webview_frame_timeline_low_information',
    'Webview frame timeline was suppressed because captured frames were not visually informative',
  ],
  ['webview_frame_timeline_missing', 'No webview frame timeline proof was captured for this run'],
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
  if (PROVIDER_ENVIRONMENT_TEXT_PATTERN.test(text)) {
    return 'Top up or rotate the live provider/API key, confirm its billing limit, then rerun the live provider lane.';
  }
  if (/Selected scenario did not produce e2e-report\.json|scenario_report_missing|setup\/bootstrap/i.test(text)) {
    return 'Open the GitHub Actions matrix job for this scenario, fix the first setup/bootstrap failure, then rerun the E2E gate.';
  }
  if (/WDIO scenario command failed|Failed to create a session|plugin request failed|no window/i.test(text)) {
    return 'Inspect the WDIO diagnostic log and confirm the hosted runner built and launched the Tauri debug app before rerunning.';
  }
  if (/webview_frame_timeline_(invalid|missing|low_information)/i.test(text)) {
    return 'Inspect the hosted WDIO screenshot proof and frame-timeline diagnostics, then rerun the scenario.';
  }
  if (/webview_recording_(invalid|missing)/i.test(text)) {
    return 'Inspect the hosted WDIO legacy frame-replay diagnostics, then rerun the scenario.';
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

async function readSelection() {
  try {
    return JSON.parse(await readFile(path.join(ARTIFACT_ROOT, 'e2e-selection.json'), 'utf-8'));
  } catch {
    return null;
  }
}

async function readScenarioManifest() {
  try {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf-8'));
    return new Map((manifest.scenarios ?? []).map((scenario) => [scenario.name, scenario]));
  } catch {
    return new Map();
  }
}

function selectedScenarios(selection) {
  return (selection?.selected ?? [])
    .filter((scenario) => scenario?.name)
    .map((scenario) => ({
      name: scenario.name,
      lane: scenario.lane ?? 'unknown',
      currentScript: scenario.currentScript ?? null,
    }));
}

function synthesizeMissingReport({ selected, selection, manifest }) {
  const now = new Date().toISOString();
  const metadata = manifest.get(selected.name);
  const replayCommand =
    selected.currentScript ??
    metadata?.currentScript ??
    (selected.lane === 'full-mac'
      ? `tests/e2e/run.sh ${selected.name}`
      : `bun run test:wdio -- ${selected.name}`);
  const artifactDir = path.join(ARTIFACT_ROOT, selected.name);
  const error = [
    'Selected scenario did not produce e2e-report.json.',
    'The scenario likely failed in workflow setup/bootstrap before scenario-level reporting ran.',
    'Inspect the GitHub Actions matrix job logs for the first failed setup step.',
  ].join('\n');

  return {
    schemaVersion: 1,
    repo: selection?.repo ?? 'darkmatter/nixmac',
    prNumber: Number.isFinite(Number(selection?.prNumber)) ? Number(selection.prNumber) : null,
    headSha: selection?.headSha ?? process.env.GITHUB_SHA ?? 'unknown',
    baseSha: selection?.baseSha ?? null,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ? Number(process.env.GITHUB_RUN_ATTEMPT) : null,
    lane: selected.lane,
    scenario: selected.name,
    runnerId: 'GitHub Actions',
    runnerKind: selected.lane === 'full-mac' ? 'self-hosted-mac' : 'github-hosted',
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    status: 'infra_failed',
    htmlReportUrl: null,
    primaryProofUrl: null,
    failureProofUrl: null,
    failureScreenshotUrl: null,
    failureVideoUrl: null,
    failureTimestampMs: null,
    replayCommand,
    localReproCommand: replayCommand,
    captureLimitations: ['scenario_report_missing'],
    selectedButMissing: true,
    syntheticMissingReport: true,
    phases: [
      {
        name: 'Scenario report generation',
        status: 'infra_failed',
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        assertions: ['Selected scenario produces e2e-report.json'],
        proof: [],
        error,
      },
    ],
    proof: [],
    artifactDir,
    reportPath: path.join(artifactDir, 'e2e-report.json'),
  };
}

async function synthesizeMissingSelectedReports(reports, { selection, manifest }) {
  const seen = new Set(reports.map((report) => report.scenario));
  const syntheticReports = selectedScenarios(selection)
    .filter((selected) => !seen.has(selected.name))
    .map((selected) => synthesizeMissingReport({ selected, selection, manifest }));

  for (const report of syntheticReports) {
    await mkdir(report.artifactDir, { recursive: true });
    await writeFile(
      report.reportPath,
      `${JSON.stringify(serializableReport(report), null, 2)}\n`,
      'utf-8',
    );
  }

  return [...reports, ...syntheticReports].sort((a, b) => a.scenario.localeCompare(b.scenario));
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
        <img class="thumb" src="${escapeHtml(encodedPath)}" alt="${escapeHtml(proof.caption)}" loading="lazy">
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

function proofIdentity(proof) {
  return [proof?.kind, proof?.path, proof?.caption].map((value) => String(value ?? '')).join('|');
}

function renderProofGallery(proof, { fromDir = ARTIFACT_ROOT } = {}) {
  const entries = [];
  const seen = new Set();
  for (const entry of proof ?? []) {
    const key = proofIdentity(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }

  if (!entries.length) {
    return '<div class="proof"><span class="muted">none</span></div>';
  }

  const primaryProof =
    entries.find((entry) => entry.isFailureProof) ??
    entries.find((entry) => entry.isPrimary) ??
    entries.find((entry) => entry.kind === 'video') ??
    entries[0];
  const additionalProof = entries.filter((entry) => entry !== primaryProof);

  return `
    <div class="proof">
      ${renderProof(primaryProof, { fromDir })}
      ${
        additionalProof.length > 0
          ? `<details class="proof-gallery">
              <summary>View additional proof artifacts (${additionalProof.length})</summary>
              <div class="proof-grid">
                ${additionalProof
                  .map(
                    (entry) => `
                      <article class="proof-item ${escapeHtml(entry.kind)}">
                        <strong>${escapeHtml(entry.kind)}</strong>
                        ${renderProof(entry, { fromDir })}
                      </article>
                    `,
                  )
                  .join('')}
              </div>
            </details>`
          : ''
      }
    </div>
  `;
}

function metricLabel(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : 'n/a';
}

function renderVisualAnalysis(proof, { fromDir = ARTIFACT_ROOT } = {}) {
  const analysis = proof?.visualAnalysis;
  const frames = analysis?.frames ?? [];
  if (!analysis || analysis.status !== 'completed' || frames.length === 0) {
    return '';
  }

  return `
    <div class="visual-analysis">
      <h3>Visual timeline</h3>
      <p class="muted">
        ${escapeHtml(frames.length)} meaningful frame${frames.length === 1 ? '' : 's'} from
        ${escapeHtml(analysis.source.replaceAll('-', ' '))}.
        Deterministic checks only; scripted assertions remain the gate.
      </p>
      <div class="visual-frame-grid">
        ${frames
          .map((frame) => {
            const relativePath = relativeArtifactPath(frame.path, fromDir);
            const encodedPath = relativePath ? encodeUriPath(relativePath) : null;
            return `
              <article class="visual-frame">
                ${
                  encodedPath
                    ? `<a href="${escapeHtml(encodedPath)}"><img src="${escapeHtml(encodedPath)}" alt="${escapeHtml(frame.note)}"></a>`
                    : ''
                }
                <div>
                  <strong>${(frame.timestampMs / 1000).toFixed(1)}s</strong>
                  ${frame.label ? `<code>${escapeHtml(frame.label)}</code>` : ''}
                </div>
                <dl>
                  <dt>Change</dt><dd>${escapeHtml(metricLabel(frame.changeScore))}</dd>
                  <dt>Contrast</dt><dd>${escapeHtml(metricLabel(frame.contrast))}</dd>
                  <dt>Detail</dt><dd>${escapeHtml(metricLabel(frame.edgeScore))}</dd>
                </dl>
                ${renderBullets(frame.observations, 'visual-observations')}
                <p>${escapeHtml(frame.note)}</p>
              </article>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function renderVisualTimelines(proof, { fromDir = ARTIFACT_ROOT } = {}) {
  const timelines = (proof ?? [])
    .filter((entry) => entry.visualAnalysis?.schemaVersion === 1)
    .map((entry) => renderVisualAnalysis(entry, { fromDir }))
    .filter(Boolean);
  return timelines.join('');
}

function renderLaneExplanation(report) {
  if (report.lane === 'tauri-wdio') {
    return `
      <p class="lane-note">
        Hosted webview lane: deterministic app-flow assertions with screenshot and frame-timeline proof.
        It does not claim to be a full desktop screen recording.
      </p>
    `;
  }
  if (report.lane === 'full-mac') {
    return `
      <p class="lane-note">
        Full-Mac lane: real macOS desktop automation with full-screen recording evidence.
      </p>
    `;
  }
  return '';
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
      ${renderLaneExplanation(report)}
      ${renderScenarioScope(metadata)}
      ${renderCaptureLimitations(report.captureLimitations)}
      ${
        firstFailure
          ? renderFailure(report, firstFailure, failureProof, diagnosticLog, { fromDir })
          : renderProofGallery(proof, { fromDir })
      }
      ${renderVisualTimelines(proof, { fromDir })}
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
  const passed = reports.filter((report) => report.status === 'passed').length;
  const assertionFailed = reports.filter((report) => report.status === 'failed').length;
  const infraFailed = reports.filter((report) => report.status === 'infra_failed').length;
  const missingReports = reports.filter((report) => report.syntheticMissingReport).length;
  const reported = reports.length - missingReports;
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
    .lane-note { border-left: 3px solid #9aa8b7; background: #fbfcfe; padding: 8px 10px; color: #52606d; }
    .run-summary { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; color: #52606d; margin: 10px 0 18px; }
    .run-summary strong { color: #1f2933; }
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
    .thumb { display: block; width: min(900px, 100%); max-height: 720px; object-fit: contain; border: 1px solid #d8dee8; border-radius: 6px; background: #fff; }
    .video-proof { display: block; width: min(960px, 100%); max-height: 720px; border: 1px solid #d8dee8; border-radius: 6px; background: #000; }
    .proof-gallery { margin-top: 12px; }
    .proof-gallery summary { cursor: pointer; color: #384250; font-weight: 600; }
    .proof-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 10px; }
    .proof-item { border: 1px solid #d8dee8; border-radius: 8px; padding: 10px; background: #fbfcfe; }
    .proof-item strong { display: block; margin-bottom: 8px; color: #52606d; font-size: 12px; text-transform: uppercase; }
    .proof-item .thumb { width: 100%; max-width: 100%; max-height: 180px; object-fit: contain; }
    .proof-item .video-proof { width: 100%; max-height: 220px; }
    .visual-analysis { margin-top: 16px; border: 1px solid #d8dee8; border-radius: 8px; padding: 12px; background: #fbfcfe; }
    .visual-analysis h3 { margin: 0 0 4px; font-size: 14px; }
    .visual-frame-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 12px; }
    .visual-frame { border: 1px solid #d8dee8; border-radius: 8px; padding: 10px; background: #fff; }
    .visual-frame img { display: block; width: 100%; max-height: 260px; object-fit: contain; border: 1px solid #edf0f5; border-radius: 6px; background: #0a0a0a; }
    .visual-frame div { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
    .visual-frame dl { grid-template-columns: 64px 1fr; font-size: 12px; margin: 8px 0; }
    .visual-frame p { color: #52606d; font-size: 12px; }
    .visual-observations { margin: 8px 0; padding-left: 18px; color: #52606d; font-size: 12px; }
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
    <div class="run-summary">
      <strong>${passed} passed</strong>
      <strong>${assertionFailed} assertion failed</strong>
      <strong>${infraFailed} infra/not-run</strong>
      <span>${reported}/${reports.length} selected scenarios produced reports${missingReports ? `; ${missingReports} synthesized as missing` : ''}</span>
    </div>
    ${reports.length ? reports.map((report) => renderReport(report, { fromDir, manifest })).join('') : '<p>No scenario reports found.</p>'}
  </main>
</body>
</html>
`;
}

function serializableReport(report) {
  const serializable = { ...report };
  delete serializable.reportPath;
  delete serializable.artifactDir;
  return serializable;
}

async function analyzeReports(reports) {
  if (process.env.NIXMAC_E2E_SKIP_VISUAL_ANALYSIS === '1') {
    return reports;
  }

  const analyzed = [];
  for (const report of reports) {
    const result = await analyzeReportVisualProofs(report, {
      artifactRoot: ARTIFACT_ROOT,
      artifactDir: report.artifactDir,
    });
    if (result.changed) {
      await writeFile(
        report.reportPath,
        `${JSON.stringify(serializableReport(result.report), null, 2)}\n`,
        'utf-8',
      );
    }
    analyzed.push(result.report);
  }
  return analyzed;
}

async function main() {
  const manifest = await readScenarioManifest();
  const selection = await readSelection();
  const reports = await analyzeReports(
    await synthesizeMissingSelectedReports(await readReports(), { selection, manifest }),
  );

  await mkdir(ARTIFACT_ROOT, { recursive: true });
  await writeFile(
    path.join(ARTIFACT_ROOT, 'index.html'),
    renderPage(reports, { fromDir: ARTIFACT_ROOT, manifest }),
    'utf-8',
  );

  await Promise.all(
    reports.map((report) =>
      mkdir(report.artifactDir, { recursive: true }).then(() =>
        writeFile(
          path.join(report.artifactDir, 'index.html'),
          renderPage([report], { fromDir: report.artifactDir, manifest }),
          'utf-8',
        ),
      ),
    ),
  );

  console.log(`Wrote ${path.join(ARTIFACT_ROOT, 'index.html')}`);
}

await main();
