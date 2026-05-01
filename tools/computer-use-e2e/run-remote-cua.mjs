#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const TOOL_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(TOOL_DIR, '../..');

const DEFAULT_APP = 'com.darkmatter.nixmac';
const DEFAULT_WS = 'ws://127.0.0.1:18790';
const DEFAULT_PROMPT = 'Add the bat command line tool to my Homebrew packages as the plain string "bat" only, with no inline comments.';
const DEFAULT_BUILD_ATTEMPTS = 180;
const ARTIFACT_ROOT = path.join(REPO_ROOT, 'artifacts', 'computer-use-remote');
const COVERAGE_MANIFEST_PATH = path.join(TOOL_DIR, 'coverage-manifest.json');

const scenarioLabels = {
  launch: 'App launches and first screen is usable',
  updateBanner: 'Update banner does not block the main workflow',
  settingsGeneral: 'Settings General tab visibly renders',
  settingsAIModels: 'Settings AI Models tab visibly renders',
  settingsAPIKeys: 'Settings API Keys tab visibly renders',
  settingsPreferences: 'Settings Preferences tab visibly renders',
  history: 'My History opens and renders',
  console: 'Console opens and renders',
  feedback: 'Give Feedback opens and can be cancelled',
  reportIssue: 'Report Issue opens and can be cancelled',
  suggestionCards: 'Home suggestion cards are visible/clickable',
  typedIntent: 'A typed real intent can be submitted',
  review: 'Real provider workflow reaches Review',
  summary: 'Summary tab renders after intent review',
  diff: 'Diff tab renders after intent review',
  buildBoundary: 'Build & Test destructive boundary appears before activation',
  saveFlow: 'Step 3 Save / Keep changes persists a change',
  rollbackCleanup: 'Rollback cleanup returns disposable config to clean state',
  discard: 'Discard confirmation is guarded and only confirmed in disposable state',
  visualCoverage: 'Core UX/UI surfaces are captured and inspectable',
  visualProofQuality: 'Scenario results include inspectable visual/text evidence',
  mainCoverageFreshness: 'Main branch user-visible coverage stays mapped',
  prSpecificCoverage: 'PR-specific user-visible behavior is covered when applicable',
  videoEvidence: 'Evidence video is generated and embedded',
  reportInspection: 'Generated HTML report is inspected with Computer Use',
};

const scenarioGroups = [
  {
    name: 'App Shell',
    keys: ['launch', 'updateBanner', 'visualCoverage'],
  },
  {
    name: 'Settings',
    keys: ['settingsGeneral', 'settingsAIModels', 'settingsAPIKeys', 'settingsPreferences'],
  },
  {
    name: 'Support Surfaces',
    keys: ['history', 'console', 'feedback', 'reportIssue'],
  },
  {
    name: 'Real Provider Workflow',
    keys: ['suggestionCards', 'typedIntent', 'review', 'summary', 'diff', 'buildBoundary', 'saveFlow', 'rollbackCleanup', 'discard'],
  },
  {
    name: 'PR-Specific Focus',
    keys: ['mainCoverageFreshness', 'prSpecificCoverage'],
  },
  {
    name: 'Evidence',
    keys: ['visualProofQuality', 'videoEvidence', 'reportInspection'],
  },
];

const scenarioProofCatalog = {
  launch: {
    grade: 'action-confirmed',
    screenshots: ['launch'],
    texts: ['launch'],
    proof: 'Accessibility text shows the nixmac window, Settings/History/Feedback controls, stepper, prompt text area, and disabled Send button.',
    untested: 'Does not prove provider or config state.',
  },
  updateBanner: {
    grade: 'text-confirmed',
    screenshots: ['launch'],
    texts: ['launch'],
    proof: 'Runner checks for a visible Dismiss button. If present, it dismisses it; if absent, it proves no update banner blocked the initial UI.',
    untested: 'The explicit dismiss interaction is only tested on runs where a banner is actually present.',
  },
  settingsGeneral: {
    grade: 'action-confirmed',
    screenshots: ['settings-general'],
    texts: ['settings-general'],
    proof: 'Computer Use clicked Settings and captured the General tab content.',
    untested: 'Does not persist setting edits.',
  },
  settingsAIModels: {
    grade: 'action-confirmed',
    screenshots: ['settings-ai-models'],
    texts: ['settings-ai-models'],
    proof: 'Computer Use opened AI Models and captured provider/model/build controls.',
    untested: 'Does not change models or verify every provider.',
  },
  settingsAPIKeys: {
    grade: 'text-confirmed',
    screenshots: [],
    texts: ['settings-api-keys-01'],
    proof: 'Sensitive screenshot omitted; redacted accessibility text must show API Keys/OpenRouter/API-key controls.',
    untested: 'Does not edit/delete keys and does not prove keychain persistence by itself.',
  },
  settingsPreferences: {
    grade: 'action-confirmed',
    screenshots: ['settings-preferences'],
    texts: ['settings-preferences'],
    proof: 'Computer Use opened Preferences and captured confirmation controls.',
    untested: 'Does not toggle preferences permanently.',
  },
  history: {
    grade: 'action-confirmed',
    screenshots: ['history'],
    texts: ['history'],
    proof: 'Computer Use opened History and captured a visible history/empty state.',
    untested: 'Current run does not prove a newly saved change appears there.',
  },
  console: {
    grade: 'text-confirmed',
    screenshots: [],
    texts: ['console'],
    proof: 'Sensitive screenshot omitted; redacted accessibility text must show Console/log content.',
    untested: 'Does not prove log completeness and may omit secret-bearing visuals by design.',
  },
  feedback: {
    grade: 'action-confirmed',
    screenshots: ['feedback', 'home-after-feedback'],
    texts: ['feedback', 'home-after-feedback'],
    proof: 'Computer Use opened and cancelled the feedback dialog.',
    untested: 'Does not submit feedback.',
  },
  reportIssue: {
    grade: 'action-confirmed',
    screenshots: ['report-issue', 'home-after-report-issue'],
    texts: ['report-issue', 'home-after-report-issue'],
    proof: 'Computer Use opened and cancelled the report issue dialog.',
    untested: 'Does not submit a report.',
  },
  suggestionCards: {
    grade: 'action-confirmed',
    screenshots: ['suggestion-card'],
    texts: ['suggestion-card'],
    proof: 'Computer Use found and clicked a suggestion card; the UI stayed usable afterward.',
    untested: 'Does not prove every suggestion works.',
  },
  typedIntent: {
    grade: 'action-confirmed',
    screenshots: ['typed-intent'],
    texts: ['typed-intent'],
    proof: 'Prompt text appears in the Computer Use state after set_value.',
    untested: 'Does not prove provider execution until Review is reached.',
  },
  review: {
    grade: 'action-confirmed',
    screenshots: ['provider-progress-01', 'provider-progress-02', 'provider-progress-03', 'provider-progress-04', 'provider-progress-05'],
    texts: ['provider-progress-01', 'provider-progress-02', 'provider-progress-03', 'provider-progress-04', 'provider-progress-05'],
    proof: 'Polling reached Review-equivalent UI with Build & Test/Discard/Summary/Diff controls.',
    untested: 'Does not prove Save/commit.',
  },
  summary: {
    grade: 'text-confirmed',
    screenshots: ['review-summary'],
    texts: ['review-summary'],
    proof: 'Summary text must mention the requested package/change domain.',
    untested: 'Does not prove file persistence.',
  },
  diff: {
    grade: 'text-confirmed',
    screenshots: ['review-diff'],
    texts: ['review-diff'],
    proof: 'Diff text must show the requested package/change in a configuration file.',
    untested: 'Does not prove the change builds or saves.',
  },
  buildBoundary: {
    grade: 'action-confirmed',
    screenshots: ['build-boundary', 'step-3-ready'],
    texts: ['build-boundary', 'step-3-ready'],
    proof: 'Build & Test opens a confirmation dialog before activation; disposable runs confirm it and wait for Step 3.',
    untested: 'Without explicit disposable build-confirm mode, the runner still cancels at the boundary.',
  },
  saveFlow: {
    grade: 'action-confirmed',
    screenshots: ['step-3-ready', 'after-commit'],
    texts: ['step-3-ready', 'after-commit'],
    proof: 'In disposable build-confirm mode, Computer Use reaches Step 3, clicks Commit, and the runner verifies the disposable repo HEAD changed with a clean worktree.',
    untested: 'When disposable build-confirm mode is not enabled, Save remains untested.',
  },
  rollbackCleanup: {
    grade: 'action-confirmed',
    screenshots: ['history-before-restore', 'history-restore-preview', 'after-history-restore'],
    texts: ['history-before-restore', 'history-restore-preview', 'after-history-restore'],
    proof: 'After Save, Computer Use opens History, restores the pre-test baseline commit, and the runner verifies HEAD returned to that baseline with a clean worktree.',
    untested: 'Only runs when Save succeeded and a restorable disposable baseline exists.',
  },
  discard: {
    grade: 'guardrail-confirmed',
    screenshots: ['discard-boundary', 'history-restore-preview', 'after-history-restore'],
    texts: ['discard-boundary', 'history-restore-preview', 'after-history-restore'],
    proof: 'Discard opens a confirmation boundary when used. In full-lifecycle runs, the stronger History restore cleanup path can supersede Discard and is proven by rollback artifacts.',
    untested: 'When History restore cleanup passes, Discard itself is intentionally not clicked because the disposable config is already back at baseline.',
  },
  visualCoverage: {
    grade: 'text-confirmed',
    screenshots: ['launch', 'settings-general', 'settings-ai-models', 'settings-preferences', 'history', 'feedback', 'report-issue', 'typed-intent'],
    texts: ['launch', 'settings-general', 'settings-ai-models', 'settings-preferences', 'history', 'feedback', 'report-issue', 'typed-intent'],
    proof: 'Required core UI surfaces have screenshot and text artifacts.',
    untested: 'Does not prove screenshot annotations are exact bounding boxes.',
  },
  visualProofQuality: {
    grade: 'text-confirmed',
    screenshots: [],
    texts: [],
    proof: 'Every passing scenario must have at least one primary screenshot or text artifact listed in the proof catalog.',
    untested: 'Overlay callouts are visual aids; text snapshots remain the assertion source.',
  },
  mainCoverageFreshness: {
    grade: 'manifest-confirmed',
    screenshots: [],
    texts: [],
    proof: 'A repo-local coverage manifest maps major user-visible surfaces on main to Computer Use scenarios or explicit waivers, and the runner scans for unmapped candidate files.',
    untested: 'This proves scenario mapping freshness, not that every mapped scenario passed in the current run.',
  },
  prSpecificCoverage: {
    grade: 'not-run',
    screenshots: [],
    texts: [],
    proof: 'Requires PR metadata and changed-file/user-visible focus input.',
    untested: 'No PR-specific scenario is executed unless PR context is provided.',
  },
  videoEvidence: {
    grade: 'artifact-confirmed',
    screenshots: [],
    texts: [],
    proof: 'Report embeds an MP4 under video/computer-use-evidence.mp4.',
    untested: 'Current MP4 is an evidence reel assembled from screenshots, not continuous recording.',
  },
  reportInspection: {
    grade: 'action-confirmed',
    screenshots: ['HTML report inspection'],
    texts: ['HTML report inspection'],
    proof: 'Computer Use opens the generated report on the remote Mac and sees report sections.',
    untested: 'Does not prove a human reviewed every screenshot.',
  },
};

const screenshotAnnotations = {
  launch: [
    { label: 'Workflow stepper', x: 10, y: 7, w: 82, h: 10 },
    { label: 'Save step not active yet', x: 67, y: 8, w: 25, h: 9 },
    { label: 'Prompt input', x: 12, y: 45, w: 80, h: 13 },
    { label: 'Disabled send', x: 88, y: 50, w: 4, h: 4, tone: 'pin' },
  ],
  'settings-general': [{ label: 'Settings content rendered', x: 18, y: 15, w: 64, h: 48 }],
  'settings-ai-models': [{ label: 'Provider/model controls', x: 22, y: 18, w: 56, h: 52 }],
  'settings-preferences': [{ label: 'Confirmation controls', x: 22, y: 20, w: 56, h: 52 }],
  history: [{ label: 'History surface visible', x: 18, y: 18, w: 64, h: 56 }],
  feedback: [{ label: 'Feedback dialog opened', x: 24, y: 22, w: 52, h: 52 }],
  'report-issue': [{ label: 'Report Issue dialog opened', x: 24, y: 22, w: 52, h: 52 }],
  'typed-intent': [{ label: 'Typed prompt visible', x: 18, y: 31, w: 64, h: 20 }],
  'review-summary': [{ label: 'Summary after Review', x: 15, y: 25, w: 70, h: 46 }],
  'review-diff': [{ label: 'Diff includes requested change', x: 12, y: 30, w: 76, h: 34 }],
  'build-boundary': [{ label: 'Build confirmation boundary', x: 28, y: 24, w: 44, h: 36 }],
  'step-3-ready': [{ label: 'Step 3 commit controls', x: 12, y: 12, w: 76, h: 76 }],
  'after-commit': [{ label: 'Saved commit state', x: 12, y: 12, w: 76, h: 76 }],
  'history-before-restore': [{ label: 'History restore controls', x: 10, y: 12, w: 80, h: 76 }],
  'history-restore-preview': [{ label: 'Confirm restore preview', x: 10, y: 12, w: 80, h: 76 }],
  'after-history-restore': [{ label: 'Rollback cleanup result', x: 10, y: 12, w: 80, h: 76 }],
  'discard-boundary': [{ label: 'Discard confirmation boundary', x: 28, y: 24, w: 44, h: 36 }],
};

function usage() {
  console.log(`Usage:
  node tools/computer-use-e2e/run-remote-cua.mjs run [--prompt "..."]
  node tools/computer-use-e2e/run-remote-cua.mjs render-unavailable --note "..."
  node tools/computer-use-e2e/run-remote-cua.mjs render-existing --run-dir artifacts/computer-use-remote/<timestamp>

Environment:
  NIXMAC_COMPUTER_USE_WS       WebSocket for Codex app-server (default ${DEFAULT_WS})
  NIXMAC_COMPUTER_USE_APP      Bundle id/app name (default ${DEFAULT_APP})
  NIXMAC_E2E_REMOTE_SSH_DEST   Optional ssh destination, e.g. admin@38.79.97.120
  NIXMAC_E2E_SSH_KEY           Optional ssh private key path
  NIXMAC_E2E_SSH_KNOWN_HOSTS   Optional known_hosts path for strict SSH verification
  NIXMAC_E2E_REMOTE_REPORT_DIR Optional remote report copy dir for browser inspection
  NIXMAC_E2E_APP_COMMAND       App command metadata
  NIXMAC_E2E_DISPOSABLE_CONFIG Set true only when the app is proven to use per-run disposable config
  NIXMAC_E2E_ALLOW_BUILD_CONFIRM Set true only when Build & Test may run against disposable config
  NIXMAC_E2E_ALLOW_DISCARD_CONFIRM Set true only when Discard may run against disposable config
  NIXMAC_E2E_REMOTE_CONFIG_DIR Optional explicit remote disposable config path for git proof
  NIXMAC_E2E_PR_CHANGED_FILES  Newline/comma separated PR changed files for PR-specific focus
`);
}

function argValue(args, flag, fallback = '') {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '').replace('T', 'T').replace('Z', 'Z');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    error: result.error ? String(result.error) : '',
  };
}

function sshArgs(remoteCommand) {
  const dest = process.env.NIXMAC_E2E_REMOTE_SSH_DEST;
  if (!dest) return null;
  const args = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
  if (process.env.NIXMAC_E2E_SSH_KNOWN_HOSTS) {
    args.push('-o', `UserKnownHostsFile=${process.env.NIXMAC_E2E_SSH_KNOWN_HOSTS}`);
  }
  if (process.env.NIXMAC_E2E_SSH_KEY) args.push('-i', process.env.NIXMAC_E2E_SSH_KEY);
  args.push(dest, remoteCommand);
  return args;
}

function ssh(remoteCommand) {
  const args = sshArgs(remoteCommand);
  if (!args) return { ok: false, stdout: '', stderr: 'NIXMAC_E2E_REMOTE_SSH_DEST is not set' };
  return tryRun('ssh', args);
}

function scpToRemote(localPath, remotePath) {
  const dest = process.env.NIXMAC_E2E_REMOTE_SSH_DEST;
  if (!dest) return { ok: false, stdout: '', stderr: 'NIXMAC_E2E_REMOTE_SSH_DEST is not set' };
  const args = ['-r', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
  if (process.env.NIXMAC_E2E_SSH_KNOWN_HOSTS) {
    args.push('-o', `UserKnownHostsFile=${process.env.NIXMAC_E2E_SSH_KNOWN_HOSTS}`);
  }
  if (process.env.NIXMAC_E2E_SSH_KEY) args.push('-i', process.env.NIXMAC_E2E_SSH_KEY);
  args.push(localPath, `${dest}:${remotePath}`);
  return tryRun('scp', args);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function redact(value) {
  return String(value)
    .replace(/sk-or-[A-Za-z0-9_-]+/g, '[REDACTED_OPENROUTER_KEY]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]')
    .replace(/OPENROUTER_API_KEY=[^\s"'<>]+/g, 'OPENROUTER_API_KEY=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
}

function escapeHtml(value) {
  return redact(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function findElement(text, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, index, label] = match;
    if (list.some((pattern) => pattern.test(label))) return index;
  }
  return null;
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function verdictFor(state) {
  const statuses = Object.values(state.scenarios).map((item) => item.status);
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('inconclusive')) return 'inconclusive';
  return 'pass';
}

function shouldFailProcessForVerdict(state) {
  if (process.env.NIXMAC_E2E_STRICT_VERDICT === 'false') return false;
  return state.verdict === 'fail' || state.verdict === 'inconclusive';
}

function statusCounts(state) {
  const counts = { pass: 0, fail: 0, inconclusive: 0 };
  for (const scenario of Object.values(state.scenarios)) {
    counts[scenario.status] = (counts[scenario.status] ?? 0) + 1;
  }
  return counts;
}

function statusRank(status) {
  return { fail: 0, inconclusive: 1, pass: 2 }[status] ?? 3;
}

function groupedScenarios(state) {
  const seen = new Set();
  const groups = scenarioGroups.map((group) => {
    for (const key of group.keys) seen.add(key);
    return {
      ...group,
      items: group.keys
        .filter((key) => state.scenarios[key])
        .map((key) => ({ key, ...state.scenarios[key] }))
        .sort((a, b) => statusRank(a.status) - statusRank(b.status)),
    };
  });
  const ungrouped = Object.entries(state.scenarios)
    .filter(([key]) => !seen.has(key))
    .map(([key, item]) => ({ key, ...item }))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));
  if (ungrouped.length) groups.push({ name: 'Other', keys: ungrouped.map((item) => item.key), items: ungrouped });
  return groups;
}

function splitEnvList(value = '') {
  return String(value)
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPrFocus() {
  const changedFiles = splitEnvList(process.env.NIXMAC_E2E_PR_CHANGED_FILES || '');
  const userVisibleFiles = changedFiles.filter((file) =>
    /^(apps\/native\/src\/(components|hooks|stores|lib|styles)|apps\/native\/src-tauri|tools\/computer-use-e2e|\.github\/workflows\/computer-use-e2e\.yml)/.test(file),
  );
  const scenarioKeys = new Set();
  for (const file of changedFiles) {
    if (/settings|prefs|api-keys|store|commands\.rs|store\.rs/i.test(file)) {
      scenarioKeys.add('settingsGeneral');
      scenarioKeys.add('settingsAIModels');
      scenarioKeys.add('settingsAPIKeys');
      scenarioKeys.add('settingsPreferences');
    }
    if (/evolve|use-apply|use-rollback|rebuild|merge|commit|history|rollback|git|finalize/i.test(file)) {
      scenarioKeys.add('review');
      scenarioKeys.add('summary');
      scenarioKeys.add('diff');
      scenarioKeys.add('buildBoundary');
      scenarioKeys.add('saveFlow');
      scenarioKeys.add('rollbackCleanup');
      scenarioKeys.add('history');
    }
    if (/feedback|report-issue|console|history/i.test(file)) {
      scenarioKeys.add('history');
      scenarioKeys.add('console');
      scenarioKeys.add('feedback');
      scenarioKeys.add('reportIssue');
    }
    if (/tools\/computer-use-e2e|computer-use-e2e\.yml/i.test(file)) {
      scenarioKeys.add('visualProofQuality');
      scenarioKeys.add('videoEvidence');
      scenarioKeys.add('reportInspection');
      scenarioKeys.add('prSpecificCoverage');
    }
  }
  return {
    eventName: process.env.GITHUB_EVENT_NAME || process.env.NIXMAC_E2E_PR_EVENT || '',
    number: process.env.NIXMAC_E2E_PR_NUMBER || process.env.GITHUB_PR_NUMBER || '',
    title: process.env.NIXMAC_E2E_PR_TITLE || '',
    headRef: process.env.NIXMAC_E2E_PR_HEAD_REF || process.env.GITHUB_HEAD_REF || '',
    baseRef: process.env.NIXMAC_E2E_PR_BASE_REF || process.env.GITHUB_BASE_REF || '',
    changedFiles,
    userVisibleFiles,
    scenarioKeys: [...scenarioKeys],
    configured: Boolean(process.env.NIXMAC_E2E_PR_NUMBER || process.env.GITHUB_PR_NUMBER || process.env.GITHUB_EVENT_NAME === 'pull_request'),
  };
}

function loadCoverageManifest() {
  return JSON.parse(readFileSync(COVERAGE_MANIFEST_PATH, 'utf8'));
}

function walkFiles(root) {
  const fullRoot = path.join(REPO_ROOT, root);
  if (!existsSync(fullRoot)) return [];
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(path.relative(REPO_ROOT, full).replaceAll(path.sep, '/'));
    }
  };
  visit(fullRoot);
  return files;
}

function matchesAny(value, patterns = []) {
  return patterns.some((pattern) => new RegExp(pattern).test(value));
}

function buildCoverageFreshness(state) {
  const manifest = loadCoverageManifest();
  const surfaces = manifest.surfaces || [];
  const coveredPrefixes = surfaces.flatMap((surface) => surface.sourcePrefixes || []);
  const drift = [];
  const waivers = [];
  let mapped = 0;

  for (const surface of surfaces) {
    const scenarioKeys = surface.scenarioKeys || [];
    const unknown = scenarioKeys.filter((key) => !state.scenarios[key]);
    const missingSources = (surface.sourcePrefixes || []).filter((sourcePath) => !sourcePath.endsWith('/') && !existsSync(path.join(REPO_ROOT, sourcePath)));
    if (surface.waiver) waivers.push({ id: surface.id, label: surface.label, reason: surface.waiver });
    if (unknown.length) drift.push(`${surface.id} maps to unknown scenarios: ${unknown.join(', ')}`);
    if (missingSources.length) drift.push(`${surface.id} references missing source files: ${missingSources.join(', ')}`);
    if (!scenarioKeys.length && !surface.waiver) drift.push(`${surface.id} has no scenario mapping and no waiver.`);
    if (scenarioKeys.length) mapped += 1;
  }

  const candidates = [...new Set((manifest.candidateRoots || []).flatMap((root) => walkFiles(root)))].filter(
    (file) => matchesAny(file, manifest.candidateIncludes) && !matchesAny(file, manifest.candidateExcludes),
  );
  const unmappedCandidateFiles = candidates.filter(
    (file) => !coveredPrefixes.some((prefix) => (prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix)),
  );
  if (unmappedCandidateFiles.length) drift.push(`Unmapped user-visible candidate files: ${unmappedCandidateFiles.join(', ')}`);

  return {
    manifestVersion: manifest.version,
    checkedAt: new Date().toISOString(),
    totalSurfaces: surfaces.length,
    mappedSurfaces: mapped,
    waivedSurfaces: waivers.length,
    candidateFiles: candidates.length,
    unmappedCandidateFiles,
    waivers,
    drift,
  };
}

function updateMainCoverageFreshness(state) {
  state.coverageFreshness = buildCoverageFreshness(state);
  const drift = state.coverageFreshness.drift || [];
  const waiverNote = state.coverageFreshness.waivers?.length
    ? ` Explicit waivers: ${state.coverageFreshness.waivers.map((item) => `${item.id}: ${item.reason}`).join(' | ')}`
    : '';
  updateScenario(
    state,
    'mainCoverageFreshness',
    drift.length ? 'fail' : 'pass',
    drift.length
      ? `Coverage drift detected against main: ${drift.join('; ')}${waiverNote}`
      : `Coverage manifest v${state.coverageFreshness.manifestVersion} maps ${state.coverageFreshness.totalSurfaces} user-visible surfaces to scenarios or explicit waivers.${waiverNote}`,
  );
}

function updatePrSpecificCoverage(state) {
  if (!state.prFocus?.configured) {
    updateScenario(state, 'prSpecificCoverage', 'pass', 'No PR metadata was provided, so the optional PR-specific focus lane was not applicable for this run.');
  } else if (!state.prFocus.changedFiles?.length) {
    updateScenario(state, 'prSpecificCoverage', 'inconclusive', 'PR metadata was provided, but changed-file metadata was not available.');
  } else if (!state.prFocus.userVisibleFiles?.length) {
    updateScenario(state, 'prSpecificCoverage', 'pass', 'Changed-file metadata did not infer user-visible app changes requiring a dedicated Computer Use focus pass.');
  } else if (state.prFocus.scenarioKeys?.length) {
    updateScenario(state, 'prSpecificCoverage', 'pass', `User-visible changed files were mapped to existing Computer Use scenarios and surfaced at the top of the report: ${state.prFocus.scenarioKeys.map((key) => state.scenarios[key]?.label || key).join(', ')}`);
  } else {
    updateScenario(state, 'prSpecificCoverage', 'inconclusive', `User-visible changed files were inferred, but no dedicated PR-specific Computer Use scenario has been executed yet: ${state.prFocus.userVisibleFiles.join(', ')}`);
  }
}

function ensureCurrentSchema(state) {
  state.scenarios ||= {};
  for (const [key, label] of Object.entries(scenarioLabels)) {
    if (!state.scenarios[key]) {
      state.scenarios[key] = {
        label,
        status: 'inconclusive',
        notes: [`Scenario was added after this run or was not exercised by this runner.`],
      };
    }
  }
  for (const [key, label] of Object.entries(scenarioLabels)) state.scenarios[key].label = label;
  state.claims ||= [];
  state.failures ||= [];
  state.narrative ||= [];
  state.confirmationBoundaries ||= [];
  state.screenshots ||= [];
  state.textSnapshots ||= [];
  state.video ||= { status: 'unavailable', note: 'No video status recorded.', path: null };
  state.cleanup ||= { attempted: false, restored: false, note: 'No cleanup status recorded.' };
  state.safety ||= {
    disposableConfig: process.env.NIXMAC_E2E_DISPOSABLE_CONFIG === 'true',
    buildConfirmEnabled: process.env.NIXMAC_E2E_ALLOW_BUILD_CONFIRM === 'true',
    discardConfirmEnabled: process.env.NIXMAC_E2E_ALLOW_DISCARD_CONFIRM === 'true',
    note: 'Discard/build confirmation is only allowed when disposable config mode is explicitly proven.',
  };
  state.prFocus ||= buildPrFocus();
  return state;
}

function artifactForLabel(items, label) {
  return items.find((item) => item.label === label || item.label === `HTML report inspection` && label === 'HTML report inspection') || null;
}

function proofForScenario(state, key) {
  const proof = scenarioProofCatalog[key] || {
    grade: 'insufficient',
    screenshots: [],
    texts: [],
    proof: 'No proof catalog entry has been defined for this scenario.',
    untested: 'Assertion quality has not been classified.',
  };
  const screenshotArtifacts = proof.screenshots.map((label) => artifactForLabel(state.screenshots, label)).filter(Boolean);
  const textArtifacts = proof.texts.map((label) => artifactForLabel(state.textSnapshots, label)).filter(Boolean);
  return { ...proof, screenshotArtifacts, textArtifacts };
}

function artifactLinks(state, key) {
  const proof = proofForScenario(state, key);
  return [...proof.screenshotArtifacts, ...proof.textArtifacts]
    .map((artifact) => `<code>${escapeHtml(artifact.path)}</code>`)
    .join('<br>') || 'No primary artifact linked.';
}

async function readTextExcerpt(state, artifact, maxLines = 10) {
  if (!artifact?.path) return '';
  const fullPath = path.join(state.runDir, artifact.path);
  if (!(await pathExists(fullPath))) return '';
  const text = redact(await readFile(fullPath, 'utf8'));
  return text
    .split('\n')
    .filter((line) => line.trim())
    .slice(0, maxLines)
    .join('\n')
    .slice(0, 1400);
}

function knownCoverageGaps(state) {
  const gaps = [];
  for (const [key, scenario] of Object.entries(state.scenarios)) {
    if (scenario.status !== 'pass') {
      gaps.push({
        label: scenario.label,
        status: scenario.status,
        detail: scenario.notes.join(' ') || 'No detail recorded.',
      });
    }
  }
  if (state.video?.status === 'available' && /evidence reel|screenshots/i.test(state.video.note || '')) {
    gaps.push({
      label: 'Continuous video recording',
      status: 'inconclusive',
      detail: 'Video is assembled from Computer Use screenshots, not a continuous window-bounded recording.',
    });
  }
  if (!state.remoteMacosVersion) {
    gaps.push({
      label: 'Remote Mac/app metadata',
      status: 'inconclusive',
      detail: 'Remote macOS/app version is not yet captured separately from the runner metadata.',
    });
  }
  if (!state.processEnvVerification) {
    gaps.push({
      label: 'Credential process-env verification',
      status: 'inconclusive',
      detail: 'The actual nixmac process environment is not yet recorded in the report.',
    });
  }
  if (!state.safety?.disposableConfig) {
    gaps.push({
      label: 'Disposable config proof',
      status: 'inconclusive',
      detail: 'Remote run has not proven nixmac is pointed at a per-run disposable config.',
    });
  }
  return gaps;
}

function buildAppearsActive(text) {
  return /Preparing rebuild|Starting system rebuild|Building the system configuration|Downloading .* from (Nix )?cache|Fetching .* from cache|Activating system changes/i.test(text || '');
}

function activationAuthRequired(text) {
  return /administrator privileges.*password|password when needed|administrator authentication required|incorrect administrator user name or password/i.test(text || '');
}

function remoteActivationPamSymlinkHang() {
  const result = ssh(
    "ps -axo pid=,ppid=,stat=,etime=,command= | awk '$2 != 1 && /ln -s \\/etc\\/static\\/pam\\.d\\/sudo_local \\/etc\\/pam\\.d\\/sudo_local/ && !/awk/ { print }'",
  );
  return result.ok && /ln -s .*\/etc\/static\/pam\.d\/sudo_local .*\/etc\/pam\.d\/sudo_local/.test(result.stdout || '');
}

function proofQualityIssues(state) {
  const issues = [];
  const sensitiveScreenshots = state.screenshots.filter((shot) => /settings-api-keys|console/i.test(shot.label || ''));
  for (const shot of sensitiveScreenshots) {
    issues.push(`Sensitive surface ${shot.label} has a screenshot artifact (${shot.path}); use redacted text only.`);
  }
  for (const [key, scenario] of Object.entries(state.scenarios)) {
    if (scenario.status !== 'pass') continue;
    if (['visualProofQuality', 'videoEvidence', 'mainCoverageFreshness'].includes(key)) continue;
    const proof = proofForScenario(state, key);
    if (proof.screenshotArtifacts.length === 0 && proof.textArtifacts.length === 0) {
      issues.push(`${scenario.label} has no linked screenshot or text artifact.`);
    }
    for (const artifact of proof.screenshotArtifacts) {
      const issue = imageArtifactIssue(state, artifact.path);
      if (issue) issues.push(`${scenario.label} references ${artifact.path}, but ${issue}.`);
    }
    for (const artifact of proof.textArtifacts) {
      const issue = artifactFileIssue(state, artifact.path);
      if (issue) issues.push(`${scenario.label} references ${artifact.path}, but ${issue}.`);
    }
  }
  return issues;
}

function artifactFileIssue(state, relativePath) {
  if (!relativePath) return 'artifact path is empty';
  try {
    const stats = statSync(path.join(state.runDir, relativePath));
    if (!stats.isFile()) return 'it is not a file';
    if (stats.size === 0) return 'the file is empty';
    return '';
  } catch {
    return 'the file is missing';
  }
}

function videoArtifactIssue(state) {
  if (state.video.status !== 'available') return state.video.note || 'video is unavailable';
  return artifactFileIssue(state, state.video.path);
}

function imageArtifactIssue(state, relativePath) {
  const baseIssue = artifactFileIssue(state, relativePath);
  if (baseIssue) return baseIssue;
  if (!/\.png$/i.test(relativePath)) return '';
  const fullPath = path.join(state.runDir, relativePath);
  const result = tryRun('ffmpeg', [
    '-hide_banner',
    '-i',
    fullPath,
    '-vf',
    'signalstats,metadata=print:file=-',
    '-frames:v',
    '1',
    '-f',
    'null',
    '-',
  ]);
  if (!result.ok) return `ffmpeg could not inspect the image (${result.stderr || result.error})`;
  const text = `${result.stdout}\n${result.stderr}`;
  const match = text.match(/lavfi\.signalstats\.YMAX=([0-9.]+)/);
  if (match && Number(match[1]) < 40) return 'the screenshot appears blank or visually occluded';
  return '';
}

function annotationClass(item) {
  return ['annotation', item.tone ? `annotation-${item.tone}` : ''].filter(Boolean).join(' ');
}

function renderAnnotatedImage(shot) {
  const annotations = screenshotAnnotations[shot.label] || [];
  const overlays = annotations
    .map(
      (item) => `<span class="${annotationClass(item)}" style="left:${item.x}%;top:${item.y}%;width:${item.w}%;height:${item.h}%"><span>${escapeHtml(item.label)}</span></span>`,
    )
    .join('\n');
  return `<div class="annotated-shot">
  <img src="${escapeHtml(shot.path)}" alt="${escapeHtml(shot.label)}">
  ${overlays}
</div>`;
}

async function renderVisualProofBoard(state) {
  const cards = [];
  for (const [key, scenario] of Object.entries(state.scenarios)) {
    const proof = proofForScenario(state, key);
    if (proof.screenshotArtifacts.length === 0 && proof.textArtifacts.length === 0) continue;
    const screenshots = proof.screenshotArtifacts
      .slice(0, 2)
      .map((shot) => `<figure>${renderAnnotatedImage(shot)}<figcaption><strong>${escapeHtml(shot.label)}</strong> - ${escapeHtml(shot.note || '')}</figcaption></figure>`)
      .join('\n');
    const excerpts = [];
    for (const artifact of proof.textArtifacts.slice(0, 2)) {
      const excerpt = await readTextExcerpt(state, artifact);
      if (excerpt) excerpts.push(`<details><summary>${escapeHtml(artifact.path)}</summary><pre>${escapeHtml(excerpt)}</pre></details>`);
    }
    cards.push(`<section class="proof-card">
  <h3>${escapeHtml(scenario.label)}</h3>
  <p><span class="verdict ${scenario.status}">${escapeHtml(scenario.status)}</span> <span class="grade">${escapeHtml(proof.grade)}</span></p>
  <p><strong>Assertion:</strong> ${escapeHtml(proof.proof)}</p>
  <p><strong>Not proved:</strong> ${escapeHtml(proof.untested)}</p>
  ${screenshots}
  ${excerpts.join('\n')}
</section>`);
  }
  return cards.length ? cards.join('\n') : '<p>No visual proof cards generated.</p>';
}

function renderCoverageGaps(state) {
  const gaps = knownCoverageGaps(state);
  if (!gaps.length) return '<p>No known coverage gaps recorded.</p>';
  return `<table>
    <thead><tr><th>Gap</th><th>Status</th><th>Detail</th></tr></thead>
    <tbody>
      ${gaps.map((gap) => `<tr><td>${escapeHtml(gap.label)}</td><td><span class="verdict ${gap.status}">${escapeHtml(gap.status)}</span></td><td>${escapeHtml(gap.detail)}</td></tr>`).join('\n')}
    </tbody>
  </table>`;
}

function renderPrFocus(state) {
  const pr = state.prFocus || buildPrFocus();
  const changed = pr.changedFiles?.length ? pr.changedFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('\n') : '<li>No changed-file metadata provided.</li>';
  const userVisible = pr.userVisibleFiles?.length ? pr.userVisibleFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join('\n') : '<li>No user-visible changed files inferred from current metadata.</li>';
  const scenarios = pr.scenarioKeys?.length ? pr.scenarioKeys.map((key) => `<li>${escapeHtml(state.scenarios?.[key]?.label || key)}</li>`).join('\n') : '<li>No dedicated scenario mapping inferred from changed files.</li>';
  return `<section class="panel">
    <p><strong>Configured:</strong> ${escapeHtml(String(Boolean(pr.configured)))}</p>
    <p><strong>PR:</strong> ${escapeHtml(pr.number || 'not provided')} ${pr.title ? `- ${escapeHtml(pr.title)}` : ''}</p>
    <p><strong>Refs:</strong> ${escapeHtml(pr.baseRef || 'base ?')} ← ${escapeHtml(pr.headRef || 'head ?')}</p>
    <h3>Changed Files</h3>
    <ul>${changed}</ul>
    <h3>User-Visible Focus Candidates</h3>
    <ul>${userVisible}</ul>
    <h3>Mapped Scenario Focus</h3>
    <ul>${scenarios}</ul>
  </section>`;
}

function scenarioRows(state, items) {
  if (!items.length) return '<tr><td colspan="5">None.</td></tr>';
  return items
    .map((item) => {
      const proof = proofForScenario(state, item.key);
      return `<tr><td>${escapeHtml(item.label)}<br><small>${item.notes.map(escapeHtml).join('<br>') || 'No notes recorded.'}</small></td><td><span class="verdict ${item.status}">${escapeHtml(item.status)}</span></td><td><span class="grade">${escapeHtml(proof.grade)}</span></td><td>${artifactLinks(state, item.key)}</td><td>${escapeHtml(proof.proof)}</td></tr>`;
    })
    .join('\n');
}

function scenariosWithStatus(state, status) {
  return Object.entries(state.scenarios)
    .filter(([, item]) => item.status === status)
    .map(([key, item]) => ({ key, ...item }));
}

function renderPriorityTriage(state) {
  const failed = scenariosWithStatus(state, 'fail');
  const inconclusive = scenariosWithStatus(state, 'inconclusive');
  const passed = scenariosWithStatus(state, 'pass');
  const table = (items) => `<table>
    <thead><tr><th>Scenario</th><th>Status</th><th>Evidence Grade</th><th>Primary Artifacts</th><th>What Proved It / Why It Matters</th></tr></thead>
    <tbody>${scenarioRows(state, items)}</tbody>
  </table>`;
  return `<section class="priority">
    <h3>Failures</h3>
    ${table(failed)}
    <h3>Inconclusive</h3>
    ${table(inconclusive)}
    <details>
      <summary>Passing Checks (${passed.length})</summary>
      ${table(passed)}
    </details>
  </section>`;
}

function renderPrPriority(state) {
  const pr = state.prFocus || buildPrFocus();
  if (!pr.configured) return '';
  const keys = pr.scenarioKeys?.length ? pr.scenarioKeys : ['prSpecificCoverage'];
  const evidenceRows = keys
    .filter((key) => state.scenarios[key])
    .map((key) => ({ key, ...state.scenarios[key] }))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));
  return `<h2>Pull Request Focus</h2>
  ${renderPrFocus(state)}
  <section class="panel">
    <h3>PR-Relevant Evidence</h3>
    <table>
      <thead><tr><th>Scenario</th><th>Status</th><th>Evidence Grade</th><th>Primary Artifacts</th><th>What Proved It</th></tr></thead>
      <tbody>${scenarioRows(state, evidenceRows)}</tbody>
    </table>
  </section>`;
}

function renderCoverageFreshness(state) {
  const coverage = state.coverageFreshness;
  if (!coverage) return '';
  const driftRows = coverage.drift?.length
    ? coverage.drift.map((item) => `<tr><td><span class="verdict fail">drift</span></td><td>${escapeHtml(item)}</td></tr>`).join('\n')
    : '<tr><td><span class="verdict pass">clean</span></td><td>No unmapped user-visible candidate files or manifest mapping errors detected.</td></tr>';
  const waiverRows = coverage.waivers?.length
    ? coverage.waivers.map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.reason)}</td></tr>`).join('\n')
    : '<tr><td colspan="3">No waivers recorded.</td></tr>';
  return `<h2>Main Coverage Freshness</h2>
  <section class="panel">
    <p><strong>Manifest v${escapeHtml(String(coverage.manifestVersion))}</strong>: ${escapeHtml(String(coverage.mappedSurfaces))}/${escapeHtml(String(coverage.totalSurfaces))} surfaces have direct scenario mappings; ${escapeHtml(String(coverage.waivedSurfaces))} have explicit waivers; ${escapeHtml(String(coverage.candidateFiles))} user-visible candidate files scanned.</p>
    <h3>Coverage Drift</h3>
    <table><thead><tr><th>Status</th><th>Detail</th></tr></thead><tbody>${driftRows}</tbody></table>
    <h3>Explicit Waivers</h3>
    <table><thead><tr><th>ID</th><th>Surface</th><th>Reason</th></tr></thead><tbody>${waiverRows}</tbody></table>
  </section>`;
}

async function baseState(runDir, options) {
  const branch = tryRun('git', ['branch', '--show-current'], { cwd: REPO_ROOT }).stdout || 'unknown';
  const sha = tryRun('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT }).stdout || 'unknown';
  const macosVersion =
    process.env.NIXMAC_E2E_MACOS_VERSION ||
    tryRun('sw_vers', ['-productVersion']).stdout ||
    'unknown';
  const scenarios = Object.fromEntries(
    Object.entries(scenarioLabels).map(([key, label]) => [
      key,
      { label, status: 'inconclusive', notes: [] },
    ]),
  );
  return {
    startedAt: new Date().toISOString(),
    runDir,
    ws: options.ws,
    app: options.app,
    prompt: options.prompt,
    branch,
    sha,
    macosVersion,
    appCommand: process.env.NIXMAC_E2E_APP_COMMAND || 'open -a /Applications/nixmac.app',
    provider: {
      kind: 'real-openrouter-compatible-provider',
      note: 'The key value is never written to this report. Failures may reflect provider billing/auth state.',
    },
    safety: {
      disposableConfig: process.env.NIXMAC_E2E_DISPOSABLE_CONFIG === 'true',
      buildConfirmEnabled: process.env.NIXMAC_E2E_ALLOW_BUILD_CONFIRM === 'true',
      discardConfirmEnabled: process.env.NIXMAC_E2E_ALLOW_DISCARD_CONFIRM === 'true',
      note: 'Discard/build confirmation is only allowed when disposable config mode is explicitly proven.',
    },
    prFocus: buildPrFocus(),
    video: { status: 'unavailable', note: 'Video has not been assembled yet.', path: null },
    cleanup: { attempted: false, restored: false, note: 'Cleanup has not run yet.' },
    screenshots: [],
    textSnapshots: [],
    events: [],
    claims: [],
    narrative: [],
    confirmationBoundaries: [],
    failures: [],
    scenarios,
  };
}

async function saveState(state) {
  await writeFile(path.join(state.runDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function addEvent(state, type, detail = {}) {
  state.events.push({ ts: new Date().toISOString(), type, ...detail });
  await writeFile(path.join(state.runDir, 'events.json'), `${JSON.stringify(state.events, null, 2)}\n`, 'utf8');
}

function updateScenario(state, key, status, note) {
  if (!state.scenarios[key]) throw new Error(`Unknown scenario ${key}`);
  state.scenarios[key].status = status;
  if (note) state.scenarios[key].notes.push(redact(note));
  const claim = {
    claim: state.scenarios[key].label,
    status,
    evidence: redact(note || 'See Computer Use screenshots and text snapshots.'),
  };
  const existing = state.claims.find((item) => item.claim === claim.claim);
  if (existing) Object.assign(existing, claim);
  else state.claims.push(claim);
}

function addNarrative(state, text) {
  state.narrative.push({ ts: new Date().toISOString(), text: redact(text) });
}

class AppServerClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
    this.threadId = null;
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message);
    };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${this.url}`)), 10000);
      this.ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`WebSocket error connecting to ${this.url}`));
      };
    });
    await this.request('initialize', {
      clientInfo: { name: 'nixmac-remote-computer-use-e2e', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    const thread = await this.request('thread/start', {
      cwd: '/tmp',
      model: 'gpt-5.4-mini',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      ephemeral: true,
    });
    this.threadId = thread.result.thread.id;
  }

  request(method, params = {}, timeout = 60000) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  tool(tool, args = {}, timeout = 60000) {
    return this.request(
      'mcpServer/tool/call',
      { server: 'computer-use', threadId: this.threadId, tool, arguments: args },
      timeout,
    );
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function contentText(response) {
  return response?.result?.content?.find((item) => item.type === 'text')?.text ?? '';
}

function contentImage(response) {
  return response?.result?.content?.find((item) => item.type === 'image')?.data ?? '';
}

async function captureState(client, state, label, note = '') {
  let response = await client.tool('get_app_state', { app: state.app }, 90000);
  let text = redact(contentText(response));
  for (let attempt = 0; attempt < 8 && /procNotFound|no eligible process|not running|timed out/i.test(text); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    response = await client.tool('get_app_state', { app: state.app }, 90000);
    text = redact(contentText(response));
  }
  const image = contentImage(response);
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const ordinal = String(state.textSnapshots.length + 1).padStart(2, '0');
  const textPath = path.join(state.runDir, 'texts', `${ordinal}-${safeLabel}.txt`);
  await writeFile(textPath, `${text}\n`, 'utf8');
  state.textSnapshots.push({
    label,
    path: path.relative(state.runDir, textPath),
    capturedAt: new Date().toISOString(),
    note: redact(note),
  });
  const sensitiveImage = /api-keys|console/i.test(label);
  if (image && !sensitiveImage) {
    const pngPath = path.join(state.runDir, 'screenshots', `${ordinal}-${safeLabel}.png`);
    await writeFile(pngPath, Buffer.from(image, 'base64'));
    state.screenshots.push({
      label,
      path: path.relative(state.runDir, pngPath),
      capturedAt: new Date().toISOString(),
      note: redact(note),
      source: 'Codex Computer Use get_app_state image',
    });
  } else if (image && sensitiveImage) {
    await addEvent(state, 'computer-use.screenshot-omitted', {
      label,
      reason: 'Sensitive view image omitted from artifact/video; redacted accessibility text snapshot retained.',
    });
  }
  if (note) addNarrative(state, note);
  await addEvent(state, 'computer-use.capture', { label, note: redact(note) });
  await saveState(state);
  return text;
}

async function clickByPattern(client, state, text, label, patterns, note = '') {
  const elementIndex = findElement(text, patterns);
  if (!elementIndex) {
    await addEvent(state, 'computer-use.click.skipped', { label, note: `No element found for ${label}` });
    return false;
  }
  const response = await client.tool('click', { app: state.app, element_index: elementIndex }, 60000);
  const responseText = redact(contentText(response));
  await addEvent(state, 'computer-use.click', { label, elementIndex, response: responseText.slice(0, 800), note });
  return true;
}

async function setValueByPattern(client, state, text, label, patterns, value) {
  const elementIndex = findElement(text, patterns);
  if (!elementIndex) {
    await addEvent(state, 'computer-use.set_value.skipped', { label, note: `No element found for ${label}` });
    return false;
  }
  const response = await client.tool('set_value', { app: state.app, element_index: elementIndex, value }, 60000);
  const responseText = redact(contentText(response));
  await addEvent(state, 'computer-use.set_value', { label, elementIndex, response: responseText.slice(0, 800) });
  return true;
}

async function waitFor(client, state, label, predicate, { attempts = 10, delayMs = 1500 } = {}) {
  let lastText = '';
  for (let i = 0; i < attempts; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    lastText = await captureState(client, state, `${label}-${String(i + 1).padStart(2, '0')}`, `Polling ${label}.`);
    const result = predicate(lastText);
    if (result) return { ok: true, text: lastText, result };
  }
  return { ok: false, text: lastText };
}

async function maybeRelaunchRemote(state) {
  if (process.env.NIXMAC_E2E_SKIP_RELAUNCH === 'true') {
    await addEvent(state, 'remote.relaunch.skipped', {
      reason: 'NIXMAC_E2E_SKIP_RELAUNCH=true; caller is responsible for launching nixmac.',
    });
    return;
  }
  const dest = process.env.NIXMAC_E2E_REMOTE_SSH_DEST;
  if (!dest) return;
  const result = ssh(
    "osascript -e 'tell application id \"com.darkmatter.nixmac\" to quit' >/dev/null 2>&1 || true; sleep 1; open -a /Applications/nixmac.app; sleep 5",
  );
  await addEvent(state, 'remote.relaunch', {
    ok: result.ok,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr),
  });
}

async function inspectReportWithComputerUse(client, state) {
  const dest = process.env.NIXMAC_E2E_REMOTE_SSH_DEST;
  const remoteParent = process.env.NIXMAC_E2E_REMOTE_REPORT_DIR || '/tmp/nixmac-computer-use-reports';
  const remoteDir = `${remoteParent}/${path.basename(state.runDir)}`;
  if (!dest) {
    updateScenario(state, 'reportInspection', 'inconclusive', 'No remote SSH destination was set, so the report could not be copied to the Computer Use Mac for browser inspection.');
    return;
  }

  const mkdirResult = ssh(`rm -rf ${shellQuote(remoteDir)} && mkdir -p ${shellQuote(remoteParent)}`);
  if (!mkdirResult.ok) {
    updateScenario(state, 'reportInspection', 'inconclusive', `Could not create remote report directory: ${mkdirResult.stderr}`);
    return;
  }
  const copyResult = scpToRemote(state.runDir, remoteParent);
  if (!copyResult.ok) {
    updateScenario(state, 'reportInspection', 'inconclusive', `Could not copy report to remote Mac: ${copyResult.stderr}`);
    return;
  }
  const remoteIndex = `${remoteDir}/index.html`;
  const openResult = ssh(`open -a "Google Chrome" ${shellQuote(`file://${remoteIndex}`)} || open ${shellQuote(`file://${remoteIndex}`)}; sleep 2`);
  await addEvent(state, 'report.remote-open', {
    ok: openResult.ok,
    stdout: redact(openResult.stdout),
    stderr: redact(openResult.stderr),
    remoteIndex,
  });
  const browserApps = ['com.google.Chrome', 'Safari', 'com.apple.Safari'];
  for (const app of browserApps) {
    try {
      const response = await client.tool('get_app_state', { app }, 60000);
      const text = redact(contentText(response));
      if (/nixmac Computer Use|Scenario Checklist|Claims vs Evidence|Failures \/ Open Issues/i.test(text)) {
        const label = `report-inspection-${app.replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
        const image = contentImage(response);
        const ordinal = String(state.screenshots.length + 1).padStart(2, '0');
        const textPath = path.join(state.runDir, 'texts', `${ordinal}-${label}.txt`);
        await writeFile(textPath, `${text}\n`, 'utf8');
        if (image) {
          const pngPath = path.join(state.runDir, 'screenshots', `${ordinal}-${label}.png`);
          await writeFile(pngPath, Buffer.from(image, 'base64'));
          state.screenshots.push({
            label: 'HTML report inspection',
            path: path.relative(state.runDir, pngPath),
            capturedAt: new Date().toISOString(),
            note: `Computer Use inspected the generated report in ${app}.`,
            source: 'Codex Computer Use get_app_state image',
          });
        }
        state.textSnapshots.push({
          label: 'HTML report inspection',
          path: path.relative(state.runDir, textPath),
          capturedAt: new Date().toISOString(),
          note: `Computer Use inspected the generated report in ${app}.`,
        });
        updateScenario(state, 'reportInspection', 'pass', `Computer Use inspected the generated report in ${app}; report text and evidence sections were visible.`);
        addNarrative(state, `Computer Use inspected the generated HTML report in ${app} on the remote Mac.`);
        return;
      }
    } catch (error) {
      await addEvent(state, 'report.browser-inspection-error', { app, error: redact(error instanceof Error ? error.message : String(error)) });
    }
  }
  updateScenario(state, 'reportInspection', 'fail', 'Computer Use could not observe the report in Chrome or Safari after opening it on the remote Mac.');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function decodeBase64(value = '') {
  if (!value) return '';
  return Buffer.from(value, 'base64').toString('utf8').trim();
}

function parseKeyValueLines(stdout = '') {
  const parsed = {};
  for (const line of stdout.split('\n')) {
    const index = line.indexOf('=');
    if (index === -1) continue;
    parsed[line.slice(0, index)] = line.slice(index + 1);
  }
  return parsed;
}

function remoteConfigDirFromSettings() {
  if (process.env.NIXMAC_E2E_REMOTE_CONFIG_DIR) return process.env.NIXMAC_E2E_REMOTE_CONFIG_DIR;
  const script = [
    'import json, os',
    'p=os.path.join(os.environ["HOME"], "Library/Application Support/com.darkmatter.nixmac", "settings.json")',
    'with open(p, encoding="utf-8") as f: settings=json.load(f)',
    'print(settings.get("configDir", ""))',
  ].join('; ');
  const result = ssh(`/usr/bin/python3 -c ${shellQuote(script)}`);
  return result.ok ? result.stdout.trim() : '';
}

function remoteGitSnapshot(configDir, baselineHead = '') {
  if (!configDir) return { ok: false, error: 'No remote configDir available.' };
  const command = [
    `CONFIG_DIR=${shellQuote(configDir)}`,
    `BASELINE=${shellQuote(baselineHead)}`,
    'cd "$CONFIG_DIR"',
    'printf "HEAD="; git rev-parse HEAD',
    'printf "STATUS_B64="; git status --porcelain=v1 | base64 | tr -d "\\n"; printf "\\n"',
    'printf "DIFF_B64="; git diff --name-only | base64 | tr -d "\\n"; printf "\\n"',
    'if [ -n "$BASELINE" ]; then printf "BASELINE_DIFF_B64="; git diff --name-only "$BASELINE" HEAD | base64 | tr -d "\\n"; printf "\\n"; fi',
    'if git grep -q -E "(^|[^A-Za-z])bat([^A-Za-z]|$)" HEAD -- . >/dev/null 2>&1; then echo "CONTAINS_BAT=true"; else echo "CONTAINS_BAT=false"; fi',
  ].join('; ');
  const result = ssh(command);
  if (!result.ok) return { ok: false, error: result.stderr || result.stdout || result.error || 'Remote git snapshot failed.' };
  const parsed = parseKeyValueLines(result.stdout);
  return {
    ok: true,
    configDir,
    head: parsed.HEAD || '',
    statusShort: decodeBase64(parsed.STATUS_B64),
    diffNameOnly: decodeBase64(parsed.DIFF_B64),
    baselineDiffNameOnly: decodeBase64(parsed.BASELINE_DIFF_B64),
    containsBat: parsed.CONTAINS_BAT === 'true',
  };
}

function meaningfulBaselineDiff(snapshot) {
  return String(snapshot?.baselineDiffNameOnly || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== 'result')
    .join('\n');
}

async function addRemoteGitEvent(state, type, snapshot) {
  await addEvent(state, type, {
    ok: Boolean(snapshot?.ok),
    configDir: snapshot?.configDir || '',
    head: snapshot?.head || '',
    statusShort: redact(snapshot?.statusShort || ''),
    diffNameOnly: redact(snapshot?.diffNameOnly || ''),
    baselineDiffNameOnly: redact(snapshot?.baselineDiffNameOnly || ''),
    containsBat: Boolean(snapshot?.containsBat),
    error: redact(snapshot?.error || ''),
  });
}

async function waitForRemoteGit(state, label, predicate, { attempts = 20, delayMs = 1500 } = {}) {
  let snapshot = null;
  const configDir = state.remoteConfig?.configDir || remoteConfigDirFromSettings();
  for (let i = 0; i < attempts; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    snapshot = remoteGitSnapshot(configDir, state.remoteConfig?.baselineHead || '');
    await addRemoteGitEvent(state, `remote.git.${label}.${String(i + 1).padStart(2, '0')}`, snapshot);
    if (predicate(snapshot)) return { ok: true, snapshot };
  }
  return { ok: false, snapshot };
}

async function prepareDisposableRemoteBaseline(state) {
  const canConfirmBuild = state.safety?.disposableConfig === true && state.safety?.buildConfirmEnabled === true;
  if (!canConfirmBuild) {
    await addEvent(state, 'remote.git.baseline.skipped', {
      reason: 'Build confirmation is not enabled for a proven disposable config.',
      disposableConfig: Boolean(state.safety?.disposableConfig),
      buildConfirmEnabled: Boolean(state.safety?.buildConfirmEnabled),
    });
    return null;
  }
  const configDir = remoteConfigDirFromSettings();
  if (!configDir) {
    await addEvent(state, 'remote.git.baseline.skipped', { reason: 'No remote configDir could be resolved from env/settings.' });
    return null;
  }
  const initial = remoteGitSnapshot(configDir);
  await addRemoteGitEvent(state, 'remote.git.initial', initial);
  if (!initial.ok) return null;

  const markerResult = ssh(
    [
      `cd ${shellQuote(configDir)}`,
      'git config user.name "nixmac E2E"',
      'git config user.email "nixmac-e2e@example.invalid"',
      'git add -A',
      'git commit --allow-empty -m "nixmac e2e restore baseline" >/dev/null',
    ].join('; '),
  );
  await addEvent(state, 'remote.git.baseline-commit', {
    ok: markerResult.ok,
    stdout: redact(markerResult.stdout),
    stderr: redact(markerResult.stderr),
  });
  if (!markerResult.ok) return null;

  const baseline = remoteGitSnapshot(configDir);
  await addRemoteGitEvent(state, 'remote.git.baseline', baseline);
  if (baseline.ok && !baseline.statusShort) {
    state.remoteConfig = {
      configDir,
      initialHead: initial.head,
      baselineHead: baseline.head,
      baselinePrepared: true,
    };
    await saveState(state);
  } else if (baseline.ok) {
    await addEvent(state, 'remote.git.baseline.dirty', {
      reason: 'Disposable baseline was created but the worktree was not clean.',
      statusShort: redact(baseline.statusShort || ''),
    });
  }
  return baseline;
}

async function assembleVideo(state) {
  const ffmpeg = tryRun('which', ['ffmpeg']);
  if (!ffmpeg.ok) {
    state.video = { status: 'unavailable', path: null, note: `ffmpeg unavailable: ${ffmpeg.stderr || ffmpeg.error || 'not found'}` };
    return;
  }
  if (state.screenshots.length < 2) {
    state.video = { status: 'unavailable', path: null, note: 'Not enough Computer Use screenshots to assemble a video.' };
    return;
  }
  const concatPath = path.join(state.runDir, 'video', 'frames.txt');
  const lines = state.screenshots
    .filter((shot) => shot.path.endsWith('.png'))
    .map((shot) => `file '${path.join(state.runDir, shot.path).replaceAll("'", "'\\''")}'\nduration 1`)
    .join('\n');
  await writeFile(concatPath, `${lines}\n`, 'utf8');
  const videoPath = path.join(state.runDir, 'video', 'computer-use-evidence.mp4');
  const result = tryRun('ffmpeg', [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    '-r',
    '30',
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
    '-movflags',
    '+faststart',
    videoPath,
  ]);
  if (!result.ok) {
    state.video = {
      status: 'unavailable',
      path: null,
      note: `ffmpeg failed to assemble Computer Use evidence video: ${redact(result.stderr || result.error)}`,
    };
    return;
  }
  state.video = {
    status: 'available',
    path: path.relative(state.runDir, videoPath),
    note: 'Video assembled at 30 fps from Computer Use screenshots. This is an evidence reel, not a continuous screen recording.',
  };
}

async function render(state, { stateFileName = 'state.json', recordEvent = true } = {}) {
  ensureCurrentSchema(state);
  const verdict = verdictFor(state);
  state.verdict = verdict;
  state.claims = Object.values(state.scenarios).map((scenario) => ({
    claim: scenario.label,
    status: scenario.status,
    evidence: scenario.notes.join(' ') || 'See proof artifacts and coverage gaps.',
  }));
  const failures = Object.entries(state.scenarios)
    .filter(([, item]) => item.status !== 'pass')
    .map(([key, item]) => ({ key, ...item }));
  const coverageFreshnessHtml = renderCoverageFreshness(state);
  const screenshotHtml = state.screenshots.length
    ? state.screenshots
        .map(
          (shot) => `<figure>
  <img src="${escapeHtml(shot.path)}" alt="${escapeHtml(shot.label)}">
  <figcaption><strong>${escapeHtml(shot.label)}</strong> - ${escapeHtml(shot.note || 'No note')} (${escapeHtml(shot.capturedAt)})</figcaption>
</figure>`,
        )
        .join('\n')
    : '<p>No screenshots captured.</p>';
  const videoHtml =
    state.video.status === 'available' && state.video.path
      ? `<video controls src="${escapeHtml(state.video.path)}"></video><p>${escapeHtml(state.video.note)}</p>`
      : `<p><strong>Unavailable.</strong> ${escapeHtml(state.video.note || 'No video status recorded.')}</p>`;
  const counts = statusCounts(state);
  const groupedScenarioHtml = groupedScenarios(state)
    .map(
      (group) => `<section class="group">
  <h3>${escapeHtml(group.name)}</h3>
  <table>
    <thead><tr><th>Scenario</th><th>Status</th><th>Evidence Grade</th><th>Primary Artifacts</th><th>What Proved It</th><th>Still Untested</th></tr></thead>
    <tbody>
      ${group.items
        .map((item) => {
          const proof = proofForScenario(state, item.key);
          return `<tr><td>${escapeHtml(item.label)}<br><small>${item.notes.map(escapeHtml).join('<br>') || 'No notes recorded.'}</small></td><td><span class="verdict ${item.status}">${escapeHtml(item.status)}</span></td><td><span class="grade">${escapeHtml(proof.grade)}</span></td><td>${artifactLinks(state, item.key)}</td><td>${escapeHtml(proof.proof)}</td><td>${escapeHtml(proof.untested)}</td></tr>`;
        })
        .join('\n')}
    </tbody>
  </table>
</section>`,
    )
    .join('\n');
  const evidenceSummary = `${state.screenshots.length} screenshots, ${state.textSnapshots.length} text snapshots, video ${state.video.status}`;
  const coverageGapsHtml = renderCoverageGaps(state);
  const prFocusHtml = renderPrFocus(state);
  const prPriorityHtml = renderPrPriority(state);
  const priorityTriageHtml = renderPriorityTriage(state);
  const visualProofHtml = await renderVisualProofBoard(state);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>nixmac Computer Use E2E Evidence</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #111318; color: #eef1f5; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 56px; }
    h1, h2, h3 { margin: 0 0 12px; }
    h1 { font-size: 28px; letter-spacing: 0; }
    h2 { font-size: 18px; margin-top: 30px; letter-spacing: 0; }
    h3 { font-size: 15px; margin-top: 18px; color: #f6f8fb; letter-spacing: 0; }
    p, li { color: #c5cbd3; line-height: 1.5; }
    .lede { max-width: 850px; color: #d9dee6; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 18px 0; }
    .panel { border: 1px solid #303640; border-radius: 8px; padding: 14px; background: #171a21; overflow-wrap: anywhere; }
    .metric { border: 1px solid #303640; border-radius: 8px; padding: 14px; background: #171a21; }
    .metric strong { display: block; font-size: 28px; color: #fff; margin-bottom: 4px; }
    .verdict { display: inline-block; border-radius: 999px; padding: 5px 10px; font-weight: 700; text-transform: uppercase; }
    .pass { background: #123d2a; color: #8bf0bb; }
    .fail { background: #471a1a; color: #ff9e9e; }
    .inconclusive { background: #443512; color: #ffd36e; }
    .group { margin-top: 18px; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 8px; }
    th, td { border: 1px solid #303640; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #20242d; }
    img, video { width: 100%; max-width: 100%; border: 1px solid #303640; border-radius: 8px; background: #000; }
    small { color: #9ba3ae; }
    pre { max-height: 280px; overflow: auto; white-space: pre-wrap; border: 1px solid #303640; border-radius: 8px; padding: 10px; background: #0d0f14; color: #dce3ec; }
    details { margin: 10px 0; }
    summary { cursor: pointer; color: #a7d7ff; }
    details > summary { font-weight: 700; margin: 12px 0; }
    .grade { display: inline-block; border: 1px solid #3c4654; border-radius: 999px; padding: 4px 8px; color: #dce3ec; background: #20242d; font-size: 12px; }
    .priority table { margin-bottom: 18px; }
    .proof-card { margin-top: 18px; border: 1px solid #303640; border-radius: 8px; padding: 14px; background: #151922; }
    .annotated-shot { position: relative; overflow: hidden; border: 1px solid #303640; border-radius: 8px; background: #000; }
    .annotated-shot img { display: block; border: 0; border-radius: 0; }
    .annotation { position: absolute; box-sizing: border-box; border: 1.5px solid rgba(255, 214, 94, 0.95); border-radius: 5px; background: rgba(255, 214, 94, 0.10); box-shadow: inset 0 0 0 1px rgba(20, 19, 13, 0.35), 0 8px 24px rgba(0,0,0,0.28); pointer-events: none; }
    .annotation::after { content: ""; position: absolute; inset: -4px; border: 1px solid rgba(255, 214, 94, 0.28); border-radius: 8px; }
    .annotation span { position: absolute; left: 6px; top: 6px; max-width: min(260px, calc(100% - 12px)); border-radius: 4px; padding: 3px 6px; background: rgba(255, 214, 94, 0.95); color: #111318; font-size: 12px; line-height: 1.15; font-weight: 700; white-space: normal; box-shadow: 0 2px 8px rgba(0,0,0,0.22); }
    .annotation-pin { border-radius: 999px; }
    .annotation-pin span { left: 50%; top: -28px; transform: translateX(-50%); white-space: nowrap; max-width: none; }
    figure { margin: 0 0 18px; }
    figcaption { margin-top: 6px; color: #c5cbd3; font-size: 13px; }
    code { color: #a7d7ff; overflow-wrap: anywhere; }
    ul { padding-left: 20px; }
  </style>
</head>
<body>
<main>
  <h1>nixmac Computer Use E2E Evidence</h1>
  <p class="lede">Remote desktop QA driven through Codex Computer Use against the real macOS app. The report summarizes major feature coverage, functional UX/UI checks, screenshots, and a generated evidence video.</p>
  <p><span class="verdict ${verdict}">Verdict: ${verdict}</span></p>

  <section class="summary" aria-label="Run summary">
    <div class="metric"><strong>${counts.pass}</strong>Passed</div>
    <div class="metric"><strong>${counts.fail}</strong>Failed</div>
    <div class="metric"><strong>${counts.inconclusive}</strong>Inconclusive</div>
    <div class="metric"><strong>${escapeHtml(String(state.screenshots.length))}</strong>Screenshots</div>
    <div class="metric"><strong>${escapeHtml(state.video.status)}</strong>Video</div>
  </section>

  ${prPriorityHtml}

  <h2>Findings First</h2>
  <p>Failures are shown first, then inconclusive checks, then passing checks. The full grouped checklist and visual proof board remain below.</p>
  ${priorityTriageHtml}

  ${coverageFreshnessHtml}

  <section class="meta">
    <div class="panel"><strong>Timestamp</strong><br>${escapeHtml(state.startedAt)}</div>
    <div class="panel"><strong>Branch</strong><br>${escapeHtml(state.branch)}</div>
    <div class="panel"><strong>SHA</strong><br><code>${escapeHtml(state.sha)}</code></div>
    <div class="panel"><strong>macOS</strong><br>${escapeHtml(state.macosVersion)}</div>
    <div class="panel"><strong>App</strong><br><code>${escapeHtml(state.app)}</code></div>
    <div class="panel"><strong>App Command</strong><br><code>${escapeHtml(state.appCommand)}</code></div>
    <div class="panel"><strong>Provider</strong><br><code>${escapeHtml(state.provider.kind)}</code><br>${escapeHtml(state.provider.note)}</div>
    <div class="panel"><strong>Prompt</strong><br>${escapeHtml(state.prompt)}</div>
    <div class="panel"><strong>Evidence</strong><br>${escapeHtml(evidenceSummary)}</div>
  </section>

  <h2>Video</h2>
  ${videoHtml}

  <h2>Scenario Checklist</h2>
  ${groupedScenarioHtml}

  <h2>Coverage Gaps / Not Proved</h2>
  ${coverageGapsHtml}

  <h2>PR-Specific Focus</h2>
  ${prFocusHtml}

  <h2>Visual Proof Board</h2>
  <p>Annotations are reviewer aids, not the sole assertion source. The pass/fail source of truth is the paired Computer Use accessibility text and recorded action events.</p>
  ${visualProofHtml}

  <h2>Screenshots</h2>
  ${screenshotHtml}

  <h2>Human QA Narrative</h2>
  ${
    state.narrative.length
      ? `<ul>${state.narrative.map((item) => `<li>${escapeHtml(item.ts)} - ${escapeHtml(item.text)}</li>`).join('\n')}</ul>`
      : '<p>No narrative recorded.</p>'
  }

  <h2>Claims vs Evidence</h2>
  <table>
    <thead><tr><th>Claim</th><th>Status</th><th>Evidence</th></tr></thead>
    <tbody>
      ${
        state.claims.length
          ? state.claims
              .map((claim) => `<tr><td>${escapeHtml(claim.claim)}</td><td><span class="verdict ${claim.status}">${escapeHtml(claim.status)}</span></td><td>${escapeHtml(claim.evidence)}</td></tr>`)
              .join('\n')
          : '<tr><td colspan="3">No claims recorded.</td></tr>'
      }
    </tbody>
  </table>

  <h2>Failures / Open Issues</h2>
  ${
    failures.length
      ? `<ul>${failures.map((failure) => `<li><strong>${escapeHtml(failure.status)}:</strong> ${escapeHtml(failure.label)} - ${escapeHtml(failure.notes.join(' ') || 'No detail recorded.')}</li>`).join('\n')}</ul>`
      : '<p>None recorded.</p>'
  }

  <h2>Confirmation Boundaries</h2>
  ${
    state.confirmationBoundaries.length
      ? `<ul>${state.confirmationBoundaries.map((boundary) => `<li>${escapeHtml(boundary)}</li>`).join('\n')}</ul>`
      : '<p>None recorded.</p>'
  }

  <h2>Cleanup / Restore Status</h2>
  <p>${escapeHtml(state.cleanup.note)}</p>
</main>
</body>
</html>
`;
  await writeFile(path.join(state.runDir, 'index.html'), html, 'utf8');
  if (stateFileName === 'state.json') await saveState(state);
  else await writeFile(path.join(state.runDir, stateFileName), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  if (recordEvent) await addEvent(state, 'report.rendered', { path: 'index.html', verdict });
}

async function runSuite(args) {
  const options = {
    ws: process.env.NIXMAC_COMPUTER_USE_WS || DEFAULT_WS,
    app: process.env.NIXMAC_COMPUTER_USE_APP || DEFAULT_APP,
    prompt: argValue(args, '--prompt', process.env.NIXMAC_E2E_PROMPT || DEFAULT_PROMPT),
  };
  const runDir = argValue(args, '--run-dir', path.join(ARTIFACT_ROOT, timestampSlug()));
  await mkdir(path.join(runDir, 'screenshots'), { recursive: true });
  await mkdir(path.join(runDir, 'texts'), { recursive: true });
  await mkdir(path.join(runDir, 'video'), { recursive: true });
  const state = await baseState(runDir, options);
  await saveState(state);

  const client = new AppServerClient(options.ws);
  try {
    await client.connect();
    await prepareDisposableRemoteBaseline(state);
    await maybeRelaunchRemote(state);

    let text = await captureState(client, state, 'launch', 'Computer Use observed the nixmac window at launch.');
    if (/nixmac/i.test(text) && hasAny(text, [/button Settings/i, /text entry area/i, /Get started/i, /Progress: step 1 of 3/i])) {
      updateScenario(state, 'launch', 'pass', 'Computer Use saw the nixmac app window, prompt surface, progress stepper, and top-level controls.');
    } else {
      updateScenario(state, 'launch', 'fail', 'Computer Use did not see a usable nixmac app window.');
    }

    const updateDismissed = await clickByPattern(client, state, text, 'Dismiss update banner', [/button Dismiss/i], 'Dismiss update/error banner if present.');
    if (updateDismissed) {
      text = await captureState(client, state, 'after-dismiss', 'Computer Use clicked a visible Dismiss button.');
      updateScenario(state, 'updateBanner', 'pass', 'A visible Dismiss button was clicked and the UI remained usable.');
    } else {
      updateScenario(state, 'updateBanner', 'pass', 'No dismissible update banner was visible; no banner blocked the main workflow.');
    }

    const settingsOpened = await clickByPattern(client, state, text, 'Settings', [/button Settings/i], 'Open Settings.');
    text = await captureState(client, state, 'settings-general', 'Computer Use opened Settings.');
    if (settingsOpened && /Settings|General/i.test(text)) {
      updateScenario(state, 'settingsGeneral', 'pass', 'Settings opened and General-related content was visible.');
    } else {
      updateScenario(state, 'settingsGeneral', 'fail', 'Computer Use could not open Settings General.');
    }

    if (await clickByPattern(client, state, text, 'AI Models tab', [/AI Models/i], 'Open AI Models settings.')) {
      text = await captureState(client, state, 'settings-ai-models', 'Computer Use opened AI Models settings.');
      updateScenario(state, 'settingsAIModels', /AI Models|Provider|Model|Max Build Attempts/i.test(text) ? 'pass' : 'fail', /AI Models|Provider|Model|Max Build Attempts/i.test(text) ? 'AI Models settings content was visible with provider/model controls.' : 'AI Models tab did not visibly render expected content.');
    }

    if (await clickByPattern(client, state, text, 'API Keys tab', [/API Keys/i], 'Open API Keys settings.')) {
      const apiWait = await waitFor(
        client,
        state,
        'settings-api-keys',
        (candidate) => (/API Keys|OpenRouter|API key|Add key|Provider|No API key/i.test(candidate) ? 'rendered' : null),
        { attempts: 5, delayMs: 1000 },
      );
      text = apiWait.text;
      updateScenario(
        state,
        'settingsAPIKeys',
        apiWait.ok ? 'pass' : 'fail',
        apiWait.ok
          ? 'API Keys content was visible after Computer Use polling, including OpenRouter/API key controls.'
          : 'API Keys stayed blank or exposed only an empty WebView accessibility tree after polling.',
      );
    }

    if (state.scenarios.settingsAPIKeys.status === 'fail') {
      await maybeRelaunchRemote(state);
      text = await captureState(client, state, 'recover-after-api-keys', 'Relaunched after API Keys blank-screen reproduction so the rest of the suite could continue.');
      await clickByPattern(client, state, text, 'Settings after recovery', [/button Settings/i], 'Reopen Settings after recovery.');
      text = await captureState(client, state, 'settings-after-recovery', 'Computer Use reopened Settings after recovery.');
    }

    if (await clickByPattern(client, state, text, 'Preferences tab', [/Preferences/i], 'Open Preferences settings.')) {
      text = await captureState(client, state, 'settings-preferences', 'Computer Use opened Preferences settings.');
      updateScenario(state, 'settingsPreferences', /Preferences|Confirm|Build|Clear|Discard|Diagnostics/i.test(text) ? 'pass' : 'fail', /Preferences|Confirm|Build|Clear|Discard|Diagnostics/i.test(text) ? 'Preferences settings content was visible with confirmation controls.' : 'Preferences tab did not visibly render expected content.');
    } else {
      updateScenario(state, 'settingsPreferences', 'inconclusive', 'Preferences tab was not found in the current Settings tree.');
    }

    await clickByPattern(client, state, text, 'Close settings', [/button Close/i, /^button ×/i, /^button X/i], 'Close Settings.');
    text = await captureState(client, state, 'home-after-settings', 'Computer Use returned to the main app surface after Settings coverage.');

    if (await clickByPattern(client, state, text, 'History', [/button History/i], 'Open My History.')) {
      text = await captureState(client, state, 'history', 'Computer Use opened History.');
      updateScenario(state, 'history', /History|Empty|No history|changes/i.test(text) ? 'pass' : 'fail', /History|Empty|No history|changes/i.test(text) ? 'History rendered a visible state.' : 'History did not visibly render expected content.');
      const closedHistory = await clickByPattern(client, state, text, 'Close history', [/button Close/i, /^button ×/i, /^button X/i], 'Close History.');
      if (!closedHistory && /heading History/i.test(text)) {
        await clickByPattern(client, state, text, 'Toggle history closed', [/button History/i], 'Toggle History closed to return to the prompt surface.');
      }
      text = await captureState(client, state, 'home-after-history', 'Computer Use returned home after History.');
    }

    if (await clickByPattern(client, state, text, 'Console', [/Console/i], 'Open Console.')) {
      text = await captureState(client, state, 'console', 'Computer Use opened Console.');
      updateScenario(state, 'console', /Console|log|Error|Info|Debug/i.test(text) ? 'pass' : 'fail', /Console|log|Error|Info|Debug/i.test(text) ? 'Console rendered visible content.' : 'Console did not visibly render expected content.');
      await clickByPattern(client, state, text, 'Close console', [/button Close/i, /^button ×/i, /^button X/i], 'Close Console.');
      text = await captureState(client, state, 'home-after-console', 'Computer Use returned home after Console.');
    } else {
      updateScenario(state, 'console', 'inconclusive', 'Console button was not visible in the current state.');
    }

    if (await clickByPattern(client, state, text, 'Give feedback', [/Give feedback/i], 'Open Give Feedback.')) {
      text = await captureState(client, state, 'feedback', 'Computer Use opened Give Feedback.');
      updateScenario(state, 'feedback', /Feedback|message|Cancel|Submit/i.test(text) ? 'pass' : 'fail', /Feedback|message|Cancel|Submit/i.test(text) ? 'Feedback dialog rendered and no submission was made.' : 'Feedback dialog did not visibly render.');
      await clickByPattern(client, state, text, 'Cancel feedback', [/Cancel/i, /Close/i, /^button ×/i, /^button X/i], 'Cancel Give Feedback.');
      text = await captureState(client, state, 'home-after-feedback', 'Computer Use returned home after Feedback.');
    }

    if (await clickByPattern(client, state, text, 'Report Issue', [/Report Issue/i, /Report Error/i], 'Open Report Issue.')) {
      text = await captureState(client, state, 'report-issue', 'Computer Use opened Report Issue.');
      updateScenario(state, 'reportIssue', /Report|Issue|Error|Cancel|Submit/i.test(text) ? 'pass' : 'fail', /Report|Issue|Error|Cancel|Submit/i.test(text) ? 'Report Issue dialog rendered and no submission was made.' : 'Report Issue did not visibly render.');
      await clickByPattern(client, state, text, 'Cancel report issue', [/Cancel/i, /Close/i, /^button ×/i, /^button X/i], 'Cancel Report Issue.');
      text = await captureState(client, state, 'home-after-report-issue', 'Computer Use returned home after Report Issue.');
    } else {
      updateScenario(state, 'reportIssue', 'inconclusive', 'Report Issue button was not visible in the current state.');
    }

    const suggestionVisible = hasAny(text, [/Install vim/i, /Add Rectangle/i, /Finder path bar/i]);
    const suggestionClicked = suggestionVisible
      ? await clickByPattern(client, state, text, 'Suggestion card', [/Install vim/i, /Add Rectangle/i, /Finder path bar/i], 'Click a home suggestion card.')
      : false;
    text = await captureState(client, state, 'suggestion-card', 'Computer Use checked home suggestion cards.');
    updateScenario(state, 'suggestionCards', suggestionClicked ? 'pass' : 'fail', suggestionClicked ? 'A suggestion card was clicked and the UI remained usable.' : suggestionVisible ? 'Suggestion cards were visible but Computer Use could not click one.' : 'No suggestion cards were visible.');

    const inputSet = await setValueByPattern(client, state, text, 'Prompt input', [/text entry area/i], options.prompt);
    text = await captureState(client, state, 'typed-intent', 'Computer Use set a real prompt in the app prompt field.');
    if (inputSet && text.includes(options.prompt)) {
      updateScenario(state, 'typedIntent', 'pass', 'Computer Use entered the real prompt into the app prompt field.');
    } else {
      updateScenario(state, 'typedIntent', 'fail', 'Computer Use could not enter the prompt into the app prompt field.');
    }

    if (inputSet && (await clickByPattern(client, state, text, 'Send prompt', [/button Send/i], 'Submit the real prompt.'))) {
      const wait = await waitFor(
        client,
        state,
        'provider-progress',
        (candidate) => {
          if (/heading Review|button Build & Test|button Discard|Summary|Diff/i.test(candidate)) return 'review';
          if (/Payment Required|Insufficient credits|out of credits|billing limit/i.test(candidate)) return 'billing-error';
          if (/No API key|missing API key|API key is required|invalid API key|Unauthorized|401/i.test(candidate)) return 'credential-error';
          if (/Provider request failed|provider error|OpenRouter error|fatal error|uncaught/i.test(candidate)) return 'provider-error';
          return null;
        },
        { attempts: Number(process.env.NIXMAC_E2E_PROVIDER_ATTEMPTS || 48), delayMs: Number(process.env.NIXMAC_E2E_PROVIDER_DELAY_MS || 5000) },
      );
      text = wait.text;
      if (wait.result === 'review') {
        updateScenario(state, 'review', 'pass', 'The real provider workflow reached Review or a Review-equivalent state.');
      } else if (wait.result === 'billing-error' || /Payment Required|Insufficient credits|out of credits|billing limit/i.test(text)) {
        updateScenario(state, 'review', 'fail', 'The real provider call failed because the configured OpenRouter account appears out of credits or over its billing limit.');
        state.failures.push('Provider billing/credits prevented prompt-to-review coverage.');
      } else if (wait.result === 'credential-error' || /No API key|missing API key|API key is required|invalid API key|Unauthorized|401/i.test(text)) {
        updateScenario(state, 'review', 'fail', 'The real provider call failed because nixmac could not access an API key.');
        state.failures.push('Provider credential access prevented prompt-to-review coverage.');
      } else if (wait.result === 'provider-error') {
        updateScenario(state, 'review', 'fail', 'The provider workflow showed a hard provider/application error before reaching Review.');
        state.failures.push('A hard provider/application error prevented prompt-to-review coverage.');
      } else {
        updateScenario(state, 'review', 'inconclusive', 'The prompt was submitted, but Review did not appear before the polling window ended.');
      }
    } else {
      updateScenario(state, 'review', 'fail', 'The prompt could not be submitted.');
    }

    if (state.scenarios.review.status === 'pass') {
      if (await clickByPattern(client, state, text, 'Summary tab', [/Summary/i], 'Open Summary tab.')) {
        text = await captureState(client, state, 'review-summary', 'Computer Use opened Summary after Review.');
        const summaryMatchesIntent = /bat/i.test(text) && /Homebrew|brew|package|command line/i.test(text);
        updateScenario(state, 'summary', summaryMatchesIntent ? 'pass' : 'fail', summaryMatchesIntent ? 'Summary described the requested bat/Homebrew package intent.' : 'Summary did not visibly describe the typed bat/Homebrew intent.');
      }
      if (await clickByPattern(client, state, text, 'Diff tab', [/Diff/i], 'Open Diff tab.')) {
        text = await captureState(client, state, 'review-diff', 'Computer Use opened Diff after Review.');
        const expectedPackage = /"bat"|bat command line|Homebrew formulae|brews = \[/i.test(text);
        updateScenario(state, 'diff', expectedPackage ? 'pass' : 'fail', expectedPackage ? 'Diff rendered a candidate Homebrew configuration change for bat.' : 'Diff did not visibly show the expected bat/Homebrew change.');
      }
      if (await clickByPattern(client, state, text, 'Build & Test', [/Build & Test/i, /Build/i], 'Click Build & Test boundary.')) {
        text = await captureState(client, state, 'build-boundary', 'Computer Use clicked Build & Test to verify the destructive boundary.');
        const boundary = /Confirm|Are you sure|Build & Test|Cancel/i.test(text);
        updateScenario(state, 'buildBoundary', boundary ? 'pass' : 'fail', boundary ? 'Build & Test presented a visible confirmation/boundary before activation.' : 'Build & Test did not present an obvious confirmation boundary.');
        const canConfirmBuild = boundary && state.safety?.disposableConfig === true && state.safety?.buildConfirmEnabled === true && state.remoteConfig?.baselinePrepared === true;
        if (boundary && canConfirmBuild) {
          state.confirmationBoundaries.push('Build & Test boundary observed and confirmed in proven disposable state.');
          await clickByPattern(client, state, text, 'Confirm build boundary', [/button Confirm/i], 'Confirm Build & Test in proven disposable state.');
          let pamSymlinkHangSeen = 0;
          const step3 = await waitFor(
            client,
            state,
            'build-to-step-3',
            (candidate) => {
              if (/All changes active|Commit Changes|button Commit|Progress: step 3 of 3|Save Keep changes/i.test(candidate) && !/button \(disabled\) Commit/i.test(candidate)) return 'step-3';
              if (activationAuthRequired(candidate)) return 'activation-auth-required';
              if (buildAppearsActive(candidate) && remoteActivationPamSymlinkHang()) {
                pamSymlinkHangSeen += 1;
                if (pamSymlinkHangSeen >= 2) return 'activation-pam-symlink-hang';
              } else {
                pamSymlinkHangSeen = 0;
              }
              if (/Build Failed|Nix Evaluation Error|Package build failed|Full Disk Access|Permission denied|failed with|❌/i.test(candidate)) return 'build-error';
              return null;
            },
            { attempts: Number(process.env.NIXMAC_E2E_BUILD_ATTEMPTS || DEFAULT_BUILD_ATTEMPTS), delayMs: Number(process.env.NIXMAC_E2E_BUILD_DELAY_MS || 5000) },
          );
          text = step3.text;
          if (step3.result === 'step-3') {
            text = await captureState(client, state, 'step-3-ready', 'Computer Use reached Step 3 after Build & Test.');
            if (/button \(disabled\) Commit/i.test(text)) {
              const commitReady = await waitFor(
                client,
                state,
                'commit-ready',
                (candidate) => (/button Commit/i.test(candidate) && !/button \(disabled\) Commit/i.test(candidate) ? 'ready' : null),
                { attempts: Number(process.env.NIXMAC_E2E_COMMIT_READY_ATTEMPTS || 20), delayMs: Number(process.env.NIXMAC_E2E_COMMIT_READY_DELAY_MS || 1000) },
              );
              text = commitReady.text;
            }
            if (await clickByPattern(client, state, text, 'Commit changes', [/button Commit/i], 'Commit Step 3 changes.')) {
              const committed = await waitForRemoteGit(
                state,
                'after-commit',
                (snapshot) =>
                  snapshot?.ok &&
                  snapshot.head &&
                  snapshot.head !== state.remoteConfig?.baselineHead &&
                  !snapshot.statusShort &&
                  Boolean(snapshot.baselineDiffNameOnly) &&
                  snapshot.containsBat === true,
                { attempts: Number(process.env.NIXMAC_E2E_COMMIT_ATTEMPTS || 30), delayMs: Number(process.env.NIXMAC_E2E_COMMIT_DELAY_MS || 1000) },
              );
              text = await captureState(client, state, 'after-commit', 'Computer Use committed Step 3 changes.');
              if (committed.ok) {
                state.remoteConfig.savedHead = committed.snapshot.head;
                updateScenario(state, 'saveFlow', 'pass', 'Step 3 Commit persisted the generated bat/Homebrew change in the disposable config repo and left the worktree clean.');
              } else {
                updateScenario(state, 'saveFlow', 'fail', 'Step 3 Commit was clicked, but the disposable repo did not show a clean committed bat/Homebrew change.');
                state.failures.push('Step 3 Commit did not produce the expected clean disposable git state.');
              }
            } else {
              updateScenario(state, 'saveFlow', 'fail', 'Step 3 appeared, but Computer Use could not click Commit.');
              state.failures.push('Step 3 Commit button was not reachable.');
            }
          } else if (step3.result === 'build-error') {
            updateScenario(state, 'saveFlow', 'fail', 'Build & Test was confirmed in disposable mode, but the rebuild failed before Step 3.');
            updateScenario(state, 'rollbackCleanup', 'inconclusive', 'Rollback cleanup was not attempted because Build & Test did not reach Step 3.');
            state.failures.push('Build & Test failed before Step 3.');
          } else if (step3.result === 'activation-auth-required') {
            updateScenario(state, 'saveFlow', 'fail', 'Build & Test reached macOS activation, but the remote lane requires an interactive administrator authentication prompt before Step 3 can appear.');
            updateScenario(state, 'rollbackCleanup', 'inconclusive', 'Rollback cleanup was not attempted because activation was blocked by macOS administrator authentication.');
            state.failures.push('Remote activation requires interactive macOS administrator authentication before Step 3.');
          } else if (step3.result === 'activation-pam-symlink-hang') {
            updateScenario(state, 'saveFlow', 'fail', 'Build & Test reached macOS activation, but remote AppleScript activation hung while creating /etc/pam.d/sudo_local for Touch ID sudo.');
            updateScenario(state, 'rollbackCleanup', 'inconclusive', 'Rollback cleanup was not attempted because activation hung before Step 3.');
            state.failures.push('Remote activation hung creating /etc/pam.d/sudo_local during Touch ID sudo setup.');
          } else {
            updateScenario(
              state,
              'saveFlow',
              'inconclusive',
              buildAppearsActive(text)
                ? 'Build & Test was confirmed in disposable mode, but the rebuild still appeared active when the polling window ended.'
                : 'Build & Test was confirmed in disposable mode, but Step 3 did not appear before the polling window ended.',
            );
            updateScenario(state, 'rollbackCleanup', 'inconclusive', 'Rollback cleanup was not attempted because Step 3 was not reached.');
          }
        } else {
          if (boundary) state.confirmationBoundaries.push('Build & Test boundary observed; not confirmed because disposable build-confirm mode was not proven.');
          await addEvent(state, 'safety.build-confirm.skipped', {
            reason: 'Build confirmation requires disposable config, explicit build-confirm enablement, and a prepared baseline commit.',
            disposableConfig: Boolean(state.safety?.disposableConfig),
            buildConfirmEnabled: Boolean(state.safety?.buildConfirmEnabled),
            baselinePrepared: Boolean(state.remoteConfig?.baselinePrepared),
          });
          await clickByPattern(client, state, text, 'Cancel build boundary', [/Cancel/i, /Close/i, /^button ×/i, /^button X/i], 'Cancel Build & Test boundary.');
          text = await captureState(client, state, 'after-build-cancel', 'Computer Use cancelled the Build & Test boundary.');
          updateScenario(state, 'saveFlow', 'inconclusive', 'Step 3 Save / Keep changes was not exercised because Build & Test confirmation was not enabled for a proven disposable config.');
          updateScenario(state, 'rollbackCleanup', 'inconclusive', 'Rollback cleanup was not exercised because Step 3 Save did not run.');
        }
      } else {
        updateScenario(state, 'saveFlow', 'inconclusive', 'Step 3 Save / Keep changes was not exercised because Build & Test was not available.');
        updateScenario(state, 'rollbackCleanup', 'inconclusive', 'Rollback cleanup was not exercised because Build & Test was not available.');
      }
      if (state.scenarios.saveFlow.status === 'pass') {
        if (await clickByPattern(client, state, text, 'History after commit', [/button History/i], 'Open History to restore the disposable baseline.')) {
          text = await captureState(client, state, 'history-before-restore', 'Computer Use opened History after Step 3 commit.');
          if (await clickByPattern(client, state, text, 'Restore previous commit', [/button Restore/i], 'Restore the pre-test disposable baseline from History.')) {
            text = await captureState(client, state, 'history-restore-preview', 'Computer Use previewed History restore.');
            if (await clickByPattern(client, state, text, 'Confirm restore', [/Confirm Restore/i], 'Confirm History restore cleanup.')) {
              const restored = await waitForRemoteGit(
                state,
                'after-history-restore',
                (snapshot) =>
                  snapshot?.ok &&
                  !snapshot.statusShort &&
                  !meaningfulBaselineDiff(snapshot) &&
                  snapshot.containsBat === false,
                { attempts: Number(process.env.NIXMAC_E2E_RESTORE_ATTEMPTS || 80), delayMs: Number(process.env.NIXMAC_E2E_RESTORE_DELAY_MS || 5000) },
              );
              text = await captureState(client, state, 'after-history-restore', 'Computer Use completed History restore cleanup.');
              updateScenario(
                state,
                'rollbackCleanup',
                restored.ok ? 'pass' : 'fail',
                restored.ok
                  ? 'History restore rollback returned the disposable config tree to pre-test baseline content with a clean worktree; the top-level nix build result symlink was ignored as a build artifact.'
                  : 'History restore was confirmed, but the disposable config tree did not return to the pre-test baseline content cleanly.',
              );
              if (!restored.ok) state.failures.push('Rollback cleanup did not restore the disposable config tree to baseline content.');
            } else {
              updateScenario(state, 'rollbackCleanup', 'fail', 'History restore preview appeared, but Computer Use could not click Confirm Restore.');
              state.failures.push('History restore confirmation was not reachable.');
            }
          } else {
            updateScenario(state, 'rollbackCleanup', 'fail', 'History opened after Save, but no Restore control was reachable for the disposable baseline.');
            state.failures.push('No History Restore control was reachable after Step 3 commit.');
          }
        } else {
          updateScenario(state, 'rollbackCleanup', 'fail', 'Step 3 Commit passed, but Computer Use could not open History for rollback cleanup.');
          state.failures.push('History was not reachable for rollback cleanup after Step 3 commit.');
        }
      } else if (state.scenarios.rollbackCleanup.status === 'inconclusive' && state.scenarios.rollbackCleanup.notes.length === 0) {
        updateScenario(state, 'rollbackCleanup', 'inconclusive', 'Rollback cleanup was not attempted because Step 3 Save did not pass.');
      }

      if (state.scenarios.rollbackCleanup.status === 'pass') {
        updateScenario(state, 'discard', 'pass', 'Discard was intentionally not exercised because the stronger Step 3 save plus History restore cleanup path returned the disposable config to baseline.');
      } else if (activationAuthRequired(text)) {
        updateScenario(state, 'discard', 'inconclusive', 'Discard was not exercised because activation was blocked by macOS administrator authentication; external disposable-state restore handles cleanup.');
      } else if (buildAppearsActive(text)) {
        updateScenario(state, 'discard', 'inconclusive', 'Discard was not exercised because Build & Test still appeared active; external disposable-state restore handles cleanup.');
      } else if (await clickByPattern(client, state, text, 'Discard', [/Discard/i], 'Open Discard confirmation.')) {
        text = await captureState(client, state, 'discard-boundary', 'Computer Use opened Discard confirmation.');
        const boundary = /Discard|Cancel|Are you sure|Confirm/i.test(text);
        state.confirmationBoundaries.push('Discard boundary observed; confirmation only safe for disposable state.');
        const canConfirmDiscard = state.safety?.disposableConfig === true && state.safety?.discardConfirmEnabled === true;
        let exitedDiscard = false;
        if (canConfirmDiscard) {
          exitedDiscard = await clickByPattern(client, state, text, 'Confirm discard', [/button Confirm/i, /^button Discard$/i], 'Confirm discard in proven disposable state.');
        } else {
          await addEvent(state, 'safety.discard-confirm.skipped', {
            reason: 'Disposable config mode was not explicitly proven/enabled; Discard confirmation was not clicked.',
            disposableConfig: Boolean(state.safety?.disposableConfig),
            discardConfirmEnabled: Boolean(state.safety?.discardConfirmEnabled),
          });
        }
        if (!exitedDiscard) await clickByPattern(client, state, text, 'Cancel discard', [/Cancel/i, /Close/i, /^button ×/i, /^button X/i], 'Exit Discard dialog without confirming.');
        text = await captureState(client, state, 'after-discard', 'Computer Use exited Discard flow.');
        if (!boundary) {
          updateScenario(state, 'discard', 'fail', 'Discard did not show a visible confirmation boundary.');
        } else if (canConfirmDiscard) {
          updateScenario(state, 'discard', /Progress: step 1 of 3|Get started/i.test(text) ? 'pass' : 'fail', /Progress: step 1 of 3|Get started/i.test(text) ? 'Discard was confirmed in proven disposable state and returned to the prompt/start state.' : 'Discard confirmation did not return to start.');
        } else {
          updateScenario(state, 'discard', 'inconclusive', 'Discard boundary appeared, but confirmation was skipped because disposable config mode was not proven.');
        }
      }
    } else {
      updateScenario(state, 'summary', 'inconclusive', 'Summary was not tested because the real provider workflow did not reach Review.');
      updateScenario(state, 'diff', 'inconclusive', 'Diff was not tested because the real provider workflow did not reach Review.');
      updateScenario(state, 'buildBoundary', 'inconclusive', 'Build & Test boundary was not tested because the real provider workflow did not reach Review.');
      updateScenario(state, 'saveFlow', 'inconclusive', 'Step 3 Save / Keep changes was not tested because the real provider workflow did not reach Review.');
      updateScenario(state, 'rollbackCleanup', 'inconclusive', 'Rollback cleanup was not tested because the real provider workflow did not reach Review.');
      updateScenario(state, 'discard', 'inconclusive', 'Discard-after-review was not tested because the real provider workflow did not reach Review.');
    }

    const coreSurfaceLabels = new Set(state.screenshots.map((shot) => shot.label));
    const requiredVisualSurfaces = [
      'launch',
      'settings-general',
      'settings-ai-models',
      'settings-preferences',
      'history',
      'feedback',
      'report-issue',
      'typed-intent',
    ];
    const missingVisualSurfaces = requiredVisualSurfaces.filter((label) => !coreSurfaceLabels.has(label));
    updateScenario(
      state,
      'visualCoverage',
      missingVisualSurfaces.length === 0 ? 'pass' : 'fail',
      missingVisualSurfaces.length === 0
        ? 'Screenshots/text snapshots cover the core app shell, settings, support dialogs, prompt input, and provider flow.'
        : `Missing expected visual evidence for: ${missingVisualSurfaces.join(', ')}.`,
    );

    const proofIssues = proofQualityIssues(state);
    updateScenario(
      state,
      'visualProofQuality',
      proofIssues.length === 0 ? 'pass' : 'fail',
      proofIssues.length === 0
        ? 'Every passing scenario has a linked screenshot or redacted accessibility text artifact in the proof catalog.'
        : `Missing proof artifacts for passing scenarios: ${proofIssues.join('; ')}`,
    );
    updateMainCoverageFreshness(state);

    updatePrSpecificCoverage(state);

    state.cleanup.note = 'Remote app state was not restored by this runner. CI wrapper is responsible for remote app-support backup/restore; local artifacts are retained.';
    await assembleVideo(state);
    const videoIssue = videoArtifactIssue(state);
    updateScenario(
      state,
      'videoEvidence',
      videoIssue ? 'fail' : 'pass',
      videoIssue
        ? `Evidence video artifact is not valid: ${videoIssue}.`
        : `Evidence video generated at ${state.video.path}.`,
    );
    await render(state);
    await inspectReportWithComputerUse(client, state);
    await render(state);
    await saveState(state);
    console.log(path.join(state.runDir, 'index.html'));
    if (shouldFailProcessForVerdict(state)) {
      console.error(`Computer Use E2E verdict was ${state.verdict}; failing the check while preserving the evidence report.`);
      process.exitCode = 1;
    }
  } finally {
    client.close();
  }
}

async function renderUnavailable(args) {
  const note = argValue(args, '--note', 'Computer Use remote runner was not available.');
  const runDir = argValue(args, '--run-dir', path.join(ARTIFACT_ROOT, timestampSlug()));
  await mkdir(path.join(runDir, 'screenshots'), { recursive: true });
  await mkdir(path.join(runDir, 'texts'), { recursive: true });
  await mkdir(path.join(runDir, 'video'), { recursive: true });
  const state = await baseState(runDir, {
    ws: process.env.NIXMAC_COMPUTER_USE_WS || DEFAULT_WS,
    app: process.env.NIXMAC_COMPUTER_USE_APP || DEFAULT_APP,
    prompt: process.env.NIXMAC_E2E_PROMPT || DEFAULT_PROMPT,
  });
  addNarrative(state, note);
  for (const key of Object.keys(state.scenarios)) updateScenario(state, key, 'inconclusive', note);
  state.cleanup.note = 'No app state touched; unavailable report only.';
  await render(state);
  console.log(path.join(runDir, 'index.html'));
}

async function renderExisting(args) {
  const runDir = argValue(args, '--run-dir', '');
  if (!runDir) throw new Error('render-existing requires --run-dir <path>');
  const statePath = path.join(runDir, 'state.json');
  const original = JSON.parse(await readFile(statePath, 'utf8'));
  const state = ensureCurrentSchema({
    ...original,
    runDir,
    regeneratedFrom: 'state.json',
    regeneratedAt: new Date().toISOString(),
  });

  if (state.scenarios.saveFlow?.status === 'inconclusive' && state.scenarios.saveFlow.notes.length === 1 && /added after this run/.test(state.scenarios.saveFlow.notes[0])) {
    state.scenarios.saveFlow.notes = ['Step 3 Save / Keep changes was not exercised in this historical run.'];
  }
  if (state.scenarios.discard?.status === 'pass' && !state.safety?.disposableConfig) {
    state.scenarios.discard.status = 'inconclusive';
    state.scenarios.discard.notes.push('Historical pass downgraded for regenerated report: Discard confirmation was not safe to count as pass because disposable config mode was not proven.');
  }
  if (state.scenarios.rollbackCleanup?.status === 'pass' && state.scenarios.discard?.status === 'inconclusive') {
    state.scenarios.discard.status = 'pass';
    state.scenarios.discard.notes = ['Discard was intentionally not exercised because the stronger Step 3 save plus History restore cleanup path returned the disposable config to baseline.'];
  }
  state.claims = Object.values(state.scenarios).map((scenario) => ({
    claim: scenario.label,
    status: scenario.status,
    evidence: scenario.notes.join(' ') || 'See proof artifacts and coverage gaps.',
  }));
  const proofIssues = proofQualityIssues(state);
  state.scenarios.visualProofQuality.status = proofIssues.length === 0 ? 'pass' : 'fail';
  state.scenarios.visualProofQuality.notes = [
    proofIssues.length === 0
      ? 'Every passing scenario has a linked screenshot or redacted accessibility text artifact in the proof catalog.'
      : `Missing proof artifacts for passing scenarios: ${proofIssues.join('; ')}`,
  ];
  const videoIssue = videoArtifactIssue(state);
  const preserveUnavailableVideoEvidence =
    state.video.status !== 'available' && state.scenarios.videoEvidence.status === 'inconclusive';
  if (!preserveUnavailableVideoEvidence) {
    state.scenarios.videoEvidence.status = videoIssue ? 'fail' : 'pass';
    state.scenarios.videoEvidence.notes = [
      videoIssue
        ? `Evidence video artifact is not valid: ${videoIssue}.`
        : `Evidence video generated at ${state.video.path}.`,
    ];
  }
  updateMainCoverageFreshness(state);
  updatePrSpecificCoverage(state);
  await render(state, { stateFileName: 'state.regenerated.json', recordEvent: false });
  console.log(path.join(runDir, 'index.html'));
}

async function renderErrorReport(error, args) {
  const note = `Computer Use remote runner failed before completing the suite: ${redact(error instanceof Error ? error.message : String(error))}`;
  await renderUnavailable([...args, '--note', note]);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'run') await runSuite(args);
    else if (command === 'render-unavailable') await renderUnavailable(args);
    else if (command === 'render-existing') await renderExisting(args);
    else {
      usage();
      process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error(redact(error instanceof Error ? error.stack || error.message : String(error)));
    if (command === 'run') {
      try {
        await renderErrorReport(error, args);
      } catch (reportError) {
        console.error(redact(reportError instanceof Error ? reportError.stack || reportError.message : String(reportError)));
      }
    }
    process.exit(1);
  }
}

await main();
