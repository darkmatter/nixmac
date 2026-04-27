import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const E2E_TAURI_DIR = path.resolve(THIS_DIR, '..');
const REPO_ROOT = path.resolve(E2E_TAURI_DIR, '../../..');
const DEFAULT_ARTIFACT_ROOT = path.join(E2E_TAURI_DIR, 'artifacts');
const ARTIFACT_ROOT = path.resolve(process.env.NIXMAC_E2E_ARTIFACT_ROOT ?? DEFAULT_ARTIFACT_ROOT);
const OUTPUT_DIR = path.resolve(
  process.env.NIXMAC_E2E_AI_QA_OUTPUT_DIR ?? path.join(DEFAULT_ARTIFACT_ROOT, 'ai-qa'),
);
const MANIFEST_PATH = path.join(E2E_TAURI_DIR, 'scenarios', 'manifest.json');
const PACKET_MAX_REPORT_ERROR_CHARS = Number(process.env.NIXMAC_E2E_AI_QA_ERROR_CHARS ?? 1200);
const PACKET_MAX_VISUAL_FRAMES = Number(process.env.NIXMAC_E2E_AI_QA_MAX_VISUAL_FRAMES ?? 8);
const PACKET_MAX_CHANGED_FILES = Number(process.env.NIXMAC_E2E_AI_QA_MAX_CHANGED_FILES ?? 200);
const OPENAI_TIMEOUT_MS = Number(process.env.NIXMAC_E2E_AI_QA_TIMEOUT_MS ?? 120000);

const VERDICT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'status',
    'summary',
    'blockingIssues',
    'nonBlockingIssues',
    'scenarioAssessments',
    'unreviewedRisks',
    'recommendedNextActions',
  ],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    status: { type: 'string', enum: ['passed', 'needs_human_review', 'failed', 'incomplete'] },
    summary: { type: 'string' },
    blockingIssues: {
      type: 'array',
      items: { $ref: '#/$defs/issue' },
    },
    nonBlockingIssues: {
      type: 'array',
      items: { $ref: '#/$defs/issue' },
    },
    scenarioAssessments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['scenario', 'lane', 'verdict', 'rationale', 'evidenceUsed'],
        properties: {
          scenario: { type: 'string' },
          lane: { type: 'string' },
          verdict: { type: 'string', enum: ['covered', 'weak_evidence', 'failed', 'not_run'] },
          rationale: { type: 'string' },
          evidenceUsed: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
    unreviewedRisks: {
      type: 'array',
      items: { type: 'string' },
    },
    recommendedNextActions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  $defs: {
    issue: {
      type: 'object',
      additionalProperties: false,
      required: ['severity', 'title', 'detail', 'scenario', 'evidence'],
      properties: {
        severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        title: { type: 'string' },
        detail: { type: 'string' },
        scenario: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        evidence: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  },
});

function truncate(value, maxLength) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function redact(value) {
  return String(value ?? '')
    .replace(/x-access-token:[^@\s]+@/g, 'x-access-token:[redacted]@')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[redacted-github-token]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted-github-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/(Authorization:\s*)[^\n\r]+/gi, '$1[redacted]')
    .replace(/(ADMIN_PASSWORD=)[^\s]+/g, '$1[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-aws-key]')
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, '[redacted-google-key]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[redacted-openai-key]')
    .replace(/\bsk-ant-[A-Za-z0-9_-]{20,}\b/gi, '[redacted-anthropic-key]')
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '[redacted-private-key]');
}

function redactStructured(value) {
  if (typeof value === 'string') {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactStructured);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStructured(item)]));
  }
  return value;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function findFiles(root, fileName) {
  const matches = [];
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return matches;
  }

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findFiles(fullPath, fileName)));
    } else if (entry.name === fileName) {
      matches.push(fullPath);
    }
  }

  return matches;
}

async function gitOutput(args) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: REPO_ROOT,
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function changedFiles() {
  const base = process.env.E2E_BASE_SHA || process.env.GITHUB_BASE_SHA || '';
  const head = process.env.E2E_HEAD_SHA || process.env.GITHUB_SHA || '';
  if (base && head) {
    const output = await gitOutput(['diff', '--name-only', `${base}...${head}`]);
    if (output) {
      return output.split('\n').filter(Boolean).slice(0, PACKET_MAX_CHANGED_FILES);
    }
  }

  const output = await gitOutput(['diff', '--name-only', 'HEAD']);
  return output.split('\n').filter(Boolean).slice(0, PACKET_MAX_CHANGED_FILES);
}

function scenarioMetadata(manifest, scenarioName) {
  return (manifest.scenarios ?? []).find((scenario) => scenario.name === scenarioName) ?? null;
}

function summarizePhase(phase) {
  return {
    name: phase.name,
    status: phase.status,
    durationMs: phase.durationMs ?? 0,
    assertions: phase.assertions ?? [],
    error: phase.error ? truncate(redact(phase.error), PACKET_MAX_REPORT_ERROR_CHARS) : null,
    proofCount: (phase.proof ?? []).length,
  };
}

function summarizeProof(proof) {
  const visualFrames = (proof.visualAnalysis?.frames ?? []).slice(0, PACKET_MAX_VISUAL_FRAMES);
  return {
    kind: proof.kind,
    path: proof.path ?? null,
    url: proof.url ?? null,
    phase: proof.phase ?? null,
    caption: proof.caption ?? null,
    isPrimary: Boolean(proof.isPrimary),
    isFailureProof: Boolean(proof.isFailureProof),
    metadata: proof.metadata ?? {},
    visualAnalysis: proof.visualAnalysis
      ? {
          status: proof.visualAnalysis.status,
          source: proof.visualAnalysis.source,
          selectedFrameCount: proof.visualAnalysis.selectedFrameCount ?? visualFrames.length,
          sampleCount: proof.visualAnalysis.sampleCount ?? 0,
          warnings: proof.visualAnalysis.warnings ?? [],
          frames: visualFrames.map((frame) => ({
            timestampMs: frame.timestampMs,
            label: frame.label,
            path: frame.path,
            url: frame.url ?? null,
            observations: frame.observations ?? [],
            note: frame.note,
            changeScore: frame.changeScore ?? null,
            contrast: frame.contrast ?? null,
            edgeScore: frame.edgeScore ?? null,
          })),
        }
      : null,
  };
}

function summarizeReport(report, manifest) {
  const meta = scenarioMetadata(manifest, report.scenario);
  return {
    scenario: report.scenario,
    title: meta?.title ?? report.scenario,
    lane: report.lane,
    status: report.status,
    durationMs: report.durationMs ?? 0,
    runnerKind: report.runnerKind,
    runnerId: report.runnerId,
    htmlReportUrl: report.htmlReportUrl ?? null,
    primaryProofUrl: report.primaryProofUrl ?? null,
    failureProofUrl: report.failureProofUrl ?? null,
    failureScreenshotUrl: report.failureScreenshotUrl ?? null,
    failureVideoUrl: report.failureVideoUrl ?? null,
    replayCommand: report.replayCommand ?? null,
    captureLimitations: report.captureLimitations ?? [],
    selectedButMissing: Boolean(report.selectedButMissing),
    syntheticMissingReport: Boolean(report.syntheticMissingReport),
    expectedCoverage: meta?.coverage ?? [],
    knownGaps: meta?.knownGaps ?? [],
    riskAreas: meta?.riskAreas ?? [],
    phases: (report.phases ?? []).map(summarizePhase),
    proof: (report.proof ?? []).map(summarizeProof),
  };
}

function summarizeMissingSelection(selectionEntry, selection, manifest) {
  const meta = scenarioMetadata(manifest, selectionEntry.name);
  const replayCommand =
    selectionEntry.currentScript ??
    meta?.currentScript ??
    (selectionEntry.lane === 'full-mac'
      ? `tests/e2e/run.sh ${selectionEntry.name}`
      : `bun run test:wdio -- ${selectionEntry.name}`);

  return {
    scenario: selectionEntry.name,
    title: meta?.title ?? selectionEntry.name,
    lane: selectionEntry.lane ?? 'unknown',
    status: 'infra_failed',
    durationMs: 0,
    runnerKind: selectionEntry.lane === 'full-mac' ? 'self-hosted-mac' : 'github-hosted',
    runnerId: 'GitHub Actions',
    htmlReportUrl: null,
    primaryProofUrl: null,
    failureProofUrl: null,
    failureScreenshotUrl: null,
    failureVideoUrl: null,
    replayCommand,
    captureLimitations: ['scenario_report_missing'],
    selectedButMissing: true,
    syntheticMissingReport: true,
    expectedCoverage: meta?.coverage ?? selectionEntry.coverage ?? [],
    knownGaps: meta?.knownGaps ?? selectionEntry.knownGaps ?? [],
    riskAreas: meta?.riskAreas ?? selectionEntry.riskAreas ?? [],
    phases: [
      {
        name: 'Scenario report generation',
        status: 'infra_failed',
        durationMs: 0,
        assertions: ['Selected scenario produces e2e-report.json'],
        error:
          'Selected scenario did not produce e2e-report.json; inspect the GitHub Actions matrix job for the first setup/bootstrap failure.',
        proofCount: 0,
      },
    ],
    proof: [],
    selectionReason: selection?.reason ?? null,
  };
}

function buildReviewerPrompt(packet) {
  return `You are the nixmac AI QA reviewer for a GitHub PR.

Review the evidence packet below as if you are replacing a careful human QA pass. Be concrete and skeptical.

Rules:
- Use only evidence in the packet.
- Distinguish deterministic test failures from weak or missing proof.
- Treat hosted tauri-wdio frame timelines as webview proof, not full desktop proof.
- Treat full-mac videos as real desktop proof.
- Check whether selected scenarios plausibly cover the changed files and stated risk areas.
- Call out blind spots from known gaps and capture limitations.
- Return JSON matching the provided verdict schema.

Verdict schema:
${JSON.stringify(VERDICT_SCHEMA, null, 2)}

Evidence packet:
${JSON.stringify(packet, null, 2)}
`;
}

function responseOutputText(response) {
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }

  return '';
}

async function runOpenAiReview(prompt) {
  const apiKey =
    process.env.NIXMAC_E2E_AI_QA_OPENAI_API_KEY ||
    process.env.NIXMAC_E2E_AI_QA_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';
  const model = process.env.NIXMAC_E2E_AI_QA_MODEL || '';
  if (!apiKey || !model) {
    return {
      status: 'unavailable',
      reason: !apiKey ? 'missing_api_key' : 'missing_model',
      provider: 'openai',
      model: model || null,
      verdict: null,
    };
  }

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: 'You are a QA reviewer. Return JSON only, matching the supplied schema.',
              },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: prompt }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'nixmac_ai_qa_verdict',
            schema: VERDICT_SCHEMA,
            strict: true,
          },
        },
      }),
    });
  } catch (error) {
    return {
      status: 'error',
      reason: 'openai_network_error',
      provider: 'openai',
      model,
      error: redact(error instanceof Error ? error.message : String(error)).slice(0, 2000),
      verdict: null,
    };
  }

  const body = await response.json().catch((error) => ({
    parseError: redact(error instanceof Error ? error.message : String(error)).slice(0, 2000),
  }));
  if (!response.ok) {
    return {
      status: 'error',
      reason: `openai_api_error:${response.status}`,
      provider: 'openai',
      model,
      error: redact(JSON.stringify(body)).slice(0, 2000),
      verdict: null,
    };
  }

  const outputText = responseOutputText(body);
  if (!outputText) {
    return {
      status: 'error',
      reason: 'openai_empty_output',
      provider: 'openai',
      model,
      verdict: null,
    };
  }

  try {
    return {
      status: 'performed',
      reason: null,
      provider: 'openai',
      model,
      verdict: JSON.parse(outputText),
    };
  } catch (error) {
    return {
      status: 'error',
      reason: 'openai_unparseable_json',
      provider: 'openai',
      model,
      error: error instanceof Error ? error.message : String(error),
      rawOutput: outputText.slice(0, 2000),
      verdict: null,
    };
  }
}

function markdownReport(packet) {
  const reports = packet.scenarioReports;
  const limitations = reports.flatMap((report) =>
    (report.captureLimitations ?? []).map((limitation) => `${report.scenario}: ${limitation}`),
  );
  const verdict = packet.aiReview.verdict;
  const verdictSummary = verdict
    ? `\n## AI Reviewer Verdict\n\n- Status: ${markdownLine(verdict.status)}\n- Summary: ${markdownLine(verdict.summary)}\n- Blocking issues: ${(verdict.blockingIssues ?? []).length}\n- Non-blocking issues: ${(verdict.nonBlockingIssues ?? []).length}\n`
    : '';

  return `# nixmac AI QA Evidence Packet

- Status: ${packet.aiReview.status}
- Provider: ${packet.aiReview.provider ?? 'not configured'}
- Reason: ${packet.aiReview.reason ?? 'n/a'}
- PR: ${packet.pr.number ?? 'n/a'}
- Commit: ${packet.pr.headSha}
- Selected scenarios: ${packet.summary.selectedCount}
- Scenario reports: ${packet.summary.reportedCount}/${packet.summary.selectedCount}
- Missing scenario reports: ${packet.summary.missingReportCount}
- Assertion-failed scenarios: ${packet.summary.failedCount}
- Infra/not-run scenarios: ${packet.summary.infraFailedCount}
- Capture limitations: ${packet.summary.captureLimitationCount}
${verdictSummary}

## Scenario Evidence

| Scenario | Lane | Status | Primary proof | Limitations |
| --- | --- | --- | --- | --- |
${reports
  .map(
    (report) =>
      `| \`${markdownCell(report.scenario)}\` | ${markdownCell(report.lane)} | **${markdownCell(report.status)}** | ${markdownCell(report.primaryProofUrl ?? 'none')} | ${markdownCell((report.captureLimitations ?? []).join(', ') || 'none')} |`,
  )
  .join('\n')}

## Capture Limitations

${limitations.length ? limitations.map((item) => `- ${item}`).join('\n') : '- none'}

## AI Reviewer Prompt

The machine-readable prompt and verdict schema are included in \`ai-qa-packet.json\`.
`;
}

function markdownLine(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}

function markdownCell(value) {
  return markdownLine(value).replace(/\|/g, '\\|') || 'none';
}

function html(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlReport(packet) {
  const reports = packet.scenarioReports;
  const verdict = packet.aiReview.verdict;
  const statusClass =
    packet.aiReview.status === 'performed' && verdict?.status === 'passed'
      ? 'ok'
      : packet.aiReview.required
        ? 'bad'
        : 'warn';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>nixmac AI QA Evidence Packet</title>
  <style>
    :root { color-scheme: light; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f8fb; color: #172033; }
    main { max-width: 1080px; margin: 0 auto; padding: 32px 24px 48px; }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 28px 0 12px; font-size: 18px; letter-spacing: 0; }
    .meta { color: #5b6475; margin: 0 0 24px; }
    .panel { background: #fff; border: 1px solid #d9e0ea; border-radius: 8px; padding: 18px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .metric { border: 1px solid #e3e8ef; border-radius: 6px; padding: 12px; background: #fbfcfe; }
    .metric span { display: block; color: #667085; font-size: 12px; margin-bottom: 4px; }
    .metric strong { font-size: 18px; }
    .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 700; }
    .ok { color: #067647; background: #dcfae6; }
    .warn { color: #b54708; background: #fff4d6; }
    .bad { color: #b42318; background: #fee4e2; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d9e0ea; border-radius: 8px; overflow: hidden; }
    th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid #e7ecf3; font-size: 14px; }
    th { background: #f0f4f9; color: #384152; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    tr:last-child td { border-bottom: 0; }
    code { background: #eef2f7; border-radius: 4px; padding: 2px 5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    a { color: #155eef; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .muted { color: #667085; }
    .summary { white-space: pre-wrap; line-height: 1.45; }
  </style>
</head>
<body>
  <main>
    <h1>nixmac AI QA Evidence Packet</h1>
    <p class="meta">Generated ${html(packet.generatedAt)} for ${html(packet.pr.repo)} at ${html(packet.pr.headSha)}.</p>
    <section class="panel">
      <div class="grid">
        <div class="metric"><span>AI review</span><strong><span class="pill ${statusClass}">${html(packet.aiReview.status)}</span></strong></div>
        <div class="metric"><span>Reason</span><strong>${html(packet.aiReview.reason ?? 'n/a')}</strong></div>
        <div class="metric"><span>Selected</span><strong>${packet.summary.selectedCount}</strong></div>
        <div class="metric"><span>Reports</span><strong>${packet.summary.reportedCount}/${packet.summary.selectedCount}</strong></div>
        <div class="metric"><span>Missing reports</span><strong>${packet.summary.missingReportCount}</strong></div>
        <div class="metric"><span>Assertion failed</span><strong>${packet.summary.failedCount}</strong></div>
        <div class="metric"><span>Infra/not-run</span><strong>${packet.summary.infraFailedCount}</strong></div>
        <div class="metric"><span>Required</span><strong>${packet.aiReview.required ? 'yes' : 'no'}</strong></div>
      </div>
      ${
        verdict
          ? `<h2>AI Reviewer Verdict</h2>
      <p><span class="pill ${verdict.status === 'passed' ? 'ok' : 'bad'}">${html(verdict.status)}</span></p>
      <p class="summary">${html(verdict.summary)}</p>`
          : '<p class="muted">AI review did not run. The packet and prompt are still available for inspection.</p>'
      }
    </section>

    <h2>Scenario Evidence</h2>
    <table>
      <thead><tr><th>Scenario</th><th>Lane</th><th>Status</th><th>Primary proof</th><th>Limitations</th></tr></thead>
      <tbody>
        ${reports
          .map(
            (report) => `<tr>
          <td><code>${html(report.scenario)}</code></td>
          <td>${html(report.lane)}</td>
          <td><span class="pill ${report.status === 'passed' ? 'ok' : 'bad'}">${html(report.status)}</span></td>
          <td>${report.primaryProofUrl ? html(report.primaryProofUrl) : '<span class="muted">none</span>'}</td>
          <td>${html((report.captureLimitations ?? []).join(', ') || 'none')}</td>
        </tr>`,
          )
          .join('\n')}
      </tbody>
    </table>

    <h2>Machine-Readable Artifacts</h2>
    <p><a href="./ai-qa-packet.json">ai-qa-packet.json</a>${packet.aiReview.verdict ? ' · <a href="./ai-qa-verdict.json">ai-qa-verdict.json</a>' : ''} · <a href="./ai-qa-report.md">ai-qa-report.md</a></p>
  </main>
</body>
</html>
`;
}

async function main() {
  const manifest = await readJson(MANIFEST_PATH, { scenarios: [] });
  const reportPaths = await findFiles(ARTIFACT_ROOT, 'e2e-report.json');
  const reports = [];
  for (const reportPath of reportPaths) {
    const report = await readJson(reportPath);
    if (report?.scenario) {
      reports.push(summarizeReport(report, manifest));
    }
  }
  reports.sort((a, b) => String(a.scenario).localeCompare(String(b.scenario)));

  const selectionPaths = await findFiles(ARTIFACT_ROOT, 'e2e-selection.json');
  const selection = selectionPaths.length ? await readJson(selectionPaths[0]) : null;
  const reportedScenarios = new Set(reports.map((report) => report.scenario));
  for (const selected of selection?.selected ?? []) {
    if (selected?.name && !reportedScenarios.has(selected.name)) {
      reports.push(summarizeMissingSelection(selected, selection, manifest));
      reportedScenarios.add(selected.name);
    }
  }
  reports.sort((a, b) => String(a.scenario).localeCompare(String(b.scenario)));

  const files = selection?.changedFiles ?? selection?.changedFileSample ?? (await changedFiles());
  const selectedCount = selection?.selected?.length ?? reports.length;
  const missingReportCount = reports.filter((report) => report.syntheticMissingReport).length;
  const summary = {
    selectedCount,
    reportCount: reports.length,
    reportedCount: reports.length - missingReportCount,
    missingReportCount,
    passedCount: reports.filter((report) => report.status === 'passed').length,
    failedCount: reports.filter((report) => report.status === 'failed').length,
    infraFailedCount: reports.filter((report) => report.status === 'infra_failed').length,
    captureLimitationCount: reports.reduce(
      (count, report) => count + (report.captureLimitations ?? []).length,
      0,
    ),
    lanes: Array.from(new Set(reports.map((report) => report.lane).filter(Boolean))).sort(),
  };
  const packet = redactStructured({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    pr: {
      repo: process.env.GITHUB_REPOSITORY ?? 'darkmatter/nixmac',
      number: process.env.GITHUB_PR_NUMBER ? Number(process.env.GITHUB_PR_NUMBER) : null,
      baseSha: process.env.E2E_BASE_SHA || process.env.GITHUB_BASE_SHA || null,
      headSha: process.env.E2E_HEAD_SHA || process.env.GITHUB_SHA || 'unknown',
      workflowRunId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ? Number(process.env.GITHUB_RUN_ATTEMPT) : null,
    },
    selection,
    changedFiles: files,
    summary,
    scenarioReports: reports,
    aiReview: {
      status: 'packet_only',
      reason: 'provider_not_configured',
      required: process.env.NIXMAC_E2E_AI_QA_REQUIRED === 'true',
      verdictSchema: VERDICT_SCHEMA,
      provider: null,
      model: null,
      verdict: null,
    },
  });

  packet.reviewerPrompt = buildReviewerPrompt(packet);
  const review = await runOpenAiReview(packet.reviewerPrompt);
  packet.aiReview = {
    ...packet.aiReview,
    ...review,
    required: process.env.NIXMAC_E2E_AI_QA_REQUIRED === 'true',
    verdictSchema: VERDICT_SCHEMA,
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, 'ai-qa-packet.json'), `${JSON.stringify(packet, null, 2)}\n`);
  if (packet.aiReview.verdict) {
    await writeFile(
      path.join(OUTPUT_DIR, 'ai-qa-verdict.json'),
      `${JSON.stringify(packet.aiReview.verdict, null, 2)}\n`,
    );
  }
  await writeFile(path.join(OUTPUT_DIR, 'ai-qa-report.md'), markdownReport(packet));
  await writeFile(path.join(OUTPUT_DIR, 'index.html'), htmlReport(packet));
  console.log(`Wrote AI QA packet for ${reports.length} scenario report(s) to ${OUTPUT_DIR}`);

  if (packet.aiReview.required && packet.aiReview.status !== 'performed') {
    console.error(`AI QA is required but was not performed: ${packet.aiReview.reason}`);
    process.exit(1);
  }
  if (packet.aiReview.required && packet.aiReview.verdict?.status !== 'passed') {
    console.error(`AI QA reviewer did not pass the gate: ${packet.aiReview.verdict?.status ?? 'no_verdict'}`);
    process.exit(1);
  }
}

await main();
