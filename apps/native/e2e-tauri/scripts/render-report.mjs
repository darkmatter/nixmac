import path from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const E2E_TAURI_DIR = path.resolve(THIS_DIR, '..');
const ARTIFACT_ROOT = path.join(E2E_TAURI_DIR, 'artifacts');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function relativeArtifactPath(filePath) {
  if (!filePath) return null;
  if (!path.isAbsolute(filePath)) return filePath.split(path.sep).join('/');
  return path.relative(ARTIFACT_ROOT, filePath).split(path.sep).join('/');
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
      reports.push({ ...report, reportPath });
    } catch {
      // Ignore partial scenario dirs; the aggregate gate will validate required reports later.
    }
  }

  return reports.sort((a, b) => a.scenario.localeCompare(b.scenario));
}

function renderProof(proof) {
  if (!proof) return '<span class="muted">none</span>';

  const relativePath = relativeArtifactPath(proof.path);
  if (proof.kind === 'screenshot' && relativePath) {
    return `
      <a href="${escapeHtml(relativePath)}">
        <img class="thumb" src="${escapeHtml(relativePath)}" alt="${escapeHtml(proof.caption)}">
      </a>
    `;
  }

  if (proof.kind === 'video' && relativePath) {
    return `
      <video class="video-proof" controls preload="metadata" src="${escapeHtml(relativePath)}"></video>
      <p><a href="${escapeHtml(relativePath)}">${escapeHtml(proof.caption || 'Flow recording')}</a></p>
    `;
  }

  return relativePath
    ? `<a href="${escapeHtml(relativePath)}">${escapeHtml(proof.caption || proof.kind)}</a>`
    : `<span>${escapeHtml(proof.caption || proof.kind)}</span>`;
}

function renderReport(report) {
  const firstFailure = report.phases.find((phase) => phase.status !== 'passed');
  const failureProof = report.proof.find((entry) => entry.isFailureProof);
  const primaryProof = report.proof.find((entry) => entry.isPrimary) ?? report.proof[0] ?? null;

  return `
    <section class="scenario ${escapeHtml(report.status)}">
      <header>
        <div>
          <h2>${escapeHtml(report.scenario)}</h2>
          <p>${escapeHtml(report.lane)} on ${escapeHtml(report.runnerId)} (${escapeHtml(report.runnerKind)})</p>
        </div>
        <strong>${escapeHtml(report.status)}</strong>
      </header>
      <dl>
        <dt>Commit</dt><dd><code>${escapeHtml(report.headSha)}</code></dd>
        <dt>Duration</dt><dd>${Math.round((report.durationMs ?? 0) / 1000)}s</dd>
        <dt>Replay</dt><dd><code>${escapeHtml(report.replayCommand)}</code></dd>
      </dl>
      ${
        firstFailure
          ? `<div class="failure">
              <h3>Failure: ${escapeHtml(firstFailure.name)}</h3>
              <p>${escapeHtml(firstFailure.error ?? 'No error message captured')}</p>
              ${renderProof(failureProof)}
            </div>`
          : `<div class="proof">${renderProof(primaryProof)}</div>`
      }
      <table>
        <thead><tr><th>Phase</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead>
        <tbody>
          ${report.phases
            .map(
              (phase) => `
                <tr>
                  <td>${escapeHtml(phase.name)}</td>
                  <td>${escapeHtml(phase.status)}</td>
                  <td>${Math.round((phase.durationMs ?? 0) / 1000)}s</td>
                  <td>${escapeHtml(phase.error ?? '')}</td>
                </tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    </section>
  `;
}

async function main() {
  const reports = await readReports();
  const failed = reports.filter((report) => report.status !== 'passed').length;
  const passed = reports.length - failed;

  await mkdir(ARTIFACT_ROOT, { recursive: true });
  await writeFile(
    path.join(ARTIFACT_ROOT, 'index.html'),
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>nixmac E2E Report</title>
  <style>
    body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #1f2933; background: #f7f8fa; }
    main { max-width: 1120px; margin: 0 auto; }
    h1 { margin-bottom: 4px; }
    .muted { color: #687483; }
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
    .failure { border: 1px solid #f2b8b5; background: #fff5f5; border-radius: 8px; padding: 12px; }
    .thumb { display: block; max-width: 520px; max-height: 320px; border: 1px solid #d8dee8; border-radius: 6px; background: #fff; }
    .video-proof { display: block; width: min(720px, 100%); max-height: 480px; border: 1px solid #d8dee8; border-radius: 6px; background: #000; }
  </style>
</head>
<body>
  <main>
    <h1>nixmac E2E Report</h1>
    <p class="muted">${passed} passed, ${failed} failed, ${reports.length} total</p>
    ${reports.length ? reports.map(renderReport).join('') : '<p>No scenario reports found.</p>'}
  </main>
</body>
</html>
`,
    'utf-8',
  );

  console.log(`Wrote ${path.join(ARTIFACT_ROOT, 'index.html')}`);
}

await main();
