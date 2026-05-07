#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { scenarioLabels as sharedScenarioLabels } from './scenario-catalog.mjs';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  DEFAULT_PEEKABOO_SCENARIO,
  applyPeekabooResultToState,
  buildPeekabooRunPlan,
  isDestructivePeekabooScenario,
  peekabooRunnerSelfTest,
  runPeekabooScenario,
} from './peekaboo-runner.mjs';
import { shellQuote } from './remote-stage.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const TOOL_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(TOOL_DIR, '../..');
const APP_SUPPORT_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'com.darkmatter.nixmac',
);
const ARTIFACT_ROOT = path.join(REPO_ROOT, 'artifacts', 'computer-use-local');
const REAL_ARTIFACT_ROOT = path.join(REPO_ROOT, 'artifacts', 'computer-use-real');
const BACKUP_ROOT = path.join(
  os.homedir(),
  'Library',
  'Caches',
  'com.darkmatter.nixmac',
  'computer-use-e2e-backups',
);
const REAL_BACKUP_ROOT = path.join(
  os.homedir(),
  'Library',
  'Caches',
  'com.darkmatter.nixmac',
  'computer-use-real-backups',
);
const PEEKABOO_BACKUP_ROOT = path.join(
  os.homedir(),
  'Library',
  'Caches',
  'com.darkmatter.nixmac-e2e',
  'peekaboo-e2e-backups',
);
const TEMPLATE_DIR = path.join(REPO_ROOT, 'apps/native/templates/nix-darwin-determinate');
const TEST_DATA_DIR = path.join(REPO_ROOT, 'apps/native/e2e-tauri/tests/data');
const DEFAULT_FIXTURE = 'add-font.jsonl';
const DETERMINISTIC_APP_COMMAND = [
  'cd apps/native',
  'VITE_NIXMAC_SKIP_PERMISSIONS=true ./node_modules/.bin/tauri build --debug --bundles app --no-sign --config src-tauri/tauri.conf.dev.json',
  'open -n ../../target/debug/bundle/macos/nixmac.app',
].join(' && ');
const REAL_APP_PATH = process.env.NIXMAC_COMPUTER_USE_APP ?? '/Applications/nixmac.app';
const REAL_APP_COMMAND = `open -n ${REAL_APP_PATH}`;
const SETTINGS_FILE = path.join(APP_SUPPORT_DIR, 'settings.json');
const CURRENT_RUN_FILE = path.join(ARTIFACT_ROOT, '.current-run');
const REAL_CURRENT_RUN_FILE = path.join(REAL_ARTIFACT_ROOT, '.current-run');
const COVERAGE_MANIFEST_PATH = path.join(TOOL_DIR, 'coverage-manifest.json');
const PEEKABOO_PR_ENV_KEYS = [
  'GITHUB_EVENT_NAME',
  'GITHUB_PR_NUMBER',
  'GITHUB_HEAD_REF',
  'GITHUB_BASE_REF',
  'NIXMAC_E2E_PR_EVENT',
  'NIXMAC_E2E_PR_NUMBER',
  'NIXMAC_E2E_PR_TITLE',
  'NIXMAC_E2E_PR_HEAD_REF',
  'NIXMAC_E2E_PR_BASE_REF',
  'NIXMAC_E2E_PR_CHANGED_FILES',
];

const scenarioLabels = {
  launch: 'App launches and first screen is usable',
  settings: 'Settings safe tabs render: General, AI Models, Preferences',
  history: 'My History opens and renders',
  console: 'Console opens and closes',
  feedback: 'Feedback / report dialogs open and cancel without submission',
  suggestion: 'Home suggestion card is clickable',
  suggestionCards: sharedScenarioLabels.suggestionCards,
  descriptor: 'Typed intent reaches review',
  updateBanner: 'Update banner does not block the main workflow',
  settingsGeneral: 'Settings General tab visibly renders',
  settingsAIModels: 'Settings AI Models tab visibly renders',
  settingsAPIKeys: 'Settings API Keys tab visibly renders',
  settingsPreferences: 'Settings Preferences tab visibly renders',
  reportIssue: 'Report Issue opens and can be cancelled',
  typedIntent: 'A typed real intent can be submitted',
  review: 'Real provider workflow reaches Review',
  summary: 'Summary describes the typed intent',
  diff: 'Diff shows an acceptable config change',
  buildCheck: 'Build check completes or fails visibly',
  buildBoundary: 'Build & Test confirmation boundary appears and is cancelled',
  customizationSaveRollback: sharedScenarioLabels.customizationSaveRollback,
  homebrewSaveRollback: sharedScenarioLabels.homebrewSaveRollback,
  saveFlow: 'Step 3 Save / Keep changes persists a change',
  rollbackCleanup: 'Rollback cleanup returns disposable config to clean state',
  discard: 'Discard confirmation and return-to-start',
  visualCoverage: 'Core UX/UI surfaces are captured and inspectable',
  visualProofQuality: 'Scenario results include inspectable visual/text evidence',
  mainCoverageFreshness: sharedScenarioLabels.mainCoverageFreshness,
  prSpecificCoverage: sharedScenarioLabels.prSpecificCoverage,
  storybookPreview: sharedScenarioLabels.storybookPreview,
  reportInspection: sharedScenarioLabels.reportInspection,
  peekabooDescriptorPromptSmoke: 'Peekaboo descriptor prompt smoke',
  peekabooCoreProductProof: 'Peekaboo core Product Proof wrapper',
  peekabooSupportDialogsSmoke: 'Peekaboo support dialogs smoke',
  peekabooConsoleSmoke: 'Peekaboo Console smoke',
  peekabooHomebrewSaveRollbackSmoke: 'Peekaboo Homebrew save/rollback smoke',
  peekabooCustomizationSaveRollbackSmoke: 'Peekaboo customization save/rollback smoke',
  peekabooCoreFixture: 'Peekaboo core fixture setup',
  peekabooCoreLaunch: 'Peekaboo core app shell',
  peekabooCoreUpdateBanner: 'Peekaboo update banner non-blocking state',
  peekabooCoreSettingsGeneral: 'Peekaboo Settings General',
  peekabooCoreSettingsAIModels: 'Peekaboo Settings AI Models',
  peekabooCoreSettingsAPIKeys: 'Peekaboo Settings API Keys redaction proof',
  peekabooCoreSettingsPreferences: 'Peekaboo Settings Preferences',
  peekabooCoreHistory: 'Peekaboo History surface',
  peekabooCoreConsole: 'Peekaboo Console text surface',
  peekabooCoreFeedback: 'Peekaboo Feedback dialog',
  peekabooCoreReportIssue: 'Peekaboo Report Issue classification',
  peekabooCoreSuggestionCards: 'Peekaboo suggestion card prompt fill',
  peekabooCoreTypedIntent: 'Peekaboo typed intent',
  peekabooCoreProviderValidation: 'Peekaboo local provider-validation boundary',
  peekabooCoreVisualProofQuality: 'Peekaboo core visual/text proof quality',
  peekabooHomebrewSaveRollback: 'Peekaboo Homebrew save + rollback',
  peekabooCustomizationSaveRollback: 'Peekaboo customization save + rollback',
  peekabooProviderEvolveFullSmoke: 'Peekaboo provider-backed evolve smoke',
  peekabooProviderDiscardSmoke: 'Peekaboo provider discard smoke',
  peekabooProviderFixture: 'Peekaboo provider fixture setup',
  peekabooProviderLaunch: 'Peekaboo provider app shell',
  peekabooProviderTypedIntent: 'Peekaboo provider typed intent',
  peekabooProviderReview: 'Peekaboo provider Review proof',
  peekabooProviderBuildBoundary: 'Peekaboo provider Build & Test boundary',
  peekabooProviderSaveFlow: 'Peekaboo provider Save flow',
  peekabooProviderRollbackCleanup: 'Peekaboo provider rollback cleanup',
  peekabooProviderAudit: 'Peekaboo provider request audit',
  peekabooProviderDiscard: 'Peekaboo provider Discard proof',
  peekabooReportInspection: 'Peekaboo report inspection',
  peekabooNixInstall: 'Peekaboo Nix install flow',
};
const PEEKABOO_SCENARIO_TO_REPORT_KEY = Object.freeze({
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
const LOCAL_ONLY_SCENARIO_KEYS = new Set([
  'settings',
  'suggestion',
  'descriptor',
  'buildCheck',
  'peekabooDescriptorPromptSmoke',
  'peekabooCoreProductProof',
  'peekabooSupportDialogsSmoke',
  'peekabooConsoleSmoke',
  'peekabooHomebrewSaveRollbackSmoke',
  'peekabooCustomizationSaveRollbackSmoke',
  'peekabooCoreFixture',
  'peekabooCoreLaunch',
  'peekabooCoreUpdateBanner',
  'peekabooCoreSettingsGeneral',
  'peekabooCoreSettingsAIModels',
  'peekabooCoreSettingsAPIKeys',
  'peekabooCoreSettingsPreferences',
  'peekabooCoreHistory',
  'peekabooCoreConsole',
  'peekabooCoreFeedback',
  'peekabooCoreReportIssue',
  'peekabooCoreSuggestionCards',
  'peekabooCoreTypedIntent',
  'peekabooCoreProviderValidation',
  'peekabooCoreVisualProofQuality',
  'peekabooHomebrewSaveRollback',
  'peekabooCustomizationSaveRollback',
  'peekabooProviderEvolveFullSmoke',
  'peekabooProviderFixture',
  'peekabooProviderLaunch',
  'peekabooProviderTypedIntent',
  'peekabooProviderReview',
  'peekabooProviderBuildBoundary',
  'peekabooProviderSaveFlow',
  'peekabooProviderRollbackCleanup',
  'peekabooProviderAudit',
  'peekabooProviderDiscardSmoke',
  'peekabooProviderDiscard',
  'peekabooReportInspection',
  'peekabooNixInstall',
]);

function splitPrEnvList(value = '') {
  return String(value)
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function loadCoverageManifest() {
  try {
    return JSON.parse(readFileSync(COVERAGE_MANIFEST_PATH, 'utf8'));
  } catch (error) {
    return {
      surfaces: [],
      candidateIncludes: [],
      candidateExcludes: [],
      loadError: error instanceof Error ? error.message : String(error),
    };
  }
}

function matchesAnyPattern(value, patterns = []) {
  return patterns.some((pattern) => new RegExp(pattern).test(value));
}

function sourcePrefixMatches(file, sourcePrefix) {
  const normalizedPrefix = String(sourcePrefix ?? '').replaceAll(path.sep, '/');
  if (!normalizedPrefix) return false;
  if (normalizedPrefix.endsWith('/')) return file.startsWith(normalizedPrefix);
  return file === normalizedPrefix || file.startsWith(`${normalizedPrefix}/`);
}

function changedFileMatchesSurface(file, surface) {
  return (surface.sourcePrefixes ?? []).some((sourcePrefix) => sourcePrefixMatches(file, sourcePrefix));
}

function isLikelyUserVisiblePrFile(file, manifest) {
  if (matchesAnyPattern(file, manifest.candidateExcludes ?? [])) return false;
  if (matchesAnyPattern(file, manifest.candidateIncludes ?? [])) return true;
  if (manifest.surfaces?.some((surface) => changedFileMatchesSurface(file, surface))) return true;
  return /^(apps\/native\/src\/(?:App|main|index|style|.*\.css)|apps\/native\/src\/components\/|apps\/native\/src\/hooks\/|apps\/native\/src-tauri\/src\/|apps\/native\/templates\/|tools\/computer-use-e2e\/|tests\/e2e\/|\.github\/workflows\/peekaboo-e2e\.yml)/.test(
    file,
  );
}

function scenarioSuggestionForFile(file, matchedSurfaces = []) {
  const waiver = matchedSurfaces.find((surface) => surface.waiver)?.waiver;
  if (waiver?.exitCriteria) return `Add a dedicated Peekaboo scenario for ${file}: ${waiver.exitCriteria}`;
  if (/^tools\/computer-use-e2e\/|^tests\/e2e\/|^\.github\/workflows\/peekaboo-e2e\.yml/.test(file)) {
    return `Map ${file} to reportInspection or visualProofQuality and keep the workflow/report contract self-test covering the changed behavior.`;
  }
  return `Add or extend a Peekaboo scenario that exercises ${file}, then map it in coverage-manifest.json.`;
}

function buildPeekabooPrFocus(env = process.env) {
  const manifest = loadCoverageManifest();
  const changedFiles = splitPrEnvList(env.NIXMAC_E2E_PR_CHANGED_FILES || '');
  const scenarioKeys = new Set();
  const userVisibleFiles = [];
  const unmappedUserVisibleFiles = [];
  const scenarioSuggestions = [];
  const matchedSurfaceRows = [];

  for (const file of changedFiles) {
    const matchedSurfaces = (manifest.surfaces ?? []).filter((surface) => changedFileMatchesSurface(file, surface));
    const mappedKeys = matchedSurfaces.flatMap((surface) => surface.scenarioKeys ?? []).filter(Boolean);
    for (const key of mappedKeys) scenarioKeys.add(key);
    if (/^tools\/computer-use-e2e\/|^tests\/e2e\/|^\.github\/workflows\/peekaboo-e2e\.yml/.test(file)) {
      scenarioKeys.add('visualProofQuality');
      scenarioKeys.add('reportInspection');
    }
    if (/^apps\/native\/src\/[^/]+\.(?:css|ts|tsx)$/i.test(file)) {
      scenarioKeys.add('launch');
      scenarioKeys.add('visualCoverage');
    }
    if (!isLikelyUserVisiblePrFile(file, manifest)) continue;
    userVisibleFiles.push(file);
    if (matchedSurfaces.length) {
      matchedSurfaceRows.push(
        ...matchedSurfaces.map((surface) => ({
          file,
          id: surface.id,
          label: surface.label,
          scenarioKeys: surface.scenarioKeys ?? [],
          waiver: surface.waiver ?? null,
          coverageDisposition: surface.coverageDisposition ?? null,
          coverageNote: surface.coverageNote ?? null,
        })),
      );
    }
    const nonClaimingOnly = matchedSurfaces.some((surface) => surface.coverageDisposition === 'non-claiming');
    if (!mappedKeys.length && !nonClaimingOnly && !/^tools\/computer-use-e2e\/|^tests\/e2e\/|^\.github\/workflows\/peekaboo-e2e\.yml/.test(file)) {
      unmappedUserVisibleFiles.push(file);
      scenarioSuggestions.push(scenarioSuggestionForFile(file, matchedSurfaces));
    }
  }

  return {
    eventName: env.GITHUB_EVENT_NAME || env.NIXMAC_E2E_PR_EVENT || '',
    number: env.NIXMAC_E2E_PR_NUMBER || env.GITHUB_PR_NUMBER || '',
    title: env.NIXMAC_E2E_PR_TITLE || '',
    headRef: env.NIXMAC_E2E_PR_HEAD_REF || env.GITHUB_HEAD_REF || '',
    baseRef: env.NIXMAC_E2E_PR_BASE_REF || env.GITHUB_BASE_REF || '',
    changedFiles,
    userVisibleFiles,
    scenarioKeys: [...scenarioKeys],
    matchedSurfaces: matchedSurfaceRows,
    unmappedUserVisibleFiles,
    scenarioSuggestions: [...new Set(scenarioSuggestions)],
    manifestLoadError: manifest.loadError ?? null,
    configured: Boolean(env.NIXMAC_E2E_PR_NUMBER || env.GITHUB_PR_NUMBER || env.GITHUB_EVENT_NAME === 'pull_request'),
  };
}
const PR75_COMPUTER_USE_BASELINE = Object.freeze({
  source: 'artifacts/pr-75-computer-use-baseline/index.html',
  rawPassedClaimCount: 27,
  requiredKeys: [
    'launch',
    'updateBanner',
    'settingsGeneral',
    'settingsAIModels',
    'settingsAPIKeys',
    'settingsPreferences',
    'history',
    'console',
    'feedback',
    'reportIssue',
    'suggestionCards',
    'customizationSaveRollback',
    'homebrewSaveRollback',
    'typedIntent',
    'review',
    'summary',
    'diff',
    'buildBoundary',
    'saveFlow',
    'rollbackCleanup',
    'discard',
    'visualCoverage',
    'visualProofQuality',
    'reportInspection',
  ],
  metaKeys: ['mainCoverageFreshness', 'prSpecificCoverage', 'storybookPreview'],
  explicitWaivers: [
    {
      key: 'customizationSaveRollback',
      label: 'Untracked customizations save + rollback',
      note: 'Visibility alone is not parity. Peekaboo should only claim this after a deterministic chip add, Save, and rollback scenario proves the disposable repo returns clean.',
    },
    {
      key: 'homebrewSaveRollback',
      label: 'Untracked Homebrew save + rollback',
      note: 'Visibility alone is not parity. Peekaboo should only claim this after a deterministic Homebrew chip add, Save, and rollback scenario proves the disposable repo returns clean.',
    },
    {
      key: 'onboardingPermissions',
      label: 'Clean-profile onboarding permissions',
      note: 'PR #75 tracks this as a known limit; Peekaboo parity should add a clean-profile scenario before claiming full main coverage.',
    },
    {
      key: 'sudoLocalActivation',
      label: 'Production sudo_local activation path',
      note: 'PR #75 uses a CI fixture waiver. Peekaboo should keep this as a separate release/manual proof unless unattended activation is made deterministic.',
    },
    {
      key: 'previewIndicator',
      label: 'Preview indicator commit/revert UI',
      note: 'Needs deterministic preview-state setup or a real workflow that activates the indicator.',
    },
  ],
});
const PR75_REQUIRED_COMPUTER_USE_KEYS = new Set(PR75_COMPUTER_USE_BASELINE.requiredKeys);

function usage() {
  console.log(`Usage:
  node tools/computer-use-e2e/run-local.mjs setup
  node tools/computer-use-e2e/run-local.mjs setup-deterministic
  node tools/computer-use-e2e/run-local.mjs setup-real
  node tools/computer-use-e2e/run-local.mjs run-peekaboo [macos_descriptor_prompt_smoke|macos_core_product_proof|macos_support_dialogs_smoke|macos_console_smoke|macos_homebrew_save_rollback_smoke|macos_customization_save_rollback_smoke|macos_provider_evolve_full_smoke|macos_provider_discard_smoke] [--no-record] [--allow-destructive]
  node tools/computer-use-e2e/run-local.mjs run-peekaboo-suite [--no-record] [--allow-cleanup] [macos_core_product_proof macos_support_dialogs_smoke macos_console_smoke macos_homebrew_save_rollback_smoke macos_customization_save_rollback_smoke macos_provider_evolve_full_smoke macos_provider_discard_smoke]
  node tools/computer-use-e2e/run-local.mjs run-peekaboo-macincloud [--suite|--scenario <name>] [--ssh-dest admin@host] [--identity-file ~/.ssh/key] [--repo-dir /Users/admin/nixmac-peekaboo-local-e2e] [--app-path /Users/admin/nixmac.app] [--no-record] [--allow-cleanup]
  node tools/computer-use-e2e/run-local.mjs verify-report <run-dir> --method computer-use|ci-static --notes "<inspection notes>"
  node tools/computer-use-e2e/run-local.mjs serve-mock <run-dir>
  node tools/computer-use-e2e/run-local.mjs capture <label> [--note "..."]
  node tools/computer-use-e2e/run-local.mjs scenario <key> <pass|fail|inconclusive> [--note "..."]
  node tools/computer-use-e2e/run-local.mjs confirmation <label> --note "..."
  node tools/computer-use-e2e/run-local.mjs narrative "..."
  node tools/computer-use-e2e/run-local.mjs app-command "..."
  node tools/computer-use-e2e/run-local.mjs render
  node tools/computer-use-e2e/run-local.mjs self-test
  node tools/computer-use-e2e/run-local.mjs cleanup`);
}

function argValue(args, flag, fallback = '') {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertContainedPath(root, candidate, label) {
  const relative = path.relative(root, candidate);
  assert(
    relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)),
    `${label} must stay under ${root}`,
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.status}${stderr ? `: ${stderr}` : ''}${stdout ? `\n${stdout}` : ''}`,
    );
  }
  return result.stdout.trim();
}

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    error: result.error ? String(result.error) : '',
  };
}

function gitMetadata() {
  const branch = tryRun('git', ['branch', '--show-current'], { cwd: REPO_ROOT });
  const sha = tryRun('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT });
  return {
    branch: branch.ok && branch.stdout ? branch.stdout : 'unknown',
    sha: sha.ok && sha.stdout ? sha.stdout : 'unknown',
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', 'Z');
}

async function getCurrentRunDir() {
  const fromEnv = process.env.NIXMAC_COMPUTER_USE_RUN_DIR;
  if (fromEnv) return fromEnv;
  const candidates = [];
  for (const filePath of [CURRENT_RUN_FILE, REAL_CURRENT_RUN_FILE]) {
    if (await pathExists(filePath)) {
      const runDir = (await readFile(filePath, 'utf8')).trim();
      if (runDir && (await pathExists(path.join(runDir, 'state.json')))) {
        const fileStat = await stat(path.join(runDir, 'state.json'));
        candidates.push({ runDir, mtimeMs: fileStat.mtimeMs });
      }
    }
  }
  if (candidates.length === 0) {
    throw new Error(`No current run file found at ${CURRENT_RUN_FILE}. Run setup first.`);
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0].runDir;
}

async function statePath(runDir = null) {
  return path.join(runDir ?? (await getCurrentRunDir()), 'state.json');
}

async function loadState(runDir = null) {
  return readJson(await statePath(runDir));
}

async function saveState(state) {
  await writeJson(path.join(state.runDir, 'state.json'), state);
}

async function appendEvent(state, type, detail = {}) {
  const event = {
    ts: new Date().toISOString(),
    type,
    ...detail,
  };
  const eventsPath = path.join(state.runDir, 'events.json');
  const events = (await pathExists(eventsPath)) ? await readJson(eventsPath) : [];
  events.push(event);
  await writeJson(eventsPath, events);
}

async function assertNoUnrestoredRun() {
  for (const currentFile of [CURRENT_RUN_FILE, REAL_CURRENT_RUN_FILE]) {
    if (!(await pathExists(currentFile))) continue;

    const previousRunDir = (await readFile(currentFile, 'utf8')).trim();
    if (!previousRunDir || !(await pathExists(path.join(previousRunDir, 'state.json')))) continue;

    const previousState = await loadState(previousRunDir);
    if (previousState.cleanup?.restored === true) continue;

    throw new Error(
      `Refusing setup because a previous run has not been restored: ${previousRunDir}. Run cleanup first or set NIXMAC_COMPUTER_USE_RUN_DIR to that path and run cleanup.`,
    );
  }
}

function getPlatformTriple() {
  const archMap = { arm64: 'aarch64', x64: 'x86_64' };
  return `${archMap[process.arch] ?? process.arch}-${process.platform}`;
}

async function listFiles(dirPath, predicate) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath, predicate)));
    } else if (entry.isFile() && predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function createConfigRepo(runDir) {
  const configDir = await mkdtemp(path.join(runDir, 'nix-config-'));
  await cp(TEMPLATE_DIR, configDir, { recursive: true });

  const hostnameResult = tryRun('scutil', ['--get', 'LocalHostName']);
  const hostname = hostnameResult.ok && hostnameResult.stdout ? hostnameResult.stdout : 'localhost';
  const username = os.userInfo().username || process.env.USER || 'nobody';
  const platformTriple = getPlatformTriple();
  const nixFiles = await listFiles(configDir, (filePath) => filePath.endsWith('.nix'));

  for (const nixFile of nixFiles) {
    const content = await readFile(nixFile, 'utf8');
    const updated = content
      .replaceAll('HOSTNAME_PLACEHOLDER', hostname)
      .replaceAll('USERNAME_PLACEHOLDER', username)
      .replaceAll('PLATFORM_PLACEHOLDER', platformTriple);
    if (updated !== content) await writeFile(nixFile, updated, 'utf8');
  }

  await writeFile(path.join(configDir, '.gitignore'), 'flake.lock\n', 'utf8');
  run('git', ['init'], { cwd: configDir });
  run('git', ['config', 'user.name', 'eval'], { cwd: configDir });
  run('git', ['config', 'user.email', 'eval@test'], { cwd: configDir });
  run('git', ['add', '-A'], { cwd: configDir });
  run('git', ['commit', '-m', 'initial nix config state', '--author', 'eval <eval@test>'], {
    cwd: configDir,
  });
  run('git', ['update-index', '--refresh'], { cwd: configDir });

  return { configDir, hostname };
}

async function parseJsonl(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'))
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Failed parsing ${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

function writeResponse(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readRequestBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    chunks.push(buffer);
    bytes += buffer.length;
  }
  return { raw: Buffer.concat(chunks).toString('utf8'), bytes };
}

async function serveMock(runDir) {
  const fixturePath = path.join(TEST_DATA_DIR, DEFAULT_FIXTURE);
  let responses = await parseJsonl(fixturePath);
  let requestIndex = 0;
  const requestsLog = path.join(runDir, 'mock-provider-requests.jsonl');

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        writeResponse(response, 200, { status: 'ok' });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/__admin/mock-responses') {
        const requestBody = await readRequestBody(request);
        const body = JSON.parse(requestBody.raw || '{}');
        if (Array.isArray(body.responses)) {
          responses = body.responses;
        } else if (Array.isArray(body.responseFiles)) {
          const loaded = [];
          for (const fileName of body.responseFiles) {
            loaded.push(...(await parseJsonl(path.join(TEST_DATA_DIR, fileName))));
          }
          responses = loaded;
        } else {
          writeResponse(response, 400, { error: 'Expected responses or responseFiles' });
          return;
        }
        requestIndex = 0;
        writeResponse(response, 200, { status: 'ok', queuedResponses: responses.length });
        return;
      }

      if (
        request.method !== 'POST' ||
        !['/v1/chat/completions', '/chat/completions'].includes(requestUrl.pathname)
      ) {
        writeResponse(response, 404, { error: `Unhandled endpoint: ${request.method} ${requestUrl.pathname}` });
        return;
      }

      const requestBody = await readRequestBody(request);
      await writeFile(
        requestsLog,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          path: requestUrl.pathname,
          requestIndex,
          requestBodyBytes: requestBody.bytes,
        })}\n`,
        { flag: 'a' },
      );

      if (requestIndex >= responses.length) {
        writeResponse(response, 500, {
          error: 'Mock response queue exhausted',
          code: 'MOCK_RESPONSE_QUEUE_EXHAUSTED',
          configuredResponses: responses.length,
          consumedResponses: requestIndex,
          requestBodyBytes: requestBody.bytes,
        });
        return;
      }

      const payload = responses[requestIndex];
      requestIndex += 1;
      writeResponse(response, 200, payload);
    } catch (error) {
      writeResponse(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  await writeJson(path.join(runDir, 'mock-provider.json'), {
    pid: process.pid,
    origin,
    baseUrl: `${origin}/v1`,
    fixture: fixturePath,
    queuedResponses: responses.length,
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

async function waitForFile(filePath, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pathExists(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function quitNixmac() {
  const osa = tryRun('osascript', ['-e', 'tell application id "com.darkmatter.nixmac" to quit']);
  const pkill = tryRun('pkill', ['-x', 'nixmac']);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return { osascript: osa, pkill };
}

function createInitialState({
  runDir,
  startedAt,
  branch,
  sha,
  macosVersion,
  appSupportExisted,
  backupPath,
  quitResult,
  mode,
  appCommand,
  artifactRoot,
}) {
  return {
    runDir,
    startedAt,
    mode,
    branch,
    sha,
    macosVersion,
    appCommand,
    appBundleId: 'com.darkmatter.nixmac',
    artifactRoot,
    appSupportDir: APP_SUPPORT_DIR,
    appSupportExisted,
    appSupportBackupPath: appSupportExisted ? backupPath : null,
    setup: {
      quitResult,
      configDir: null,
      mockProvider: null,
    },
    scenarios: Object.fromEntries(
      Object.entries(scenarioLabels).map(([key, label]) => [
        key,
        { label, status: 'inconclusive', notes: [] },
      ]),
    ),
    prFocus: buildPeekabooPrFocus(),
    screenshots: [],
    diagnostics: [],
    narrative: [],
    failures: [],
    claims: [],
    confirmationBoundaries: [],
    cleanup: {
      attempted: false,
      restored: false,
      note: 'Cleanup has not run yet.',
    },
  };
}

async function setup({ mode = 'deterministic' } = {}) {
  const isReal = mode === 'real';
  const artifactRoot = isReal ? REAL_ARTIFACT_ROOT : ARTIFACT_ROOT;
  const backupRoot = isReal ? REAL_BACKUP_ROOT : BACKUP_ROOT;
  const appCommand = isReal ? REAL_APP_COMMAND : DETERMINISTIC_APP_COMMAND;

  await mkdir(artifactRoot, { recursive: true });
  await assertNoUnrestoredRun();

  const startedAt = new Date();
  const runSlug = timestampSlug(startedAt);
  const runDir = path.join(artifactRoot, runSlug);
  await mkdir(path.join(runDir, 'screenshots'), { recursive: true });

  const { branch, sha } = gitMetadata();
  const macosVersion = tryRun('sw_vers', ['-productVersion']).stdout || 'unknown';
  const appSupportExisted = await pathExists(APP_SUPPORT_DIR);
  const backupPath = path.join(backupRoot, runSlug, 'app-support-backup');

  const quitResult = await quitNixmac();
  if (appSupportExisted) {
    await mkdir(path.dirname(backupPath), { recursive: true });
    await cp(APP_SUPPORT_DIR, backupPath, { recursive: true, preserveTimestamps: true });
  }

  const state = createInitialState({
    runDir,
    startedAt: startedAt.toISOString(),
    branch,
    sha,
    macosVersion,
    appSupportExisted,
    backupPath,
    quitResult,
    mode,
    appCommand,
    artifactRoot,
  });
  await saveState(state);
  await writeFile(isReal ? REAL_CURRENT_RUN_FILE : CURRENT_RUN_FILE, `${runDir}\n`, 'utf8');
  await appendEvent(state, 'setup.started', { mode });

  if (!isReal) {
    await rm(APP_SUPPORT_DIR, { recursive: true, force: true });
    await mkdir(APP_SUPPORT_DIR, { recursive: true });
  } else if (!appSupportExisted) {
    await mkdir(APP_SUPPORT_DIR, { recursive: true });
  }

  const { configDir, hostname } = await createConfigRepo(runDir);
  state.setup.configDir = configDir;

  let settings = {};
  if (isReal && (await pathExists(SETTINGS_FILE))) {
    settings = await readJson(SETTINGS_FILE);
  }

  if (isReal) {
    state.setup.mockProvider = null;
    state.provider = {
      kind: 'real-openrouter-compatible',
      providerSetting: 'openai',
      keySource: 'existing app keychain/settings/env; not written to report',
    };
    await writeJson(SETTINGS_FILE, {
      ...settings,
      hostAttr: hostname,
      configDir,
      evolveProvider: 'openai',
      evolveModel:
        process.env.NIXMAC_COMPUTER_USE_EVOLVE_MODEL ??
        settings.evolveModel ??
        'anthropic/claude-sonnet-4',
      summaryProvider: 'openai',
      summaryModel:
        process.env.NIXMAC_COMPUTER_USE_SUMMARY_MODEL ??
        settings.summaryModel ??
        'openai/gpt-4o-mini',
      sendDiagnostics: false,
      confirmBuild: true,
      confirmClear: true,
      confirmRollback: true,
    });
  } else {
    const mock = spawn(process.execPath, [THIS_FILE, 'serve-mock', runDir], {
      detached: true,
      stdio: 'ignore',
    });
    mock.unref();

    const mockInfoPath = path.join(runDir, 'mock-provider.json');
    await waitForFile(mockInfoPath, 5000);
    const mockInfo = await readJson(mockInfoPath);
    state.setup.mockProvider = mockInfo;
    await saveState(state);

    await writeJson(SETTINGS_FILE, {
      hostAttr: hostname,
      configDir,
      vllmApiBaseUrl: mockInfo.baseUrl,
      vllmApiKey: null,
      evolveProvider: 'vllm',
      evolveModel: 'gpt-oss-120b',
      summaryProvider: 'vllm',
      summaryModel: 'gpt-oss-120b',
      sendDiagnostics: false,
      confirmBuild: true,
      confirmClear: true,
      confirmRollback: true,
    });
  }

  await saveState(state);
  await appendEvent(state, 'setup.completed', { mode, configDir });
  console.log(runDir);
}

async function createPeekabooRunState({ scenario, noRecord, noCleanup, allowDestructive }) {
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  await assertNoUnrestoredRun();
  const startedAt = new Date();
  const runSlug = timestampSlug(startedAt);
  const runDir = path.join(ARTIFACT_ROOT, runSlug);
  await mkdir(path.join(runDir, 'screenshots'), { recursive: true });
  await mkdir(path.join(runDir, 'video'), { recursive: true });
  const appSupportExisted = await pathExists(APP_SUPPORT_DIR);
  const backupPath = path.join(PEEKABOO_BACKUP_ROOT, runSlug, 'app-support-backup');
  const quitResult = await quitNixmac();
  if (appSupportExisted) {
    await mkdir(path.dirname(backupPath), { recursive: true });
    await cp(APP_SUPPORT_DIR, backupPath, { recursive: true, preserveTimestamps: true });
  }

  const { branch, sha } = gitMetadata();
  const macosVersion = tryRun('sw_vers', ['-productVersion']).stdout || 'unknown';
  const state = createInitialState({
    runDir,
    startedAt: startedAt.toISOString(),
    branch,
    sha,
    macosVersion,
    appSupportExisted,
    backupPath,
    quitResult,
    mode: 'peekaboo',
    appCommand: `bash tests/e2e/run.sh ${scenario}`,
    artifactRoot: ARTIFACT_ROOT,
  });

  state.provider =
    scenario === 'macos_provider_evolve_full_smoke'
      ? {
          kind: 'local-provider-stub',
          note: 'Scenario owns and verifies a deterministic local OpenAI-compatible provider stub.',
        }
      : {
          kind: 'no-llm-provider-required',
          note: 'This Peekaboo scenario does not require an LLM provider.',
        };
  state.setup = {
    configDir: null,
    mockProvider: null,
    note: appSupportExisted
      ? `Backed up nixmac Application Support before running Peekaboo scenario: ${backupPath}.`
      : 'No existing nixmac Application Support directory was present before the Peekaboo run.',
  };
  state.cleanup = {
    attempted: false,
    restored: false,
    note: 'Cleanup has not run yet. Peekaboo scenarios may write nixmac settings and must restore app support after the run.',
  };
  state.peekaboo = {
    scenario,
    noRecord,
    noCleanup,
    allowDestructive,
    destructive: isDestructivePeekabooScenario(scenario),
  };

  await saveState(state);
  await writeFile(CURRENT_RUN_FILE, `${runDir}\n`, 'utf8');
  await appendEvent(state, 'peekaboo.setup.completed', {
    scenario,
    noRecord,
    noCleanup,
    allowDestructive,
  });
  return state;
}

async function executePeekabooScenario({ scenario, noRecord, noCleanup, allowDestructive }) {
  const state = await createPeekabooRunState({ scenario, noRecord, noCleanup, allowDestructive });
  const plan = buildPeekabooRunPlan({
    repoRoot: REPO_ROOT,
    runDir: state.runDir,
    scenario,
    noRecord,
    noCleanup,
    allowDestructive,
  });
  await appendEvent(state, 'peekaboo.run.started', {
    command: plan.command,
    args: plan.args,
    resultsFile: path.relative(state.runDir, plan.resultsFile),
    reportFile: path.relative(state.runDir, plan.reportFile),
  });
  let peekabooResult = null;
  try {
    peekabooResult = await runPeekabooScenario(plan);
    const updatedState = applyPeekabooResultToState(await loadState(state.runDir), peekabooResult);
    updatedState.peekaboo.result = peekabooResult;
    await saveState(updatedState);
    await appendEvent(updatedState, 'peekaboo.run.completed', {
      scenario,
      status: peekabooResult.status,
      success: peekabooResult.success,
    });
  } finally {
    try {
      await cleanup();
    } catch (error) {
      error.runDir ??= state.runDir;
      error.scenario ??= scenario;
      throw error;
    }
  }
  if (!peekabooResult?.success) {
    const outcome = peekabooResult?.infraFailure ? 'infra blocked' : 'failed';
    const error = new Error(`Peekaboo scenario ${scenario} ${outcome}; report rendered at ${path.join(state.runDir, 'index.html')}`);
    error.runDir = state.runDir;
    error.scenario = scenario;
    throw error;
  }
  console.log(`${scenario}: ${state.runDir}`);
  return { scenario, runDir: state.runDir };
}

async function runPeekaboo(args) {
  const scenario = args.find((arg) => !arg.startsWith('-')) || DEFAULT_PEEKABOO_SCENARIO;
  const noRecord = args.includes('--no-record');
  const noCleanup = args.includes('--no-cleanup') || !args.includes('--allow-cleanup');
  const allowDestructive = args.includes('--allow-destructive');
  await executePeekabooScenario({ scenario, noRecord, noCleanup, allowDestructive });
}

async function runPeekabooSuite(args) {
  const scenarios = args.filter((arg) => !arg.startsWith('-'));
  const noRecord = args.includes('--no-record');
  const noCleanup = args.includes('--no-cleanup') || !args.includes('--allow-cleanup');
  const allowDestructive = args.includes('--allow-destructive');
  const suiteScenarios =
    scenarios.length > 0
      ? scenarios
      : [
          'macos_core_product_proof',
          'macos_support_dialogs_smoke',
          'macos_console_smoke',
          'macos_homebrew_save_rollback_smoke',
          'macos_customization_save_rollback_smoke',
          'macos_provider_evolve_full_smoke',
          'macos_provider_discard_smoke',
        ];
  const destructiveScenarios = suiteScenarios.filter((scenario) => isDestructivePeekabooScenario(scenario));
  if (destructiveScenarios.length) {
    throw new Error(
      `Peekaboo suite refuses destructive scenario(s) by default: ${destructiveScenarios.join(', ')}. Run those as explicit single-scenario disposable-host tests.`,
    );
  }
  const results = [];
  const suiteFailures = [];
  for (const scenario of suiteScenarios) {
    try {
      results.push(await executePeekabooScenario({ scenario, noRecord, noCleanup, allowDestructive }));
    } catch (error) {
      if (error?.runDir && error?.scenario) {
        results.push({ scenario: error.scenario, runDir: error.runDir, failed: true, error: error.message });
      }
      suiteFailures.push({ scenario, error });
    }
  }
  if (results.length) {
    const suiteDir = await renderPeekabooSuiteAggregate({ results, suiteScenarios, noRecord, noCleanup, allowDestructive });
    console.log(`peekaboo-suite: ${suiteDir}`);
    if (suiteFailures.length) {
      const failureSummary = suiteFailures.map((item) => `${item.scenario}: ${item.error.message}`).join('; ');
      throw new Error(`Peekaboo suite failed after rendering aggregate report at ${path.join(suiteDir, 'index.html')}: ${failureSummary}`);
    }
  } else if (suiteFailures.length) {
    const failureSummary = suiteFailures.map((item) => `${item.scenario}: ${item.error.message}`).join('; ');
    throw new Error(`Peekaboo suite failed before any scenario report could be aggregated: ${failureSummary}`);
  }
}

function optionValue(args, flag, env, envKey, fallback = '') {
  const explicit = argValue(args, flag, '');
  if (explicit) return explicit;
  return env[envKey] || fallback;
}

function buildPeekabooMacInCloudCommand(args, env = process.env) {
  const sshDest =
    optionValue(args, '--ssh-dest', env, 'NIXMAC_E2E_MACINCLOUD_SSH_DEST', '') ||
    optionValue(args, '--remote-ssh-dest', env, 'NIXMAC_E2E_REMOTE_SSH_DEST', '');
  if (!sshDest) {
    throw new Error(
      'run-peekaboo-macincloud requires --ssh-dest, NIXMAC_E2E_MACINCLOUD_SSH_DEST, or NIXMAC_E2E_REMOTE_SSH_DEST.',
    );
  }

  const identityFile = optionValue(args, '--identity-file', env, 'NIXMAC_E2E_MACINCLOUD_SSH_KEY', env.NIXMAC_E2E_SSH_KEY || '');
  const knownHosts = optionValue(
    args,
    '--known-hosts',
    env,
    'NIXMAC_E2E_MACINCLOUD_KNOWN_HOSTS',
    env.NIXMAC_E2E_SSH_KNOWN_HOSTS || '',
  );
  const repoDir = optionValue(
    args,
    '--repo-dir',
    env,
    'NIXMAC_E2E_MACINCLOUD_REPO_DIR',
    '/Users/admin/nixmac-peekaboo-local-e2e',
  );
  const nodeBin = optionValue(args, '--node', env, 'NIXMAC_E2E_MACINCLOUD_NODE', '/opt/homebrew/bin/node');
  const appPath = optionValue(args, '--app-path', env, 'NIXMAC_E2E_MACINCLOUD_APP_PATH', env.NIXMAC_APP_PATH || '');
  const scenario = argValue(args, '--scenario', '');
  const mode = args.includes('--scenario') || scenario ? 'run-peekaboo' : 'run-peekaboo-suite';
  const remoteArgs = [mode];
  if (args.includes('--no-record')) remoteArgs.push('--no-record');
  if (args.includes('--allow-cleanup')) remoteArgs.push('--allow-cleanup');
  if (args.includes('--allow-destructive')) remoteArgs.push('--allow-destructive');
  if (mode === 'run-peekaboo') remoteArgs.push(scenario || DEFAULT_PEEKABOO_SCENARIO);

  const forwardedPrEnv = PEEKABOO_PR_ENV_KEYS
    .filter((key) => env[key])
    .map((key) => `${key}=${shellQuote(env[key])}`);
  const remoteEnv = [
    'PATH=/opt/homebrew/bin:$PATH',
    appPath ? `NIXMAC_APP_PATH=${shellQuote(appPath)}` : '',
    ...forwardedPrEnv,
  ].filter(Boolean);
  const remoteCommand = [
    `cd ${shellQuote(repoDir)}`,
    `${remoteEnv.join(' ')} ${shellQuote(nodeBin)} tools/computer-use-e2e/run-local.mjs ${remoteArgs.map(shellQuote).join(' ')}`,
  ].join(' && ');

  const sshArgs = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
  if (knownHosts) sshArgs.push('-o', `UserKnownHostsFile=${knownHosts}`);
  if (identityFile) sshArgs.push('-i', identityFile);
  sshArgs.push(sshDest, remoteCommand);
  return { sshArgs, remoteCommand, sshDest, repoDir, mode };
}

async function runPeekabooMacInCloud(args) {
  const command = buildPeekabooMacInCloudCommand(args);
  console.log(`Running ${command.mode} on ${command.sshDest}:${command.repoDir}`);
  const result = spawnSync('ssh', command.sshArgs, { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`MacInCloud Peekaboo run failed with status ${result.status ?? 'unknown'}.`);
}

function scenarioStatusRank(status) {
  return { not_required: 0, inconclusive: 1, pass: 2, fail: 3 }[status] ?? 1;
}

function mergeScenarioState(target, key, source, sourceScenario) {
  const current = target.scenarios[key] ?? {
    label: source.label ?? scenarioLabels[key] ?? sharedScenarioLabels[key] ?? key,
    status: 'inconclusive',
    notes: [],
  };
  if (scenarioStatusRank(source.status) > scenarioStatusRank(current.status)) current.status = source.status;
  if (source.executedByPeekaboo) current.executedByPeekaboo = true;
  if (source.peekabooEvidence) current.peekabooEvidence = source.peekabooEvidence;
  if (source.peekabooTransitiveCoverage && !current.peekabooTransitiveCoverage) {
    current.peekabooTransitiveCoverage = source.peekabooTransitiveCoverage;
  }
  for (const note of source.notes ?? []) {
    const prefixed = `[${sourceScenario}] ${note}`;
    if (!current.notes.includes(prefixed)) current.notes.push(prefixed);
  }
  target.scenarios[key] = current;
}

function mergeQualityScan(rollup, scan, sourceScenario, kind) {
  if (!scan) {
    rollup.violations.push({
      path: null,
      label: sourceScenario,
      issue: `${kind} scan did not produce a result`,
    });
    return;
  }
  rollup.scannedFiles += scan.scannedFiles ?? 0;
  for (const violation of scan.violations ?? []) {
    rollup.violations.push(
      typeof violation === 'string'
        ? `${sourceScenario}: ${violation}`
        : {
            ...violation,
            path: violation.path ? `${sourceScenario}/${violation.path}` : null,
            label: `${sourceScenario}: ${violation.label ?? kind}`,
          },
    );
  }
  if (scan.status !== 'passed') {
    rollup.violations.push({
      path: null,
      label: sourceScenario,
      issue: `${kind} scan status was ${scan.status ?? 'missing'}`,
    });
  }
}

async function copySuiteArtifact({ sourceState, relativePath, suiteDir, suiteScenarioDir }) {
  if (!relativePath) return null;
  assert(!path.isAbsolute(relativePath), `Suite artifact path must be relative: ${relativePath}`);
  const normalizedRelativePath = path.normalize(relativePath);
  assert(
    normalizedRelativePath !== '..' && !normalizedRelativePath.startsWith(`..${path.sep}`),
    `Suite artifact path must not escape the source run directory: ${relativePath}`,
  );
  const sourceRoot = await realpath(sourceState.runDir);
  const sourcePath = path.resolve(sourceRoot, normalizedRelativePath);
  if (!(await pathExists(sourcePath))) return null;
  const resolvedSource = await realpath(sourcePath);
  assertContainedPath(sourceRoot, resolvedSource, 'Suite artifact source');
  const destinationRoot = path.resolve(suiteDir, 'scenarios', suiteScenarioDir);
  const destination = path.resolve(destinationRoot, normalizedRelativePath);
  assertContainedPath(destinationRoot, destination, 'Suite artifact destination');
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(resolvedSource, destination, { recursive: true, preserveTimestamps: true });
  return path.relative(suiteDir, destination);
}

async function renderPeekabooSuiteAggregate({ results, suiteScenarios, noRecord, noCleanup, allowDestructive }) {
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const startedAt = new Date();
  const runSlug = `${timestampSlug(startedAt)}-peekaboo-suite`;
  const runDir = path.join(ARTIFACT_ROOT, runSlug);
  await mkdir(path.join(runDir, 'scenarios'), { recursive: true });
  const { branch, sha } = gitMetadata();
  const macosVersion = tryRun('sw_vers', ['-productVersion']).stdout || 'unknown';
  const suiteCommandArgs = [
    'run-peekaboo-suite',
    ...(noRecord ? ['--no-record'] : []),
    ...(!noCleanup ? ['--allow-cleanup'] : []),
    ...(allowDestructive ? ['--allow-destructive'] : []),
    ...suiteScenarios,
  ];
  const state = createInitialState({
    runDir,
    startedAt: startedAt.toISOString(),
    branch,
    sha,
    macosVersion,
    appSupportExisted: false,
    backupPath: null,
    quitResult: { ok: true, status: 0, stdout: '', stderr: '', error: '' },
    mode: 'peekaboo-suite',
    appCommand: `node tools/computer-use-e2e/run-local.mjs ${suiteCommandArgs.join(' ')}`,
    artifactRoot: ARTIFACT_ROOT,
  });
  state.provider = {
    kind: 'peekaboo-suite',
    note: 'Suite combines no-provider core proof with deterministic local provider smoke proof.',
  };
  state.peekaboo = {
    suite: {
      artifactRows: [],
    },
    scenarios: [],
    noRecord,
    noCleanup,
    allowDestructive,
    coverageMap: {
      schemaVersion: 1,
      lane: 'peekaboo-local-suite',
      scenario: 'peekaboo-suite',
      note: 'Suite coverage is merged from individual Peekaboo scenario reports. Artifacts are copied into this suite directory for portable file:// viewing.',
      phaseCoverage: [],
    },
  };
  const phaseCoverageByKey = new Map();
  const artifactRowsForSuite = [];
  const secretScanRollup = { status: 'passed', scannedFiles: 0, violations: [] };
  const screenshotSignalRollup = { status: 'passed', scannedFiles: 0, violations: [] };
  const cleanupFailures = [];
  for (const result of results) {
    const sourceState = await loadState(result.runDir);
    if (sourceState.cleanup?.restored !== true) cleanupFailures.push(result.scenario);
    const suiteScenarioDir = `${result.scenario}-${path.basename(result.runDir)}`;
    state.peekaboo.scenarios.push({
      scenario: result.scenario,
      sourceRunDir: result.runDir,
      copiedArtifactDir: path.join('scenarios', suiteScenarioDir),
      failed: Boolean(result.failed),
      error: result.error ?? null,
      verdict: verdictFor(sourceState),
      durationSeconds:
        sourceState.peekaboo?.result?.report?.durationMs > 0
          ? Math.round(sourceState.peekaboo.result.report.durationMs / 1000)
          : sourceState.peekaboo?.result?.results?.duration_seconds ?? null,
    });
    for (const [key, item] of Object.entries(sourceState.scenarios ?? {})) {
      if (item.status === 'inconclusive' && !(item.executedByPeekaboo || item.peekabooTransitiveCoverage)) continue;
      mergeScenarioState(state, key, item, result.scenario);
    }
    for (const coverage of coverageMap(sourceState)?.phaseCoverage ?? []) {
      phaseCoverageByKey.set(coverage.key, coverage);
    }
    mergeQualityScan(secretScanRollup, sourceState.peekaboo?.secretScan, result.scenario, 'secret');
    mergeQualityScan(screenshotSignalRollup, sourceState.peekaboo?.screenshotSignal, result.scenario, 'screenshot signal');
    for (const screenshot of sourceState.screenshots ?? []) {
      const copied = await copySuiteArtifact({ sourceState, relativePath: screenshot.path, suiteDir: runDir, suiteScenarioDir });
      if (copied) {
        state.screenshots.push({
          ...screenshot,
          label: `${result.scenario}: ${screenshot.label}`,
          path: copied,
        });
      }
    }
    for (const diagnostic of sourceState.diagnostics ?? []) {
      const copied = await copySuiteArtifact({ sourceState, relativePath: diagnostic.path, suiteDir: runDir, suiteScenarioDir });
      if (copied) state.diagnostics.push({ ...diagnostic, label: `${result.scenario}: ${diagnostic.label}`, path: copied });
    }
    const artifacts = sourceState.peekaboo?.result?.artifacts ?? {};
    for (const [label, relativePath] of [
      ['Preflight', artifacts.preflight],
      ['Log', artifacts.logFile],
      ['stdout', artifacts.stdout],
      ['stderr', artifacts.stderr],
      ['Legacy JSON', artifacts.resultsFile],
      ['Structured report', artifacts.reportFile],
      ['Video', artifacts.videoFile],
      ['Coverage map', 'peekaboo-coverage-map.json'],
      ['Secret scan', 'secret-scan.json'],
      ['Screenshot signal', 'screenshot-signal.json'],
      ['Scenario state', 'state.json'],
      ['Scenario HTML report', 'index.html'],
    ]) {
      const copied = await copySuiteArtifact({ sourceState, relativePath, suiteDir: runDir, suiteScenarioDir });
      if (copied) artifactRowsForSuite.push([`${result.scenario}: ${label}`, copied]);
    }
    state.claims.push(...(sourceState.claims ?? []).map((claim) => ({
      ...claim,
      claim: `[${result.scenario}] ${claim.claim}`,
    })));
    state.narrative.push(...(sourceState.narrative ?? []));
    if (sourceState.failures?.length) {
      state.failures.push(...sourceState.failures.map((failure) => `[${result.scenario}] ${failure}`));
    }
  }
  state.peekaboo.coverageMap.phaseCoverage = [...phaseCoverageByKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  secretScanRollup.status = secretScanRollup.violations.length === 0 ? 'passed' : 'failed';
  screenshotSignalRollup.status = screenshotSignalRollup.violations.length === 0 ? 'passed' : 'failed';
  state.peekaboo.secretScan = secretScanRollup;
  state.peekaboo.screenshotSignal = screenshotSignalRollup;
  state.peekaboo.suite.artifactRows = artifactRowsForSuite;
  state.cleanup = {
    attempted: true,
    restored: cleanupFailures.length === 0,
    note: cleanupFailures.length
      ? `Scenario cleanup was not confirmed for: ${cleanupFailures.join(', ')}. Inspect copied scenario state artifacts before reusing the host.`
      : 'Each scenario performed its own app support restore before the suite aggregate was rendered.',
  };
  for (const [key, item] of Object.entries(state.scenarios)) {
    if (item.status === 'inconclusive') {
      item.status = 'not_required';
      item.notes.push(`Not required for Peekaboo suite scenarios: ${suiteScenarios.join(', ')}.`);
    }
  }
  await saveState(state);
  await writeFile(CURRENT_RUN_FILE, `${runDir}\n`, 'utf8');
  await appendEvent(state, 'peekaboo.suite.rendered', { scenarios: suiteScenarios, sourceRuns: results.map((result) => result.runDir) });
  await render();
  return runDir;
}

function getNixmacWindowInfo() {
  const script = `
tell application "System Events"
  set matches to (processes whose bundle identifier is "com.darkmatter.nixmac")
  if (count of matches) is 0 then error "nixmac is not running as bundle com.darkmatter.nixmac"
  tell item 1 of matches
    if (count of windows) is 0 then error "nixmac has no visible windows"
    set {windowX, windowY} to position of window 1
    set {windowWidth, windowHeight} to size of window 1
    if windowWidth < 1 or windowHeight < 1 then error "nixmac window has invalid bounds"
    try
      set windowTitle to (name of window 1) as text
    on error
      set windowTitle to ""
    end try
    return (windowX as text) & "," & (windowY as text) & "," & (windowWidth as text) & "," & (windowHeight as text) & linefeed & windowTitle
  end tell
end tell`;
  const [region, ...titleLines] = run('osascript', ['-e', script]).trim().split(/\r?\n/);
  if (!/^-?\d+,-?\d+,\d+,\d+$/.test(region)) {
    throw new Error(`Invalid nixmac window region from Accessibility: ${region || '<empty>'}`);
  }
  return { region, title: titleLines.join('\n').trim() };
}

async function capture(args) {
  const label = args[0];
  if (!label) throw new Error('capture requires a label');
  const note = argValue(args, '--note', '');
  const state = await loadState();
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const fileName = `${String(state.screenshots.length + 1).padStart(2, '0')}-${safeLabel}.png`;
  const screenshotPath = path.join(state.runDir, 'screenshots', fileName);
  const windowInfo = getNixmacWindowInfo();
  run('screencapture', ['-x', '-R', windowInfo.region, screenshotPath]);
  const fileStat = await stat(screenshotPath);
  state.screenshots.push({
    label,
    path: path.relative(state.runDir, screenshotPath),
    capturedAt: new Date().toISOString(),
    note,
    bytes: fileStat.size,
    windowTitle: windowInfo.title || null,
  });
  if (note) state.narrative.push({ ts: new Date().toISOString(), text: note });
  await saveState(state);
  await appendEvent(state, 'screenshot.captured', {
    label,
    path: path.relative(state.runDir, screenshotPath),
    note,
    windowTitle: windowInfo.title || null,
  });
  console.log(screenshotPath);
}

async function scenario(args) {
  const [key, statusValue] = args;
  if (!scenarioLabels[key]) throw new Error(`Unknown scenario key: ${key}`);
  if (!['pass', 'fail', 'inconclusive'].includes(statusValue)) {
    throw new Error('scenario status must be pass, fail, or inconclusive');
  }
  const note = argValue(args, '--note', '');
  const state = await loadState();
  state.scenarios[key].status = statusValue;
  if (note) state.scenarios[key].notes.push(note);
  const claim = {
    claim: state.scenarios[key].label,
    status: statusValue,
    evidence: note || 'See screenshots and narrative.',
  };
  const existingClaim = state.claims.find((item) => item.claim === claim.claim);
  if (existingClaim) {
    existingClaim.status = claim.status;
    existingClaim.evidence = claim.evidence;
  } else {
    state.claims.push(claim);
  }
  await saveState(state);
  await appendEvent(state, 'scenario.updated', { key, status: statusValue, note });
}

async function confirmation(args) {
  const [label] = args;
  if (!label) throw new Error('confirmation requires a label');
  const note = argValue(args, '--note', '');
  const state = await loadState();
  const entry = note ? `${label}: ${note}` : label;
  if (!state.confirmationBoundaries.includes(entry)) {
    state.confirmationBoundaries.push(entry);
  }
  await saveState(state);
  await appendEvent(state, 'confirmation.recorded', { label, note });
}

async function narrative(args) {
  const text = args.join(' ').trim();
  if (!text) throw new Error('narrative requires text');
  const state = await loadState();
  state.narrative.push({ ts: new Date().toISOString(), text });
  await saveState(state);
  await appendEvent(state, 'narrative.added', { text });
}

async function appCommand(args) {
  const text = args.join(' ').trim();
  if (!text) throw new Error('app-command requires text');
  const state = await loadState();
  state.appCommand = text;
  await saveState(state);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function verdictFor(state) {
  const statuses = Object.values(state.scenarios).map((scenarioState) => scenarioState.status);
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('inconclusive')) return 'inconclusive';
  if ((state.mode === 'peekaboo' || state.mode === 'peekaboo-suite') && requiredComputerUseCoverage(state).missingRequiredKeys.length > 0) return 'inconclusive';
  return 'pass';
}

function linkArtifact(pathValue) {
  if (!pathValue) return '';
  const label = escapeHtml(pathValue);
  return `<a href="${label}"><code>${label}</code></a>`;
}

function artifactRows(state) {
  if (state.peekaboo?.suite?.artifactRows?.length) {
    const rows = [...state.peekaboo.suite.artifactRows];
    if (state.video?.path && !rows.some(([, artifactPath]) => artifactPath === state.video.path)) {
      rows.unshift(['Video', state.video.path]);
    }
    return rows;
  }
  const artifacts = state.peekaboo?.result?.artifacts;
  const rows = artifacts
    ? [
    ['Preflight', artifacts.preflight],
    ['Log', artifacts.logFile],
    ['stdout', artifacts.stdout],
    ['stderr', artifacts.stderr],
    ['Legacy JSON', artifacts.resultsFile],
    ['Structured report', artifacts.reportFile],
    ['Video', artifacts.videoFile],
      ]
    : [];
  if (state.video?.path && !rows.some(([, artifactPath]) => artifactPath === state.video.path)) {
    rows.unshift(['Video', state.video.path]);
  }
  for (const diagnostic of state.diagnostics ?? []) {
    rows.push([diagnostic.label, diagnostic.path]);
  }
  return rows.filter(([, artifactPath]) => artifactPath);
}

function statusCounts(state) {
  const counts = { pass: 0, fail: 0, inconclusive: 0, not_required: 0 };
  for (const scenario of Object.values(state.scenarios ?? {})) {
    counts[scenario.status] = (counts[scenario.status] ?? 0) + 1;
  }
  return counts;
}

function coverageMap(state) {
  return state.peekaboo?.coverageMap ?? state.peekaboo?.result?.coverageMap ?? null;
}

function coveragePassed(state, coverage) {
  return state.scenarios?.[coverage.key]?.status === 'pass';
}

function phaseCoverageByKey(state) {
  return new Map((coverageMap(state)?.phaseCoverage ?? []).map((coverage) => [coverage.key, coverage]));
}

function coveredComputerUseKeys(state) {
  return [
    ...new Set(
      (coverageMap(state)?.phaseCoverage ?? [])
        .filter((item) => coveragePassed(state, item))
        .flatMap((item) => item.correspondsTo ?? [])
        .filter(Boolean),
    ),
  ].sort();
}

function requiredComputerUseCoverage(state) {
  const covered = new Set(coveredComputerUseKeys(state));
  const requiredKeys = [...PR75_REQUIRED_COMPUTER_USE_KEYS];
  return {
    requiredKeys,
    coveredRequiredKeys: requiredKeys.filter((key) => covered.has(key)),
    missingRequiredKeys: requiredKeys.filter((key) => !covered.has(key)),
  };
}

function currentExplicitWaivers(state) {
  const covered = new Set(coveredComputerUseKeys(state));
  return PR75_COMPUTER_USE_BASELINE.explicitWaivers.filter((waiver) => {
    if (!PR75_REQUIRED_COMPUTER_USE_KEYS.has(waiver.key)) return true;
    return !covered.has(waiver.key);
  });
}

function scenarioEntries(state) {
  return Object.entries(state.scenarios ?? {}).map(([key, item]) => ({ key, ...item }));
}

function visibleNonPassEntries(state) {
  return scenarioEntries(state).filter((item) => !['pass', 'not_required'].includes(item.status));
}

function executedPeekabooEntries(state) {
  const coverageByKey = phaseCoverageByKey(state);
  const phaseKeys = new Set(coverageByKey.keys());
  const scenarioKey = PEEKABOO_SCENARIO_TO_REPORT_KEY[state.peekaboo?.scenario] ?? null;
  return scenarioEntries(state)
    .filter((item) => item.key === scenarioKey || item.executedByPeekaboo || phaseKeys.has(item.key))
    .map((item) => {
      const coverage = coverageByKey.get(item.key);
      if (!coverage || item.peekabooEvidence) return item;
      return {
        ...item,
        executedByPeekaboo: true,
        peekabooEvidence: {
          phaseKey: item.key,
          grade: coverage.grade,
          correspondsTo: coverage.correspondsTo ?? [],
        },
      };
    });
}

function transitiveComputerUseEntries(state) {
  return scenarioEntries(state).filter((item) => item.peekabooTransitiveCoverage);
}

function notRequiredEntries(state) {
  const coveredKeys = new Set(coveredComputerUseKeys(state));
  return scenarioEntries(state).filter((item) => item.status === 'not_required' && !coveredKeys.has(item.key) && !PR75_REQUIRED_COMPUTER_USE_KEYS.has(item.key));
}

function providerLabel(state) {
  if (state.provider?.kind === 'peekaboo-suite') return 'Suite mixed provider';
  if (state.provider?.kind === 'local-provider-stub') return 'Local provider stub';
  if (state.provider?.kind === 'no-llm-provider-required') return 'No LLM provider required';
  if (state.provider?.kind === 'not-required' && /local provider stub/i.test(state.provider?.note ?? '')) return 'Local provider stub';
  if (state.provider?.kind) return state.provider.kind;
  return state.setup?.mockProvider?.baseUrl ?? 'Unavailable';
}

function providerSummaryNote(state) {
  if (state.provider?.kind === 'peekaboo-suite') return 'Core no-provider proof + provider stub proof.';
  if (state.provider?.kind === 'local-provider-stub') return 'Deterministic OpenAI-compatible stub verified.';
  if (state.provider?.kind === 'no-llm-provider-required') return 'No provider required for this scenario.';
  if (state.provider?.kind === 'not-required' && /local provider stub/i.test(state.provider?.note ?? '')) return 'Deterministic provider stub verified.';
  return state.provider?.note ?? '';
}

function scenarioDisplayName(state) {
  if (state.mode === 'peekaboo-suite') return 'Peekaboo Product Proof suite';
  const scenario = state.peekaboo?.scenario;
  const reportKey = PEEKABOO_SCENARIO_TO_REPORT_KEY[scenario];
  return scenarioLabels[reportKey] ?? scenario ?? state.mode ?? 'local';
}

function scenarioSummaryNote(state) {
  if (state.mode === 'peekaboo-suite') {
    const scenarios = state.peekaboo?.scenarios?.map((item) => item.scenario).join(', ') || 'No scenarios recorded';
    return `${scenarios} · ${runDuration(state)}`;
  }
  const scenario = state.peekaboo?.scenario;
  const duration = runDuration(state);
  return scenario ? `${scenario} · ${duration}` : duration;
}

function runDuration(state) {
  if (state.mode === 'peekaboo-suite') {
    const durations = (state.peekaboo?.scenarios ?? []).map((item) => item.durationSeconds).filter(Number.isFinite);
    if (durations.length) return `${durations.reduce((sum, value) => sum + value, 0)}s`;
    return `${state.peekaboo?.scenarios?.length ?? 0} scenario(s)`;
  }
  const ms = state.peekaboo?.result?.report?.durationMs;
  const seconds = state.peekaboo?.result?.results?.duration_seconds;
  if (Number.isFinite(ms) && ms > 0) return `${Math.round(ms / 1000)}s`;
  if (Number.isFinite(seconds) && seconds > 0) return `${seconds}s`;
  return 'Not recorded';
}

function renderStatusPill(status, label = status) {
  return `<span class="verdict ${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function renderNotes(notes = []) {
  return notes.length ? notes.map(escapeHtml).join('<br>') : 'No notes recorded.';
}

function renderScenarioNotes(item) {
  let notes = item.notes ?? [];
  if (item.status !== 'not_required') {
    notes = notes.filter(
      (note) =>
        !/\bNot required for Peekaboo (?:suite scenarios|macos_[a-z_]+ run)\b/i.test(String(note)),
    );
  }
  if (!notes.length && item.peekabooTransitiveCoverage) {
    notes = [`Covered transitively by ${item.peekabooTransitiveCoverage.phaseKey ?? 'Peekaboo evidence'}.`];
  }
  if (!notes.length && item.executedByPeekaboo) {
    notes = ['Executed by Peekaboo and confirmed in this report.'];
  }
  return renderNotes(notes);
}

function renderProofRows(items, { includeCoverage = true } = {}) {
  if (!items.length) return '<tr><td colspan="5">None.</td></tr>';
  return items
    .map((item) => {
      const evidence = item.peekabooEvidence ?? item.peekabooTransitiveCoverage ?? {};
      return `<tr>
        <td><strong>${escapeHtml(item.label)}</strong><br><small><code>${escapeHtml(item.key)}</code></small></td>
        <td>${renderStatusPill(item.status)}</td>
        <td>${escapeHtml(evidence.grade ?? 'scenario')}</td>
        <td>${includeCoverage ? escapeHtml((item.peekabooEvidence?.correspondsTo ?? [item.peekabooTransitiveCoverage ? item.key : '']).filter(Boolean).join(', ') || 'none') : ''}</td>
        <td>${renderScenarioNotes(item)}</td>
      </tr>`;
    })
    .join('\n');
}

function renderStatusRows(items) {
  if (!items.length) return '<tr><td colspan="3">None.</td></tr>';
  return items
    .map(
      (item) => `<tr>
        <td><strong>${escapeHtml(item.label)}</strong><br><small><code>${escapeHtml(item.key)}</code></small></td>
        <td>${renderStatusPill(item.status)}</td>
        <td>${renderScenarioNotes(item)}</td>
      </tr>`,
    )
    .join('\n');
}

function transitiveCoverageFor(item) {
  const note = (item.notes ?? [])
    .map(String)
    .find((entry) => /Covered transitively by \w+; Peekaboo evidence grade: [^.]+/i.test(entry));
  const match = note?.match(/Covered transitively by (\w+); Peekaboo evidence grade: ([^.]+)/i);
  if (match) return { phaseKey: match[1], grade: match[2] };
  return item.peekabooTransitiveCoverage ?? {};
}

function renderTransitiveRows(items) {
  if (!items.length) return '<tr><td colspan="5">None.</td></tr>';
  return items
    .map((item) => {
      const coverage = transitiveCoverageFor(item);
      return `<tr>
        <td><strong>${escapeHtml(item.label)}</strong><br><small><code>${escapeHtml(item.key)}</code></small></td>
        <td>${renderStatusPill(item.status)}</td>
        <td>${escapeHtml(coverage.grade ?? 'scenario')}</td>
        <td><code>${escapeHtml(coverage.phaseKey ?? 'unknown')}</code></td>
        <td>${renderScenarioNotes(item)}</td>
      </tr>`;
    })
    .join('\n');
}

function renderParityRows(state) {
  const rows = [];
  const groupedByComputerUseKey = new Map();
  for (const coverage of coverageMap(state)?.phaseCoverage ?? []) {
    if (!coverage.correspondsTo?.length) {
      rows.push({
        computerUseKey: 'none',
        phases: [coverage],
        status: 'pass',
        note: 'Peekaboo-only fixture or audit evidence; no direct Computer Use key.',
      });
      continue;
    }
    for (const computerUseKey of coverage.correspondsTo) {
      const row = groupedByComputerUseKey.get(computerUseKey) ?? {
        computerUseKey,
        phases: [],
      };
      row.phases.push(coverage);
      groupedByComputerUseKey.set(computerUseKey, row);
    }
  }
  for (const row of groupedByComputerUseKey.values()) {
      const computerUseScenario = state.scenarios?.[row.computerUseKey];
      const phasePassed = row.phases.some((coverage) => coveragePassed(state, coverage));
      row.status =
        computerUseScenario?.peekabooTransitiveCoverage || phasePassed
          ? 'pass'
          : computerUseScenario?.status ?? 'not_required';
      const passedPhaseKeys = row.phases.filter((coverage) => coveragePassed(state, coverage)).map((coverage) => coverage.key);
      row.note = phasePassed
        ? `Covered by passed Peekaboo phase(s): ${passedPhaseKeys.join(', ')}.`
        : computerUseScenario?.notes?.join(' ') || 'Mapped by Peekaboo coverage metadata.';
      rows.push(row);
  }
  if (!rows.length) return '<tr><td colspan="5">No Peekaboo parity map was produced.</td></tr>';
  return rows
    .map(
      (row) => `<tr>
        <td><code>${escapeHtml(row.computerUseKey)}</code></td>
        <td>${renderStatusPill(row.status)}</td>
        <td>${row.phases.map((phase) => `<code>${escapeHtml(phase.key)}</code><br><small>${escapeHtml(phase.label)}</small>`).join('<br>')}</td>
        <td>${escapeHtml([...new Set(row.phases.map((phase) => phase.grade))].join(', '))}</td>
        <td>${escapeHtml(row.note)}</td>
      </tr>`,
    )
    .join('\n');
}

function renderBaselineCoverageRows(state) {
  const covered = new Set(coveredComputerUseKeys(state));
  return PR75_COMPUTER_USE_BASELINE.requiredKeys
    .map((key) => {
      const status = covered.has(key) ? 'pass' : 'not_required';
      const note = covered.has(key)
        ? 'Covered by passed Peekaboo evidence in this report.'
        : 'Remaining required breadth gap for Peekaboo parity.';
      return `<tr>
        <td><code>${escapeHtml(key)}</code></td>
        <td>${renderStatusPill(status, covered.has(key) ? 'covered' : 'gap')}</td>
        <td>${escapeHtml(scenarioLabels[key] ?? sharedScenarioLabels[key] ?? key)}</td>
        <td>${escapeHtml(note)}</td>
      </tr>`;
    })
    .join('\n');
}

function renderListItems(items = [], fallback) {
  if (!items.length) return `<li>${escapeHtml(fallback)}</li>`;
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n');
}

function renderCodeListItems(items = [], fallback) {
  if (!items.length) return `<li>${escapeHtml(fallback)}</li>`;
  return items.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('\n');
}

function renderPrSurfaceRows(state) {
  const rows = state.prFocus?.matchedSurfaces ?? [];
  if (!rows.length) return '<tr><td colspan="4">No manifest surface mappings inferred.</td></tr>';
  return rows
    .map((row) => {
      const coverageNote = row.waiver
        ? escapeHtml(row.waiver.exitCriteria ?? row.waiver.reason ?? 'waived')
        : row.coverageNote
          ? escapeHtml(row.coverageNote)
          : row.coverageDisposition === 'non-claiming'
            ? 'Tracked without claiming scenario coverage'
            : 'Mapped';
      return `<tr>
        <td><code>${escapeHtml(row.file)}</code></td>
        <td>${escapeHtml(row.label ?? row.id ?? 'unknown')}</td>
        <td>${escapeHtml((row.scenarioKeys ?? []).map((key) => scenarioLabels[key] ?? sharedScenarioLabels[key] ?? key).join(', ') || 'explicit waiver / unmapped')}</td>
        <td>${coverageNote}</td>
      </tr>`;
    })
    .join('\n');
}

function renderPeekabooPrFocus(state) {
  const pr = state.prFocus ?? { configured: false, changedFiles: [], userVisibleFiles: [], scenarioKeys: [], scenarioSuggestions: [] };
  const mappedScenarioLabels = (pr.scenarioKeys ?? []).map((key) => scenarioLabels[key] ?? sharedScenarioLabels[key] ?? key);
  return `<h2 id="pull-request-focus">Pull Request Focus</h2>
  <section class="panel">
    <p><strong>PR:</strong> ${escapeHtml(pr.number || 'not provided')}${pr.title ? ` - ${escapeHtml(pr.title)}` : ''}</p>
    <p><strong>Refs:</strong> ${escapeHtml(pr.baseRef || 'base ?')} ← ${escapeHtml(pr.headRef || 'head ?')}</p>
    <div class="summary">
      <div class="metric"><strong>Changed files</strong><span>${escapeHtml(String(pr.changedFiles?.length ?? 0))}</span><small>${pr.configured ? 'Forwarded from GitHub PR metadata.' : 'No PR metadata was configured for this run.'}</small></div>
      <div class="metric"><strong>User-visible files</strong><span>${escapeHtml(String(pr.userVisibleFiles?.length ?? 0))}</span><small>Inferred from coverage-manifest.json plus app/test/workflow heuristics.</small></div>
      <div class="metric"><strong>Mapped scenarios</strong><span>${escapeHtml(String(pr.scenarioKeys?.length ?? 0))}</span><small>Used to focus reviewer attention on changed surfaces.</small></div>
    </div>
    ${pr.manifestLoadError ? `<p class="warning"><strong>Manifest load error:</strong> ${escapeHtml(pr.manifestLoadError)}</p>` : ''}
    <h3>Mapped PR Surfaces</h3>
    <div class="table-scroll"><table>
      <thead><tr><th>Changed File</th><th>Surface</th><th>Scenario Focus</th><th>Coverage Note</th></tr></thead>
      <tbody>${renderPrSurfaceRows(state)}</tbody>
    </table></div>
    <h3>Scenario Focus</h3>
    <ul>${renderListItems(mappedScenarioLabels, 'No dedicated scenario mapping inferred from changed files.')}</ul>
    <h3>Suggested Coverage Updates</h3>
    <ul>${renderListItems(pr.scenarioSuggestions ?? [], 'No unmapped user-visible changed files detected.')}</ul>
    <details>
      <summary>Changed files (${escapeHtml(String(pr.changedFiles?.length ?? 0))})</summary>
      <ul>${renderCodeListItems(pr.changedFiles ?? [], 'No changed-file metadata provided.')}</ul>
    </details>
    <details>
      <summary>Unmapped user-visible files (${escapeHtml(String(pr.unmappedUserVisibleFiles?.length ?? 0))})</summary>
      <ul>${renderCodeListItems(pr.unmappedUserVisibleFiles ?? [], 'No unmapped user-visible files detected.')}</ul>
    </details>
  </section>`;
}

function screenshotFamily(labelOrPath) {
  return path
    .basename(String(labelOrPath ?? 'screenshot'))
    .replace(/\.[^.]+$/, '')
    .replace(/_annotated$/, '')
    .replace(/-webkit-snapshot-\d+$/i, '');
}

function proofGalleryItems(state) {
  const families = new Map();
  for (const shot of state.screenshots ?? []) {
    const family = screenshotFamily(shot.path ?? shot.label);
    const current = families.get(family) ?? { family, primary: null, annotated: null, variants: [] };
    current.variants.push(shot);
    if (/_annotated(?:\.[^.]+)?$/.test(path.basename(shot.path ?? shot.label ?? ''))) {
      current.annotated ??= shot;
    } else if (!current.primary || (shot.path?.startsWith('screenshots/') && !current.primary.path?.startsWith('screenshots/'))) {
      current.primary = shot;
    }
    families.set(family, current);
  }
  return [...families.values()]
    .map((item) => ({ ...item, primary: item.primary ?? item.annotated ?? item.variants[0] }))
    .sort((a, b) => a.primary.path.localeCompare(b.primary.path));
}

function formatChapterTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0ms';
  if (seconds < 60) return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function evidenceVideoFrameDurationSeconds(state = {}) {
  const fromState = Number(state.video?.frameDurationSeconds);
  if (Number.isFinite(fromState) && fromState > 0) return fromState;
  const fromEnv = Number(process.env.NIXMAC_E2E_VIDEO_FRAME_DURATION_SECONDS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 1.1;
}

function proofTimelineItems(state) {
  const items = proofGalleryItems(state).sort((a, b) => {
    const aTime = Date.parse(a.primary.capturedAt ?? '');
    const bTime = Date.parse(b.primary.capturedAt ?? '');
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    return a.primary.path.localeCompare(b.primary.path);
  });
  const firstCapturedAt = Date.parse(items[0]?.primary.capturedAt ?? '');
  const videoFrameDurationSeconds = evidenceVideoFrameDurationSeconds(state);
  return items.map((item, index) => {
    const capturedAt = Date.parse(item.primary.capturedAt ?? '');
    return {
      ...item,
      frameIndex: index,
      seconds: Number.isFinite(firstCapturedAt) && Number.isFinite(capturedAt) ? Math.max(0, (capturedAt - firstCapturedAt) / 1000) : 0,
      videoSeconds: Number((index * videoFrameDurationSeconds).toFixed(3)),
      chapterLabel: item.primary.label.replace(/^[^:]+:\s*/, '').replace(/[-_]/g, ' '),
    };
  });
}

function splitScreenshotLabel(label) {
  const raw = String(label ?? '');
  const match = raw.match(/^([^:]+):\s*(.+)$/);
  return match ? { scenario: match[1], label: match[2] } : { scenario: null, label: raw };
}

function humanizeScreenshotLabel(label) {
  return String(label ?? 'Screenshot proof')
    .replace(/\.(png|jpg|jpeg|webp)$/i, '')
    .replace(/-\d{9,}$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function galleryScenarioStatus(state, item) {
  const scenarioName = splitScreenshotLabel(item.primary?.label).scenario;
  if (!scenarioName) return verdictFor(state);
  const suiteScenario = state.peekaboo?.scenarios?.find((scenario) => scenario.scenario === scenarioName);
  if (suiteScenario?.failed) return 'fail';
  if (['pass', 'fail', 'inconclusive'].includes(suiteScenario?.verdict)) return suiteScenario.verdict;
  return verdictFor(state);
}

function galleryScenarioLabel(item) {
  const scenarioName = splitScreenshotLabel(item.primary?.label).scenario;
  return scenarioName ? humanizeScreenshotLabel(scenarioName) : 'Focused run';
}

const galleryCalloutRules = [
  {
    pattern: /settings|api-keys|ai-models|preferences/i,
    callouts: [{ label: 'Settings surface under test', x: 12, y: 14, w: 76, h: 72 }],
  },
  {
    pattern: /descriptor|typed|prompt/i,
    callouts: [{ label: 'Typed intent captured', x: 7, y: 34, w: 86, h: 22 }],
  },
  {
    pattern: /review|provider|summary|diff/i,
    callouts: [{ label: 'Generated review evidence visible', x: 8, y: 13, w: 84, h: 76 }],
  },
  {
    pattern: /save-step|ready|after-build|commit/i,
    callouts: [{ label: 'Save boundary evidence', x: 12, y: 20, w: 76, h: 60 }],
  },
  {
    pattern: /history|restore|rollback/i,
    callouts: [{ label: 'History / restore proof', x: 8, y: 13, w: 84, h: 74 }],
  },
  {
    pattern: /discard|confirmation/i,
    callouts: [{ label: 'Discard confirmation boundary', x: 18, y: 18, w: 64, h: 64 }],
  },
  {
    pattern: /feedback|report-issue|support/i,
    callouts: [{ label: 'Support dialog evidence', x: 18, y: 15, w: 64, h: 68 }],
  },
  {
    pattern: /console/i,
    callouts: [{ label: 'Console surface visible', x: 8, y: 12, w: 84, h: 76 }],
  },
  {
    pattern: /popover|customization|homebrew/i,
    callouts: [{ label: 'Configuration surface proof', x: 12, y: 16, w: 76, h: 68 }],
  },
  {
    pattern: /launch|launched|core/i,
    callouts: [
      { label: 'App shell visible', x: 6, y: 8, w: 88, h: 26 },
      { label: 'Workflow area ready', x: 7, y: 36, w: 86, h: 38 },
    ],
  },
];

function galleryCallouts(item) {
  const { label } = splitScreenshotLabel(item.primary?.label);
  const searchTarget = `${item.family} ${label} ${item.primary?.path ?? ''}`;
  const rule = galleryCalloutRules.find((candidate) => candidate.pattern.test(searchTarget));
  return rule?.callouts ?? [{ label: 'Screenshot evidence for this check', x: 8, y: 10, w: 84, h: 78 }];
}

function renderGalleryCallouts(callouts) {
  return callouts
    .map(
      (callout) =>
        `<span class="visual-callout" style="left:${escapeHtml(String(callout.x))}%;top:${escapeHtml(String(callout.y))}%;width:${escapeHtml(String(callout.w))}%;height:${escapeHtml(String(callout.h))}%"><span>${escapeHtml(callout.label)}</span></span>`,
    )
    .join('\n');
}

function videoArtifactPath(state, artifactRowsForState = artifactRows(state)) {
  if (state.video?.path) return state.video.path;
  const row = artifactRowsForState.find(([label, artifactPath]) => /video/i.test(label) && /\.mp4(?:$|\?)/i.test(artifactPath ?? ''));
  return row?.[1] ?? null;
}

function ffmpegConcatFileLine(filePath) {
  return `file '${String(filePath).replaceAll("'", "'\\''")}'`;
}

async function usableFile(relativeRunPath, runDir) {
  if (!relativeRunPath) return false;
  try {
    const fileStat = await stat(path.join(runDir, relativeRunPath));
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

async function maybeGeneratePeekabooEvidenceVideo(state) {
  if (state.mode !== 'peekaboo' && state.mode !== 'peekaboo-suite') return false;
  const runDir = path.resolve(state.runDir);
  if (state.video?.path && (await usableFile(state.video.path, runDir))) return false;

  const timeline = proofTimelineItems(state);
  const frames = [];
  for (const item of timeline) {
    if (!item.primary?.path) continue;
    const fullPath = path.join(runDir, item.primary.path);
    try {
      const fileStat = await stat(fullPath);
      if (fileStat.isFile() && fileStat.size > 0) frames.push(fullPath);
    } catch {
      // Missing screenshots are handled by the screenshot-signal gate.
    }
  }

  if (!frames.length) {
    state.video = {
      status: 'unavailable',
      note: 'No screenshot frames were available for the Peekaboo evidence video.',
    };
    return true;
  }

  const videoDir = path.join(runDir, 'video');
  await mkdir(videoDir, { recursive: true });
  const frameDurationSeconds = evidenceVideoFrameDurationSeconds(state);
  const framesPath = path.join(videoDir, 'peekaboo-evidence-frames.txt');
  const chaptersPath = path.join(videoDir, 'peekaboo-evidence-chapters.json');
  const videoPath = path.join(videoDir, 'peekaboo-evidence.mp4');
  const concatFrames = frames.map((framePath) => path.relative(videoDir, framePath));
  const frameList = concatFrames.flatMap((framePath) => [ffmpegConcatFileLine(framePath), `duration ${frameDurationSeconds}`]).join('\n');
  await writeFile(framesPath, `${frameList}\n${ffmpegConcatFileLine(concatFrames.at(-1))}\n`, 'utf8');
  await writeJson(
    chaptersPath,
    timeline.map((item) => ({
      timeSeconds: item.videoSeconds,
      label: item.chapterLabel,
      screenshot: item.primary?.path ?? null,
      capturedAt: item.primary?.capturedAt ?? null,
    })),
  );

  const result = tryRun('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    framesPath,
    '-vf',
    'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p',
    '-movflags',
    '+faststart',
    videoPath,
  ]);

  const relativeVideoPath = path.relative(runDir, videoPath);
  if (!result.ok || !(await usableFile(relativeVideoPath, runDir))) {
    state.video = {
      status: 'unavailable',
      path: result.ok ? relativeVideoPath : null,
      frames: frames.length,
      frameDurationSeconds,
      note: `ffmpeg could not generate the Peekaboo screenshot evidence video: ${result.stderr || result.error || 'unknown error'}`,
    };
    return true;
  }

  state.video = {
    status: 'available',
    path: relativeVideoPath,
    frames: frames.length,
    frameDurationSeconds,
    chaptersPath: path.relative(runDir, chaptersPath),
    framesPath: path.relative(runDir, framesPath),
    note: `Screenshot-compilation video generated from ${frames.length} Peekaboo frames at ${frameDurationSeconds}s per frame.`,
  };
  state.diagnostics ??= [];
  for (const [label, artifactPath, note] of [
    ['Peekaboo evidence video chapters', state.video.chaptersPath, 'Generated timestamp/chapter metadata for the Peekaboo evidence MP4.'],
    ['Peekaboo evidence video frame list', state.video.framesPath, 'Generated ffmpeg concat frame list for the Peekaboo evidence MP4.'],
  ]) {
    if (artifactPath && !state.diagnostics.some((item) => item.path === artifactPath)) {
      state.diagnostics.push({ label, path: artifactPath, note });
    }
  }
  return true;
}

function renderEvidenceVideo(state, artifacts) {
  const timeline = proofTimelineItems(state);
  const videoPath = videoArtifactPath(state, artifacts);
  const chapters = timeline;
  const frameDurationSeconds = evidenceVideoFrameDurationSeconds(state);
  const chapterButtons = chapters.length
    ? `<div class="video-chapters" aria-label="Derived video chapters">
        <strong>Screenshot chapters</strong>
        <small>${
          videoPath
            ? `Chapter times use the same persisted ${escapeHtml(String(frameDurationSeconds))}s screenshot frame cadence as the Computer Use evidence video.`
            : 'Times are derived from screenshot capture metadata; chapter buttons scroll to the matching proof frame.'
        }</small>
        <div class="chapter-list">
          ${chapters
            .map(
              (item) =>
                `<button type="button" ${videoPath ? `data-video-seek="${escapeHtml(String(item.videoSeconds))}"` : ''} data-screenshot-target="screenshot-${escapeHtml(item.family)}">${escapeHtml(formatChapterTime(videoPath ? item.videoSeconds : item.seconds))} ${escapeHtml(item.chapterLabel)}</button>`,
            )
            .join('\n')}
        </div>
      </div>`
    : '';
  const storyboard = timeline.length
    ? `<div class="storyboard-strip" aria-label="Screenshot storyboard">
        ${timeline
          .slice(0, 18)
          .map(
            (item) => `<a href="#screenshot-${escapeHtml(item.family)}">
              <img src="${escapeHtml(item.primary.path)}" alt="${escapeHtml(item.primary.label)}">
              <span>${escapeHtml(formatChapterTime(videoPath ? item.videoSeconds : item.seconds))}</span>
            </a>`,
          )
          .join('\n')}
      </div>`
    : '<p>No storyboard frames captured.</p>';

  return `<section id="summary-video" class="summary-video">
    <div class="summary-video-copy">
      <strong>${videoPath ? 'Evidence video' : 'Evidence storyboard'}</strong>
      <small>${
        videoPath
          ? `Screenshot-compilation MP4 built from ${state.video?.frames ?? timeline.length} captured frame(s), with ${chapters.length} timestamped chapter marker(s).`
          : `Timestamped screenshot storyboard compiled from ${timeline.length} captured frame(s).`
      }</small>
      ${chapterButtons}
    </div>
    <div>
      ${
        videoPath
          ? `<video controls preload="metadata" src="${escapeHtml(videoPath)}"></video>`
          : '<p class="summary-video-unavailable">No MP4 was recorded for this run; the storyboard below preserves the same skim path with derived timestamps.</p>'
      }
      ${storyboard}
    </div>
  </section>`;
}

function renderGallery(state) {
  const items = proofGalleryItems(state);
  if (!items.length) return '<p>No screenshots captured.</p>';
  return `<div class="proof-grid">
    ${items
      .map((item) => {
        const status = galleryScenarioStatus(state, item);
        const { label } = splitScreenshotLabel(item.primary.label);
        const displayLabel = humanizeScreenshotLabel(label);
        const callouts = galleryCallouts(item);
        const isWebkitSnapshot = /webkit-snapshot/i.test(`${item.primary.label ?? ''} ${item.primary.path ?? ''}`);
        return `<figure class="proof-card proof-card-${escapeHtml(status)}" id="screenshot-${escapeHtml(item.family)}">
          <div class="screenshot-proof-frame" data-visual-annotation="report-callouts">
            <img src="${escapeHtml(item.primary.path)}" alt="${escapeHtml(item.primary.label)}">
            <div class="visual-annotation-layer" aria-hidden="true">
              <span class="visual-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
              ${renderGalleryCallouts(callouts)}
            </div>
          </div>
          <figcaption>
            <span class="proof-caption-head">
              <strong>${escapeHtml(displayLabel || item.primary.label)}</strong>
              <span class="proof-mode">${escapeHtml(isWebkitSnapshot ? 'WKWebView internal snapshot' : 'review highlight')}</span>
            </span>
            <span>${escapeHtml(galleryScenarioLabel(item))} - ${escapeHtml(item.primary.note || 'Screenshot proof')}</span>
            <span class="proof-meta">Captured ${escapeHtml(item.primary.capturedAt || 'time unavailable')} from ${escapeHtml(isWebkitSnapshot ? 'the running WKWebView WebContent surface' : 'the raw screenshot')}; video/storyboard frames remain raw.</span>
            ${
              item.primary.windowTitle
                ? `<span class="proof-meta">Window title at capture: ${escapeHtml(item.primary.windowTitle)}</span>`
                : ''
            }
            <a class="proof-link" href="${escapeHtml(item.primary.path)}" target="_blank" rel="noopener">Open raw screenshot</a>
            ${
              item.annotated && item.annotated.path !== item.primary.path
                ? `<details><summary>Peekaboo AX overlay</summary><p>Auto-generated accessibility-tree boxes from Peekaboo, kept for debugging but not treated as the curated pass/fail callout layer.</p><img src="${escapeHtml(item.annotated.path)}" alt="${escapeHtml(item.annotated.label)}"></details>`
                : ''
            }
          </figcaption>
        </figure>`;
      })
      .join('\n')}
  </div>`;
}

function renderArtifactTable(rows) {
  if (!rows.length) return '<p>No runner artifacts recorded.</p>';
  return `<div class="table-scroll"><table>
    <thead><tr><th>Artifact</th><th>Path</th></tr></thead>
    <tbody>
      ${rows
        .map(
          ([label, artifactPath]) => `<tr>
            <td>${escapeHtml(label)}</td>
            <td>${linkArtifact(artifactPath)}</td>
          </tr>`,
        )
        .join('\n')}
    </tbody>
  </table></div>`;
}

async function render() {
  const runDir = await getCurrentRunDir();
  const state = await loadState(runDir);
  state.runDir = runDir;
  if (await maybeGeneratePeekabooEvidenceVideo(state)) {
    await saveState(state);
  }
  const verdict = verdictFor(state);
  const counts = statusCounts(state);
  const failures = visibleNonPassEntries(state);
  const executed = executedPeekabooEntries(state);
  const transitive = transitiveComputerUseEntries(state);
  const notRequired = notRequiredEntries(state);
  const requiredCoverage = requiredComputerUseCoverage(state);
  const artifacts = artifactRows(state);
  const reportTitle = state.mode === 'peekaboo' ? 'nixmac Peekaboo Local E2E Evidence' : 'nixmac Computer Use Local E2E Evidence';
  const effectiveReportTitle = state.mode === 'peekaboo-suite' ? 'nixmac Peekaboo Suite E2E Evidence' : reportTitle;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(effectiveReportTitle)}</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; background: #050607; color: #f4f5f5; }
    * { box-sizing: border-box; }
    body { margin: 0; background: radial-gradient(circle at 20% 0%, #15191a 0, #050607 42rem); color: #f4f5f5; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 18px 56px; }
    header { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(320px, .9fr); gap: 18px; align-items: stretch; margin-bottom: 18px; }
    h1, h2, h3 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 28px; line-height: 1.1; }
    h2 { font-size: 17px; margin: 28px 0 12px; }
    h3 { font-size: 14px; margin-bottom: 8px; }
    p, small, figcaption { color: #a9b0b5; line-height: 1.45; }
    a { color: #9fe8c6; text-decoration: none; }
    code { color: #b7d7ff; word-break: break-word; }
    .hero, .panel, .metric, .proof-card { border: 1px solid #23282b; border-radius: 8px; background: rgba(16, 18, 20, .92); }
    .hero { padding: 18px; min-height: 210px; display: flex; flex-direction: column; justify-content: space-between; }
    .hero p { max-width: 820px; margin: 10px 0 0; }
    .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    header .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    header .summary .metric:first-child { grid-column: 1 / -1; }
    .metric { padding: 12px; min-height: 68px; min-width: 0; }
    .metric strong { display: block; font-size: 11px; color: #7f878d; text-transform: uppercase; margin-bottom: 7px; }
    .metric span { display: block; font-size: 20px; line-height: 1.15; font-weight: 700; color: #f4f5f5; overflow-wrap: anywhere; }
    .metric small { display: block; margin-top: 4px; overflow-wrap: anywhere; }
    .verdict { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 9px; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .pass, .passed { background: #0d3c28; color: #8cf2bc; }
    .fail, .failed { background: #4c1515; color: #ffb0aa; }
    .inconclusive { background: #453612; color: #ffd983; }
    .not_required { background: #252b31; color: #aab2bb; }
    .warning { border-color: #4d3b18; background: #191409; }
    .warning strong { color: #ffd983; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; }
    nav a { border: 1px solid #252b31; border-radius: 999px; padding: 7px 10px; color: #dce2e2; background: #111417; font-size: 12px; }
    .panel { padding: 14px; margin: 12px 0; }
    .table-scroll { overflow-x: auto; border: 1px solid #23282b; border-radius: 8px; }
    table { width: 100%; min-width: 760px; border-collapse: collapse; background: #0b0d0f; }
    th, td { border-bottom: 1px solid #23282b; padding: 10px; text-align: left; vertical-align: top; }
    th { color: #8a9298; font-size: 11px; text-transform: uppercase; background: #13171a; }
    td { font-size: 13px; }
    tr:last-child td { border-bottom: 0; }
    .proof-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
    .proof-card-pass { border-color: #214934; }
    .proof-card-fail { border-color: #6b2525; }
    .proof-card-inconclusive { border-color: #5f4a18; }
    .screenshot-proof-frame { position: relative; overflow: hidden; border: 1px solid #23282b; border-radius: 8px; background: #000; }
    .screenshot-proof-frame img { border: 0; border-radius: 0; }
    .visual-annotation-layer { position: absolute; inset: 0; pointer-events: none; }
    .visual-status { position: absolute; left: 10px; top: 10px; z-index: 2; display: inline-flex; align-items: center; justify-content: center; min-width: 58px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; padding: 5px 9px; font-size: 11px; line-height: 1; font-weight: 900; letter-spacing: 0; text-transform: uppercase; box-shadow: 0 8px 22px rgba(0,0,0,.34); }
    .visual-callout { position: absolute; box-sizing: border-box; border: 2px solid rgba(159, 232, 198, .92); border-radius: 6px; background: rgba(159, 232, 198, .08); box-shadow: inset 0 0 0 1px rgba(3, 16, 12, .42), 0 10px 28px rgba(0,0,0,.28); }
    .proof-card-fail .visual-callout { border-color: rgba(255, 176, 170, .95); background: rgba(255, 176, 170, .10); }
    .proof-card-inconclusive .visual-callout { border-color: rgba(255, 217, 131, .95); background: rgba(255, 217, 131, .10); }
    .visual-callout::after { content: ""; position: absolute; inset: -5px; border: 1px solid rgba(159, 232, 198, .24); border-radius: 10px; }
    .proof-card-fail .visual-callout::after { border-color: rgba(255, 176, 170, .26); }
    .proof-card-inconclusive .visual-callout::after { border-color: rgba(255, 217, 131, .26); }
    .visual-callout span { position: absolute; left: 8px; top: 8px; max-width: min(260px, calc(100% - 16px)); border: 1px solid rgba(0,0,0,.16); border-radius: 5px; padding: 4px 7px; background: rgba(159, 232, 198, .96); color: #07110d; font-size: 12px; line-height: 1.15; font-weight: 850; box-shadow: 0 6px 18px rgba(0,0,0,.28); }
    .proof-card-fail .visual-callout span { background: rgba(255, 176, 170, .96); color: #180707; }
    .proof-card-inconclusive .visual-callout span { background: rgba(255, 217, 131, .96); color: #171005; }
    .summary-video { margin: 18px 0; display: grid; grid-template-columns: minmax(240px, 0.42fr) minmax(360px, 1fr); gap: 18px; align-items: start; padding: 16px; border: 1px solid #23282b; border-radius: 8px; background: #101418; }
    .summary-video-copy strong { display: block; margin-bottom: 6px; color: #f4f5f5; }
    .summary-video-copy small { display: block; color: #a9b0b5; line-height: 1.45; }
    .summary-video video { width: 100%; max-height: 520px; border: 1px solid #23282b; border-radius: 8px; background: #000; }
    .summary-video-unavailable { margin: 0 0 10px; }
    .video-chapters { margin-top: 14px; display: grid; gap: 8px; }
    .chapter-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .chapter-list button { border: 1px solid #2f373c; border-radius: 999px; padding: 6px 9px; background: #151a1e; color: #dce2e2; cursor: pointer; font: inherit; font-size: 12px; }
    .chapter-list button:hover { border-color: #9fe8c6; color: #9fe8c6; }
    .storyboard-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; margin-top: 10px; }
    .storyboard-strip a { display: block; border: 1px solid #23282b; border-radius: 8px; padding: 6px; background: #0b0d0f; color: #dce2e2; text-decoration: none; }
    .storyboard-strip img { aspect-ratio: 16 / 10; object-fit: cover; border-radius: 6px; }
    .storyboard-strip span { display: block; margin-top: 4px; font-size: 11px; color: #a9b0b5; }
    figure { margin: 0; }
    img, video { width: 100%; border: 1px solid #23282b; border-radius: 8px; background: #000; display: block; }
    figcaption { padding-top: 8px; font-size: 12px; }
    figcaption strong, figcaption span { display: block; }
    .proof-caption-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .proof-caption-head strong { min-width: 0; color: #f4f5f5; overflow-wrap: anywhere; }
    .proof-mode { flex: none; border: 1px solid #2f373c; border-radius: 999px; padding: 3px 7px; color: #9fe8c6; background: #111417; font-size: 11px; line-height: 1.1; font-weight: 800; text-transform: uppercase; }
    .proof-meta { margin-top: 4px; color: #7f878d; }
    .proof-link { display: inline-flex; margin-top: 7px; font-weight: 800; }
    details { border: 1px solid #23282b; border-radius: 8px; padding: 10px 12px; background: #0b0d0f; margin-top: 10px; }
    summary { cursor: pointer; color: #dce2e2; font-weight: 700; }
    ul { padding-left: 18px; }
    .claim-list { columns: 2; }
    .muted { color: #8a9298; }
    @media (max-width: 860px) { header { grid-template-columns: 1fr; } .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .summary-video { grid-template-columns: 1fr; } .claim-list { columns: 1; } }
  </style>
</head>
<body>
<main>
  <header id="summary">
    <section class="hero">
      <div>
        ${renderStatusPill(verdict, `Verdict: ${verdict}`)}
        <h1>${escapeHtml(effectiveReportTitle)}</h1>
        <p>Peekaboo drove the actual nixmac macOS app through Scott's shell driver and preserved inspectable screenshots, structured report data, runner logs, and artifact quality gates.</p>
      </div>
      <nav aria-label="Report navigation">
        <a href="#executed-proof">Executed Proof</a>
        <a href="#pull-request-focus">PR Focus</a>
        <a href="#parity-map">Parity Map</a>
        <a href="#baseline-coverage">Baseline</a>
        <a href="#summary-video">Evidence Video</a>
        <a href="#visual-proof">Visual Proof</a>
        <a href="#artifacts">Artifacts</a>
        <a href="#out-of-scope">Out of Scope</a>
      </nav>
    </section>
    <section class="summary" aria-label="Run summary">
      <div class="metric"><strong>Scenario</strong><span>${escapeHtml(scenarioDisplayName(state))}</span><small>${escapeHtml(scenarioSummaryNote(state))}</small></div>
      <div class="metric"><strong>Executed checks</strong><span>${escapeHtml(String(executed.length))}</span><small>${escapeHtml(`${counts.fail} fail / ${counts.inconclusive} inconclusive`)}</small></div>
      <div class="metric"><strong>CU keys mapped</strong><span>${escapeHtml(String(requiredCoverage.coveredRequiredKeys.length))}/${escapeHtml(String(requiredCoverage.requiredKeys.length))}</span><small>PR #75 also has ${escapeHtml(String(PR75_COMPUTER_USE_BASELINE.metaKeys.length))} meta/PR checks.</small></div>
      <div class="metric"><strong>Screenshots</strong><span>${escapeHtml(String(proofGalleryItems(state).length))}</span><small>${escapeHtml(state.peekaboo?.screenshotSignal?.status ?? 'not scanned')}</small></div>
      <div class="metric"><strong>Secret scan</strong><span>${escapeHtml(state.peekaboo?.secretScan?.status ?? 'not scanned')}</span><small>${escapeHtml(String(state.peekaboo?.secretScan?.scannedFiles ?? 0))} text artifacts scanned</small></div>
      <div class="metric"><strong>Provider</strong><span>${escapeHtml(providerLabel(state))}</span><small>${escapeHtml(providerSummaryNote(state))}</small></div>
    </section>
  </header>

  <section class="panel warning">
    <strong>Parity note</strong>
    ${state.mode === 'peekaboo-suite' ? 'This Peekaboo suite' : 'This single Peekaboo report'} maps ${escapeHtml(String(requiredCoverage.coveredRequiredKeys.length))} of ${escapeHtml(String(requiredCoverage.requiredKeys.length))} required Computer Use Product Proof key(s), leaving ${escapeHtml(String(requiredCoverage.missingRequiredKeys.length))} required breadth gap(s). The PR #75 baseline recorded ${escapeHtml(String(PR75_COMPUTER_USE_BASELINE.rawPassedClaimCount))} raw passing claim(s), including ${escapeHtml(String(PR75_COMPUTER_USE_BASELINE.metaKeys.length))} meta/PR check(s); currently applicable known limits are listed explicitly below.
    ${state.mode === 'peekaboo' && requiredCoverage.missingRequiredKeys.length > 0 ? '<br><strong>Single-scenario boundary</strong> This report is evidence for one focused Peekaboo scenario, not a full parity claim; use the Peekaboo suite report for Computer Use breadth parity.' : ''}
  </section>

  ${renderPeekabooPrFocus(state)}

  ${renderEvidenceVideo(state, artifacts)}

  <section class="panel">
    <h2>Run Metadata</h2>
    <div class="summary">
      <div class="metric"><strong>Timestamp</strong>${escapeHtml(state.startedAt)}</div>
      <div class="metric"><strong>Branch</strong>${escapeHtml(state.branch)}</div>
      <div class="metric"><strong>SHA</strong><code>${escapeHtml(state.sha)}</code></div>
      <div class="metric"><strong>macOS</strong>${escapeHtml(state.macosVersion)}</div>
      <div class="metric"><strong>Mode</strong>${escapeHtml(state.mode ?? 'deterministic')}</div>
      <div class="metric"><strong>App command</strong><code>${escapeHtml(state.appCommand)}</code></div>
    </div>
  </section>

  <h2 id="executed-proof">Executed Proof</h2>
  <p>These are the checks this run actually exercised. Failures and inconclusive rows stay visible here; skipped scope is collapsed later.</p>
  ${failures.length ? `<section class="panel warning"><h3>Failures / Inconclusive</h3><div class="table-scroll"><table><thead><tr><th>Scenario</th><th>Status</th><th>Notes</th></tr></thead><tbody>${renderStatusRows(failures)}</tbody></table></div></section>` : ''}
  <div class="table-scroll"><table>
    <thead><tr><th>Proof</th><th>Status</th><th>Grade</th><th>CU keys</th><th>Evidence</th></tr></thead>
    <tbody>${renderProofRows(executed)}</tbody>
  </table></div>

  <h2 id="parity-map">Computer Use Parity Map</h2>
  <p>This map is additive and explicit: it lists which Computer Use keys are covered by Peekaboo evidence in this run, and keeps remaining breadth visible.</p>
  <div class="table-scroll"><table>
    <thead><tr><th>Computer Use Key</th><th>Status</th><th>Peekaboo Evidence</th><th>Grade</th><th>Notes</th></tr></thead>
    <tbody>${renderParityRows(state)}</tbody>
  </table></div>
  ${transitive.length ? `<details open><summary>Transitive Computer Use coverage (${escapeHtml(String(transitive.length))})</summary><div class="table-scroll"><table><thead><tr><th>CU Scenario</th><th>Status</th><th>Grade</th><th>Peekaboo Phase</th><th>Evidence</th></tr></thead><tbody>${renderTransitiveRows(transitive)}</tbody></table></div></details>` : ''}

  <h2 id="baseline-coverage">PR #75 Baseline Coverage</h2>
  <p>Required parity keys are separated from PR/meta checks and explicit waivers so this report does not inflate or hide the remaining gap.</p>
  <div class="table-scroll"><table>
    <thead><tr><th>Required Key</th><th>Peekaboo Status</th><th>Computer Use Scenario</th><th>Notes</th></tr></thead>
    <tbody>${renderBaselineCoverageRows(state)}</tbody>
  </table></div>
  <details>
    <summary>Meta checks and explicit waivers</summary>
    <div class="table-scroll"><table>
      <thead><tr><th>Key</th><th>Type</th><th>Notes</th></tr></thead>
      <tbody>
        ${PR75_COMPUTER_USE_BASELINE.metaKeys.map((key) => `<tr><td><code>${escapeHtml(key)}</code></td><td>PR/meta</td><td>${escapeHtml(scenarioLabels[key] ?? sharedScenarioLabels[key] ?? key)}</td></tr>`).join('\n')}
        ${currentExplicitWaivers(state).map((waiver) => `<tr><td><code>${escapeHtml(waiver.key)}</code></td><td>known limit</td><td><strong>${escapeHtml(waiver.label)}</strong><br>${escapeHtml(waiver.note)}</td></tr>`).join('\n')}
      </tbody>
    </table></div>
  </details>

  <h2 id="visual-proof">Visual Proof</h2>
  <p class="muted">Screenshot cards use raw frames with reviewer-facing highlights. These highlights are visual signposts for inspecting the captured proof; scenario status comes from the recorded run verdict, and semantic pass/fail proof remains in the scenario tables and artifacts.</p>
  ${renderGallery(state)}

  <h2 id="artifacts">Artifacts</h2>
  ${renderArtifactTable(artifacts)}

  <h2>Human QA Narrative</h2>
  ${
    state.narrative.length
      ? `<ul>${state.narrative.map((item) => `<li>${escapeHtml(item.ts)} - ${escapeHtml(item.text)}</li>`).join('\n')}</ul>`
      : '<p>No narrative recorded.</p>'
  }

  <h2>Claims vs Evidence</h2>
  <details>
    <summary>Claims vs evidence (${escapeHtml(String(state.claims.length))})</summary>
    <div class="table-scroll"><table>
      <thead><tr><th>Claim</th><th>Status</th><th>Evidence</th></tr></thead>
      <tbody>
      ${
        state.claims.length
          ? state.claims
              .map((claim) => `<tr>
                <td>${escapeHtml(claim.claim)}</td>
                <td><span class="verdict ${claim.status}">${escapeHtml(claim.status)}</span></td>
                <td>${escapeHtml(claim.evidence)}</td>
              </tr>`)
              .join('\n')
          : '<tr><td colspan="3">No claims recorded.</td></tr>'
      }
      </tbody>
    </table></div>
  </details>

  <h2>Confirmation Boundaries</h2>
  ${
    state.confirmationBoundaries?.length
      ? `<ul>${state.confirmationBoundaries.map((boundary) => `<li>${escapeHtml(boundary)}</li>`).join('\n')}</ul>`
      : '<p>None recorded.</p>'
  }

  <h2>Cleanup / Restore Status</h2>
  <p>${escapeHtml(state.cleanup.note)}</p>

  <h2 id="out-of-scope">Out of Scope for This Scenario</h2>
  <details>
    <summary>${escapeHtml(String(notRequired.length))} not-required row(s), collapsed to keep executed proof readable</summary>
    <div class="table-scroll"><table>
      <thead><tr><th>Scenario</th><th>Status</th><th>Notes</th></tr></thead>
      <tbody>${renderStatusRows(notRequired)}</tbody>
    </table></div>
  </details>
</main>
<script>
	  for (const button of document.querySelectorAll('[data-video-seek], [data-screenshot-target]')) {
    button.addEventListener('click', () => {
      const video = document.querySelector('#summary-video video');
      if (video && button.dataset.videoSeek) {
        video.currentTime = Number(button.dataset.videoSeek || 0);
        video.play().catch(() => {});
        return;
      }
      const target = button.dataset.screenshotTarget;
      if (target) document.getElementById(target)?.scrollIntoView({ block: 'center' });
    });
  }
</script>
</body>
</html>
`;

  const reportPath = path.join(state.runDir, 'index.html');
  await writeFile(reportPath, html, 'utf8');
  await appendEvent(state, 'report.rendered', { path: path.relative(state.runDir, reportPath) });
  console.log(reportPath);
}

function requireSubstantiveInspectionNotes(notes, method = 'computer-use') {
  const trimmed = notes.trim();
  if (trimmed.length < 80) {
    throw new Error('verify-report --notes must be at least 80 characters and describe the inspection performed.');
  }
  if (method === 'computer-use' && !/computer use/i.test(trimmed)) {
    throw new Error('verify-report --notes must explicitly attest that Computer Use performed the visual inspection.');
  }
  if (method === 'ci-static' && !/(ci|workflow|static|automated)/i.test(trimmed)) {
    throw new Error('verify-report --notes must explicitly attest that CI performed the static report inspection.');
  }
  if (!/(opened|loaded|rendered|inspected|clicked|scrolled|verified|confirmed)/i.test(trimmed)) {
    throw new Error('verify-report --notes must describe at least one concrete inspection action.');
  }
  const sectionHits = [
    /first[- ]viewport|summary/i,
    /coverage|baseline|parity/i,
    /video|storyboard|screenshot|visual proof/i,
    /artifact|executed proof/i,
  ].filter((pattern) => pattern.test(trimmed));
  if (sectionHits.length < 2) {
    throw new Error('verify-report --notes must mention at least two inspected sections, such as first-viewport, coverage, baseline, video/storyboard, screenshots, or artifacts.');
  }
  return trimmed;
}

function htmlRowsContainingCode(html, key) {
  const encodedKey = escapeHtml(key);
  return [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
    .map((match) => match[0])
    .filter((row) => row.includes(`<code>${encodedKey}</code>`));
}

function reportStaticChecks({ state, html }) {
  const galleryItems = proofGalleryItems(state);
  const hasScreenshots = galleryItems.length > 0;
  const hasPeekabooAxOverlays = galleryItems.some((item) => item.annotated && item.annotated.path !== item.primary.path);
  const checks = [
    ['title', /nixmac Peekaboo .*E2E Evidence/i.test(html)],
    ['verdict', /Verdict:\s*(pass|fail|inconclusive)/i.test(html)],
    ['coverage metric', /CU keys mapped/i.test(html)],
    ['baseline table', /PR #75 Baseline Coverage/i.test(html)],
    ['evidence video/storyboard', /Evidence (video|storyboard)/i.test(html)],
    ['visual proof', /id="visual-proof"/i.test(html)],
    ['visual report callouts', !hasScreenshots || /data-visual-annotation="report-callouts"/i.test(html)],
    ['raw screenshot fallback', !hasScreenshots || /Open raw screenshot/i.test(html)],
    ['peekaboo ax overlay labeled', !hasPeekabooAxOverlays || /Peekaboo AX overlay/i.test(html)],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  const requiredCoverage = requiredComputerUseCoverage(state);
  for (const key of requiredCoverage.coveredRequiredKeys) {
    const rows = htmlRowsContainingCode(html, key);
    if (rows.some((row) => /<span class="verdict not_required">\s*gap\s*<\/span>/i.test(row))) failed.push(`covered key rendered as gap: ${key}`);
    if (rows.some((row) => /<td>\s*known limit\s*<\/td>/i.test(row))) failed.push(`covered key rendered as known limit: ${key}`);
  }
  return {
    status: failed.length ? 'failed' : 'passed',
    checks: checks.map(([name, ok]) => ({ name, status: ok ? 'passed' : 'failed' })),
    failed,
    coveredRequiredKeys: requiredCoverage.coveredRequiredKeys,
    missingRequiredKeys: requiredCoverage.missingRequiredKeys,
  };
}

async function verifyReport(args) {
  const runDirArg = args.find((arg) => !arg.startsWith('-'));
  if (!runDirArg) throw new Error('verify-report requires <run-dir>');
  const runDir = path.resolve(runDirArg);
  const method = argValue(args, '--method');
  if (!['computer-use', 'ci-static'].includes(method)) {
    throw new Error('verify-report records reportInspection coverage only with --method computer-use or --method ci-static.');
  }
  const notes = requireSubstantiveInspectionNotes(argValue(args, '--notes'), method);
  const reportPath = path.join(runDir, 'index.html');
  const stateFile = path.join(runDir, 'state.json');
  if (!(await pathExists(reportPath))) throw new Error(`Report not found: ${reportPath}`);
  if (!(await pathExists(stateFile))) throw new Error(`State not found: ${stateFile}`);

  const state = await loadState(runDir);
  state.runDir = runDir;
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  await writeFile(CURRENT_RUN_FILE, `${runDir}\n`, 'utf8');
  await render();
  const html = await readFile(reportPath, 'utf8');
  let staticChecks = reportStaticChecks({ state, html });
  if (staticChecks.status !== 'passed') {
    throw new Error(`Report static checks failed: ${staticChecks.failed.join(', ')}`);
  }

  const inspector =
    process.env.NIXMAC_REPORT_INSPECTOR ||
    tryRun('git', ['config', 'user.email'], { cwd: REPO_ROOT }).stdout ||
    process.env.USER ||
    'unknown';
  const inspection = {
    schemaVersion: 1,
    inspectedAt: new Date().toISOString(),
    inspector,
    method,
    reportPath,
    notes,
    staticChecks,
  };
  await writeJson(path.join(runDir, 'report-inspection.json'), inspection);
  const inspectionGrade = method === 'computer-use' ? 'manual-visual-artifact-inspection' : 'automated-report-integrity';
  const inspectionLabel = method === 'computer-use' ? 'Peekaboo report visual inspection' : 'Peekaboo report CI integrity inspection';

  state.peekaboo ??= {};
  state.peekaboo.coverageMap ??= {
    schemaVersion: 1,
    lane: state.mode === 'peekaboo-suite' ? 'peekaboo-local-suite' : 'peekaboo-local',
    scenario: state.mode === 'peekaboo-suite' ? 'peekaboo-suite' : state.peekaboo?.scenario ?? 'peekaboo-report',
    note: 'Coverage map augmented by explicit report inspection proof.',
    phaseCoverage: [],
  };
  if (!state.peekaboo.coverageMap.phaseCoverage.some((item) => item.key === 'peekabooReportInspection')) {
    state.peekaboo.coverageMap.phaseCoverage.push({
      key: 'peekabooReportInspection',
      label: inspectionLabel,
      correspondsTo: ['reportInspection'],
      grade: inspectionGrade,
    });
  }
  state.scenarios.peekabooReportInspection = {
    label: scenarioLabels.peekabooReportInspection,
    status: 'pass',
    executedByPeekaboo: true,
    peekabooEvidence: {
      phaseKey: 'peekabooReportInspection',
      grade: inspectionGrade,
      correspondsTo: ['reportInspection'],
    },
    notes: [
      `Report inspected with ${method} by ${inspector}.`,
      notes,
      `Static checks passed: ${staticChecks.checks.map((check) => check.name).join(', ')}.`,
    ],
  };
  state.scenarios.reportInspection ??= {
    label: scenarioLabels.reportInspection,
    status: 'not_required',
    notes: [],
  };
  state.scenarios.reportInspection.status = 'pass';
  state.scenarios.reportInspection.peekabooTransitiveCoverage = {
    phaseKey: 'peekabooReportInspection',
    grade: inspectionGrade,
  };
  state.scenarios.reportInspection.notes = (state.scenarios.reportInspection.notes ?? []).filter(
    (note) => !note.includes('Covered transitively by peekabooReportInspection') && note !== notes,
  );
  state.scenarios.reportInspection.notes.push(
    `Covered transitively by peekabooReportInspection; Peekaboo evidence grade: ${inspectionGrade}.`,
    notes,
  );
  if (!state.diagnostics.some((item) => item.path === 'report-inspection.json')) {
    state.diagnostics.push({
      label: 'Report inspection record',
      path: 'report-inspection.json',
      note: 'Manual visual inspection notes plus static report checks.',
    });
  }
  if (!state.claims.some((item) => item.evidence === 'report-inspection.json')) {
    state.claims.push({
      claim: 'Peekaboo report was inspected and passed static report integrity checks',
      status: 'pass',
      evidence: 'report-inspection.json',
    });
  }
  state.narrative = state.narrative.filter((item) => !item.text.startsWith(`Report inspection recorded via ${method}:`));
  state.narrative.push({
    ts: inspection.inspectedAt,
    text: `Report inspection recorded via ${method}: ${notes}`,
  });

  await saveState(state);
  await writeFile(CURRENT_RUN_FILE, `${runDir}\n`, 'utf8');
  await appendEvent(state, 'report.inspected', { method, inspector, path: 'report-inspection.json' });
  await render();
  const finalState = await loadState(runDir);
  finalState.runDir = runDir;
  const finalHtml = await readFile(reportPath, 'utf8');
  staticChecks = reportStaticChecks({ state: finalState, html: finalHtml });
  if (staticChecks.status !== 'passed') {
    throw new Error(`Final report static checks failed: ${staticChecks.failed.join(', ')}`);
  }
  inspection.staticChecks = staticChecks;
  await writeJson(path.join(runDir, 'report-inspection.json'), inspection);
}

async function cleanup() {
  const state = await loadState();
  state.cleanup.attempted = true;
  state.cleanup.note = 'Cleanup started.';
  await saveState(state);
  await appendEvent(state, 'cleanup.started');
  const quitResult = await quitNixmac();
  state.cleanup.quitResult = quitResult;
  await saveState(state);

  let mockProvider = state.setup?.mockProvider;
  const mockProviderFile = path.join(state.runDir, 'mock-provider.json');
  if (!mockProvider?.pid && (await pathExists(mockProviderFile))) {
    mockProvider = await readJson(mockProviderFile);
    state.setup = state.setup ?? {};
    state.setup.mockProvider = mockProvider;
    await saveState(state);
  }

  if (mockProvider?.pid) {
    const pid = mockProvider.pid;
    const processInfo = tryRun('ps', ['-p', String(pid), '-o', 'args=']);
    const expectedFragment = `run-local.mjs serve-mock ${state.runDir}`;
    if (processInfo.ok && processInfo.stdout.includes(expectedFragment)) {
      try {
        process.kill(pid, 'SIGTERM');
        state.cleanup.mockProviderStop = `Sent SIGTERM to mock provider pid ${pid}.`;
      } catch {
        state.cleanup.mockProviderStop = `Mock provider pid ${pid} was already stopped.`;
      }
    } else {
      state.cleanup.mockProviderStop = `Skipped SIGTERM for pid ${pid}; process identity did not match mock provider.`;
    }
    await saveState(state);
  }

  try {
    await rm(APP_SUPPORT_DIR, { recursive: true, force: true });
    state.cleanup.liveStateRemoved = true;
    await saveState(state);
    if (state.appSupportExisted && state.appSupportBackupPath) {
      await cp(state.appSupportBackupPath, APP_SUPPORT_DIR, {
        recursive: true,
        preserveTimestamps: true,
      });
      state.cleanup.restored = true;
      await saveState(state);
      await rm(state.appSupportBackupPath, { recursive: true, force: true });
      state.cleanup.backupRemoved = true;
      state.cleanup.note = `Restored original app support directory from off-repo backup and removed that backup: ${state.appSupportBackupPath}.`;
    } else {
      state.cleanup.restored = true;
      state.cleanup.note = 'No original app support directory existed; removed disposable app support state.';
    }
  } catch (error) {
    state.cleanup.error = error instanceof Error ? error.message : String(error);
    state.cleanup.note = `Cleanup failed: ${state.cleanup.error}`;
    await saveState(state);
    throw error;
  }
  await saveState(state);
  await appendEvent(state, 'cleanup.completed', { restored: state.cleanup.restored, note: state.cleanup.note });
  await render();
}

async function runPeekabooEvidenceVideoSelfTest() {
  if (!tryRun('ffmpeg', ['-version']).ok) {
    console.warn('Skipping Peekaboo evidence video self-test because ffmpeg is unavailable.');
    return;
  }

  const runDir = await mkdtemp(path.join(os.tmpdir(), 'nixmac-peekaboo-video-self-test-'));
  try {
    await mkdir(path.join(runDir, 'screenshots'), { recursive: true });
    run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=#0b0d0f:s=16x9',
      '-frames:v',
      '1',
      path.join(runDir, 'screenshots', '01-launch.png'),
    ]);
    run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=#111820:s=16x9',
      '-frames:v',
      '1',
      path.join(runDir, 'screenshots', '02-settings.png'),
    ]);

    const state = {
      runDir,
      mode: 'peekaboo',
      scenarios: {},
      diagnostics: [],
      screenshots: [
        { label: '01 launch', path: 'screenshots/01-launch.png', capturedAt: '2026-05-05T00:00:00.000Z' },
        { label: '02 settings', path: 'screenshots/02-settings.png', capturedAt: '2026-05-05T00:00:01.100Z' },
      ],
      peekaboo: { result: { artifacts: {} } },
    };

    assert.equal(await maybeGeneratePeekabooEvidenceVideo(state), true, 'Peekaboo evidence video self-test should generate an MP4');
    assert.equal(state.video?.status, 'available', 'Peekaboo evidence video should be marked available');
    assert.equal(state.video?.frames, 2, 'Peekaboo evidence video should include every fixture screenshot frame');
    assert.equal(await usableFile(state.video.path, runDir), true, 'Generated Peekaboo evidence MP4 should be usable');

    const artifacts = artifactRows(state);
    assert(
      artifacts.some(([label, artifactPath]) => label === 'Video' && artifactPath === state.video.path),
      'Generated Peekaboo evidence MP4 should be listed in the artifact table',
    );

    const html = renderEvidenceVideo(state, artifacts);
    assert(html.includes('data-video-seek="1.1"'), 'Rendered chapters should include persisted 1.1s seek timestamps');
    assert.equal((html.match(/data-video-seek=/g) ?? []).length, 2, 'Rendered chapters should cover every video frame');
    assert(
      html.includes('same persisted 1.1s screenshot frame cadence as the Computer Use evidence video'),
      'Rendered copy should describe frame-cadence parity precisely',
    );

    const frameList = await readFile(path.join(runDir, state.video.framesPath), 'utf8');
    assert(!frameList.includes(runDir), 'Persisted ffmpeg frame list should be portable, not absolute to the source run directory');
    assert(
      frameList.includes("../screenshots/01-launch.png"),
      'Persisted ffmpeg frame list should reference local screenshots relatively',
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

async function runSuiteArtifactCopySelfTest() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nixmac-suite-copy-self-test-'));
  try {
    const sourceRunDir = path.join(root, 'source');
    const suiteDir = path.join(root, 'suite');
    await mkdir(path.join(sourceRunDir, 'screenshots'), { recursive: true });
    await writeFile(path.join(sourceRunDir, 'screenshots', 'proof.png'), 'proof', 'utf8');

    const copied = await copySuiteArtifact({
      sourceState: { runDir: sourceRunDir },
      relativePath: 'screenshots/proof.png',
      suiteDir,
      suiteScenarioDir: 'macos_core_product_proof',
    });
    assert.equal(
      copied,
      path.join('scenarios', 'macos_core_product_proof', 'screenshots', 'proof.png'),
      'Suite artifact copy should preserve valid relative paths',
    );

    await assert.rejects(
      () =>
        copySuiteArtifact({
          sourceState: { runDir: sourceRunDir },
          relativePath: '../outside.txt',
          suiteDir,
          suiteScenarioDir: 'macos_core_product_proof',
        }),
      /must not escape/,
      'Suite artifact copy should reject source path traversal',
    );
    await assert.rejects(
      () =>
        copySuiteArtifact({
          sourceState: { runDir: sourceRunDir },
          relativePath: path.join(sourceRunDir, 'screenshots', 'proof.png'),
          suiteDir,
          suiteScenarioDir: 'macos_core_product_proof',
        }),
      /must be relative/,
      'Suite artifact copy should reject absolute source paths',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runVisualAnnotationGallerySelfTest() {
  const buildState = (suiteScenario) => ({
    mode: 'peekaboo-suite',
    scenarios: { launch: { status: 'pass', notes: [] } },
    diagnostics: [],
    screenshots: [
      {
        label: 'macos_core_product_proof: 01-core-launch-1234567890',
        path: 'screenshots/01-core-launch-1234567890.png',
        capturedAt: '2026-05-05T00:00:00.000Z',
        note: 'Captured by Peekaboo runner.',
      },
      {
        label: 'macos_core_product_proof: 01-core-launch-1234567890_annotated',
        path: 'screenshots/01-core-launch-1234567890_annotated.png',
        capturedAt: '2026-05-05T00:00:00.100Z',
        note: 'Captured by Peekaboo runner.',
      },
    ],
    peekaboo: {
      scenarios: [suiteScenario],
      coverageMap: { phaseCoverage: [] },
    },
  });
  const state = buildState({ scenario: 'macos_core_product_proof', verdict: 'pass' });
  const html = renderGallery(state);
  assert(html.includes('data-visual-annotation="report-callouts"'), 'Visual gallery should render deterministic report callouts');
  assert(html.includes('visual-status pass'), 'Visual gallery should show the owning scenario status on the screenshot');
  assert(html.includes('proof-card-pass'), 'Visual gallery should apply pass card styling');
  assert(html.includes('Workflow area ready'), 'Visual gallery should include a launch-specific curated callout');
  assert(html.includes('Open raw screenshot'), 'Visual gallery should keep a direct raw screenshot fallback link');
  assert(html.includes('Peekaboo AX overlay'), 'Visual gallery should label Peekaboo element overlays as AX debug evidence');
  assert(
    html.indexOf('screenshots/01-core-launch-1234567890.png') < html.indexOf('screenshots/01-core-launch-1234567890_annotated.png'),
    'Visual gallery should keep the raw screenshot as the primary card image',
  );

  const inconclusiveHtml = renderGallery(buildState({ scenario: 'macos_core_product_proof', verdict: 'inconclusive' }));
  assert(inconclusiveHtml.includes('visual-status inconclusive'), 'Visual gallery should preserve inconclusive scenario verdicts');
  assert(inconclusiveHtml.includes('proof-card-inconclusive'), 'Visual gallery should apply inconclusive card styling');

  const failHtml = renderGallery(buildState({ scenario: 'macos_core_product_proof', verdict: 'pass', failed: true }));
  assert(failHtml.includes('visual-status fail'), 'Visual gallery should render failed suite scenarios as fail');
  assert(failHtml.includes('proof-card-fail'), 'Visual gallery should apply fail card styling');

  const videoHtml = renderEvidenceVideo(state, []);
  assert(!videoHtml.includes('data-visual-annotation="report-callouts"'), 'Evidence video/storyboard should not receive screenshot-card overlays');
  assert(videoHtml.includes('screenshots/01-core-launch-1234567890.png'), 'Evidence storyboard should use the raw screenshot frame');
  assert(!videoHtml.includes('screenshots/01-core-launch-1234567890_annotated.png'), 'Evidence storyboard should not use Peekaboo AX overlay frames');

  const staticHtml = `<title>nixmac Peekaboo Suite E2E Evidence</title>Verdict: pass CU keys mapped PR #75 Baseline Coverage Evidence video id="visual-proof"${html}`;
  assert.equal(
    reportStaticChecks({ state, html: staticHtml }).status,
    'passed',
    'Report static checks should require screenshot callouts, raw fallback links, and labeled AX overlays',
  );
}

async function runSelfTest() {
  // This is a one-way drift guard: run-local is a deliberate subset with a few
  // local-only scenario names, so it should not require every shared key.
  const unexpectedLocalKeys = Object.keys(scenarioLabels).filter((key) => !sharedScenarioLabels[key] && !LOCAL_ONLY_SCENARIO_KEYS.has(key));
  assert.deepEqual(
    unexpectedLocalKeys,
    [],
    'run-local scenario keys should either exist in shared scenarioLabels or be explicitly listed in LOCAL_ONLY_SCENARIO_KEYS',
  );
  const staleLocalOnlyKeys = [...LOCAL_ONLY_SCENARIO_KEYS].filter((key) => sharedScenarioLabels[key]);
  assert.deepEqual(staleLocalOnlyKeys, [], 'LOCAL_ONLY_SCENARIO_KEYS should not include keys that now exist in shared scenarioLabels');
  const missingLocalOnlyKeys = [...LOCAL_ONLY_SCENARIO_KEYS].filter((key) => !scenarioLabels[key]);
  assert.deepEqual(missingLocalOnlyKeys, [], 'LOCAL_ONLY_SCENARIO_KEYS should all be declared in run-local scenarioLabels');
  assert.equal(
    verdictFor({ mode: 'peekaboo', scenarios: { launch: { status: 'pass' } }, peekaboo: { coverageMap: { phaseCoverage: [] } } }),
    'inconclusive',
    'Single Peekaboo reports should not render pass when required Computer Use parity keys are missing',
  );
  assert.equal(
    verdictFor({ mode: 'peekaboo-suite', scenarios: { launch: { status: 'pass' } }, peekaboo: { coverageMap: { phaseCoverage: [] } } }),
    'inconclusive',
    'Peekaboo suite verdict should downgrade when required Computer Use parity keys are missing',
  );
  {
    const allRequiredCoverageState = {
      mode: 'peekaboo-suite',
      scenarios: {},
      peekaboo: { coverageMap: { phaseCoverage: [] } },
    };
    for (const [index, computerUseKey] of PR75_COMPUTER_USE_BASELINE.requiredKeys.entries()) {
      const key = `selfTestPeekabooParity${index}`;
      allRequiredCoverageState.scenarios[key] = { status: 'pass' };
      allRequiredCoverageState.peekaboo.coverageMap.phaseCoverage.push({
        key,
        correspondsTo: [computerUseKey],
        grade: 'self-test',
      });
    }
    assert.deepEqual(
      requiredComputerUseCoverage(allRequiredCoverageState).missingRequiredKeys,
      [],
      'Synthetic all-pass Peekaboo suite should cover every required PR #75 Computer Use key',
    );
    assert.equal(
      verdictFor(allRequiredCoverageState),
      'pass',
      'Peekaboo suite verdict should pass when every required Computer Use parity key is covered by passing Peekaboo evidence',
    );
  }
  assert.equal(
    reportStaticChecks({
      state: {
        mode: 'peekaboo-suite',
        scenarios: { launch: { status: 'pass' } },
        peekaboo: { coverageMap: { phaseCoverage: [{ key: 'peekabooCoreLaunch', correspondsTo: ['launch'] }] } },
      },
      html: '<title>nixmac Peekaboo Suite E2E Evidence</title>Verdict: inconclusive CU keys mapped PR #75 Baseline Coverage Evidence video id="visual-proof"',
    }).status,
    'passed',
    'Report static checks should accept an honest inconclusive parity report',
  );
  const prFocus = buildPeekabooPrFocus({
    GITHUB_EVENT_NAME: 'pull_request',
    NIXMAC_E2E_PR_NUMBER: '90',
    NIXMAC_E2E_PR_TITLE: 'Peekaboo proof',
    NIXMAC_E2E_PR_HEAD_REF: 'fkb/scott-peekaboo-local-e2e',
    NIXMAC_E2E_PR_BASE_REF: 'fkb/e2e-required-gate-policy',
    NIXMAC_E2E_PR_CHANGED_FILES: [
      'apps/native/src/components/widget/settings/settings-dialog.tsx',
      'apps/native/src-tauri/src/main.rs',
      'apps/native/src-tauri/src/rebuild/darwin.rs',
      'apps/native/src-tauri/src/storage/store.rs',
      'apps/native/src-tauri/src/summarize/build_prompt.rs',
      'apps/native/src/components/widget/new-visible-surface.tsx',
      'tools/computer-use-e2e/run-local.mjs',
    ].join('\n'),
  });
  assert.equal(prFocus.configured, true, 'Peekaboo PR focus should mark pull_request metadata as configured');
  assert(prFocus.scenarioKeys.includes('settingsGeneral'), 'Peekaboo PR focus should map manifest files to scenario keys');
  assert(prFocus.scenarioKeys.includes('summary'), 'Peekaboo PR focus should map summary prompt files to summary coverage');
  assert(prFocus.scenarioKeys.includes('saveFlow'), 'Peekaboo PR focus should map summary prompt files to Save-flow coverage');
  assert(prFocus.scenarioKeys.includes('reportInspection'), 'Peekaboo PR focus should map runner/report changes to report inspection');
  assert(
    prFocus.matchedSurfaces.some((surface) => surface.id === 'e2e-harness-rust' && surface.coverageDisposition === 'non-claiming'),
    'Peekaboo PR focus should identify E2E-gated harness files without claiming user-facing scenario coverage',
  );
  assert.deepEqual(
    prFocus.unmappedUserVisibleFiles,
    ['apps/native/src/components/widget/new-visible-surface.tsx'],
    'Peekaboo PR focus should surface unmapped user-visible files for scenario suggestions',
  );
  assert(
    renderPeekabooPrFocus({
      prFocus,
      scenarios: Object.fromEntries(Object.entries(scenarioLabels).map(([key, label]) => [key, { label, status: 'inconclusive', notes: [] }])),
    }).includes('Suggested Coverage Updates'),
    'Peekaboo report should render PR-focused scenario suggestions',
  );
  const macInCloudCommand = buildPeekabooMacInCloudCommand(
    [
      '--ssh-dest',
      'admin@example.test',
      '--identity-file',
      '/tmp/key',
      '--repo-dir',
      '/Users/admin/nixmac-peekaboo-local-e2e',
      '--app-path',
      '/Users/admin/nixmac.app',
      '--scenario',
      'macos_core_product_proof',
      '--no-record',
      '--allow-cleanup',
    ],
    {
      NIXMAC_E2E_PR_CHANGED_FILES: 'apps/native/src/components/widget/settings/settings-dialog.tsx',
      NIXMAC_E2E_PR_NUMBER: '90',
    },
  );
  assert.equal(macInCloudCommand.mode, 'run-peekaboo', 'MacInCloud command should support single-scenario dispatch');
  assert(macInCloudCommand.sshArgs.includes('admin@example.test'), 'MacInCloud command should include the SSH destination');
  assert(macInCloudCommand.remoteCommand.includes('run-peekaboo'), 'MacInCloud command should run the remote Peekaboo command');
  assert(
    macInCloudCommand.remoteCommand.includes('NIXMAC_E2E_PR_CHANGED_FILES='),
    'MacInCloud command should forward PR changed-file metadata to the remote Peekaboo run',
  );
  assert(
    macInCloudCommand.remoteCommand.includes('macos_core_product_proof'),
    'MacInCloud command should include the requested scenario',
  );
  runVisualAnnotationGallerySelfTest();
  await runSuiteArtifactCopySelfTest();
  await runPeekabooEvidenceVideoSelfTest();
  peekabooRunnerSelfTest({ repoRoot: REPO_ROOT });
  run('bash', ['tests/e2e/lib/peekaboo.test.sh'], { cwd: REPO_ROOT });
  console.log('Computer Use local runner self-test passed.');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'setup') await setup();
    else if (command === 'setup-deterministic') await setup();
    else if (command === 'setup-real') await setup({ mode: 'real' });
    else if (command === 'run-peekaboo') await runPeekaboo(args);
    else if (command === 'run-peekaboo-suite') await runPeekabooSuite(args);
    else if (command === 'run-peekaboo-macincloud') await runPeekabooMacInCloud(args);
    else if (command === 'serve-mock') await serveMock(args[0]);
    else if (command === 'capture') await capture(args);
    else if (command === 'scenario') await scenario(args);
    else if (command === 'confirmation') await confirmation(args);
    else if (command === 'narrative') await narrative(args);
    else if (command === 'app-command') await appCommand(args);
    else if (command === 'render') await render();
    else if (command === 'verify-report') await verifyReport(args);
    else if (command === 'self-test') await runSelfTest();
    else if (command === 'cleanup') await cleanup();
    else {
      usage();
      process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

await main();
