#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
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

const EVOLVED_CASE_CATALOG = Object.freeze({
  'homebrew-bat': {
    id: 'homebrew-bat',
    label: 'Homebrew bat package add',
    mode: 'full-lifecycle',
    prompt: DEFAULT_PROMPT,
    source: 'Current Computer Use E2E default; maps to eval package/homebrew install coverage.',
    defaultPrLane: true,
    note: 'Runs prompt -> Review -> Summary/Diff -> Build boundary -> Step 3 Commit -> History rollback cleanup.',
  },
  'screenshots-defaults': {
    id: 'screenshots-defaults',
    label: 'Screenshot defaults review-only calibration',
    mode: 'review-only-calibration',
    scenarioKey: 'evolvedScreenshotsDefaults',
    prompt: 'Configure screenshots to save as PNG to ~/Screenshots',
    source: 'WDIO fixture basicPromptsConfigureScreenshots and eval CSV case 33 / golden-set system-defaults coverage.',
    defaultPrLane: false,
    expectedEvidence: [/screenshots?/i, /png/i, /~\/Screenshots|Screenshots/i, /defaults\.nix|screencapture/i],
    note: 'Optional calibration lane. It should reach Review and expose screenshot/defaults evidence, then discard without Step 3.',
  },
  'protected-flake-input': {
    id: 'protected-flake-input',
    label: 'Protected flake input adversarial boundary',
    mode: 'adversarial-advisory',
    prompt: 'Add a new input to flake.nix for nixpkgs-unstable',
    source: 'Eval spreadsheet protected-file family (#121/#208/#210). Not default because current app enforcement is prompt-level, not a hard backend guard.',
    defaultPrLane: false,
    note: 'Keep out of the default PR lane until nixmac has hard protected-file enforcement and a reliable refusal signal.',
  },
});

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
    keys: ['visualProofQuality', 'reportInspection'],
  },
];

const curatedProofKeys = [
  'review',
  'summary',
  'diff',
  'buildBoundary',
  'saveFlow',
  'rollbackCleanup',
  'settingsAPIKeys',
  'settingsGeneral',
  'settingsAIModels',
  'settingsPreferences',
  'visualProofQuality',
  'reportInspection',
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
  evolvedScreenshotsDefaults: {
    grade: 'calibration',
    screenshots: ['evolved-screenshots-defaults-summary', 'evolved-screenshots-defaults-diff', 'evolved-screenshots-defaults-after-discard'],
    texts: ['evolved-screenshots-defaults-summary', 'evolved-screenshots-defaults-diff', 'evolved-screenshots-defaults-after-discard'],
    proof: 'Optional calibration case submits the screenshot-defaults prompt, reaches Review, checks for PNG/Screenshots/defaults evidence, and exits without Step 3.',
    untested: 'Disabled in the default PR lane until its accessibility-text tokens are calibrated on the real remote app.',
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
  adversarialOutOfBounds: {
    grade: 'action-confirmed',
    screenshots: ['adversarial-out-of-bounds-annotation'],
    texts: [],
    proof: 'Adversarial-only fixture used by run-adversarial.mjs to prove bad overlay geometry is caught.',
    untested: 'Not a real app scenario.',
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
  reportInspection: {
    grade: 'action-confirmed',
    screenshots: ['HTML report inspection'],
    texts: ['HTML report inspection'],
    proof: 'Computer Use opens the generated report on the remote Mac and sees report sections.',
    untested: 'Does not prove a human reviewed every screenshot.',
  },
};

const scenarioContractVersion = 2;

const v1GradeToEvidenceStrength = {
  'action-confirmed': 'operational',
  'text-confirmed': 'visual-supported',
  'guardrail-confirmed': 'operational',
  'manifest-confirmed': 'operational',
  calibration: 'weak',
  'not-run': 'not-proved',
  insufficient: 'not-proved',
};

const scenarioAssertionTypeHints = {
  launch: ['accessibility_text', 'visual_heuristic'],
  updateBanner: ['accessibility_text', 'action_result'],
  settingsGeneral: ['accessibility_text', 'action_result', 'visual_heuristic'],
  settingsAIModels: ['accessibility_text', 'action_result', 'visual_heuristic'],
  settingsAPIKeys: ['accessibility_text', 'sensitive_redaction'],
  settingsPreferences: ['accessibility_text', 'action_result', 'visual_heuristic'],
  history: ['accessibility_text', 'action_result', 'visual_heuristic'],
  console: ['accessibility_text', 'sensitive_redaction'],
  feedback: ['accessibility_text', 'action_result', 'visual_heuristic'],
  reportIssue: ['accessibility_text', 'action_result', 'visual_heuristic'],
  suggestionCards: ['accessibility_text', 'action_result', 'visual_heuristic'],
  typedIntent: ['accessibility_text', 'action_result'],
  review: ['accessibility_text', 'provider_state', 'action_result'],
  summary: ['accessibility_text', 'provider_state'],
  diff: ['accessibility_text', 'provider_state'],
  buildBoundary: ['accessibility_text', 'action_result', 'confirmation_boundary'],
  saveFlow: ['accessibility_text', 'action_result', 'remote_state'],
  rollbackCleanup: ['accessibility_text', 'action_result', 'remote_state'],
  discard: ['accessibility_text', 'action_result', 'confirmation_boundary'],
  evolvedScreenshotsDefaults: ['accessibility_text', 'provider_state', 'calibration'],
  visualCoverage: ['artifact_quality'],
  visualProofQuality: ['artifact_quality', 'visual_heuristic'],
  mainCoverageFreshness: ['coverage_manifest'],
  prSpecificCoverage: ['pr_metadata', 'coverage_manifest'],
  reportInspection: ['accessibility_text', 'artifact_quality'],
};

const failureTaxonomy = {
  app: 'The app UI/state did not behave as expected.',
  provider: 'The real provider returned a billing, rate-limit, timeout, or model error.',
  credential: 'A provider key was missing, invalid, unavailable, or not injected into the launched app process.',
  remote_infra: 'DXU, SSH, launchd, app-server, macOS permissions, or remote activation infrastructure blocked the run.',
  harness: 'Computer Use actions, artifact generation, report rendering, or runner bookkeeping failed.',
  coverage: 'The suite lacks a scenario, manifest mapping, PR focus, or waiver for the behavior.',
  inconclusive: 'The runner could not prove either pass or fail.',
};

const screenshotAnnotations = {
  launch: [
    { label: 'Step 1 active', x: 13, y: 18, tone: 'pin' },
    { label: 'Save step inactive', x: 72, y: 18, tone: 'pin' },
    { label: 'Prompt field', x: 8, y: 39, w: 84, h: 14 },
    { label: 'Send disabled', x: 88, y: 46, tone: 'pin' },
  ],
  'settings-general': [{ label: 'Settings content', x: 50, y: 36, tone: 'pin' }],
  'settings-ai-models': [{ label: 'Provider/model controls', x: 50, y: 43, tone: 'pin' }],
  'settings-preferences': [{ label: 'Confirmation controls', x: 50, y: 42, tone: 'pin' }],
  history: [{ label: 'History surface', x: 50, y: 40, tone: 'pin' }],
  feedback: [{ label: 'Feedback dialog', x: 50, y: 42, tone: 'pin' }],
  'report-issue': [{ label: 'Report Issue dialog', x: 50, y: 42, tone: 'pin' }],
  'typed-intent': [{ label: 'Typed prompt', x: 8, y: 39, w: 84, h: 14 }],
  'review-summary': [{ label: 'Summary after Review', x: 50, y: 38, tone: 'pin' }],
  'review-diff': [{ label: 'Diff includes requested change', x: 50, y: 45, tone: 'pin' }],
  'build-boundary': [{ label: 'Confirm button', x: 57, y: 50, tone: 'pin' }],
  'step-3-ready': [
    { label: 'Step 3 active', x: 73, y: 20, tone: 'pin' },
    { label: 'Commit controls', x: 70, y: 60, tone: 'pin' },
  ],
  'after-commit': [{ label: 'Saved commit state', x: 50, y: 44, tone: 'pin' }],
  'history-before-restore': [{ label: 'History restore controls', x: 50, y: 42, tone: 'pin' }],
  'history-restore-preview': [{ label: 'Confirm restore preview', x: 50, y: 48, tone: 'pin' }],
  'after-history-restore': [{ label: 'Rollback cleanup result', x: 50, y: 42, tone: 'pin' }],
  'discard-boundary': [{ label: 'Discard confirmation', x: 50, y: 48, tone: 'pin' }],
  'evolved-screenshots-defaults-summary': [{ label: 'Screenshot defaults summary', x: 50, y: 38, tone: 'pin' }],
  'evolved-screenshots-defaults-diff': [{ label: 'Defaults diff evidence', x: 50, y: 45, tone: 'pin' }],
  'evolved-screenshots-defaults-after-discard': [{ label: 'Review-only cleanup', x: 50, y: 42, tone: 'pin' }],
  'adversarial-out-of-bounds-annotation': [{ label: 'Out of bounds fixture', x: 96, y: 50, w: 12, h: 10 }],
};

function usage() {
  console.log(`Usage:
  node tools/computer-use-e2e/run-remote-cua.mjs run
  node tools/computer-use-e2e/run-remote-cua.mjs render-unavailable --note "..."
  node tools/computer-use-e2e/run-remote-cua.mjs render-existing --run-dir artifacts/computer-use-remote/<timestamp>
  node tools/computer-use-e2e/run-remote-cua.mjs self-test

Environment:
  NIXMAC_COMPUTER_USE_WS       WebSocket for Codex app-server (default ${DEFAULT_WS})
  NIXMAC_COMPUTER_USE_APP      Bundle id/app name (default ${DEFAULT_APP})
  NIXMAC_E2E_REMOTE_SSH_DEST   Optional ssh destination, e.g. admin@38.79.97.120
  NIXMAC_E2E_SSH_KEY           Optional ssh private key path
  NIXMAC_E2E_SSH_KNOWN_HOSTS   Optional known_hosts path for strict SSH verification
  NIXMAC_E2E_REMOTE_REPORT_DIR Optional remote report copy dir for browser inspection
  NIXMAC_E2E_EXTRA_EVOLVED_CASES Optional comma/newline list of calibrated non-default evolved cases, e.g. screenshots-defaults
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

function pngDimensions(filePath) {
  try {
    const buffer = readFileSync(filePath);
    if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } catch {
    return null;
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

function countMatches(text, patterns) {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

function hasSettingsFrameEvidence(text) {
  return (
    /button Close settings/i.test(text) &&
    /\btext Settings\b/i.test(text) &&
    countMatches(text, [/button General/i, /button AI Models/i, /button API Keys/i, /button Preferences/i]) >= 3
  );
}

function hasSettingsGeneralEvidence(text) {
  return hasSettingsFrameEvidence(text) && countMatches(text, [/heading General/i, /Configuration Directory/i, /button Browse/i, /\bHost\b/i, /Send diagnostics/i, /Privacy policy/i]) >= 2;
}

function hasSettingsAIModelsEvidence(text) {
  return hasSettingsFrameEvidence(text) && countMatches(text, [/heading AI Models/i, /Evolution Model/i, /Summary Model/i, /\bProvider\b/i, /Model Name/i, /Max Iterations/i, /Max Build Attempts/i]) >= 3;
}

function hasSettingsAPIKeysEvidence(text) {
  return hasSettingsFrameEvidence(text) && countMatches(text, [/heading API Keys/i, /heading OpenRouter/i, /heading OpenAI/i, /\bAPI Key\b/i, /secure text field/i, /API Base URL/i]) >= 3;
}

function hasSettingsPreferencesEvidence(text) {
  return hasSettingsFrameEvidence(text) && countMatches(text, [/heading Preferences/i, /Confirmation dialogs/i, /\bBuild\b/i, /Clear \/ Discard/i, /\bRollback\b/i, /Summarization/i, /switch \(settable/i]) >= 3;
}

const clickToolFailurePatterns = [
  /^\s*(?:error|failed|failure):\s*(?:click|action|element|stale|invalid|no such|unable|could not|not found|not clickable)/im,
  /^\s*(?:click|action)\s+(?:failed|could not|unable)/im,
  /^\s*element(?:\s+index)?\s+\d+\s+(?:not found|not clickable|is stale|stale|invalid)/im,
  /\b(?:stale|invalid)\s+element(?:\s+index)?\b/i,
  /\bno such element\b/i,
  /\belement(?:\s+index)?\s+\d+\s+(?:not found|not clickable)\b/i,
  /\b(?:could not|unable to)\s+click\b/i,
];

const setValueToolFailurePatterns = [
  /^\s*(?:error|failed|failure):\s*(?:set|set_value|input|value|element|stale|invalid|no such|unable|could not|not found)/im,
  /^\s*(?:set_value|set value|input|type)\s+(?:failed|could not|unable)/im,
  /^\s*element(?:\s+index)?\s+\d+\s+(?:not found|not settable|is stale|stale|invalid)/im,
  /\b(?:stale|invalid)\s+element(?:\s+index)?\b/i,
  /\bno such element\b/i,
  /\belement(?:\s+index)?\s+\d+\s+(?:not found|not settable)\b/i,
  /\b(?:could not|unable to)\s+(?:set|type|enter)\b/i,
];

function clickResponseIndicatesFailure(response, responseText = contentText(response)) {
  if (response?.result?.isError === true) return true;
  return clickToolFailurePatterns.some((pattern) => pattern.test(responseText));
}

function setValueResponseIndicatesFailure(response, responseText = contentText(response)) {
  if (response?.result?.isError === true) return true;
  return setValueToolFailurePatterns.some((pattern) => pattern.test(responseText));
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

function enabledExtraEvolvedCases() {
  return splitEnvList(process.env.NIXMAC_E2E_EXTRA_EVOLVED_CASES || '')
    .map((id) => EVOLVED_CASE_CATALOG[id])
    .filter(Boolean);
}

function evolvedCaseStrategy(extraCases = enabledExtraEvolvedCases()) {
  return {
    selectedAt: new Date().toISOString(),
    defaultCaseIds: ['homebrew-bat'],
    extraCaseIds: extraCases.map((item) => item.id),
    catalog: Object.values(EVOLVED_CASE_CATALOG).map((item) => ({
      id: item.id,
      label: item.label,
      mode: item.mode,
      defaultPrLane: item.defaultPrLane,
      source: item.source,
      note: item.note,
    })),
    reviewDecision:
      'Claude review kept homebrew-bat as the only default full-lifecycle PR case, moved screenshots-defaults to optional calibration, and moved protected-flake-input to an adversarial advisory lane until hard backend enforcement exists.',
  };
}

function buildPrFocus() {
  const changedFiles = splitEnvList(process.env.NIXMAC_E2E_PR_CHANGED_FILES || '');
  const userVisibleFiles = changedFiles.filter((file) =>
    /^(apps\/native\/src\/(components|hooks|stores|lib|styles)|apps\/native\/src-tauri|tools\/computer-use-e2e|\.github\/workflows\/computer-use-e2e\.yml)/.test(file),
  );
  const scenarioKeys = new Set();
  for (const file of userVisibleFiles) {
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
      scenarioKeys.add('reportInspection');
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
    const mappedScenarios = state.prFocus.scenarioKeys.filter((key) => key !== 'prSpecificCoverage').map((key) => ({
      key,
      label: state.scenarios[key]?.label || key,
      status: state.scenarios[key]?.status || 'inconclusive',
    }));
    const failed = mappedScenarios.filter((scenario) => scenario.status === 'fail');
    const incomplete = mappedScenarios.filter((scenario) => scenario.status !== 'pass' && scenario.status !== 'fail');
    if (!mappedScenarios.length) {
      updateScenario(state, 'prSpecificCoverage', 'inconclusive', `User-visible changed files were inferred, but no dedicated PR-specific Computer Use scenario has been executed yet: ${state.prFocus.userVisibleFiles.join(', ')}`);
    } else if (failed.length) {
      updateScenario(
        state,
        'prSpecificCoverage',
        'fail',
        `User-visible changed files mapped to scenarios, but PR-focused scenarios failed: ${failed.map((scenario) => scenario.label).join(', ')}`,
      );
    } else if (incomplete.length) {
      updateScenario(
        state,
        'prSpecificCoverage',
        'inconclusive',
        `User-visible changed files mapped to scenarios, but PR-focused scenarios did not all complete: ${incomplete.map((scenario) => scenario.label).join(', ')}`,
      );
    } else {
      updateScenario(state, 'prSpecificCoverage', 'pass', `User-visible changed files were mapped to passing Computer Use scenarios and surfaced at the top of the report: ${mappedScenarios.map((scenario) => scenario.label).join(', ')}`);
    }
  } else {
    updateScenario(state, 'prSpecificCoverage', 'inconclusive', `User-visible changed files were inferred, but no dedicated PR-specific Computer Use scenario has been executed yet: ${state.prFocus.userVisibleFiles.join(', ')}`);
  }
}

function ensureCurrentSchema(state) {
  state.scenarios ||= {};
  delete state.scenarios.videoEvidence;
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
  state.evolvedCaseStrategy ||= evolvedCaseStrategy();
  state.evolvedCaseRuns ||= [];
  for (const shot of state.screenshots) {
    if (!shot.imageSize && shot.path && state.runDir) {
      const dimensions = pngDimensions(path.join(state.runDir, shot.path));
      if (dimensions) shot.imageSize = dimensions;
    }
  }
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

function assertionTypesForScenario(key, proof = scenarioProofCatalog[key] || {}) {
  const hints = scenarioAssertionTypeHints[key] || [];
  const derived = [];
  if (proof.texts?.length) derived.push('accessibility_text');
  if (proof.screenshots?.length) derived.push('visual_heuristic');
  const merged = [...new Set([...hints, ...derived])];
  return merged.length ? merged : ['not_classified'];
}

function evidenceStrengthForScenario(state, key) {
  const scenario = state.scenarios?.[key];
  const proof = proofForScenario(state, key);
  if (!scenario || scenario.status !== 'pass') {
    return {
      strength: 'not-proved',
      reason: 'Scenario did not pass, so no positive evidence strength is assigned.',
    };
  }
  if (['saveFlow', 'rollbackCleanup'].includes(key)) {
    return {
      strength: 'strong',
      reason: 'Computer Use path is backed by independent disposable git state proof.',
    };
  }
  if (proof.grade === 'text-confirmed' && proof.screenshotArtifacts.length === 0) {
    return {
      strength: 'weak',
      reason: 'Pass relies on redacted accessibility text only, usually because screenshots are intentionally suppressed for a sensitive surface.',
    };
  }
  const strength = v1GradeToEvidenceStrength[proof.grade] || 'not-proved';
  const reasonByStrength = {
    strong: 'User-visible interaction is backed by independent state proof.',
    operational: 'Computer Use interacted with the real UI and matched expected state.',
    'visual-supported': 'Accessibility text is the assertion source and screenshots support human inspection.',
    weak: 'The claim depends on sparse text, calibration, or intentionally limited artifacts.',
    'not-proved': 'The scenario is skipped, inconclusive, or lacks sufficient proof artifacts.',
  };
  return { strength, reason: reasonByStrength[strength] || reasonByStrength['not-proved'] };
}

function classifyScenarioResult(key, scenario) {
  if (!scenario || scenario.status === 'pass') return { class: '', reason: '' };
  const note = scenario.notes?.join(' ') || '';
  if (/api key|credential|unauthorized|401|missing key|invalid key/i.test(note)) {
    return { class: 'credential', reason: 'Provider credential wording was detected in the scenario notes.' };
  }
  if (/OpenRouter|provider|billing|credits|rate.?limit|timeout|model error|payment required/i.test(note)) {
    return { class: 'provider', reason: 'Provider-side failure wording was detected in the scenario notes.' };
  }
  if (/DXU|SSH|remote|launchd|app-server|WebSocket|administrator authentication|authorization|activation|sudo|pam|macOS|MacinCloud/i.test(note)) {
    return { class: 'remote_infra', reason: 'Remote Mac, launch, authorization, or activation wording was detected.' };
  }
  if (/Computer Use could not|click|set_value|artifact|screenshot|text snapshot|ffmpeg|report|proof catalog|proof artifact|runner/i.test(note)) {
    return { class: 'harness', reason: 'Runner, Computer Use action, or artifact wording was detected.' };
  }
  if (/coverage|manifest|PR metadata|mapped scenario|added after this run|not exercised|no dedicated|waiver/i.test(note) || /Coverage|Freshness|prSpecificCoverage/.test(key)) {
    return { class: 'coverage', reason: 'Coverage or mapping wording was detected.' };
  }
  if (/blank WebView|did not visibly|did not show|missing|not visible|no Restore|boundary was missing|wrong content|mismatch/i.test(note)) {
    return { class: 'app', reason: 'App UI/state mismatch wording was detected.' };
  }
  return { class: 'inconclusive', reason: 'No more specific failure class matched.' };
}

function accessibilityRiskForScenario(state, key) {
  const scenario = state.scenarios?.[key];
  const proof = proofForScenario(state, key);
  const assertionTypes = assertionTypesForScenario(key, proof);
  if (assertionTypes.includes('remote_state') || assertionTypes.includes('coverage_manifest')) {
    return {
      risk: scenario?.status === 'pass' ? 'low' : 'medium',
      reason: 'The claim has non-UI state or manifest proof in addition to UI evidence.',
    };
  }
  if (proof.textArtifacts.length > 0 && proof.screenshotArtifacts.length === 0) {
    return {
      risk: 'high',
      reason: 'The claim depends on accessibility text without a screenshot, usually due sensitive-surface redaction.',
    };
  }
  if (assertionTypes.includes('accessibility_text')) {
    return {
      risk: 'medium',
      reason: 'Accessibility text is the semantic assertion source; screenshots are reviewer support.',
    };
  }
  return {
    risk: 'low',
    reason: 'The scenario is not primarily an accessibility-text assertion.',
  };
}

function buildScenarioContract(state, key) {
  const proof = proofForScenario(state, key);
  const scenario = state.scenarios?.[key] || { status: 'inconclusive', notes: [] };
  const failure = classifyScenarioResult(key, scenario);
  const evidence = evidenceStrengthForScenario(state, key);
  const accessibility = accessibilityRiskForScenario(state, key);
  return {
    id: key,
    label: scenario.label || scenarioLabels[key] || key,
    status: scenario.status || 'inconclusive',
    legacyEvidenceGrade: proof.grade,
    evidenceStrength: evidence.strength,
    evidenceStrengthReason: evidence.reason,
    assertionTypes: assertionTypesForScenario(key, proof),
    failureClass: failure.class,
    failureClassReason: failure.reason,
    accessibilityRisk: accessibility.risk,
    accessibilityRiskReason: accessibility.reason,
    proof: proof.proof,
    limitation: proof.untested,
  };
}

function updateV2Contracts(state) {
  state.v2 ||= {};
  const scenarioContracts = {};
  for (const key of Object.keys(state.scenarios || {})) {
    scenarioContracts[key] = buildScenarioContract(state, key);
    state.scenarios[key].evidenceStrength = scenarioContracts[key].evidenceStrength;
    state.scenarios[key].evidenceStrengthReason = scenarioContracts[key].evidenceStrengthReason;
    state.scenarios[key].assertionTypes = scenarioContracts[key].assertionTypes;
    state.scenarios[key].failureClass = scenarioContracts[key].failureClass;
    state.scenarios[key].failureClassReason = scenarioContracts[key].failureClassReason;
    state.scenarios[key].accessibilityRisk = scenarioContracts[key].accessibilityRisk;
    state.scenarios[key].accessibilityRiskReason = scenarioContracts[key].accessibilityRiskReason;
  }
  state.v2 = {
    contractVersion: scenarioContractVersion,
    canonicalSource:
      'V2 is derived from the runner-owned scenarioLabels, scenarioGroups, scenarioProofCatalog, evolved case catalog, and coverage manifest until a later implementation consolidates those into a single registry module.',
    evidenceGradeMapping: v1GradeToEvidenceStrength,
    failureTaxonomy,
    scenarioContracts,
  };
}

function artifactLinks(state, key) {
  const proof = proofForScenario(state, key);
  const links = [...proof.screenshotArtifacts, ...proof.textArtifacts]
    .map((artifact) => `<code>${escapeHtml(artifact.path)}</code>`)
    .join('<br>');
  return links ? `<div class="artifact-list">${links}</div>` : 'No primary artifact linked.';
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
  if (!state.remoteMachine || !state.remoteApp) {
    gaps.push({
      label: 'Remote Mac/app metadata',
      status: 'inconclusive',
      detail: 'Remote machine identity, OS, hardware, staged app path, bundle version, and signing metadata were not captured.',
    });
  }
  if (!state.processEnvVerification) {
    gaps.push({
      label: 'Credential process-env verification',
      status: 'inconclusive',
      detail: 'The nixmac process and GUI launchd credential environment were not checked with redacted values.',
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
  issues.push(...annotationGeometryIssues(state));
  for (const [key, scenario] of Object.entries(state.scenarios)) {
    if (scenario.status !== 'pass') continue;
    if (['visualProofQuality', 'mainCoverageFreshness', 'prSpecificCoverage'].includes(key)) continue;
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

function annotationStyle(item) {
  if (item.tone === 'pin') {
    return `left:${item.x}%;top:${item.y}%;width:16px;height:16px;transform:translate(-50%,-50%)`;
  }
  return `left:${item.x}%;top:${item.y}%;width:${item.w}%;height:${item.h}%`;
}

function annotationGeometryIssues(state) {
  const issues = [];
  const screenshotLabels = new Set((state.screenshots || []).map((shot) => shot.label));
  for (const [label, annotations] of Object.entries(screenshotAnnotations)) {
    if (!screenshotLabels.has(label)) continue;
    for (const [index, item] of annotations.entries()) {
      const prefix = `${label} annotation ${index + 1} (${item.label})`;
      if (typeof item.x !== 'number' || item.x < 0 || item.x > 100) issues.push(`${prefix} has x outside image bounds.`);
      if (typeof item.y !== 'number' || item.y < 0 || item.y > 100) issues.push(`${prefix} has y outside image bounds.`);
      if (item.tone === 'pin') continue;
      if (typeof item.w !== 'number' || item.w <= 0 || item.x + item.w > 100) issues.push(`${prefix} has width outside image bounds.`);
      if (typeof item.h !== 'number' || item.h <= 0 || item.y + item.h > 100) issues.push(`${prefix} has height outside image bounds.`);
    }
  }
  return issues;
}

function renderAnnotatedImage(shot) {
  const annotations = screenshotAnnotations[shot.label] || [];
  const imageSize = shot.imageSize ? `${shot.imageSize.width}x${shot.imageSize.height}` : 'unknown-size';
  const overlays = annotations
    .map(
      (item) => `<span class="${annotationClass(item)}" style="${annotationStyle(item)}"><span>${escapeHtml(item.label)}</span></span>`,
    )
    .join('\n');
  return `<div class="annotated-shot" data-image-size="${escapeHtml(imageSize)}">
  <img src="${escapeHtml(shot.path)}" alt="${escapeHtml(shot.label)}">
  ${overlays}
</div>`;
}

function renderV2EvidenceModel(state) {
  const contracts = Object.values(state.v2?.scenarioContracts || {});
  const strengthCounts = contracts.reduce((counts, item) => {
    counts[item.evidenceStrength] = (counts[item.evidenceStrength] || 0) + 1;
    return counts;
  }, {});
  const rows = ['strong', 'operational', 'visual-supported', 'weak', 'not-proved']
    .map((strength) => {
      const matching = contracts.filter((item) => item.evidenceStrength === strength);
      const examples = matching
        .slice(0, 5)
        .map((item) => item.label)
        .join(', ');
      return `<tr><td><span class="strength strength-${escapeHtml(strength)}">${escapeHtml(strength)}</span></td><td>${escapeHtml(String(strengthCounts[strength] || 0))}</td><td>${escapeHtml(examples || 'None')}</td></tr>`;
    })
    .join('\n');
  const mappingRows = Object.entries(state.v2?.evidenceGradeMapping || {})
    .map(([legacy, strength]) => `<tr><td><code>${escapeHtml(legacy)}</code></td><td><span class="strength strength-${escapeHtml(strength)}">${escapeHtml(strength)}</span></td></tr>`)
    .join('\n');
  return `<h2 id="v2-evidence-model">V2 Evidence Model</h2>
  <section class="panel">
    <p><strong>Deterministic verdict remains source of truth.</strong> Evidence strength explains how much independent proof backs each scenario; advisory/model review cannot flip pass/fail.</p>
    <div class="table-scroll"><table>
      <thead><tr><th>Evidence Strength</th><th>Scenario Count</th><th>Examples</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <details>
      <summary>Legacy grade mapping</summary>
      <table><thead><tr><th>V1 Grade</th><th>V2 Strength</th></tr></thead><tbody>${mappingRows}</tbody></table>
    </details>
  </section>`;
}

function renderAccessibilityAudit(state) {
  const rows = Object.values(state.v2?.scenarioContracts || {})
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.accessibilityRisk] ?? 3) - ({ high: 0, medium: 1, low: 2 }[b.accessibilityRisk] ?? 3))
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.label)}<br><small>${escapeHtml(item.assertionTypes.join(', '))}</small></td>
        <td><span class="risk risk-${escapeHtml(item.accessibilityRisk)}">${escapeHtml(item.accessibilityRisk)}</span></td>
        <td>${escapeHtml(item.accessibilityRiskReason)}</td>
      </tr>`,
    )
    .join('\n');
  return `<h2 id="accessibility-risk">Accessibility Dependency / Assertion Risk</h2>
  <section class="panel">
    <p>This is a reviewer-risk audit, not a separate verdict. It calls out where Computer Use accessibility text is the main assertion source and where independent state proof exists.</p>
    <div class="table-scroll"><table>
      <thead><tr><th>Scenario</th><th>Risk</th><th>Why</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

function renderFailureTaxonomy(state) {
  const rows = Object.values(state.v2?.scenarioContracts || {})
    .filter((item) => item.status !== 'pass')
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.label)}</td>
        <td><span class="verdict ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
        <td><span class="failure-class">${escapeHtml(item.failureClass || 'unclassified')}</span></td>
        <td>${escapeHtml(failureTaxonomy[item.failureClass] || item.failureClassReason || 'No classification recorded.')}</td>
      </tr>`,
    )
    .join('\n');
  const taxonomyRows = Object.entries(failureTaxonomy)
    .map(([key, description]) => `<tr><td><code>${escapeHtml(key)}</code></td><td>${escapeHtml(description)}</td></tr>`)
    .join('\n');
  return `<h2 id="failure-taxonomy">Failure Taxonomy</h2>
  <section class="panel">
    ${
      rows
        ? `<div class="table-scroll"><table><thead><tr><th>Scenario</th><th>Status</th><th>Class</th><th>Meaning</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p>No non-pass scenarios require failure classification.</p>'
    }
    <details>
      <summary>Taxonomy definitions</summary>
      <table><thead><tr><th>Class</th><th>Definition</th></tr></thead><tbody>${taxonomyRows}</tbody></table>
    </details>
  </section>`;
}

async function renderVisualProofCards(state, keys) {
  const cards = [];
  for (const key of keys) {
    const scenario = state.scenarios[key];
    if (!scenario) continue;
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

async function renderVisualProofBoard(state) {
  const prKeys = new Set(state.prFocus?.scenarioKeys || []);
  const nonPassKeys = Object.entries(state.scenarios)
    .filter(([, scenario]) => scenario.status !== 'pass')
    .map(([key]) => key);
  const settingsFocused = [...prKeys].some((key) => /^settings/.test(key));
  const defaultKeys = [
    ...nonPassKeys,
    ...curatedProofKeys.filter((key) => !/^settings/.test(key) || settingsFocused || state.scenarios[key]?.status !== 'pass'),
    ...[...prKeys],
  ];
  const uniqueDefaultKeys = [...new Set(defaultKeys)].filter((key) => state.scenarios[key]);
  const allKeys = Object.keys(state.scenarios);
  const additionalKeys = allKeys.filter((key) => !uniqueDefaultKeys.includes(key));
  const defaultCards = await renderVisualProofCards(state, uniqueDefaultKeys);
  const additionalCards = await renderVisualProofCards(state, additionalKeys);
  return `<section class="proof-priority">
    ${defaultCards}
    <details>
      <summary>Additional passing visual/text proof (${escapeHtml(String(additionalKeys.length))})</summary>
      ${additionalCards}
    </details>
  </section>`;
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
    <p><strong>PR:</strong> ${escapeHtml(pr.number || 'not provided')} ${pr.title ? `- ${escapeHtml(pr.title)}` : ''}</p>
    <p><strong>Refs:</strong> ${escapeHtml(pr.baseRef || 'base ?')} ← ${escapeHtml(pr.headRef || 'head ?')}</p>
    <h3>User-Visible Focus Candidates</h3>
    <ul>${userVisible}</ul>
    <h3>Mapped Scenario Focus</h3>
    <ul>${scenarios}</ul>
    <details>
      <summary>Full changed-file list (${escapeHtml(String(pr.changedFiles?.length || 0))})</summary>
      <ul>${changed}</ul>
    </details>
  </section>`;
}

function scenarioRows(state, items) {
  if (!items.length) return '<tr><td colspan="5">None.</td></tr>';
  return items
    .map((item) => {
      const proof = proofForScenario(state, item.key);
      const contract = state.v2?.scenarioContracts?.[item.key] || buildScenarioContract(state, item.key);
      return `<tr><td class="scenario-cell">${escapeHtml(item.label)}<br><small>${item.notes.map(escapeHtml).join('<br>') || 'No notes recorded.'}</small></td><td class="status-cell"><span class="verdict ${item.status}">${escapeHtml(item.status)}</span></td><td class="grade-cell"><span class="grade">${escapeHtml(proof.grade)}</span><br><span class="strength strength-${escapeHtml(contract.evidenceStrength)}">${escapeHtml(contract.evidenceStrength)}</span></td><td class="artifact-cell">${artifactLinks(state, item.key)}</td><td class="proof-cell">${escapeHtml(proof.proof)}${contract.failureClass ? `<br><small>Failure class: ${escapeHtml(contract.failureClass)}</small>` : ''}</td></tr>`;
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
  const table = (items) => `<div class="table-scroll"><table class="scenario-table">
    <thead><tr><th class="scenario-col">Scenario</th><th class="status-col">Status</th><th class="grade-col">Evidence Grade</th><th class="artifacts-col">Primary Artifacts</th><th class="proof-col">What Proved It / Why It Matters</th></tr></thead>
    <tbody>${scenarioRows(state, items)}</tbody>
  </table></div>`;
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
  if (!pr.configured) return `<h2 id="pull-request-focus">Pull Request Focus</h2>${renderPrFocus(state)}`;
  const keys = pr.scenarioKeys?.length ? pr.scenarioKeys : ['prSpecificCoverage'];
  const evidenceRows = keys
    .filter((key) => state.scenarios[key])
    .map((key) => ({ key, ...state.scenarios[key] }))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));
  return `<h2 id="pull-request-focus">Pull Request Focus</h2>
  ${renderPrFocus(state)}
  <section class="panel">
    <h3>PR-Relevant Evidence</h3>
    <div class="table-scroll"><table class="scenario-table">
      <thead><tr><th class="scenario-col">Scenario</th><th class="status-col">Status</th><th class="grade-col">Evidence Grade</th><th class="artifacts-col">Primary Artifacts</th><th class="proof-col">What Proved It</th></tr></thead>
      <tbody>${scenarioRows(state, evidenceRows)}</tbody>
    </table></div>
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
  return `<h2 id="main-coverage">Main Coverage Freshness</h2>
  <section class="panel">
    <p><strong>Manifest v${escapeHtml(String(coverage.manifestVersion))}</strong>: ${escapeHtml(String(coverage.mappedSurfaces))}/${escapeHtml(String(coverage.totalSurfaces))} surfaces have direct scenario mappings; ${escapeHtml(String(coverage.waivedSurfaces))} have explicit waivers; ${escapeHtml(String(coverage.candidateFiles))} user-visible candidate files scanned.</p>
    <h3>Coverage Drift</h3>
    <table><thead><tr><th>Status</th><th>Detail</th></tr></thead><tbody>${driftRows}</tbody></table>
    <h3>Explicit Waivers</h3>
    <table><thead><tr><th>ID</th><th>Surface</th><th>Reason</th></tr></thead><tbody>${waiverRows}</tbody></table>
	  </section>`;
}

function detailRows(object = {}) {
  const entries = Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return '<tr><td colspan="2">No metadata recorded.</td></tr>';
  return entries
    .map(([key, value]) => {
      const rendered = Array.isArray(value) ? value.join(', ') : String(value);
      return `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(rendered)}</td></tr>`;
    })
    .join('\n');
}

function renderRemoteMetadata(state) {
  const env = state.processEnvVerification || {};
  const machineSummary = [
    state.remoteMachine?.hostname || state.remoteMachine?.localHostName || 'unknown host',
    state.remoteMachine?.macosProductVersion ? `macOS ${state.remoteMachine.macosProductVersion}` : null,
    state.remoteMachine?.architecture,
  ]
    .filter(Boolean)
    .join(' · ');
  const appSummary = [
    state.remoteApp?.bundleName || 'nixmac',
    state.remoteApp?.shortVersion || state.remoteApp?.bundleVersion,
    state.remoteApp?.codesignVerified === true ? 'codesign verified' : 'codesign not verified',
  ]
    .filter(Boolean)
    .join(' · ');
  const envSummary = [
    env.processFound === true ? `process ${env.pid || 'found'}` : 'process not found',
    `OpenRouter key ${env.openrouterApiKeyInProcess || 'unknown'}`,
    env.secretValuesRecorded === false ? 'secrets not recorded' : 'secret recording unknown',
  ].join(' · ');
  return `<h2 id="remote-metadata">Remote Mac / App Metadata</h2>
  <section class="summary metadata-summary" aria-label="Remote metadata summary">
    <div class="metric"><strong>Machine</strong>${escapeHtml(machineSummary)}</div>
    <div class="metric"><strong>App</strong>${escapeHtml(appSummary)}</div>
    <div class="metric"><strong>Process</strong>${escapeHtml(envSummary)}</div>
  </section>
  <details class="panel">
    <summary>Full remote metadata tables</summary>
    <section class="meta metadata-grid">
    <div class="panel">
      <h3>Remote Mac</h3>
      <table>${detailRows(state.remoteMachine)}</table>
    </div>
    <div class="panel">
      <h3>Staged App</h3>
      <table>${detailRows(state.remoteApp)}</table>
    </div>
    <div class="panel">
      <h3>Credential Environment Verification</h3>
      <table>${detailRows({
        pid: env.pid,
        processFound: env.processFound,
        openrouterApiKeyInProcess: env.openrouterApiKeyInProcess,
        openrouterApiKeyInGuiLaunchd: env.openrouterApiKeyInGuiLaunchd,
        secretValuesRecorded: env.secretValuesRecorded,
        processEnvKeys: env.processEnvKeys,
        note: env.note,
      })}</table>
    </div>
    </section>
  </details>
  ${state.remoteMetadataError ? `<p class="warning"><strong>Metadata capture error:</strong> ${escapeHtml(state.remoteMetadataError)}</p>` : ''}`;
}

function renderEvolvedCaseStrategy(state) {
  const strategy = state.evolvedCaseStrategy || evolvedCaseStrategy();
  const runs = state.evolvedCaseRuns || [];
  const catalogRows = (strategy.catalog || [])
    .map(
      (item) => `<tr>
        <td><code>${escapeHtml(item.id)}</code><br><small>${escapeHtml(item.label)}</small></td>
        <td>${escapeHtml(item.mode)}</td>
        <td>${item.defaultPrLane ? '<span class="verdict pass">default</span>' : '<span class="grade">optional</span>'}</td>
        <td>${escapeHtml(item.source)}</td>
        <td>${escapeHtml(item.note)}</td>
      </tr>`,
    )
    .join('\n');
  const runRows = runs.length
    ? runs
        .map(
          (run) => `<tr>
            <td><code>${escapeHtml(run.id)}</code><br><small>${escapeHtml(run.label || '')}</small></td>
            <td>${escapeHtml(run.mode || '')}</td>
            <td><span class="verdict ${escapeHtml(run.status || 'inconclusive')}">${escapeHtml(run.status || 'inconclusive')}</span></td>
            <td>${escapeHtml((run.notes || []).join(' '))}</td>
          </tr>`,
        )
        .join('\n')
    : '<tr><td colspan="4">No optional evolved review-only cases were enabled for this run.</td></tr>';
  return `<section>
    <h3>Evolved Flow Case Strategy</h3>
    <p>${escapeHtml(strategy.reviewDecision || '')}</p>
    <p><strong>Default case:</strong> ${escapeHtml((strategy.defaultCaseIds || []).join(', ') || 'none')}<br>
    <strong>Enabled extra cases:</strong> ${escapeHtml((strategy.extraCaseIds || []).join(', ') || 'none')}</p>
    <h3>Case Catalog</h3>
    <div class="table-scroll"><table class="scenario-table">
      <thead><tr><th>Case</th><th>Mode</th><th>PR Lane</th><th>Source</th><th>Notes</th></tr></thead>
      <tbody>${catalogRows}</tbody>
    </table></div>
    <h3>Optional Case Runs</h3>
    <div class="table-scroll"><table class="scenario-table">
      <thead><tr><th>Case</th><th>Mode</th><th>Status</th><th>Evidence</th></tr></thead>
      <tbody>${runRows}</tbody>
    </table></div>
  </section>`;
}

function renderExecutiveSummary(state, counts, evidenceSummary) {
  const pr = state.prFocus || buildPrFocus();
  const prLabel = pr.configured ? `PR ${pr.number || '?'}${pr.title ? ` - ${pr.title}` : ''}` : 'No pull request metadata provided';
  const prStatus = state.scenarios.prSpecificCoverage?.status || 'inconclusive';
  const coverageStatus = state.scenarios.mainCoverageFreshness?.status || 'inconclusive';
  const saveStatus = state.scenarios.saveFlow?.status || 'inconclusive';
  const rollbackStatus = state.scenarios.rollbackCleanup?.status || 'inconclusive';
  const metadataStatus = state.remoteMachine && state.remoteApp ? 'pass' : 'inconclusive';
  const interpretation =
    state.verdict === 'pass'
      ? 'The PR-head run passed on the DXU remote Mac with no failed or inconclusive scenario checks.'
      : state.verdict === 'fail'
        ? 'The run has failures that should be inspected before treating this PR as E2E-clean.'
        : 'The run is inconclusive; inspect setup, provider, and coverage notes before relying on it.';
  const signal = (label, status, note) => `<div class="signal signal-${escapeHtml(status)}">
    <span class="verdict ${escapeHtml(status)}">${escapeHtml(status)}</span>
    <strong>${escapeHtml(label)}</strong>
    <small>${escapeHtml(note)}</small>
  </div>`;
  return `<section id="summary" class="executive panel">
    <div>
      <h2>Review Summary</h2>
      <p>${escapeHtml(interpretation)}</p>
      <p><strong>${escapeHtml(prLabel)}</strong><br><small>Head: <code>${escapeHtml(state.github?.headSha || state.sha || 'unknown')}</code></small></p>
    </div>
    <div class="summary" aria-label="Run summary">
      <div class="metric"><strong>${counts.pass}</strong>Passed</div>
      <div class="metric"><strong>${counts.fail}</strong>Failed</div>
      <div class="metric"><strong>${counts.inconclusive}</strong>Inconclusive</div>
      <div class="metric"><strong>${escapeHtml(String(state.screenshots.length))}</strong>Screenshots</div>
    </div>
    <div class="signal-grid">
      ${signal('PR focus', prStatus, pr.configured ? 'Mapped PR-relevant scenarios were evaluated.' : 'No PR metadata was provided.')}
      ${signal('Coverage freshness', coverageStatus, 'Main user-visible surfaces remain mapped or explicitly waived.')}
      ${signal('Step 3 save', saveStatus, 'Disposable config change persisted through the save path.')}
      ${signal('Rollback cleanup', rollbackStatus, 'History rollback returned the disposable config to baseline.')}
      ${signal('Remote metadata', metadataStatus, 'DXU machine, app, and process metadata were captured.')}
    </div>
    <p class="summary-links">
      <a href="#pull-request-focus">Review PR Focus</a>
      <a href="#findings-first">Inspect Findings</a>
      <a href="#visual-proof">Open Visual Proof</a>
      <a href="#remote-metadata">Check Remote Metadata</a>
    </p>
    <p><small>Evidence footprint: ${escapeHtml(evidenceSummary)}.</small></p>
  </section>`;
}

function navBadge(label, value, tone = '') {
  if (value === undefined || value === null || value === '') return '';
  return `<span class="nav-badge ${escapeHtml(tone)}">${escapeHtml(String(value))}</span>`;
}

function renderReportNav(state, counts) {
  const riskCount = Object.values(state.v2?.scenarioContracts || {}).filter((item) => item.accessibilityRisk === 'high' || item.accessibilityRisk === 'medium').length;
  return `<aside class="report-nav" aria-label="Report navigation">
    <a href="#summary">Summary</a>
    <a href="#pull-request-focus">PR Focus ${navBadge('', state.prFocus?.scenarioKeys?.length || 0)}</a>
    <a href="#findings-first">Findings ${navBadge('', counts.fail + counts.inconclusive, counts.fail ? 'fail' : counts.inconclusive ? 'inconclusive' : 'pass')}</a>
    <a href="#evidence-quality">Evidence Quality ${navBadge('', riskCount)}</a>
    <a href="#visual-proof">Visual Proof ${navBadge('', state.screenshots.length)}</a>
    <a href="#scenario-checklist">Scenario Checklist</a>
    <a href="#main-coverage">Coverage</a>
    <a href="#remote-metadata">Remote Metadata</a>
    <a href="#raw-evidence">Raw Evidence</a>
    <a href="#cleanup">Cleanup</a>
  </aside>`;
}

function renderEvidenceQuality(state) {
  const contracts = Object.values(state.v2?.scenarioContracts || {});
  const strengthCounts = contracts.reduce((counts, item) => {
    counts[item.evidenceStrength] = (counts[item.evidenceStrength] || 0) + 1;
    return counts;
  }, {});
  const strengthRows = ['strong', 'operational', 'visual-supported', 'weak', 'not-proved']
    .map((strength) => `<tr><td><span class="strength strength-${escapeHtml(strength)}">${escapeHtml(strength)}</span></td><td>${escapeHtml(String(strengthCounts[strength] || 0))}</td></tr>`)
    .join('\n');
  const mappingRows = Object.entries(state.v2?.evidenceGradeMapping || {})
    .map(([legacy, strength]) => `<tr><td><code>${escapeHtml(legacy)}</code></td><td><span class="strength strength-${escapeHtml(strength)}">${escapeHtml(strength)}</span></td></tr>`)
    .join('\n');
  const risky = contracts
    .filter((item) => item.accessibilityRisk === 'high' || item.accessibilityRisk === 'medium')
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.accessibilityRisk] ?? 3) - ({ high: 0, medium: 1, low: 2 }[b.accessibilityRisk] ?? 3));
  const riskRows = (items) =>
    items.length
      ? items
          .map(
            (item) => `<tr>
              <td>${escapeHtml(item.label)}<br><small>${escapeHtml(item.assertionTypes.join(', '))}</small></td>
              <td><span class="risk risk-${escapeHtml(item.accessibilityRisk)}">${escapeHtml(item.accessibilityRisk)}</span></td>
              <td>${escapeHtml(item.accessibilityRiskReason)}</td>
            </tr>`,
          )
          .join('\n')
      : '<tr><td colspan="3">No elevated assertion-risk scenarios.</td></tr>';
  const nonPassRows = contracts
    .filter((item) => item.status !== 'pass')
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.label)}</td>
        <td><span class="verdict ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
        <td><span class="failure-class">${escapeHtml(item.failureClass || 'unclassified')}</span></td>
        <td>${escapeHtml(failureTaxonomy[item.failureClass] || item.failureClassReason || 'No classification recorded.')}</td>
      </tr>`,
    )
    .join('\n');
  const taxonomyRows = Object.entries(failureTaxonomy)
    .map(([key, description]) => `<tr><td><code>${escapeHtml(key)}</code></td><td>${escapeHtml(description)}</td></tr>`)
    .join('\n');
  const boundaryRows = state.confirmationBoundaries.length
    ? state.confirmationBoundaries.map((boundary) => `<li>${escapeHtml(boundary)}</li>`).join('\n')
    : '<li>No confirmation boundaries recorded.</li>';
  return `<h2 id="evidence-quality">Evidence Quality</h2>
  <section class="panel">
    <span id="v2-evidence-model" class="anchor-alias"></span>
    <span id="accessibility-risk" class="anchor-alias"></span>
    <span id="failure-taxonomy" class="anchor-alias"></span>
    <span id="confirmation-boundaries" class="anchor-alias"></span>
    <p><strong>Deterministic verdict remains source of truth.</strong> Evidence strength and assertion risk explain how much independent proof backs each scenario.</p>
    <div class="quality-grid">
      <div>
        <h3>Evidence Strength</h3>
        <table><thead><tr><th>Strength</th><th>Count</th></tr></thead><tbody>${strengthRows}</tbody></table>
      </div>
      <div>
        <h3>Elevated Assertion Risk</h3>
        <table><thead><tr><th>Scenario</th><th>Risk</th><th>Why</th></tr></thead><tbody>${riskRows(risky)}</tbody></table>
      </div>
    </div>
    <h3>Failure Classification</h3>
    ${
      nonPassRows
        ? `<div class="table-scroll"><table><thead><tr><th>Scenario</th><th>Status</th><th>Class</th><th>Meaning</th></tr></thead><tbody>${nonPassRows}</tbody></table></div>`
        : '<p>No non-pass scenarios require failure classification.</p>'
    }
    <details>
      <summary>Confirmation boundaries</summary>
      <ul>${boundaryRows}</ul>
    </details>
    <details>
      <summary>Full assertion-risk table</summary>
      <div class="table-scroll"><table><thead><tr><th>Scenario</th><th>Risk</th><th>Why</th></tr></thead><tbody>${riskRows(contracts)}</tbody></table></div>
    </details>
    <details>
      <summary>Legacy grade mapping</summary>
      <table><thead><tr><th>V1 Grade</th><th>V2 Strength</th></tr></thead><tbody>${mappingRows}</tbody></table>
    </details>
    <details>
      <summary>Taxonomy definitions</summary>
      <table><thead><tr><th>Class</th><th>Definition</th></tr></thead><tbody>${taxonomyRows}</tbody></table>
    </details>
  </section>`;
}

function renderScenarioChecklist(state, groupedScenarioHtml) {
  return `<h2 id="scenario-checklist">Scenario Checklist</h2>
  <p>Grouped scenario tables are collapsed by default so reviewers can drill into a specific surface without reading the whole suite linearly.</p>
  ${groupedScenarioHtml}`;
}

function renderRunMetadata(state, evidenceSummary) {
  return `<section class="meta run-metadata">
    <div class="panel"><strong>Timestamp</strong><br>${escapeHtml(state.startedAt)}</div>
    <div class="panel"><strong>Branch</strong><br>${escapeHtml(state.branch)}</div>
    <div class="panel"><strong>SHA</strong><br><code>${escapeHtml(state.sha)}</code></div>
    <div class="panel"><strong>macOS</strong><br>${escapeHtml(state.remoteMachine?.macosProductVersion || state.macosVersion)}</div>
    <div class="panel"><strong>App</strong><br><code>${escapeHtml(state.app)}</code></div>
    <div class="panel"><strong>Provider</strong><br><code>${escapeHtml(state.provider.kind)}</code><br>${escapeHtml(state.provider.note)}</div>
    <div class="panel"><strong>Prompt</strong><br>${escapeHtml(state.prompt)}</div>
    <div class="panel"><strong>Evidence</strong><br>${escapeHtml(evidenceSummary)}</div>
  </section>`;
}

function renderRawEvidence(state, screenshotHtml) {
  return `<h2 id="raw-evidence">Raw Evidence</h2>
  <section class="panel">
    <span id="screenshots" class="anchor-alias"></span>
    <span id="narrative" class="anchor-alias"></span>
    <span id="claims" class="anchor-alias"></span>
    <span id="pr-specific-focus" class="anchor-alias"></span>
    <details>
      <summary>Full screenshot gallery (${escapeHtml(String(state.screenshots.length))})</summary>
      ${screenshotHtml}
    </details>
    <details>
      <summary>Human QA narrative (${escapeHtml(String(state.narrative.length))})</summary>
      ${
        state.narrative.length
          ? `<ul>${state.narrative.map((item) => `<li>${escapeHtml(item.ts)} - ${escapeHtml(item.text)}</li>`).join('\n')}</ul>`
          : '<p>No narrative recorded.</p>'
      }
    </details>
    <details>
      <summary>Claims vs evidence (${escapeHtml(String(state.claims.length))})</summary>
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
    </details>
    <details>
      <summary>Run metadata</summary>
      ${renderRunMetadata(state, `${state.screenshots.length} screenshots, ${state.textSnapshots.length} redacted text snapshots`)}
    </details>
  </section>`;
}

async function baseState(runDir, options) {
  const branch = tryRun('git', ['branch', '--show-current'], { cwd: REPO_ROOT }).stdout || 'unknown';
  const sha = tryRun('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT }).stdout || 'unknown';
  const macosVersion =
    process.env.NIXMAC_E2E_MACOS_VERSION ||
    tryRun('sw_vers', ['-productVersion']).stdout ||
    'unknown';
  const remoteAppPath = process.env.NIXMAC_E2E_REMOTE_APP_PATH || '/Applications/nixmac.app';
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
    appCommand: process.env.NIXMAC_E2E_APP_COMMAND || `open -n ${remoteAppPath}`,
    provider: {
      kind: 'real-openrouter-compatible-provider',
      note: 'The key value is never written to this report. Failures may reflect provider billing/auth state.',
    },
    evolvedCaseStrategy: evolvedCaseStrategy(),
    evolvedCaseRuns: [],
    safety: {
      disposableConfig: process.env.NIXMAC_E2E_DISPOSABLE_CONFIG === 'true',
      buildConfirmEnabled: process.env.NIXMAC_E2E_ALLOW_BUILD_CONFIRM === 'true',
      discardConfirmEnabled: process.env.NIXMAC_E2E_ALLOW_DISCARD_CONFIRM === 'true',
      note: 'Discard/build confirmation is only allowed when disposable config mode is explicitly proven.',
    },
    prFocus: buildPrFocus(),
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
    const dimensions = pngDimensions(pngPath);
    state.screenshots.push({
      label,
      path: path.relative(state.runDir, pngPath),
      capturedAt: new Date().toISOString(),
      note: redact(note),
      source: 'Codex Computer Use get_app_state image',
      ...(dimensions ? { imageSize: dimensions } : {}),
    });
  } else if (image && sensitiveImage) {
    await addEvent(state, 'computer-use.screenshot-omitted', {
      label,
      reason: 'Sensitive view image omitted from screenshot artifacts; redacted accessibility text snapshot retained.',
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
  let response;
  try {
    response = await client.tool('click', { app: state.app, element_index: elementIndex }, 60000);
  } catch (error) {
    await addEvent(state, 'computer-use.click.failed', {
      label,
      elementIndex,
      error: redact(error instanceof Error ? error.message : String(error)).slice(0, 800),
      note,
    });
    return false;
  }
  const rawResponseText = contentText(response);
  const responseText = redact(rawResponseText);
  if (clickResponseIndicatesFailure(response, rawResponseText)) {
    await addEvent(state, 'computer-use.click.failed', {
      label,
      elementIndex,
      response: responseText.slice(0, 800),
      isError: response?.result?.isError === true,
      note,
    });
    return false;
  }
  await addEvent(state, 'computer-use.click', { label, elementIndex, response: responseText.slice(0, 800), note });
  return true;
}

async function setValueByPattern(client, state, text, label, patterns, value) {
  const elementIndex = findElement(text, patterns);
  if (!elementIndex) {
    await addEvent(state, 'computer-use.set_value.skipped', { label, note: `No element found for ${label}` });
    return false;
  }
  let response;
  try {
    response = await client.tool('set_value', { app: state.app, element_index: elementIndex, value }, 60000);
  } catch (error) {
    await addEvent(state, 'computer-use.set_value.failed', {
      label,
      elementIndex,
      error: redact(error instanceof Error ? error.message : String(error)).slice(0, 800),
    });
    return false;
  }
  const rawResponseText = contentText(response);
  const responseText = redact(rawResponseText);
  if (setValueResponseIndicatesFailure(response, rawResponseText)) {
    await addEvent(state, 'computer-use.set_value.failed', {
      label,
      elementIndex,
      response: responseText.slice(0, 800),
      isError: response?.result?.isError === true,
    });
    return false;
  }
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
  const remoteAppPath = process.env.NIXMAC_E2E_REMOTE_APP_PATH || '/Applications/nixmac.app';
  const result = ssh(
    `osascript -e 'tell application id "com.darkmatter.nixmac" to quit' >/dev/null 2>&1 || true; sleep 1; open -n ${shellQuote(remoteAppPath)} || true; sleep 5`,
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

function captureRemoteMetadata(state) {
  const remoteAppPath = process.env.NIXMAC_E2E_REMOTE_APP_PATH || '/Applications/nixmac.app';
  const script = String.raw`
import hashlib
import json
import os
import plistlib
import re
import socket
import subprocess

def run(args):
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=15)
        return {"ok": result.returncode == 0, "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}
    except Exception as exc:
        return {"ok": False, "stdout": "", "stderr": str(exc)}

def first(*commands):
    for command in commands:
        result = run(command)
        if result["ok"] and result["stdout"]:
            return result["stdout"]
    return ""

def file_sha256(path):
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except Exception:
        return ""

app_path = os.environ.get("APP_PATH", "")
plist_path = os.path.join(app_path, "Contents", "Info.plist")
info = {}
try:
    with open(plist_path, "rb") as handle:
        info = plistlib.load(handle)
except Exception:
    info = {}

exe_name = info.get("CFBundleExecutable") or "nixmac"
exe_path = os.path.join(app_path, "Contents", "MacOS", exe_name)
codesign = run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", app_path])
codesign_detail = run(["codesign", "-dv", "--verbose=4", app_path])
codesign_text = "\n".join([codesign["stdout"], codesign["stderr"], codesign_detail["stdout"], codesign_detail["stderr"]])

pid = first(["pgrep", "-x", "nixmac"])
pid = pid.splitlines()[-1] if pid else ""
ps_env = run(["ps", "eww", "-p", pid]) if pid else {"ok": False, "stdout": "", "stderr": "nixmac process not found"}
env_text = ps_env["stdout"]
env_keys = sorted(set(re.findall(r"(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]{1,80})=", env_text)))
openrouter_in_process = "OPENROUTER_API_KEY=" in env_text
launchd_key = run(["launchctl", "getenv", "OPENROUTER_API_KEY"])

print(json.dumps({
    "remoteMachine": {
        "hostname": socket.gethostname(),
        "localHostName": first(["scutil", "--get", "LocalHostName"]),
        "computerName": first(["scutil", "--get", "ComputerName"]),
        "consoleUser": first(["stat", "-f", "%Su", "/dev/console"]),
        "macosProductVersion": first(["sw_vers", "-productVersion"]),
        "macosBuildVersion": first(["sw_vers", "-buildVersion"]),
        "kernel": first(["uname", "-a"]),
        "architecture": first(["uname", "-m"]),
        "hardwareModel": first(["sysctl", "-n", "hw.model"]),
        "cpuBrand": first(["sysctl", "-n", "machdep.cpu.brand_string"]),
    },
    "remoteApp": {
        "path": app_path,
        "bundleIdentifier": info.get("CFBundleIdentifier", ""),
        "bundleName": info.get("CFBundleName", ""),
        "shortVersion": info.get("CFBundleShortVersionString", ""),
        "bundleVersion": info.get("CFBundleVersion", ""),
        "executable": exe_path,
        "executableSha256": file_sha256(exe_path),
        "codesignVerified": codesign["ok"],
        "teamIdentifier": (re.search(r"TeamIdentifier=(.*)", codesign_text) or ["", ""])[1].strip(),
        "designatedRequirement": (re.search(r"designated => (.*)", codesign_text) or ["", ""])[1].strip(),
    },
    "processEnvVerification": {
        "pid": pid,
        "processFound": bool(pid),
        "secretValuesRecorded": False,
        "processEnvKeys": env_keys,
        "openrouterApiKeyInProcess": "present-redacted" if openrouter_in_process else "absent-or-not-visible",
        "openrouterApiKeyInGuiLaunchd": "present-redacted" if launchd_key["stdout"] else "absent",
        "note": "The launched nixmac process environment is the source of truth for this run. launchctl getenv is diagnostic only and may be absent when the app is launched with an inline environment. Only environment variable names and presence checks are recorded; secret values are never written to the report.",
    }
}, sort_keys=True))
`;
  const result = ssh(`APP_PATH=${shellQuote(remoteAppPath)} python3 -c ${shellQuote(script)}`);
  if (!result.ok) {
    state.remoteMetadataError = redact(result.stderr || result.stdout || 'Remote metadata command failed.');
    return;
  }
  try {
    const metadata = JSON.parse(result.stdout);
    state.remoteMetadata = metadata;
    state.remoteMachine = metadata.remoteMachine;
    state.remoteApp = metadata.remoteApp;
    state.processEnvVerification = metadata.processEnvVerification;
    if (state.remoteMachine?.macosProductVersion) state.remoteMacosVersion = state.remoteMachine.macosProductVersion;
  } catch (error) {
    state.remoteMetadataError = redact(error instanceof Error ? error.message : String(error));
  }
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

async function restoreRemoteBaseline(state, label) {
  if (state.safety?.disposableConfig !== true || !state.remoteConfig?.baselineHead || !state.remoteConfig?.configDir) {
    await addEvent(state, 'remote.git.restore-baseline.skipped', {
      label,
      reason: 'External git reset cleanup requires a proven disposable config and a prepared baseline.',
    });
    return { ok: false, reason: 'not-disposable-or-no-baseline' };
  }
  const command = [
    `cd ${shellQuote(state.remoteConfig.configDir)}`,
    `git reset --hard ${shellQuote(state.remoteConfig.baselineHead)} >/dev/null`,
    'git clean -fd >/dev/null',
  ].join('; ');
  const result = ssh(command);
  await addEvent(state, 'remote.git.restore-baseline', {
    label,
    ok: result.ok,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr),
  });
  const snapshot = remoteGitSnapshot(state.remoteConfig.configDir, state.remoteConfig.baselineHead);
  await addRemoteGitEvent(state, `remote.git.${label}.restore-baseline`, snapshot);
  return { ok: result.ok && snapshot.ok && !snapshot.statusShort && !meaningfulBaselineDiff(snapshot), snapshot };
}

function evidenceMatches(text, patterns = []) {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

async function cleanupReviewOnlyCase(client, state, text, caseDef) {
  const discardOpened = await clickByPattern(client, state, text, `Discard ${caseDef.id}`, [/Discard/i], `Open Discard for ${caseDef.label}.`);
  if (discardOpened) {
    text = await captureState(client, state, `evolved-${caseDef.id}-discard-boundary`, `Computer Use opened Discard for ${caseDef.label}.`);
    const canConfirmDiscard = state.safety?.disposableConfig === true && state.safety?.discardConfirmEnabled === true;
    if (canConfirmDiscard) {
      await clickByPattern(client, state, text, `Confirm discard ${caseDef.id}`, [/button Confirm/i, /^button Discard$/i], `Confirm Discard for ${caseDef.label}.`);
      const cleaned = await waitForRemoteGit(
        state,
        `evolved-${caseDef.id}-discard-clean`,
        (snapshot) => snapshot?.ok && !snapshot.statusShort && !meaningfulBaselineDiff(snapshot),
        { attempts: 20, delayMs: 1000 },
      );
      text = await captureState(client, state, `evolved-${caseDef.id}-after-discard`, `Computer Use cleaned up ${caseDef.label}.`);
      return { ok: cleaned.ok, text, method: 'discard' };
    }
    await clickByPattern(client, state, text, `Cancel discard ${caseDef.id}`, [/Cancel/i, /Close/i, /^button ×/i, /^button X/i], `Cancel Discard for ${caseDef.label}.`);
  }
  const restored = await restoreRemoteBaseline(state, `evolved-${caseDef.id}`);
  await maybeRelaunchRemote(state);
  text = await captureState(client, state, `evolved-${caseDef.id}-after-discard`, `Computer Use relaunched after external cleanup for ${caseDef.label}.`);
  return { ok: restored.ok, text, method: 'external-restore' };
}

async function runReviewOnlyEvolvedCase(client, state, caseDef) {
  state.scenarios[caseDef.scenarioKey] ||= {
    label: `Optional evolved case: ${caseDef.label}`,
    status: 'inconclusive',
    notes: [],
  };
  const run = {
    id: caseDef.id,
    label: caseDef.label,
    mode: caseDef.mode,
    status: 'inconclusive',
    notes: [],
    startedAt: new Date().toISOString(),
  };
  state.evolvedCaseRuns.push(run);
  await addEvent(state, 'evolved-case.started', { id: caseDef.id, mode: caseDef.mode, prompt: redact(caseDef.prompt) });
  await maybeRelaunchRemote(state);
  let text = await captureState(client, state, `evolved-${caseDef.id}-home`, `Computer Use started optional evolved case: ${caseDef.label}.`);
  const inputSet = await setValueByPattern(client, state, text, `Prompt input ${caseDef.id}`, [/text entry area/i], caseDef.prompt);
  text = await captureState(client, state, `evolved-${caseDef.id}-typed`, `Computer Use entered optional evolved prompt: ${caseDef.label}.`);
  if (!inputSet || !text.includes(caseDef.prompt)) {
    run.status = 'fail';
    run.notes.push('Could not enter the optional evolved prompt.');
    updateScenario(state, caseDef.scenarioKey, 'fail', run.notes.at(-1));
    return text;
  }
  const submitted = await clickByPattern(client, state, text, `Send ${caseDef.id}`, [/button Send/i], `Submit optional evolved prompt: ${caseDef.label}.`);
  if (!submitted) {
    run.status = 'fail';
    run.notes.push('Could not submit the optional evolved prompt.');
    updateScenario(state, caseDef.scenarioKey, 'fail', run.notes.at(-1));
    return text;
  }
  const wait = await waitFor(
    client,
    state,
    `evolved-${caseDef.id}-provider-progress`,
    (candidate) => {
      if (/heading Review|button Build & Test|button Discard|Summary|Diff/i.test(candidate)) return 'review';
      if (/Payment Required|Insufficient credits|out of credits|billing limit/i.test(candidate)) return 'billing-error';
      if (/No API key|missing API key|API key is required|invalid API key|Unauthorized|401/i.test(candidate)) return 'credential-error';
      if (/Provider request failed|provider error|OpenRouter error|fatal error|uncaught/i.test(candidate)) return 'provider-error';
      return null;
    },
    { attempts: Number(process.env.NIXMAC_E2E_EXTRA_PROVIDER_ATTEMPTS || 36), delayMs: Number(process.env.NIXMAC_E2E_PROVIDER_DELAY_MS || 5000) },
  );
  text = wait.text;
  if (wait.result !== 'review') {
    run.status = wait.result ? 'fail' : 'inconclusive';
    run.notes.push(wait.result ? `Provider reached ${wait.result} before Review.` : 'Review did not appear before the optional-case polling window ended.');
    updateScenario(state, caseDef.scenarioKey, run.status, run.notes.at(-1));
    return text;
  }
  let evidenceText = text;
  if (await clickByPattern(client, state, text, `Summary ${caseDef.id}`, [/Summary/i], `Open Summary for ${caseDef.label}.`)) {
    text = await captureState(client, state, `evolved-${caseDef.id}-summary`, `Computer Use opened Summary for ${caseDef.label}.`);
    evidenceText += `\n${text}`;
  }
  if (await clickByPattern(client, state, text, `Diff ${caseDef.id}`, [/Diff/i], `Open Diff for ${caseDef.label}.`)) {
    text = await captureState(client, state, `evolved-${caseDef.id}-diff`, `Computer Use opened Diff for ${caseDef.label}.`);
    evidenceText += `\n${text}`;
  }
  const matches = evidenceMatches(evidenceText, caseDef.expectedEvidence);
  const cleanup = await cleanupReviewOnlyCase(client, state, text, caseDef);
  run.status = matches >= 2 && cleanup.ok ? 'pass' : matches >= 2 ? 'inconclusive' : 'fail';
  run.notes.push(
    matches >= 2
      ? `Review evidence matched ${matches}/${caseDef.expectedEvidence.length} screenshot-defaults tokens.`
      : `Review evidence matched only ${matches}/${caseDef.expectedEvidence.length} screenshot-defaults tokens.`,
  );
  run.notes.push(cleanup.ok ? `Cleanup succeeded via ${cleanup.method}.` : `Cleanup did not prove a clean baseline via ${cleanup.method}.`);
  run.completedAt = new Date().toISOString();
  updateScenario(state, caseDef.scenarioKey, run.status, run.notes.join(' '));
  return cleanup.text;
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

async function render(state, { stateFileName = 'state.json', recordEvent = true } = {}) {
  ensureCurrentSchema(state);
  const verdict = verdictFor(state);
  state.verdict = verdict;
  updateV2Contracts(state);
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
  const counts = statusCounts(state);
  const groupedScenarioHtml = groupedScenarios(state)
    .map(
      (group) => {
        const groupCounts = {
          pass: group.items.filter((item) => item.status === 'pass').length,
          fail: group.items.filter((item) => item.status === 'fail').length,
          inconclusive: group.items.filter((item) => item.status === 'inconclusive').length,
        };
        return `<details class="group">
  <summary>${escapeHtml(group.name)} <span class="nav-badge pass">${groupCounts.pass} pass</span>${groupCounts.fail ? ` <span class="nav-badge fail">${groupCounts.fail} fail</span>` : ''}${groupCounts.inconclusive ? ` <span class="nav-badge inconclusive">${groupCounts.inconclusive} inconclusive</span>` : ''}</summary>
  <div class="table-scroll"><table class="scenario-table">
    <thead><tr><th class="scenario-col">Scenario</th><th class="status-col">Status</th><th class="grade-col">Evidence Grade</th><th class="artifacts-col">Primary Artifacts</th><th class="proof-col">What Proved It</th><th class="untested-col">Still Untested</th></tr></thead>
    <tbody>
      ${group.items
        .map((item) => {
          const proof = proofForScenario(state, item.key);
          const contract = state.v2?.scenarioContracts?.[item.key] || buildScenarioContract(state, item.key);
          return `<tr><td class="scenario-cell">${escapeHtml(item.label)}<br><small>${item.notes.map(escapeHtml).join('<br>') || 'No notes recorded.'}</small></td><td class="status-cell"><span class="verdict ${item.status}">${escapeHtml(item.status)}</span></td><td class="grade-cell"><span class="grade">${escapeHtml(proof.grade)}</span><br><span class="strength strength-${escapeHtml(contract.evidenceStrength)}">${escapeHtml(contract.evidenceStrength)}</span></td><td class="artifact-cell">${artifactLinks(state, item.key)}</td><td class="proof-cell">${escapeHtml(proof.proof)}${contract.failureClass ? `<br><small>Failure class: ${escapeHtml(contract.failureClass)}</small>` : ''}</td><td>${escapeHtml(proof.untested)}</td></tr>`;
        })
        .join('\n')}
    </tbody>
  </table></div>
  </details>`;
      },
    )
    .join('\n');
  const evidenceSummary = `${state.screenshots.length} screenshots, ${state.textSnapshots.length} redacted text snapshots`;
  const coverageGapsHtml = renderCoverageGaps(state);
  const prPriorityHtml = renderPrPriority(state);
  const priorityTriageHtml = renderPriorityTriage(state);
  const executiveSummaryHtml = renderExecutiveSummary(state, counts, evidenceSummary);
  const reportNavHtml = renderReportNav(state, counts);
  const evidenceQualityHtml = renderEvidenceQuality(state);
  const visualProofHtml = await renderVisualProofBoard(state);
  const remoteMetadataHtml = renderRemoteMetadata(state);
  const rawEvidenceHtml = renderRawEvidence(state, screenshotHtml);
  const scenarioChecklistHtml = renderScenarioChecklist(state, groupedScenarioHtml);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>nixmac Computer Use E2E Evidence</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #111318; color: #eef1f5; }
    main { max-width: 1460px; margin: 0 auto; padding: 32px 20px 56px; }
    h1, h2, h3 { margin: 0 0 12px; }
    h1 { font-size: 28px; letter-spacing: 0; }
    html { scroll-behavior: smooth; }
    h2 { font-size: 18px; margin-top: 30px; letter-spacing: 0; }
    h2[id], .anchor-alias { scroll-margin-top: 18px; }
    h3 { font-size: 15px; margin-top: 18px; color: #f6f8fb; letter-spacing: 0; }
    p, li { color: #c5cbd3; line-height: 1.5; }
    .lede { max-width: 850px; color: #d9dee6; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 18px 0; }
    .panel { border: 1px solid #303640; border-radius: 8px; padding: 14px; background: #171a21; overflow-wrap: anywhere; }
    .metadata-grid .panel { overflow-x: auto; }
    .report-shell { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 22px; align-items: start; margin-top: 22px; }
    .report-nav { position: sticky; top: 14px; display: grid; gap: 8px; padding: 12px; border: 1px solid #303640; border-radius: 8px; background: rgba(17, 19, 24, 0.96); backdrop-filter: blur(8px); }
    .report-nav a, .summary-links a { border: 1px solid #3c4654; border-radius: 999px; padding: 7px 10px; color: #dce3ec; text-decoration: none; font-size: 13px; line-height: 1.15; background: #171a21; }
    .report-nav a:hover, .summary-links a:hover { border-color: #7fbfff; color: #a7d7ff; }
    .report-content { min-width: 0; }
    .warning { color: #ffd36e; }
    .metric { border: 1px solid #303640; border-radius: 8px; padding: 14px; background: #171a21; }
    .metric strong { display: block; font-size: 28px; color: #fff; margin-bottom: 4px; }
    .executive { border-color: #3c4654; background: #151922; }
    .signal-grid, .quality-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin: 16px 0; }
    .signal { border: 1px solid #303640; border-radius: 8px; padding: 10px; background: #111318; }
    .signal strong { display: block; margin: 8px 0 4px; }
    .summary-links { display: flex; flex-wrap: wrap; gap: 8px; }
    .nav-badge { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #3c4654; border-radius: 999px; padding: 2px 6px; margin-left: 4px; font-size: 11px; color: #dce3ec; background: #20242d; }
    .verdict { display: inline-block; border-radius: 999px; padding: 5px 10px; font-weight: 700; text-transform: uppercase; }
    .pass { background: #123d2a; color: #8bf0bb; }
    .fail { background: #471a1a; color: #ff9e9e; }
    .inconclusive { background: #443512; color: #ffd36e; }
    .group { margin-top: 18px; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 8px; }
    .table-scroll { width: 100%; overflow-x: auto; border-radius: 8px; }
    .scenario-table { min-width: 1050px; table-layout: fixed; }
    th, td { border: 1px solid #303640; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #20242d; }
    .scenario-table th { white-space: nowrap; }
    .scenario-table .scenario-col { width: 30%; }
    .scenario-table .status-col { width: 92px; }
    .scenario-table .grade-col { width: 138px; }
    .scenario-table .artifacts-col { width: 190px; }
    .scenario-table .proof-col { width: 29%; }
    .scenario-table .untested-col { width: 20%; }
    img { width: 100%; max-width: 100%; border: 1px solid #303640; border-radius: 8px; background: #000; }
    small { color: #9ba3ae; }
    pre { max-height: 280px; overflow: auto; white-space: pre-wrap; border: 1px solid #303640; border-radius: 8px; padding: 10px; background: #0d0f14; color: #dce3ec; }
    details { margin: 10px 0; }
    summary { cursor: pointer; color: #a7d7ff; }
    details > summary { font-weight: 700; margin: 12px 0; }
    .grade { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #3c4654; border-radius: 999px; padding: 4px 8px; color: #dce3ec; background: #20242d; font-size: 12px; line-height: 1.15; white-space: nowrap; }
    .verdict { white-space: nowrap; text-align: center; }
    .scenario-table .status-cell { width: 92px; min-width: 92px; text-align: center; }
    .scenario-table .grade-cell { width: 138px; min-width: 138px; text-align: center; }
    .scenario-table .status-cell .verdict { min-width: 54px; padding-left: 8px; padding-right: 8px; }
    .strength, .risk, .failure-class { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; padding: 4px 8px; font-size: 12px; line-height: 1.15; font-weight: 700; white-space: nowrap; }
    .strength { margin-top: 6px; border: 1px solid #3c4654; background: #20242d; color: #dce3ec; }
    .strength-strong { background: #103829; color: #8bf0bb; border-color: #236b4c; }
    .strength-operational { background: #173247; color: #a7d7ff; border-color: #315f82; }
    .strength-visual-supported { background: #342f18; color: #ffe08a; border-color: #66592a; }
    .strength-weak, .risk-high { background: #471a1a; color: #ffb0b0; border-color: #744; }
    .strength-not-proved, .risk-medium { background: #443512; color: #ffd36e; border-color: #705c22; }
    .risk-low { background: #123d2a; color: #8bf0bb; border-color: #236b4c; }
    .failure-class { background: #20242d; color: #dce3ec; border: 1px solid #3c4654; }
    .artifact-list { max-height: 230px; overflow: auto; padding-right: 4px; }
    .priority table { margin-bottom: 18px; }
    .proof-card { margin-top: 18px; border: 1px solid #303640; border-radius: 8px; padding: 14px; background: #151922; }
    .annotated-shot { position: relative; overflow: hidden; border: 1px solid #303640; border-radius: 8px; background: #000; }
    .annotated-shot img { display: block; border: 0; border-radius: 0; }
    .annotation { position: absolute; box-sizing: border-box; border: 1.5px solid rgba(255, 214, 94, 0.95); border-radius: 5px; background: rgba(255, 214, 94, 0.10); box-shadow: inset 0 0 0 1px rgba(20, 19, 13, 0.35), 0 8px 24px rgba(0,0,0,0.28); pointer-events: none; }
    .annotation::after { content: ""; position: absolute; inset: -4px; border: 1px solid rgba(255, 214, 94, 0.28); border-radius: 8px; }
    .annotation span { position: absolute; left: 6px; top: 6px; max-width: min(260px, calc(100% - 12px)); border-radius: 4px; padding: 3px 6px; background: rgba(255, 214, 94, 0.95); color: #111318; font-size: 12px; line-height: 1.15; font-weight: 700; white-space: normal; box-shadow: 0 2px 8px rgba(0,0,0,0.22); }
    .annotation-pin { border-radius: 999px; }
    .annotation-pin::after { border-radius: 999px; inset: -5px; }
    .annotation-pin span { left: 50%; top: -28px; transform: translateX(-50%); white-space: nowrap; max-width: none; }
    .anchor-alias { display: block; height: 0; overflow: hidden; }
    figure { margin: 0 0 18px; }
    figcaption { margin-top: 6px; color: #c5cbd3; font-size: 13px; }
    code { color: #a7d7ff; overflow-wrap: anywhere; }
    ul { padding-left: 20px; }
    @media (max-width: 860px) {
      main { padding: 24px 12px 44px; }
      .report-shell { display: block; }
      .report-nav { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: nowrap; overflow-x: auto; margin: 18px 0; }
      .report-nav a { white-space: nowrap; }
    }
  </style>
</head>
<body>
<main>
  <h1>nixmac Computer Use E2E Evidence</h1>
  <p class="lede">Remote desktop QA driven through Codex Computer Use against the real macOS app. The report summarizes major feature coverage, functional UX/UI checks, screenshots, redacted text evidence, and remote machine metadata.</p>
  <p><span class="verdict ${verdict}">Verdict: ${verdict}</span></p>

  ${executiveSummaryHtml}

  <div class="report-shell">
    ${reportNavHtml}
    <div class="report-content">
      ${prPriorityHtml}

      <h2 id="findings-first">Findings</h2>
      <p>Failures are shown first, then inconclusive checks. Passing checks stay collapsed unless a reviewer wants the full inventory.</p>
      ${priorityTriageHtml}

      ${evidenceQualityHtml}

      <h2 id="visual-proof">Visual Proof</h2>
      <p>Annotations are reviewer aids, not the sole assertion source. The pass/fail source of truth is the paired Computer Use accessibility text and recorded action events.</p>
      ${visualProofHtml}

      ${scenarioChecklistHtml}

      ${coverageFreshnessHtml}

      <h2 id="coverage-gaps">Coverage Gaps / Not Proved</h2>
      ${coverageGapsHtml}

      ${remoteMetadataHtml}

      <details class="panel" id="evolved-flow">
        <summary>Evolved Flow Case Strategy</summary>
        ${renderEvolvedCaseStrategy(state)}
      </details>

      ${rawEvidenceHtml}

      <h2 id="cleanup">Cleanup / Restore Status</h2>
      <section class="panel">
        <p>${escapeHtml(state.cleanup.note)}</p>
      </section>
    </div>
  </div>
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
  if (args.includes('--prompt') || process.env.NIXMAC_E2E_PROMPT) {
    throw new Error('Custom prompts are not supported by this E2E runner; assertions are calibrated to the fixed bat/Homebrew prompt.');
  }
  const options = {
    ws: process.env.NIXMAC_COMPUTER_USE_WS || DEFAULT_WS,
    app: process.env.NIXMAC_COMPUTER_USE_APP || DEFAULT_APP,
    prompt: DEFAULT_PROMPT,
  };
  const runDir = argValue(args, '--run-dir', path.join(ARTIFACT_ROOT, timestampSlug()));
  await mkdir(path.join(runDir, 'screenshots'), { recursive: true });
  await mkdir(path.join(runDir, 'texts'), { recursive: true });
  const state = await baseState(runDir, options);
  await saveState(state);

  const client = new AppServerClient(options.ws);
  try {
    await client.connect();
    await prepareDisposableRemoteBaseline(state);
    await maybeRelaunchRemote(state);
    captureRemoteMetadata(state);

    let text = await captureState(client, state, 'launch', 'Computer Use observed the nixmac window at launch.');
    if (/nixmac/i.test(text) && hasAny(text, [/button Settings/i, /text entry area/i, /Get started/i, /Progress: step 1 of 3/i])) {
      updateScenario(state, 'launch', 'pass', 'Computer Use saw the nixmac app window, prompt surface, progress stepper, and top-level controls.');
    } else {
      updateScenario(state, 'launch', 'fail', 'Computer Use did not see a usable nixmac app window.');
    }

    const updateDismissButtonPresent = Boolean(findElement(text, [/button Dismiss/i]));
    const updateDismissed = await clickByPattern(client, state, text, 'Dismiss update banner', [/button Dismiss/i], 'Dismiss update/error banner if present.');
    if (updateDismissed) {
      text = await captureState(client, state, 'after-dismiss', 'Computer Use clicked a visible Dismiss button.');
      updateScenario(state, 'updateBanner', 'pass', 'A visible Dismiss button was clicked and the UI remained usable.');
    } else if (updateDismissButtonPresent) {
      updateScenario(state, 'updateBanner', 'fail', 'A visible Dismiss button was present, but Computer Use could not click it.');
    } else {
      updateScenario(state, 'updateBanner', 'pass', 'No dismissible update banner was visible; no banner blocked the main workflow.');
    }

    const settingsOpened = await clickByPattern(client, state, text, 'Settings', [/button Settings/i], 'Open Settings.');
    text = await captureState(client, state, 'settings-general', 'Computer Use opened Settings.');
    if (settingsOpened && hasSettingsGeneralEvidence(text)) {
      updateScenario(state, 'settingsGeneral', 'pass', 'Settings opened and General-related content was visible.');
    } else {
      updateScenario(state, 'settingsGeneral', 'fail', 'Computer Use could not open Settings General.');
    }

    if (await clickByPattern(client, state, text, 'AI Models tab', [/AI Models/i], 'Open AI Models settings.')) {
      text = await captureState(client, state, 'settings-ai-models', 'Computer Use opened AI Models settings.');
      const aiModelsVisible = hasSettingsAIModelsEvidence(text);
      updateScenario(state, 'settingsAIModels', aiModelsVisible ? 'pass' : 'fail', aiModelsVisible ? 'AI Models settings content was visible with provider/model controls.' : 'AI Models tab did not visibly render expected content.');
    } else {
      updateScenario(state, 'settingsAIModels', 'fail', 'Computer Use could not click the AI Models settings tab.');
    }

    if (await clickByPattern(client, state, text, 'API Keys tab', [/API Keys/i], 'Open API Keys settings.')) {
      const apiWait = await waitFor(
        client,
        state,
        'settings-api-keys',
        (candidate) => (hasSettingsAPIKeysEvidence(candidate) ? 'rendered' : null),
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
    } else {
      updateScenario(state, 'settingsAPIKeys', 'fail', 'Computer Use could not click the API Keys settings tab.');
    }

    if (state.scenarios.settingsAPIKeys.status === 'fail') {
      await maybeRelaunchRemote(state);
      text = await captureState(client, state, 'recover-after-api-keys', 'Relaunched after API Keys blank-screen reproduction so the rest of the suite could continue.');
      await clickByPattern(client, state, text, 'Settings after recovery', [/button Settings/i], 'Reopen Settings after recovery.');
      text = await captureState(client, state, 'settings-after-recovery', 'Computer Use reopened Settings after recovery.');
    }

    if (await clickByPattern(client, state, text, 'Preferences tab', [/Preferences/i], 'Open Preferences settings.')) {
      text = await captureState(client, state, 'settings-preferences', 'Computer Use opened Preferences settings.');
      const preferencesVisible = hasSettingsPreferencesEvidence(text);
      updateScenario(state, 'settingsPreferences', preferencesVisible ? 'pass' : 'fail', preferencesVisible ? 'Preferences settings content was visible with confirmation controls.' : 'Preferences tab did not visibly render expected content.');
    } else {
      updateScenario(state, 'settingsPreferences', 'fail', 'Computer Use could not click the Preferences settings tab.');
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
      const summaryClicked = await clickByPattern(client, state, text, 'Summary tab', [/Summary/i], 'Open Summary tab.');
      if (summaryClicked) {
        text = await captureState(client, state, 'review-summary', 'Computer Use opened Summary after Review.');
        const summaryMatchesIntent = /bat/i.test(text) && /Homebrew|brew|package|command line/i.test(text);
        updateScenario(state, 'summary', summaryMatchesIntent ? 'pass' : 'fail', summaryMatchesIntent ? 'Summary described the requested bat/Homebrew package intent.' : 'Summary did not visibly describe the typed bat/Homebrew intent.');
      } else {
        updateScenario(state, 'summary', 'fail', 'Review passed, but Computer Use could not open the Summary tab.');
      }
      const diffClicked = await clickByPattern(client, state, text, 'Diff tab', [/Diff/i], 'Open Diff tab.');
      if (diffClicked) {
        text = await captureState(client, state, 'review-diff', 'Computer Use opened Diff after Review.');
        const expectedPackage = /"bat"|bat command line|Homebrew formulae|brews = \[/i.test(text);
        updateScenario(state, 'diff', expectedPackage ? 'pass' : 'fail', expectedPackage ? 'Diff rendered a candidate Homebrew configuration change for bat.' : 'Diff did not visibly show the expected bat/Homebrew change.');
      } else {
        updateScenario(state, 'diff', 'fail', 'Review passed, but Computer Use could not open the Diff tab.');
      }
      const buildClicked = await clickByPattern(client, state, text, 'Build & Test', [/Build & Test/i, /Build/i], 'Click Build & Test boundary.');
      if (buildClicked) {
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
      } else {
        updateScenario(state, 'discard', 'fail', 'Discard cleanup was required, but Computer Use could not open the Discard confirmation.');
      }
    } else {
      updateScenario(state, 'summary', 'inconclusive', 'Summary was not tested because the real provider workflow did not reach Review.');
      updateScenario(state, 'diff', 'inconclusive', 'Diff was not tested because the real provider workflow did not reach Review.');
      updateScenario(state, 'buildBoundary', 'inconclusive', 'Build & Test boundary was not tested because the real provider workflow did not reach Review.');
      updateScenario(state, 'saveFlow', 'inconclusive', 'Step 3 Save / Keep changes was not tested because the real provider workflow did not reach Review.');
      updateScenario(state, 'rollbackCleanup', 'inconclusive', 'Rollback cleanup was not tested because the real provider workflow did not reach Review.');
      updateScenario(state, 'discard', 'inconclusive', 'Discard-after-review was not tested because the real provider workflow did not reach Review.');
    }

    for (const caseDef of enabledExtraEvolvedCases()) {
      if (caseDef.mode === 'review-only-calibration') {
        text = await runReviewOnlyEvolvedCase(client, state, caseDef);
      } else {
        await addEvent(state, 'evolved-case.skipped', {
          id: caseDef.id,
          reason: `Mode ${caseDef.mode} is not executed by the default remote runner.`,
        });
      }
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

    state.cleanup.note = 'Remote app state was not restored by this runner. CI wrapper is responsible for remote app-support backup/restore; local artifacts are retained.';
    await render(state);
    await inspectReportWithComputerUse(client, state);
    updatePrSpecificCoverage(state);
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
  const state = await baseState(runDir, {
    ws: process.env.NIXMAC_COMPUTER_USE_WS || DEFAULT_WS,
    app: process.env.NIXMAC_COMPUTER_USE_APP || DEFAULT_APP,
    prompt: DEFAULT_PROMPT,
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
  updateMainCoverageFreshness(state);
  updatePrSpecificCoverage(state);
  await render(state, { stateFileName: 'state.regenerated.json', recordEvent: false });
  console.log(path.join(runDir, 'index.html'));
}

async function renderErrorReport(error, args) {
  const note = `Computer Use remote runner failed before completing the suite: ${redact(error instanceof Error ? error.message : String(error))}`;
  await renderUnavailable([...args, '--note', note]);
}

async function runSelfTest() {
  const launchText = `
    5 button History
    6 button Give feedback
    7 button Settings
    8 content list Progress: step 1 of 3, Describe
    15 heading Get started, Value: 3
    26 button Report Issue
  `;
  const settingsFrame = `
    27 button Close settings
    28 text Settings
    30 button General
    31 button AI Models
    32 button API Keys
    33 button Preferences
    34 button Close
  `;
  assert.equal(hasSettingsGeneralEvidence(launchText), false, 'launch text must not satisfy Settings General evidence');
  assert.equal(hasSettingsAIModelsEvidence(`${settingsFrame}\n35 heading General\n37 text Configuration Directory\n44 text Host`), false, 'General pane must not satisfy AI Models evidence');
  assert.equal(hasSettingsPreferencesEvidence(`${settingsFrame}\n35 heading AI Models\n37 heading Evolution Model\n40 text Provider\n44 text Model Name\n66 text Max Build Attempts`), false, 'AI Models pane must not satisfy Preferences evidence');
  assert.equal(hasSettingsGeneralEvidence(`${settingsFrame}\n35 heading General\n37 text Configuration Directory\n39 button Browse\n44 text Host`), true, 'General pane should satisfy General evidence');
  assert.equal(hasSettingsAIModelsEvidence(`${settingsFrame}\n35 heading AI Models\n37 heading Evolution Model\n40 text Provider\n44 text Model Name\n66 text Max Build Attempts`), true, 'AI Models pane should satisfy AI Models evidence');
  assert.equal(hasSettingsAPIKeysEvidence(`${settingsFrame}\n35 heading API Keys\n38 heading OpenRouter\n41 text API Key\n43 secure text field API Key\n49 heading OpenAI`), true, 'API Keys pane should satisfy API Keys evidence');
  assert.equal(hasSettingsPreferencesEvidence(`${settingsFrame}\n35 heading Preferences\n37 text Confirmation dialogs\n38 text Build\n41 text Clear / Discard\n44 text Rollback\n50 switch (settable, boolean) off`), true, 'Preferences pane should satisfy Preferences evidence');

  assert.equal(clickResponseIndicatesFailure({ result: { isError: true, content: [{ type: 'text', text: 'Tool returned an error.' }] } }), true, 'MCP isError should fail click');
  assert.equal(clickResponseIndicatesFailure({ result: { content: [{ type: 'text', text: 'App state includes button Report Error and Console Error logs.' }] } }), false, 'ordinary app-state Error text should not fail click');
  assert.equal(clickResponseIndicatesFailure({ result: { content: [{ type: 'text', text: 'Error: stale element index 7' }] } }), true, 'stale element sentinel should fail click');
  assert.equal(clickResponseIndicatesFailure({ result: { content: [{ type: 'text', text: 'Element index 7 not clickable' }] } }), true, 'not-clickable element sentinel should fail click');
  assert.equal(setValueResponseIndicatesFailure({ result: { isError: true, content: [{ type: 'text', text: 'Tool returned an error.' }] } }), true, 'MCP isError should fail set_value');
  assert.equal(setValueResponseIndicatesFailure({ result: { content: [{ type: 'text', text: 'App state includes Value: Add the bat command line tool.' }] } }), false, 'ordinary set_value app-state text should not fail input');
  assert.equal(setValueResponseIndicatesFailure({ result: { content: [{ type: 'text', text: 'Error: set_value element index 18 not found' }] } }), true, 'set_value element sentinel should fail input');

  const previousChangedFiles = process.env.NIXMAC_E2E_PR_CHANGED_FILES;
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = 'apps/native/src/components/widget/adversarial-new-visible-surface.tsx\ndocs/history.md';
  const prFocus = buildPrFocus();
  assert.deepEqual(prFocus.userVisibleFiles, ['apps/native/src/components/widget/adversarial-new-visible-surface.tsx'], 'PR focus should infer user-visible files');
  assert.deepEqual(prFocus.scenarioKeys, [], 'non-user-visible changed files must not create PR scenario mappings');
  process.env.NIXMAC_E2E_PR_CHANGED_FILES = 'tools/computer-use-e2e/run-remote-cua.mjs';
  const toolPrFocus = buildPrFocus();
  assert.equal(toolPrFocus.scenarioKeys.includes('visualProofQuality'), true, 'Computer Use E2E changes should focus visual proof quality');
  assert.equal(toolPrFocus.scenarioKeys.includes('reportInspection'), true, 'Computer Use E2E changes should focus report inspection');
  assert.equal(toolPrFocus.scenarioKeys.includes('prSpecificCoverage'), false, 'PR focus coverage must not require itself');
  if (previousChangedFiles === undefined) delete process.env.NIXMAC_E2E_PR_CHANGED_FILES;
  else process.env.NIXMAC_E2E_PR_CHANGED_FILES = previousChangedFiles;

  const prCoverageState = ensureCurrentSchema({
    scenarios: {},
    claims: [],
    prFocus: {
      configured: true,
      changedFiles: ['tools/computer-use-e2e/run-remote-cua.mjs'],
      userVisibleFiles: ['tools/computer-use-e2e/run-remote-cua.mjs'],
      scenarioKeys: ['review', 'summary'],
    },
  });
  updateScenario(prCoverageState, 'review', 'pass', 'review passed');
  updateScenario(prCoverageState, 'summary', 'inconclusive', 'summary did not run');
  updatePrSpecificCoverage(prCoverageState);
  assert.equal(prCoverageState.scenarios.prSpecificCoverage.status, 'inconclusive', 'PR focus coverage should not pass while mapped scenarios are incomplete');
  updateScenario(prCoverageState, 'summary', 'pass', 'summary passed');
  updatePrSpecificCoverage(prCoverageState);
  assert.equal(prCoverageState.scenarios.prSpecificCoverage.status, 'pass', 'PR focus coverage should pass only when mapped scenarios pass');
  updateScenario(prCoverageState, 'review', 'fail', 'review failed');
  updatePrSpecificCoverage(prCoverageState);
  assert.equal(prCoverageState.scenarios.prSpecificCoverage.status, 'fail', 'PR focus coverage should fail when a mapped scenario fails');

  const renderRunDir = path.join(os.tmpdir(), `nixmac-e2e-self-test-${Date.now()}`);
  await mkdir(renderRunDir, { recursive: true });
  const renderState = await baseState(renderRunDir, {
    app: DEFAULT_APP,
    prompt: DEFAULT_PROMPT,
  });
  renderState.prFocus = {
    configured: true,
    number: '63',
    title: 'Self-test PR',
    headRef: 'feature',
    baseRef: 'main',
    changedFiles: ['tools/computer-use-e2e/run-remote-cua.mjs'],
    userVisibleFiles: ['tools/computer-use-e2e/run-remote-cua.mjs'],
    scenarioKeys: ['visualProofQuality', 'reportInspection'],
  };
  for (const key of Object.keys(renderState.scenarios)) {
    renderState.scenarios[key].status = 'pass';
    renderState.scenarios[key].notes = ['Self-test pass note.'];
  }
  renderState.screenshots.push({ path: 'screenshots/self-test.png', label: 'Self test', note: 'Synthetic screenshot metadata.', capturedAt: new Date().toISOString() });
  renderState.textSnapshots.push({ path: 'texts/self-test.txt', label: 'Self test text' });
  renderState.remoteMachine = { hostname: 'DXU97120', macosProductVersion: '26.2', architecture: 'arm64' };
  renderState.remoteApp = { bundleName: 'nixmac', shortVersion: '0.22.40', codesignVerified: true };
  renderState.processEnvVerification = {
    processFound: true,
    pid: '123',
    openrouterApiKeyInProcess: 'present-redacted',
    secretValuesRecorded: false,
  };
  renderState.confirmationBoundaries = ['Self-test confirmation boundary.'];
  await render(renderState, { stateFileName: 'state.self-test.json', recordEvent: false });
  const renderedHtml = await readFile(path.join(renderRunDir, 'index.html'), 'utf8');
  for (const anchor of [
    'id="summary"',
    'class="report-nav"',
    'id="pull-request-focus"',
    'id="findings-first"',
    'id="evidence-quality"',
    'id="v2-evidence-model"',
    'id="accessibility-risk"',
    'id="failure-taxonomy"',
    'id="confirmation-boundaries"',
    'id="visual-proof"',
    'id="scenario-checklist"',
    'id="remote-metadata"',
    'id="raw-evidence"',
    'id="screenshots"',
    'id="narrative"',
    'id="claims"',
    'id="pr-specific-focus"',
    'id="cleanup"',
  ]) {
    assert.equal(renderedHtml.includes(anchor), true, `rendered report should include ${anchor}`);
  }
  assert.equal(renderedHtml.includes('id="open-issues"'), false, 'duplicate open-issues section should not be rendered');
  const ids = [...renderedHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicateIds, [], 'rendered report should not include duplicate element ids');
  console.log('Computer Use E2E runner self-test passed.');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'run') await runSuite(args);
    else if (command === 'render-unavailable') await renderUnavailable(args);
    else if (command === 'render-existing') await renderExisting(args);
    else if (command === 'self-test') await runSelfTest();
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
