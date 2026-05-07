import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pngDimensions } from './artifact-utils.mjs';
import { containsUnmaskedSecret } from './redaction.mjs';
import { imageArtifactIssue, pngSignalStats, probeCropForImage } from './visual-proof.mjs';

export const PEEKABOO_E2E_SCENARIO_KEYS = Object.freeze({
  macos_descriptor_prompt_smoke: 'peekabooDescriptorPromptSmoke',
  macos_core_product_proof: 'peekabooCoreProductProof',
  macos_support_dialogs_smoke: 'peekabooSupportDialogsSmoke',
  macos_console_smoke: 'peekabooConsoleSmoke',
  macos_homebrew_save_rollback_smoke: 'peekabooHomebrewSaveRollbackSmoke',
  macos_customization_save_rollback_smoke: 'peekabooCustomizationSaveRollbackSmoke',
  macos_provider_evolve_full_smoke: 'peekabooProviderEvolveFullSmoke',
  macos_provider_discard_smoke: 'peekabooProviderDiscardSmoke',
  'nix-install': 'peekabooNixInstall',
});

export const PEEKABOO_PHASE_COVERAGE = Object.freeze({
  peekabooCoreFixture: { label: 'Peekaboo core fixture', correspondsTo: [], grade: 'fixture' },
  peekabooCoreLaunch: { label: 'Peekaboo core launch', correspondsTo: ['launch'], grade: 'action-confirmed' },
  peekabooCoreUpdateBanner: { label: 'Peekaboo update banner non-blocking', correspondsTo: ['updateBanner'], grade: 'action-confirmed' },
  peekabooCoreSettingsGeneral: { label: 'Peekaboo Settings General', correspondsTo: ['settingsGeneral'], grade: 'action-confirmed' },
  peekabooCoreSettingsAIModels: { label: 'Peekaboo Settings AI Models', correspondsTo: ['settingsAIModels'], grade: 'action-confirmed' },
  peekabooCoreSettingsAPIKeys: { label: 'Peekaboo Settings API Keys', correspondsTo: ['settingsAPIKeys'], grade: 'sensitive-redaction' },
  peekabooCoreSettingsPreferences: { label: 'Peekaboo Settings Preferences', correspondsTo: ['settingsPreferences'], grade: 'action-confirmed' },
  peekabooCoreHistory: { label: 'Peekaboo History', correspondsTo: ['history'], grade: 'action-confirmed' },
  peekabooCoreConsole: { label: 'Peekaboo Console text', correspondsTo: ['console'], grade: 'sensitive-redaction-text' },
  peekabooCoreFeedback: { label: 'Peekaboo Feedback dialog', correspondsTo: ['feedback'], grade: 'action-confirmed' },
  peekabooCoreReportIssue: { label: 'Peekaboo Report Issue classification', correspondsTo: ['reportIssue'], grade: 'action-confirmed-or-classified-absent' },
  peekabooCoreSuggestionCards: { label: 'Peekaboo suggestion cards', correspondsTo: ['suggestionCards'], grade: 'action-confirmed' },
  peekabooCoreTypedIntent: { label: 'Peekaboo typed intent', correspondsTo: ['typedIntent'], grade: 'action-confirmed' },
  peekabooCoreProviderValidation: { label: 'Peekaboo local provider validation', correspondsTo: ['typedIntent'], grade: 'guardrail-confirmed' },
  peekabooCoreVisualProofQuality: { label: 'Peekaboo core visual/text proof quality', correspondsTo: ['visualCoverage', 'visualProofQuality'], grade: 'artifact-quality' },
  peekabooHomebrewSaveRollback: { label: 'Peekaboo Homebrew save + rollback', correspondsTo: ['homebrewSaveRollback'], grade: 'remote-state' },
  peekabooCustomizationSaveRollback: { label: 'Peekaboo customization save + rollback', correspondsTo: ['customizationSaveRollback'], grade: 'remote-state' },
  peekabooProviderFixture: { label: 'Peekaboo provider fixture', correspondsTo: [], grade: 'fixture' },
  peekabooProviderLaunch: { label: 'Peekaboo provider launch', correspondsTo: ['launch'], grade: 'action-confirmed' },
  peekabooProviderTypedIntent: { label: 'Peekaboo provider typed intent', correspondsTo: ['typedIntent'], grade: 'action-confirmed' },
  peekabooProviderReview: { label: 'Peekaboo provider Review', correspondsTo: ['review', 'summary', 'diff'], grade: 'provider-state' },
  peekabooProviderBuildBoundary: { label: 'Peekaboo Build & Test boundary', correspondsTo: ['buildBoundary'], grade: 'action-confirmed' },
  peekabooProviderSaveFlow: { label: 'Peekaboo Save flow', correspondsTo: ['saveFlow'], grade: 'remote-state' },
  peekabooProviderRollbackCleanup: { label: 'Peekaboo rollback cleanup', correspondsTo: ['rollbackCleanup'], grade: 'remote-state' },
  peekabooProviderAudit: { label: 'Peekaboo provider audit', correspondsTo: ['review', 'summary'], grade: 'provider-audit' },
  peekabooProviderDiscard: { label: 'Peekaboo provider Discard proof', correspondsTo: ['discard'], grade: 'action-confirmed' },
  peekabooReportInspection: { label: 'Peekaboo report inspection', correspondsTo: ['reportInspection'], grade: 'manual-visual-artifact-inspection' },
});

const ABSENT_NO_COVERAGE_PHASE_KEYS = new Set([
  'peekabooCoreReportIssue',
  'peekabooHomebrewSaveRollback',
  'peekabooCustomizationSaveRollback',
]);
const ABSENT_NO_COVERAGE_SENTINEL = 'ABSENT_NO_COVERAGE';
const ABSENT_NO_COVERAGE_PATTERN = new RegExp(`\\b${ABSENT_NO_COVERAGE_SENTINEL}\\b`);

function phaseCoverageForReportPhase(key, phase) {
  const coverage = PEEKABOO_PHASE_COVERAGE[key];
  if (!coverage) return null;
  if (ABSENT_NO_COVERAGE_PHASE_KEYS.has(key) && ABSENT_NO_COVERAGE_PATTERN.test(phase?.name ?? '')) {
    return {
      ...coverage,
      label: `${coverage.label} absent classification`,
      correspondsTo: [],
      grade: 'classified-absent-no-coverage',
    };
  }
  return coverage;
}

export const DEFAULT_PEEKABOO_SCENARIO = 'macos_descriptor_prompt_smoke';

export function listPeekabooScenarios({ e2eRoot }) {
  const scenariosDir = path.join(e2eRoot, 'scenarios');
  return readdirSync(scenariosDir)
    .filter((entry) => entry.endsWith('.sh'))
    .map((entry) => entry.replace(/\.sh$/, ''))
    .sort();
}

export function isDestructivePeekabooScenario(scenario) {
  return scenario === 'nix-install';
}

export function buildPeekabooRunPlan({
  repoRoot,
  runDir,
  scenario = DEFAULT_PEEKABOO_SCENARIO,
  noRecord = false,
  noCleanup = true,
  allowDestructive = false,
  env = process.env,
}) {
  const e2eRoot = path.join(repoRoot, 'tests/e2e');
  const runScript = path.join(e2eRoot, 'run.sh');
  const scenarioFile = path.join(e2eRoot, 'scenarios', `${scenario}.sh`);
  const screenshotDir = path.join(runDir, 'screenshots');
  const videoDir = path.join(runDir, 'video');
  const diagnosticDir = path.join(runDir, 'diagnostics');
  const reportRoot = path.join(runDir, 'e2e-report');
  const logFile = path.join(runDir, 'peekaboo-e2e.log');
  const videoFile = path.join(videoDir, 'peekaboo-e2e.mp4');
  const resultsFile = logFile.replace(/\.log$/, '-results.json');
  const reportFile = path.join(reportRoot, scenario, 'e2e-report.json');

  if (!existsSync(runScript)) throw new Error(`Peekaboo E2E runner not found: ${runScript}`);
  if (!existsSync(path.join(e2eRoot, 'lib', 'peekaboo.sh'))) {
    throw new Error(`Peekaboo driver not found: ${path.join(e2eRoot, 'lib', 'peekaboo.sh')}`);
  }
  if (!existsSync(scenarioFile)) throw new Error(`Peekaboo E2E scenario not found: ${scenarioFile}`);
  if (isDestructivePeekabooScenario(scenario) && !allowDestructive) {
    throw new Error(
      `${scenario} is destructive: it can uninstall/reinstall system Nix. Re-run with --allow-destructive only on a disposable runner.`,
    );
  }

  const args = [runScript, scenario, '--json'];
  if (noRecord) args.push('--no-record');
  if (noCleanup) args.push('--no-cleanup');

  return {
    command: 'bash',
    args,
    cwd: repoRoot,
    scenario,
    runScript,
    scenarioFile,
    screenshotDir,
    videoDir,
    diagnosticDir,
    reportRoot,
    logFile,
    videoFile,
    resultsFile,
    reportFile,
    env: {
      ...env,
      PATH: `/opt/homebrew/bin:${env.PATH ?? ''}`,
      E2E_SCREENSHOT_DIR: screenshotDir,
      E2E_PEEKABOO_CAPTURE_DIR: path.join(runDir, 'peekaboo-captures'),
      E2E_DIAGNOSTIC_DIR: diagnosticDir,
      E2E_ARTIFACT_ROOT: reportRoot,
      E2E_LANE: 'peekaboo-local',
      E2E_RUNNER_KIND: 'peekaboo-local',
      E2E_DIALOG_AUTOMATION: env.E2E_DIALOG_AUTOMATION ?? '1',
      E2E_PEEKABOO_RECOVER_BRIDGE: env.E2E_PEEKABOO_RECOVER_BRIDGE ?? '1',
      E2E_LOG_FILE: logFile,
      E2E_VIDEO_FILE: videoFile,
      E2E_JSON: '1',
      E2E_RECORD: noRecord ? '0' : (env.E2E_RECORD ?? '1'),
      E2E_CLEANUP_NIX: noCleanup ? '0' : (env.E2E_CLEANUP_NIX ?? '1'),
    },
  };
}

function parseJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function artifactEntries(dirPath, runDir) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath)
    .filter((entry) => /\.(png|jpe?g|webp)$/i.test(entry))
    .sort()
    .map((entry) => {
      const fullPath = path.join(dirPath, entry);
      const fileStat = statSync(fullPath);
      return {
        label: entry.replace(/\.[^.]+$/, ''),
        path: path.relative(runDir, fullPath),
        capturedAt: new Date(fileStat.mtimeMs).toISOString(),
        note: /webkit-snapshot/i.test(entry)
          ? 'WKWebView internal snapshot captured from the running nixmac WebContent surface.'
          : 'Captured by Peekaboo runner.',
        bytes: fileStat.size,
      };
    });
}

function fileEntries(dirPath, runDir, { note = 'Captured by Peekaboo runner.' } = {}) {
  if (!existsSync(dirPath)) return [];
  const entries = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const fileStat = statSync(fullPath);
        entries.push({
          label: path.relative(dirPath, fullPath),
          path: path.relative(runDir, fullPath),
          capturedAt: new Date(fileStat.mtimeMs).toISOString(),
          note,
          bytes: fileStat.size,
        });
      }
    }
  };
  walk(dirPath);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function reportProofEntries(report, runDir) {
  const proofRoot = path.join(runDir, 'e2e-report');
  return (report?.proof ?? [])
    .filter((entry) => entry.kind === 'screenshot' && entry.path)
    .map((entry) => {
      const fullPath = path.join(proofRoot, entry.path);
      const fileStat = existsSync(fullPath) ? statSync(fullPath) : null;
      return {
        label: entry.caption ?? path.basename(entry.path),
        path: path.relative(runDir, fullPath),
        capturedAt: new Date(fileStat?.mtimeMs ?? Date.now()).toISOString(),
        note: entry.isFailureProof ? 'Failure proof from Peekaboo report.' : 'Proof from Peekaboo report.',
        bytes: fileStat?.size ?? 0,
      };
    });
}

function screenshotFamilyKey(artifact) {
  const basename = path.basename(artifact.path ?? artifact.label ?? '').replace(/\.[^.]+$/, '');
  const family = basename.replace(/_annotated$/, '');
  const variant = /_annotated(?:\.[^.]+)?$/i.test(path.basename(artifact.path ?? artifact.label ?? ''))
    ? 'annotated'
    : 'primary';
  return `${family}:${variant}:${artifact.bytes ?? 0}`;
}

function dedupeScreenshotArtifacts(artifacts) {
  const byKey = new Map();
  for (const artifact of artifacts) {
    const key = screenshotFamilyKey(artifact);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, artifact);
      continue;
    }
    const existingScore = existing.path?.startsWith('screenshots/') ? 2 : existing.path?.includes('_annotated') ? 0 : 1;
    const nextScore = artifact.path?.startsWith('screenshots/') ? 2 : artifact.path?.includes('_annotated') ? 0 : 1;
    if (nextScore > existingScore) byKey.set(key, artifact);
  }
  return [...byKey.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function reportDiagnosticEntries(report, runDir) {
  const proofRoot = path.join(runDir, 'e2e-report');
  return (report?.proof ?? [])
    .filter((entry) => entry.kind === 'diagnostic' && entry.path)
    .map((entry) => {
      const fullPath = path.join(proofRoot, entry.path);
      const fileStat = existsSync(fullPath) ? statSync(fullPath) : null;
      return {
        label: entry.caption ?? path.basename(entry.path),
        path: path.relative(runDir, fullPath),
        capturedAt: new Date(fileStat?.mtimeMs ?? Date.now()).toISOString(),
        note: 'Diagnostic artifact from Peekaboo report.',
        bytes: fileStat?.size ?? 0,
      };
    });
}

function dedupeArtifactEntries(artifacts) {
  const byPath = new Map();
  for (const artifact of artifacts) {
    if (!artifact?.path) continue;
    const existing = byPath.get(artifact.path);
    if (!existing || (artifact.bytes ?? 0) > (existing.bytes ?? 0)) {
      byPath.set(artifact.path, artifact);
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function walkTextArtifactFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && /\.(?:jsonl?|txt|log|html|md|csv)$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  };
  visit(root);
  return files.sort();
}

function scanRunDirForUnmaskedSecrets(runDir) {
  const violations = [];
  const files = walkTextArtifactFiles(runDir);
  for (const filePath of files) {
    let text = '';
    try {
      text = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    if (containsUnmaskedSecret(text)) {
      violations.push(path.relative(runDir, filePath));
    }
  }
  return {
    status: violations.length === 0 ? 'passed' : 'failed',
    scannedFiles: files.length,
    violations,
  };
}

const PEEKABOO_SCREENSHOT_CONTENT_PROBE = Object.freeze({
  label: 'central app content',
  x: 8,
  y: 18,
  w: 84,
  h: 70,
  minYAvg: 6,
  minYMax: 35,
  minYRange: 8,
  maxDarkChromeYAvg: 42,
});

function screenshotRequiresDarkChromeProbe(screenshot) {
  const text = `${screenshot?.label ?? ''} ${screenshot?.path ?? ''}`.toLowerCase();
  return /\b(?:launch|app shell|suggestion|descriptor|settings|history|console)\b/.test(text);
}

function parseBreadcrumbDetail(detail) {
  if (detail == null) return null;
  if (typeof detail === 'object') return detail;
  if (typeof detail !== 'string') return null;
  try {
    return JSON.parse(detail);
  } catch {
    return null;
  }
}

function readWebviewProof(runDir) {
  const breadcrumbPath = path.join(runDir, 'diagnostics', 'nixmac-frontend-breadcrumbs.jsonl');
  if (!existsSync(breadcrumbPath)) {
    return {
      status: 'missing',
      domRendered: false,
      captureReady: false,
      assetProbeCount: 0,
      mountedBreadcrumbs: 0,
      note: 'No frontend breadcrumb diagnostics were captured.',
    };
  }

  const proof = {
    status: 'captured',
    domRendered: false,
    captureReady: false,
    assetProbeCount: 0,
    mountedBreadcrumbs: 0,
    maxRootChildren: 0,
    maxBodyTextLength: 0,
    assetFailures: [],
    latestDomText: '',
    note: '',
  };
  const lines = readFileSync(breadcrumbPath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let record = null;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const label = String(record.label ?? '');
    const detail = parseBreadcrumbDetail(record.detail);
    if (
      /app mounted/i.test(label) ||
      (/native boot stage marker/i.test(label) && /mounted|app-render|app-effect/i.test(String(record.detail ?? '')))
    ) {
      proof.mountedBreadcrumbs += 1;
    }
    if (/E2E DOM snapshot .* text/i.test(label) && typeof record.detail === 'string') {
      proof.latestDomText = record.detail.slice(0, 220);
    }
    if (!detail) continue;
    const rootChildren = Number(detail.rootChildren ?? detail.rootChildCount ?? 0);
    const bodyTextLength = Number(detail.bodyTextLength ?? 0);
    if (Number.isFinite(rootChildren)) proof.maxRootChildren = Math.max(proof.maxRootChildren, rootChildren);
    if (Number.isFinite(bodyTextLength)) proof.maxBodyTextLength = Math.max(proof.maxBodyTextLength, bodyTextLength);
    if (detail.captureReady || detail.capturePaint) proof.captureReady = true;
    if (Array.isArray(detail.assets)) {
      proof.assetProbeCount += 1;
      for (const asset of detail.assets) {
        if (asset?.ok === false) {
          proof.assetFailures.push({
            kind: asset.kind ?? '',
            url: asset.url ?? '',
            status: asset.status ?? null,
            errorName: asset.errorName ?? '',
            errorMessage: asset.errorMessage ?? '',
          });
        }
      }
    }
  }
  proof.domRendered = proof.maxRootChildren > 0 && proof.maxBodyTextLength > 0;
  proof.note = proof.domRendered
    ? `WebView DOM rendered (${proof.maxRootChildren} root child node(s), ${proof.maxBodyTextLength} text chars).`
    : 'WebView DOM did not prove rendered app content.';
  return proof;
}

function writeWebviewProof(runDir, proof) {
  const proofPath = path.join(runDir, 'webview-proof.json');
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  return proofPath;
}

function hostCaptureContext(issue, webviewProof) {
  return webviewProof?.domRendered
    ? `${issue}; WebView DOM rendered, so host pixel capture is likely black/occluded`
    : issue;
}

function peekabooScreenshotSignalIssue(runDir, screenshot, webviewProof = null) {
  const baseIssue = imageArtifactIssue({ runDir }, screenshot.path);
  if (baseIssue) return baseIssue;

  const fullPath = path.join(runDir, screenshot.path);
  const imageSize = pngDimensions(fullPath);
  if (!imageSize) return 'could not read PNG dimensions';
  if (imageSize.width < 500 || imageSize.height < 350) {
    return `the screenshot is too small for app-level visual proof (${imageSize.width}x${imageSize.height})`;
  }

  const crop = probeCropForImage(imageSize, PEEKABOO_SCREENSHOT_CONTENT_PROBE);
  if (!crop) return 'central app content probe could not be mapped into image pixels';
  const cropStats = pngSignalStats(fullPath, crop);
  if (!cropStats.ok) return `ffmpeg could not inspect central app content (${cropStats.error})`;

  const yMin = cropStats.stats.YMIN;
  const yMax = cropStats.stats.YMAX;
  const yAvg = cropStats.stats.YAVG;
  const yRange = Number.isFinite(yMin) && Number.isFinite(yMax) ? yMax - yMin : NaN;
  if (!Number.isFinite(yAvg) || yAvg < PEEKABOO_SCREENSHOT_CONTENT_PROBE.minYAvg) {
    return hostCaptureContext(
      `central app content is too dark (YAVG ${Number.isFinite(yAvg) ? yAvg : 'unknown'} below ${PEEKABOO_SCREENSHOT_CONTENT_PROBE.minYAvg})`,
      webviewProof,
    );
  }
  if (!Number.isFinite(yMax) || yMax < PEEKABOO_SCREENSHOT_CONTENT_PROBE.minYMax) {
    return hostCaptureContext(
      `central app content appears blank or occluded (YMAX ${Number.isFinite(yMax) ? yMax : 'unknown'} below ${PEEKABOO_SCREENSHOT_CONTENT_PROBE.minYMax})`,
      webviewProof,
    );
  }
  if (!Number.isFinite(yRange) || yRange < PEEKABOO_SCREENSHOT_CONTENT_PROBE.minYRange) {
    return hostCaptureContext(
      `central app content has too little visual contrast (Y range ${Number.isFinite(yRange) ? yRange : 'unknown'} below ${PEEKABOO_SCREENSHOT_CONTENT_PROBE.minYRange})`,
      webviewProof,
    );
  }
  if (
    screenshotRequiresDarkChromeProbe(screenshot) &&
    Number.isFinite(yAvg) &&
    yAvg > PEEKABOO_SCREENSHOT_CONTENT_PROBE.maxDarkChromeYAvg
  ) {
    return `base app chrome is too light for nixmac dark capture proof (YAVG ${yAvg} above ${PEEKABOO_SCREENSHOT_CONTENT_PROBE.maxDarkChromeYAvg})`;
  }
  return '';
}

function scanPeekabooScreenshotSignal(runDir, screenshots, webviewProof = null) {
  const pngScreenshots = screenshots.filter((screenshot) => /\.png$/i.test(screenshot?.path ?? ''));
  const results = [];
  for (const screenshot of pngScreenshots) {
    if (!screenshot?.path || !/\.png$/i.test(screenshot.path)) continue;
    const issue = peekabooScreenshotSignalIssue(runDir, screenshot, webviewProof);
    results.push({
      screenshot,
      issue,
    });
  }

  const hasLaterPassingContent = results.some(({ screenshot, issue }) => {
    const label = `${screenshot?.label ?? ''} ${screenshot?.path ?? ''}`;
    return !issue && !/\b(01|launch|launched)\b/i.test(label);
  });

  const violations = [];
  for (const { screenshot, issue } of results) {
    if (issue) {
      const label = `${screenshot?.label ?? ''} ${screenshot?.path ?? ''}`;
      if (hasLaterPassingContent && /\b(01|launch|launched)\b/i.test(label)) continue;
      violations.push({
        path: screenshot.path,
        label: screenshot.label ?? path.basename(screenshot.path),
        issue,
      });
    }
  }
  if (pngScreenshots.length === 0) {
    violations.push({
      path: null,
      label: 'screenshot artifact',
      issue: 'no PNG screenshot artifacts were captured',
    });
  }
  return {
    status: violations.length === 0 ? 'passed' : 'failed',
    scannedFiles: pngScreenshots.length,
    violations,
  };
}

function writeSignalFixture(filePath, { color, filter = null }) {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=640x480`,
    '-frames:v',
    '1',
  ];
  if (filter) args.splice(args.length - 2, 0, '-vf', filter);
  const result = spawnSync('ffmpeg', args.concat(filePath), { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`failed to create screenshot-signal fixture: ${result.stderr || result.error || result.status}`);
  }
}

function runScreenshotSignalSelfTest() {
  if (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status !== 0) return;

  const fixtureDir = mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'peekaboo-signal-'));
  try {
    writeSignalFixture(path.join(fixtureDir, 'dark-launch.png'), {
      color: '0x0a0a0a',
      filter: 'drawbox=x=280:y=220:w=80:h=40:color=white:t=fill',
    });
    writeSignalFixture(path.join(fixtureDir, 'light-launch.png'), {
      color: '0x808080',
      filter: 'drawbox=x=280:y=220:w=80:h=40:color=white:t=fill',
    });
    writeSignalFixture(path.join(fixtureDir, 'blank-launch.png'), {
      color: '0x000000',
    });
    writeSignalFixture(path.join(fixtureDir, 'review-content.png'), {
      color: '0x0a0a0a',
      filter: 'drawbox=x=250:y=180:w=140:h=70:color=white:t=fill',
    });

    assert.equal(
      scanPeekabooScreenshotSignal(fixtureDir, [{ path: 'dark-launch.png', label: 'launch' }]).status,
      'passed',
      'dark nixmac chrome with visible foreground should pass screenshot signal',
    );

    const lightResult = scanPeekabooScreenshotSignal(fixtureDir, [{ path: 'light-launch.png', label: 'launch' }]);
    assert.equal(lightResult.status, 'failed', 'light gray base chrome should fail screenshot fidelity');
    assert.match(lightResult.violations[0].issue, /too light/i);

    const blankResult = scanPeekabooScreenshotSignal(fixtureDir, [{ path: 'blank-launch.png', label: 'launch' }]);
    assert.equal(blankResult.status, 'failed', 'blank dark capture should still fail screenshot signal');
    assert.match(blankResult.violations[0].issue, /blank|occluded|contrast|too dark/i);

    const startupBlankResult = scanPeekabooScreenshotSignal(fixtureDir, [
      { path: 'blank-launch.png', label: '01-launched' },
      { path: 'review-content.png', label: '03-review-provider-evolved' },
    ]);
    assert.equal(
      startupBlankResult.status,
      'passed',
      'an initial blank launch frame should be nonfatal when later scenario evidence has visible dark nixmac content',
    );
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

function phaseCoverageKey(phaseName = '') {
  const match = String(phaseName).match(/^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/);
  if (!match) return null;
  return PEEKABOO_PHASE_COVERAGE[match[1]] ? match[1] : null;
}

function cleanPhaseName(phaseName = '') {
  const match = String(phaseName).match(/^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/);
  return match && PEEKABOO_PHASE_COVERAGE[match[1]] ? match[2] : phaseName;
}

function coverageMapForScenario(scenario, report) {
  const phaseCoverage = [];
  const seenKeys = new Set();
  for (const phase of report?.phases ?? []) {
    const key = phaseCoverageKey(phase.name);
    if (!key || seenKeys.has(key)) continue;
    const coverage = phaseCoverageForReportPhase(key, phase);
    if (!coverage) continue;
    seenKeys.add(key);
    phaseCoverage.push({ key, ...coverage });
  }
  if (!phaseCoverage.length) return null;
  return {
    schemaVersion: 1,
    lane: 'peekaboo-local',
    scenario,
    note: 'Peekaboo coverage is intentionally additive. correspondsTo lists related Computer Use Product Proof keys, but Peekaboo keys remain separate unless the lane satisfies the same evidence grade.',
    phaseCoverage,
  };
}

export function classifyCodesignOutput(output) {
  if (!output) return { fatal: false, note: 'codesign did not return output' };
  const allowed =
    /code object is not signed at all/i.test(output) ||
    /valid on disk/i.test(output) ||
    /satisfies its Designated Requirement/i.test(output) ||
    /Signature=adhoc/i.test(output) ||
    /Authority=adhoc/i.test(output);
  const fatal =
    /a sealed resource is missing or invalid/i.test(output) ||
    /invalid signature/i.test(output) ||
    /code has no resources but signature indicates they must be present/i.test(output) ||
    /unsealed contents present in the root directory of an embedded framework/i.test(output) ||
    /resource envelope is obsolete/i.test(output) ||
    /bundle format unrecognized, invalid, or unsuitable/i.test(output);
  return {
    fatal: fatal && !allowed,
    note: allowed ? 'codesign output is acceptable for a dev/debug bundle' : fatal ? 'codesign output indicates a corrupted app bundle' : 'codesign output is non-fatal but unrecognized',
  };
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\x1B\[[0-9;]*m/g, '');
}

export function hasInfraFailureMarker(...values) {
  return values
    .flatMap((value) => stripAnsi(value).split(/\r?\n/))
    .some((line) => /^(?:\[[A-Z]+\]\s*)?E2E_INFRA:/.test(line.trim()));
}

function runPreflight(plan) {
  const script = `
		set -uo pipefail
		export PATH="/opt/homebrew/bin:$PATH"
		uid="$(id -u 2>/dev/null || true)"
		for key in NIXMAC_E2E_MOCK_SYSTEM NIXMAC_E2E_SOLID_CAPTURE NIXMAC_E2E_OPAQUE_WINDOW NIXMAC_E2E_WEBVIEW_WATCHDOG NIXMAC_SKIP_PERMISSIONS NIXMAC_RECORD_COMPLETIONS NIXMAC_COMPLETION_LOG_DIR OPENAI_API_KEY OPENROUTER_API_KEY VLLM_API_KEY ANTHROPIC_API_KEY; do
		  launchctl unsetenv "$key" >/dev/null 2>&1 || true
		  if [ -n "$uid" ]; then
		    launchctl asuser "$uid" launchctl unsetenv "$key" >/dev/null 2>&1 || true
		  fi
		done
		current_launchctl_path="$(launchctl getenv PATH 2>/dev/null || true)"
		if printf '%s\n' "$current_launchctl_path" | grep -q 'nixmac-e2e-system-mock-bin'; then
		  cleaned_launchctl_path="$(
		    printf '%s' "$current_launchctl_path" |
		      awk -v RS=: -v ORS=: '$0 !~ /nixmac-e2e-system-mock-bin/ { print }' |
		      sed 's/:$//'
		  )"
		  if [ -n "$cleaned_launchctl_path" ]; then
		    launchctl setenv PATH "$cleaned_launchctl_path" >/dev/null 2>&1 || true
		  else
		    launchctl unsetenv PATH >/dev/null 2>&1 || true
		  fi
		  echo "E2E stale launchctl PATH shim: cleared"
		fi
		app_path="\${NIXMAC_APP_PATH:-/Applications/nixmac.app}"
	status=0
	if command -v peekaboo; then
	  echo "Peekaboo CLI: Found"
	else
	  echo "Peekaboo CLI: Missing" >&2
	  status=1
	fi
	if command -v jq; then
	  echo "jq: Found"
	else
	  echo "jq: Missing" >&2
	  status=1
	fi
	if [ "${plan.env.E2E_RECORD}" = "1" ]; then
	  if command -v ffmpeg; then
	    echo "ffmpeg: Found"
	  else
	    echo "ffmpeg: Missing" >&2
	    status=1
	  fi
	  if command -v ffprobe; then
	    echo "ffprobe: Found"
	  else
	    echo "ffprobe: Missing" >&2
	    status=1
	  fi
	fi
	if [ -d "$app_path" ]; then
	  echo "nixmac app: Found at $app_path"
	else
	  echo "nixmac app: Missing at $app_path" >&2
	  status=1
	fi
	exec_name=""
	if [ -f "$app_path/Contents/Info.plist" ]; then
	  exec_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_path/Contents/Info.plist" 2>/dev/null || true)"
	fi
	if [ -z "$exec_name" ]; then
	  exec_name="$(basename "$app_path" .app)"
	fi
	if [ -x "$app_path/Contents/MacOS/$exec_name" ]; then
	  echo "nixmac executable: Found at $app_path/Contents/MacOS/$exec_name"
	else
	  echo "nixmac executable: Missing at $app_path/Contents/MacOS/$exec_name" >&2
	  status=1
	fi
	if command -v codesign >/dev/null 2>&1 && [ -d "$app_path" ]; then
	  codesign_output="$(codesign --verify --deep --strict --verbose=2 "$app_path" 2>&1)"
	  codesign_status=$?
	  if [ "$codesign_status" -eq 0 ]; then
	    echo "nixmac codesign: OK"
	  else
	    printf '%s\\n' "$codesign_output"
	    if printf '%s\\n' "$codesign_output" | grep -qiE 'a sealed resource is missing or invalid|invalid signature|code has no resources but signature indicates they must be present|unsealed contents present in the root directory of an embedded framework|resource envelope is obsolete|bundle format unrecognized, invalid, or unsuitable'; then
	      echo "nixmac codesign: Fatal"
	      status=1
	    elif printf '%s\\n' "$codesign_output" | grep -qiE 'code object is not signed at all|valid on disk|satisfies its Designated Requirement|Signature=adhoc|Authority=adhoc'; then
	      echo "nixmac codesign: Informational"
	    else
	      echo "nixmac codesign: Unrecognized non-fatal output"
	    fi
	  fi
	fi
	if command -v peekaboo >/dev/null 2>&1; then
	  bridge_status="$(peekaboo bridge status --verbose 2>&1)"
	  if ! printf '%s\n' "$bridge_status" | grep -qE "Selected: remote (gui|onDemand)" && [ "${plan.env.E2E_PEEKABOO_RECOVER_BRIDGE}" = "1" ]; then
	    pkill -f "Peekaboo.app/Contents/MacOS/Peekaboo" >/dev/null 2>&1 || true
	    sleep 2
	    open -a Peekaboo >/dev/null 2>&1 || true
	    for i in 1 2 3 4 5 6 7 8; do
	      sleep 2
	      bridge_status="$(peekaboo bridge status --verbose 2>&1)"
	      printf '%s\n' "$bridge_status" | grep -qE "Selected: remote (gui|onDemand)" && break
	    done
	  fi
	  peekaboo permissions || status=1
	  printf '%s\n' "$bridge_status"
	  if printf '%s\n' "$bridge_status" | grep -qE "Selected: remote (gui|onDemand)"; then
	    echo "Peekaboo Bridge: Connected"
	  else
	    echo "Peekaboo Bridge: Not Connected" >&2
	    status=1
	  fi
	fi
	exit "$status"
	`;
  const result = spawnSync('bash', ['-lc', script], {
    cwd: plan.cwd,
    env: plan.env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const hasScreenRecording = /Screen Recording .*:\s*Granted/i.test(output);
  const hasAccessibility = /Accessibility .*:\s*Granted/i.test(output);
  const hasPeekaboo = /Peekaboo CLI:\s*Found/i.test(output);
  const hasJq = /jq:\s*Found/i.test(output);
  const hasApp = /nixmac app:\s*Found/i.test(output);
  const hasExecutable = /nixmac executable:\s*Found/i.test(output);
  const hasCodesignFatal = /nixmac codesign:\s*Fatal/i.test(output);
  const hasBridge = /Peekaboo Bridge:\s*Connected/i.test(output);
  const hasRecordingTools =
    plan.env.E2E_RECORD !== '1' || (/ffmpeg:\s*Found/i.test(output) && /ffprobe:\s*Found/i.test(output));
  const ok =
    result.status === 0 &&
    hasPeekaboo &&
    hasJq &&
    hasApp &&
    hasExecutable &&
    !hasCodesignFatal &&
    hasRecordingTools &&
    hasScreenRecording &&
    hasAccessibility &&
    hasBridge;
  return {
    ok,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output,
    missing: [
      hasScreenRecording ? null : 'Screen Recording',
      hasAccessibility ? null : 'Accessibility',
      hasPeekaboo ? null : 'Peekaboo CLI',
      hasJq ? null : 'jq',
      hasRecordingTools ? null : 'ffmpeg/ffprobe',
      hasApp ? null : 'nixmac app',
      hasExecutable ? null : 'nixmac executable',
      hasCodesignFatal ? 'nixmac app signature' : null,
      hasBridge ? null : 'Peekaboo Bridge',
    ].filter(Boolean),
  };
}

export async function runPeekabooScenario(plan) {
  await mkdir(plan.screenshotDir, { recursive: true });
  await mkdir(plan.videoDir, { recursive: true });
  await mkdir(plan.diagnosticDir, { recursive: true });
  await mkdir(plan.reportRoot, { recursive: true });

  const stdoutPath = path.join(path.dirname(plan.logFile), 'peekaboo-e2e.stdout.txt');
  const stderrPath = path.join(path.dirname(plan.logFile), 'peekaboo-e2e.stderr.txt');
  const preflightPath = path.join(path.dirname(plan.logFile), 'peekaboo-preflight.txt');

  const preflight = runPreflight(plan);
  await writeFile(preflightPath, preflight.output, 'utf8');
  if (!preflight.ok) {
    await writeFile(stdoutPath, preflight.stdout, 'utf8');
    await writeFile(stderrPath, preflight.stderr, 'utf8');
    return {
      scenario: plan.scenario,
      success: false,
      status: preflight.status,
      signal: null,
      error: `Peekaboo preflight failed${preflight.missing.length > 0 ? `: missing ${preflight.missing.join(', ')}` : ''}`,
      infraFailure: true,
      results: null,
      report: null,
      artifacts: {
        logFile: null,
        stdout: path.relative(path.dirname(plan.logFile), stdoutPath),
        stderr: path.relative(path.dirname(plan.logFile), stderrPath),
        preflight: path.relative(path.dirname(plan.logFile), preflightPath),
        resultsFile: null,
        reportFile: null,
        videoFile: null,
        screenshots: [],
        diagnostics: [],
      },
    };
  }

  const result = spawnSync(plan.command, plan.args, {
    cwd: plan.cwd,
    env: plan.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  await writeFile(stdoutPath, result.stdout ?? '', 'utf8');
  await writeFile(stderrPath, result.stderr ?? '', 'utf8');

  const results = parseJsonIfExists(plan.resultsFile);
  const report = parseJsonIfExists(plan.reportFile);
  const screenshots = dedupeScreenshotArtifacts([
    ...artifactEntries(plan.screenshotDir, path.dirname(plan.logFile)),
    ...reportProofEntries(report, path.dirname(plan.logFile)),
  ]);
  const reportDiagnostics = reportDiagnosticEntries(report, path.dirname(plan.logFile));
  const diagnostics = dedupeArtifactEntries([
    ...reportDiagnostics,
    ...fileEntries(plan.diagnosticDir, path.dirname(plan.logFile), { note: 'Peekaboo diagnostic artifact.' }),
  ]);
  const videoExists = existsSync(plan.videoFile);
  const reportVideoPath = report?.proof?.find((entry) => entry.kind === 'video' && entry.path)?.path;
  const reportVideoFile = reportVideoPath ? path.join(plan.reportRoot, reportVideoPath) : null;
  const hasEvidence = Boolean(results || report);
  const logOutput = existsSync(plan.logFile) ? readFileSync(plan.logFile, 'utf8') : '';
  const phaseErrors = (report?.phases ?? []).map((phase) => phase.error ?? '').join('\n');
  const infraFailure =
    report?.status === 'infra_failed' || hasInfraFailureMarker(result.stdout, result.stderr, logOutput, phaseErrors);
  const coverageMap = coverageMapForScenario(plan.scenario, report);
  const coverageMapPath = coverageMap ? path.join(path.dirname(plan.logFile), 'peekaboo-coverage-map.json') : null;
  if (coverageMapPath) {
    await writeFile(coverageMapPath, `${JSON.stringify(coverageMap, null, 2)}\n`, 'utf8');
  }
  const secretScan = scanRunDirForUnmaskedSecrets(path.dirname(plan.logFile));
  const secretScanPath = path.join(path.dirname(plan.logFile), 'secret-scan.json');
  await writeFile(secretScanPath, `${JSON.stringify(secretScan, null, 2)}\n`, 'utf8');
  const webviewProof = readWebviewProof(path.dirname(plan.logFile));
  const webviewProofPath = writeWebviewProof(path.dirname(plan.logFile), webviewProof);
  const screenshotSignal = scanPeekabooScreenshotSignal(path.dirname(plan.logFile), screenshots, webviewProof);
  const screenshotSignalPath = path.join(path.dirname(plan.logFile), 'screenshot-signal.json');
  await writeFile(screenshotSignalPath, `${JSON.stringify(screenshotSignal, null, 2)}\n`, 'utf8');
  const supplementalDiagnostics = [
    ...(coverageMapPath
      ? [
          {
            label: 'peekaboo-coverage-map.json',
            path: path.relative(path.dirname(plan.logFile), coverageMapPath),
            capturedAt: new Date().toISOString(),
            note: 'Peekaboo-to-Product-Proof additive coverage map.',
            bytes: statSync(coverageMapPath).size,
          },
        ]
      : []),
    {
      label: 'secret-scan.json',
      path: path.relative(path.dirname(plan.logFile), secretScanPath),
      capturedAt: new Date().toISOString(),
      note: 'Unmasked provider-secret artifact scan.',
      bytes: statSync(secretScanPath).size,
    },
    {
      label: 'screenshot-signal.json',
      path: path.relative(path.dirname(plan.logFile), screenshotSignalPath),
      capturedAt: new Date().toISOString(),
      note: 'Peekaboo screenshot visual-signal scan.',
      bytes: statSync(screenshotSignalPath).size,
    },
    {
      label: 'webview-proof.json',
      path: path.relative(path.dirname(plan.logFile), webviewProofPath),
      capturedAt: new Date().toISOString(),
      note: 'WebView DOM, paint, and asset-probe summary used to distinguish app render from host screenshot capture.',
      bytes: statSync(webviewProofPath).size,
    },
  ];

  return {
    scenario: plan.scenario,
    success:
      result.status === 0 &&
      hasEvidence &&
      !infraFailure &&
      results?.success !== false &&
      report?.status !== 'failed' &&
      report?.status !== 'infra_failed' &&
      secretScan.status === 'passed' &&
      screenshotSignal.status === 'passed',
    status: result.status ?? 1,
    signal: result.signal ?? null,
    error: result.error ? String(result.error) : '',
    infraFailure,
    secretScan,
    screenshotSignal,
    webviewProof,
    coverageMap,
    results,
    report,
    artifacts: {
      logFile: path.relative(path.dirname(plan.logFile), plan.logFile),
      stdout: path.relative(path.dirname(plan.logFile), stdoutPath),
      stderr: path.relative(path.dirname(plan.logFile), stderrPath),
      preflight: path.relative(path.dirname(plan.logFile), preflightPath),
      resultsFile: existsSync(plan.resultsFile) ? path.relative(path.dirname(plan.logFile), plan.resultsFile) : null,
      reportFile: existsSync(plan.reportFile) ? path.relative(path.dirname(plan.logFile), plan.reportFile) : null,
      videoFile: videoExists
        ? path.relative(path.dirname(plan.logFile), plan.videoFile)
        : reportVideoFile && existsSync(reportVideoFile)
          ? path.relative(path.dirname(plan.logFile), reportVideoFile)
          : null,
      screenshots,
      diagnostics: [...diagnostics, ...supplementalDiagnostics],
    },
  };
}

function legacyPhaseStatusToClaimStatus(status) {
  if (status === 'PASS') return 'pass';
  if (status === 'FAIL') return 'fail';
  return 'inconclusive';
}

function reportPhaseStatusToClaimStatus(status) {
  if (status === 'passed') return 'pass';
  if (status === 'failed') return 'fail';
  return 'inconclusive';
}

export function applyPeekabooResultToState(state, peekabooResult) {
  const scenarioKey = PEEKABOO_E2E_SCENARIO_KEYS[peekabooResult.scenario] ?? 'peekabooDescriptorPromptSmoke';
  const reportPhases = peekabooResult.report?.phases ?? [];
  const mappedPhaseKeys = new Set(reportPhases.map((phase) => phaseCoverageKey(phase.name)).filter(Boolean));
  const transitivelyCoveredKeys = new Set();
  const scenarioState = state.scenarios[scenarioKey] ?? {
    label: `Peekaboo scenario: ${peekabooResult.scenario}`,
    status: 'inconclusive',
    notes: [],
  };

  scenarioState.status = peekabooResult.infraFailure ? 'inconclusive' : peekabooResult.success ? 'pass' : 'fail';
  if (peekabooResult.infraFailure) {
    scenarioState.notes.push(`Peekaboo infrastructure preflight failed; see ${peekabooResult.artifacts.preflight}.`);
  }
  scenarioState.notes.push(
    peekabooResult.results
      ? `Peekaboo runner exited ${peekabooResult.status}; parsed ${peekabooResult.results.phases?.length ?? 0} legacy phase result(s).`
      : 'Legacy JSON result file was not produced.',
  );
  if (peekabooResult.report) {
    scenarioState.notes.push(
      `Parsed structured report ${peekabooResult.artifacts.reportFile} with status ${peekabooResult.report.status}.`,
    );
  }
  if (peekabooResult.secretScan) {
    scenarioState.notes.push(
      `Scanned ${peekabooResult.secretScan.scannedFiles} text artifact(s) for unmasked provider secrets: ${peekabooResult.secretScan.status}.`,
    );
    if (peekabooResult.secretScan.violations?.length) {
      scenarioState.notes.push(`Secret scan violations: ${peekabooResult.secretScan.violations.join(', ')}`);
    }
  }
  if (peekabooResult.screenshotSignal) {
    scenarioState.notes.push(
      `Checked ${peekabooResult.screenshotSignal.scannedFiles} screenshot artifact(s) for visual signal: ${peekabooResult.screenshotSignal.status}.`,
    );
    if (peekabooResult.screenshotSignal.violations?.length) {
      scenarioState.notes.push(
        `Screenshot signal violations: ${peekabooResult.screenshotSignal.violations
          .map((violation) => `${violation.path} (${violation.issue})`)
          .join(', ')}`,
      );
    }
  }
  if (peekabooResult.screenshotSignal?.status === 'failed') {
    const diagnosticPaths = (peekabooResult.artifacts.diagnostics ?? []).map((diagnostic) => diagnostic.path ?? '');
    const processDiagnostics = diagnosticPaths.filter((entry) => /process-list\.json$/i.test(entry));
    const windowDiagnostics = diagnosticPaths.filter((entry) => /window-list\.json$/i.test(entry));
    const domDiagnostics = diagnosticPaths.filter((entry) => /nixmac-frontend-breadcrumbs\.jsonl$/i.test(entry));
    if (processDiagnostics.length || windowDiagnostics.length || domDiagnostics.length) {
      scenarioState.notes.push(
        `Visual failure diagnostics captured ${processDiagnostics.length} process-list, ${windowDiagnostics.length} window-list, and ${domDiagnostics.length} frontend breadcrumb artifact(s).`,
      );
    }
  }
  if (peekabooResult.coverageMap) {
    scenarioState.notes.push(`Wrote additive Peekaboo coverage map for ${peekabooResult.coverageMap.phaseCoverage.length} phase key(s).`);
  }
  scenarioState.executedByPeekaboo = true;
  scenarioState.peekabooEvidence = {
    phaseKey: scenarioKey,
    grade: 'scenario',
    correspondsTo: [],
  };
  state.scenarios[scenarioKey] = scenarioState;

  for (const phase of reportPhases) {
    const key = phaseCoverageKey(phase.name);
    if (!key) continue;
    const coverage = phaseCoverageForReportPhase(key, phase);
    if (!coverage) continue;
    const phaseState = state.scenarios[key] ?? {
      label: coverage.label,
      status: 'inconclusive',
      notes: [],
    };
    phaseState.status = peekabooResult.infraFailure ? 'inconclusive' : reportPhaseStatusToClaimStatus(phase.status);
    phaseState.executedByPeekaboo = true;
    phaseState.peekabooEvidence = {
      phaseKey: key,
      grade: coverage.grade,
      correspondsTo: coverage.correspondsTo,
    };
    phaseState.notes.push(
      `${cleanPhaseName(phase.name)} Corresponds to Computer Use key(s): ${coverage.correspondsTo.length ? coverage.correspondsTo.join(', ') : 'none'}; Peekaboo evidence grade: ${coverage.grade}.`,
    );
    if (phase.error) phaseState.notes.push(String(phase.error));
    state.scenarios[key] = phaseState;

    for (const computerUseKey of coverage.correspondsTo) {
      transitivelyCoveredKeys.add(computerUseKey);
      const cuState = state.scenarios[computerUseKey];
      if (!cuState || peekabooResult.infraFailure || reportPhaseStatusToClaimStatus(phase.status) !== 'pass') continue;
      if (cuState.status === 'inconclusive' || cuState.status === 'not_required') {
        cuState.status = 'pass';
        cuState.notes.push(
          `Covered transitively by ${key}; Peekaboo evidence grade: ${coverage.grade}.`,
        );
      }
      cuState.peekabooTransitiveCoverage ??= {
        phaseKey: key,
        grade: coverage.grade,
      };
    }
  }

  for (const [key, item] of Object.entries(state.scenarios)) {
    if (key !== scenarioKey && !mappedPhaseKeys.has(key) && !transitivelyCoveredKeys.has(key) && item.status === 'inconclusive') {
      item.status = 'not_required';
      item.notes.push(`Not required for Peekaboo ${peekabooResult.scenario} run.`);
    }
  }

  for (const phase of reportPhases) {
    state.claims.push({
      claim: `Peekaboo ${peekabooResult.scenario}: ${cleanPhaseName(phase.name)}`,
      status: reportPhaseStatusToClaimStatus(phase.status),
      evidence: `Recorded by tests/e2e/run.sh; see ${peekabooResult.artifacts.reportFile}.`,
    });
  }

  if (reportPhases.length === 0) {
    const phases = peekabooResult.results?.phases ?? [];
    for (const phase of phases) {
      state.claims.push({
        claim: `Peekaboo ${peekabooResult.scenario} phase ${phase.phase}: ${phase.message}`,
        status: legacyPhaseStatusToClaimStatus(phase.status),
        evidence: `Recorded by tests/e2e/run.sh; see ${peekabooResult.artifacts.logFile ?? peekabooResult.artifacts.preflight}.`,
      });
    }
    if (phases.length === 0) {
      state.claims.push({
        claim: `Peekaboo ${peekabooResult.scenario} completed with parseable phase evidence`,
        status: peekabooResult.infraFailure ? 'inconclusive' : peekabooResult.results || peekabooResult.report ? 'pass' : 'fail',
        evidence: peekabooResult.artifacts.reportFile ?? peekabooResult.artifacts.resultsFile ?? peekabooResult.artifacts.preflight,
      });
    }
  }

  state.screenshots.push(...peekabooResult.artifacts.screenshots);
  state.diagnostics ??= [];
  state.diagnostics.push(...(peekabooResult.artifacts.diagnostics ?? []));
  state.video = peekabooResult.artifacts.videoFile
    ? { path: peekabooResult.artifacts.videoFile, label: 'Peekaboo screen recording' }
    : state.video;
  state.narrative.push({
    ts: new Date().toISOString(),
    text: `Ran Peekaboo scenario ${peekabooResult.scenario}. Results: ${peekabooResult.artifacts.reportFile ?? peekabooResult.artifacts.resultsFile ?? 'missing'}.`,
  });
  if (peekabooResult.error) {
    state.failures.push(`Peekaboo runner error: ${peekabooResult.error}`);
  }
  if (peekabooResult.secretScan?.status === 'failed') {
    state.failures.push(`Unmasked secret artifact scan failed: ${peekabooResult.secretScan.violations.join(', ')}`);
  }
  if (peekabooResult.screenshotSignal?.status === 'failed') {
    state.failures.push(
      `Peekaboo screenshot signal scan failed: ${peekabooResult.screenshotSignal.violations
        .map((violation) => `${violation.path} (${violation.issue})`)
        .join(', ')}`,
    );
  }
  state.peekaboo ??= {};
  if (peekabooResult.coverageMap) state.peekaboo.coverageMap = peekabooResult.coverageMap;
  if (peekabooResult.secretScan) state.peekaboo.secretScan = peekabooResult.secretScan;
  if (peekabooResult.screenshotSignal) state.peekaboo.screenshotSignal = peekabooResult.screenshotSignal;
  if (peekabooResult.webviewProof) state.peekaboo.webviewProof = peekabooResult.webviewProof;
  return state;
}

export function peekabooRunnerSelfTest({ repoRoot }) {
  const e2eRoot = path.join(repoRoot, 'tests/e2e');
  const scenarios = listPeekabooScenarios({ e2eRoot });
  assert.ok(scenarios.includes('nix-install'), 'Peekaboo scenario discovery should find nix-install');
  assert.ok(
    scenarios.includes(DEFAULT_PEEKABOO_SCENARIO),
    `Peekaboo scenario discovery should find ${DEFAULT_PEEKABOO_SCENARIO}`,
  );
  assert.ok(
    scenarios.includes('macos_provider_evolve_full_smoke'),
    'Peekaboo scenario discovery should find provider evolve smoke',
  );
  assert.ok(
    scenarios.includes('macos_core_product_proof'),
    'Peekaboo scenario discovery should find core Product Proof',
  );
  assert.ok(
    scenarios.includes('macos_support_dialogs_smoke'),
    'Peekaboo scenario discovery should find support dialogs smoke',
  );
  assert.ok(
    scenarios.includes('macos_console_smoke'),
    'Peekaboo scenario discovery should find Console smoke',
  );
  assert.ok(
    scenarios.includes('macos_homebrew_save_rollback_smoke'),
    'Peekaboo scenario discovery should find Homebrew save/rollback smoke',
  );
  assert.ok(
    scenarios.includes('macos_customization_save_rollback_smoke'),
    'Peekaboo scenario discovery should find customization save/rollback smoke',
  );

  const plan = buildPeekabooRunPlan({
    repoRoot,
    runDir: path.join(repoRoot, 'artifacts/computer-use-local/self-test'),
    scenario: DEFAULT_PEEKABOO_SCENARIO,
    noRecord: true,
    env: {},
  });
  assert.equal(plan.resultsFile.endsWith('peekaboo-e2e-results.json'), true, 'legacy JSON path derives from E2E_LOG_FILE');
  assert.equal(plan.reportFile.endsWith(`${DEFAULT_PEEKABOO_SCENARIO}/e2e-report.json`), true, 'report path lives under runDir');
  assert.equal(plan.env.E2E_CLEANUP_NIX, '0', 'Peekaboo local Product Proof runs should not uninstall Nix by default');
  assert.equal(plan.env.E2E_ARTIFACT_ROOT.endsWith('/e2e-report'), true, 'report root is scoped to runDir');
  assert.equal(plan.env.E2E_DIAGNOSTIC_DIR.endsWith('/diagnostics'), true, 'diagnostics should survive runner cleanup outside transient capture dir');
  assert.equal(plan.env.E2E_DIALOG_AUTOMATION, '1', 'Peekaboo local lane preserves first-launch dialog automation by default');
  assert.equal(plan.env.E2E_PEEKABOO_RECOVER_BRIDGE, '1', 'Peekaboo local lane should recover a degraded bridge by default');
  assert.deepEqual(plan.args.slice(1), [DEFAULT_PEEKABOO_SCENARIO, '--json', '--no-record', '--no-cleanup']);
  runScreenshotSignalSelfTest();

  assert.equal(
    classifyCodesignOutput('nixmac.app: code object is not signed at all').fatal,
    false,
    'unsigned debug bundles should not be rejected by preflight',
  );
  assert.equal(
    classifyCodesignOutput('nixmac.app: a sealed resource is missing or invalid').fatal,
    true,
    'corrupted sealed-resource bundles should fail preflight',
  );
  assert.equal(hasInfraFailureMarker('[FAIL] E2E_INFRA: AX tree unavailable'), true, 'infra marker should be recognized from runner logs');
  assert.equal(hasInfraFailureMarker('App text mentions E2E_INFRA: inside a sentence'), false, 'infra marker should be line anchored');

  assert.throws(
    () =>
      buildPeekabooRunPlan({
        repoRoot,
        runDir: path.join(repoRoot, 'artifacts/computer-use-local/self-test'),
        scenario: 'nix-install',
        env: {},
      }),
    /destructive/,
    'nix-install should require an explicit destructive opt-in',
  );

  const state = {
    scenarios: {
      launch: { label: 'Launch', status: 'inconclusive', notes: [] },
      peekabooDescriptorPromptSmoke: { label: 'Peekaboo smoke', status: 'inconclusive', notes: [] },
    },
    claims: [],
    screenshots: [],
    narrative: [],
    failures: [],
  };
  applyPeekabooResultToState(state, {
    scenario: 'macos_core_product_proof',
    success: true,
    status: 0,
    error: '',
    infraFailure: false,
    secretScan: { status: 'passed', scannedFiles: 3, violations: [] },
    screenshotSignal: { status: 'passed', scannedFiles: 1, violations: [] },
    coverageMap: {
      schemaVersion: 1,
      lane: 'peekaboo-local',
      scenario: 'macos_core_product_proof',
      phaseCoverage: [{ key: 'peekabooCoreLaunch', ...PEEKABOO_PHASE_COVERAGE.peekabooCoreLaunch }],
    },
    results: null,
    report: {
      status: 'passed',
      phases: [{ name: 'peekabooCoreLaunch: Launch nixmac app', status: 'passed' }],
      proof: [],
    },
    artifacts: {
      logFile: 'peekaboo-e2e.log',
      preflight: 'peekaboo-preflight.txt',
      resultsFile: null,
      reportFile: 'e2e-report/macos_core_product_proof/e2e-report.json',
      screenshots: [],
      diagnostics: [],
      videoFile: null,
    },
  });
  assert.equal(state.scenarios.peekabooCoreProductProof.status, 'pass');
  assert.equal(state.scenarios.peekabooCoreLaunch.status, 'pass');
  assert.equal(state.scenarios.launch.status, 'pass');
  assert.equal(state.claims.length, 1);
  assert.match(state.scenarios.peekabooCoreLaunch.notes.at(-1), /Corresponds to Computer Use key\(s\): launch/);
  assert.match(state.scenarios.launch.notes.at(-1), /Covered transitively by peekabooCoreLaunch/);
  assert.equal(state.peekaboo.secretScan.status, 'passed');
  assert.equal(state.peekaboo.screenshotSignal.status, 'passed');
  assert.equal(state.peekaboo.coverageMap.phaseCoverage[0].key, 'peekabooCoreLaunch');

  for (const absentKey of ['peekabooHomebrewSaveRollback', 'peekabooCustomizationSaveRollback']) {
    const absentCoverage = phaseCoverageForReportPhase(absentKey, {
      name: `${absentKey}: ${ABSENT_NO_COVERAGE_SENTINEL} chip was not visible, so there was nothing to save or roll back in this run`,
      status: 'passed',
    });
    assert.deepEqual(absentCoverage.correspondsTo, [], `${absentKey} absent path must not claim Computer Use parity`);
    assert.equal(absentCoverage.grade, 'classified-absent-no-coverage');
  }

  const duplicateCoverageState = {
    scenarios: {
      review: { label: 'Review', status: 'inconclusive', notes: [] },
      peekabooProviderEvolveFullSmoke: { label: 'Peekaboo provider', status: 'inconclusive', notes: [] },
    },
    claims: [],
    screenshots: [],
    narrative: [],
    failures: [],
  };
  applyPeekabooResultToState(duplicateCoverageState, {
    scenario: 'macos_provider_evolve_full_smoke',
    success: true,
    status: 0,
    error: '',
    infraFailure: false,
    secretScan: { status: 'passed', scannedFiles: 0, violations: [] },
    screenshotSignal: { status: 'passed', scannedFiles: 0, violations: [] },
    results: null,
    report: {
      status: 'passed',
      phases: [
        { name: 'peekabooProviderReview: Review reached', status: 'passed' },
        { name: 'peekabooProviderAudit: Provider audit passed', status: 'passed' },
      ],
      proof: [],
    },
    artifacts: {
      logFile: 'peekaboo-e2e.log',
      preflight: 'peekaboo-preflight.txt',
      resultsFile: null,
      reportFile: 'e2e-report/macos_provider_evolve_full_smoke/e2e-report.json',
      screenshots: [],
      diagnostics: [],
      videoFile: null,
    },
  });
  assert.deepEqual(duplicateCoverageState.scenarios.review.peekabooTransitiveCoverage, {
    phaseKey: 'peekabooProviderReview',
    grade: 'provider-state',
  });
  assert.match(duplicateCoverageState.scenarios.review.notes.at(-1), /peekabooProviderReview/);

  const secretScanState = {
    scenarios: {
      peekabooCoreProductProof: { label: 'Peekaboo core', status: 'inconclusive', notes: [] },
    },
    claims: [],
    screenshots: [],
    narrative: [],
    failures: [],
  };
  applyPeekabooResultToState(secretScanState, {
    scenario: 'macos_core_product_proof',
    success: false,
    status: 0,
    error: '',
    infraFailure: false,
    secretScan: { status: 'failed', scannedFiles: 4, violations: ['diagnostics/api-keys.txt'] },
    screenshotSignal: { status: 'passed', scannedFiles: 0, violations: [] },
    results: null,
    report: {
      status: 'passed',
      phases: [{ name: 'peekabooCoreSettingsAPIKeys: API Keys tab redaction proof', status: 'passed' }],
      proof: [],
    },
    artifacts: {
      logFile: 'peekaboo-e2e.log',
      preflight: 'peekaboo-preflight.txt',
      resultsFile: null,
      reportFile: 'e2e-report/macos_core_product_proof/e2e-report.json',
      screenshots: [],
      diagnostics: [],
      videoFile: null,
    },
  });
  assert.equal(secretScanState.scenarios.peekabooCoreProductProof.status, 'fail');
  assert.equal(secretScanState.scenarios.peekabooCoreSettingsAPIKeys.status, 'pass');
  assert.deepEqual(secretScanState.failures, ['Unmasked secret artifact scan failed: diagnostics/api-keys.txt']);

  const secretScanRoot = path.join(repoRoot, 'artifacts/computer-use-local');
  mkdirSync(secretScanRoot, { recursive: true });
  const secretScanDir = mkdtempSync(path.join(secretScanRoot, 'secret-scan-self-test-'));
  try {
    writeFileSync(path.join(secretScanDir, 'requests.jsonl'), '{"authorization":"Bearer sk-self-test-secret"}\n', 'utf8');
    const jsonlScan = scanRunDirForUnmaskedSecrets(secretScanDir);
    assert.equal(jsonlScan.scannedFiles, 1, 'Secret scan should include JSONL diagnostics');
    assert.equal(jsonlScan.status, 'failed', 'Secret scan should fail on unmasked JSONL secrets');
    assert.deepEqual(jsonlScan.violations, ['requests.jsonl']);
  } finally {
    rmSync(secretScanDir, { recursive: true, force: true });
  }

  const screenshotSignalState = {
    scenarios: {
      peekabooCoreProductProof: { label: 'Peekaboo core', status: 'inconclusive', notes: [] },
    },
    claims: [],
    screenshots: [],
    narrative: [],
    failures: [],
  };
  applyPeekabooResultToState(screenshotSignalState, {
    scenario: 'macos_core_product_proof',
    success: false,
    status: 0,
    error: '',
    infraFailure: false,
    secretScan: { status: 'passed', scannedFiles: 4, violations: [] },
    screenshotSignal: {
      status: 'failed',
      scannedFiles: 1,
      violations: [{ path: 'screenshots/black.png', label: 'black', issue: 'the screenshot appears blank or visually occluded' }],
    },
    results: null,
    report: {
      status: 'passed',
      phases: [{ name: 'peekabooCoreLaunch: Launch nixmac app', status: 'passed' }],
      proof: [],
    },
    artifacts: {
      logFile: 'peekaboo-e2e.log',
      preflight: 'peekaboo-preflight.txt',
      resultsFile: null,
      reportFile: 'e2e-report/macos_core_product_proof/e2e-report.json',
      screenshots: [],
      diagnostics: [],
      videoFile: null,
    },
  });
  assert.equal(screenshotSignalState.scenarios.peekabooCoreProductProof.status, 'fail');
  assert.match(screenshotSignalState.failures.join('\n'), /screenshot signal scan failed/i);

  const infraState = {
    scenarios: {
      launch: { label: 'Launch', status: 'inconclusive', notes: [] },
      peekabooDescriptorPromptSmoke: { label: 'Peekaboo smoke', status: 'inconclusive', notes: [] },
    },
    claims: [],
    screenshots: [],
    narrative: [],
    failures: [],
  };
  applyPeekabooResultToState(infraState, {
    scenario: DEFAULT_PEEKABOO_SCENARIO,
    success: false,
    status: 1,
    error: 'Peekaboo preflight failed: missing Screen Recording, Accessibility',
    infraFailure: true,
    results: null,
    report: null,
    artifacts: {
      logFile: null,
      preflight: 'peekaboo-preflight.txt',
      resultsFile: null,
      reportFile: null,
      screenshots: [],
      diagnostics: [],
      videoFile: null,
    },
  });
  assert.equal(infraState.scenarios.peekabooDescriptorPromptSmoke.status, 'inconclusive');
  assert.equal(infraState.claims.at(-1).status, 'inconclusive');
}
