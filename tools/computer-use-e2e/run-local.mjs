#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
  'com.darkmatter.nixmac',
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

const scenarioLabels = {
  launch: 'App launches and first screen is usable',
  settings: 'Settings safe tabs render: General, AI Models, Preferences',
  history: 'My History opens and renders',
  console: 'Console opens and closes',
  feedback: 'Feedback / report dialogs open and cancel without submission',
  suggestion: 'Home suggestion card is clickable',
  descriptor: 'Typed intent reaches review',
  summary: 'Summary describes the typed intent',
  diff: 'Diff shows an acceptable config change',
  buildCheck: 'Build check completes or fails visibly',
  buildBoundary: 'Build & Test confirmation boundary appears and is cancelled',
  discard: 'Discard confirmation and return-to-start',
  peekabooDescriptorPromptSmoke: 'Peekaboo descriptor prompt smoke',
  peekabooProviderEvolveFullSmoke: 'Peekaboo provider-backed evolve smoke',
  peekabooNixInstall: 'Peekaboo Nix install flow',
};
const LOCAL_ONLY_SCENARIO_KEYS = new Set([
  'settings',
  'suggestion',
  'descriptor',
  'buildCheck',
  'peekabooDescriptorPromptSmoke',
  'peekabooProviderEvolveFullSmoke',
  'peekabooNixInstall',
]);

function usage() {
  console.log(`Usage:
  node tools/computer-use-e2e/run-local.mjs setup
  node tools/computer-use-e2e/run-local.mjs setup-deterministic
  node tools/computer-use-e2e/run-local.mjs setup-real
  node tools/computer-use-e2e/run-local.mjs run-peekaboo [macos_descriptor_prompt_smoke] [--no-record] [--allow-destructive]
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

  state.provider = {
    kind: 'not-required',
    note:
      scenario === 'macos_provider_evolve_full_smoke'
        ? 'Scenario owns its local provider stub.'
        : 'This Peekaboo scenario does not require an external LLM provider.',
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

async function runPeekaboo(args) {
  const scenario = args.find((arg) => !arg.startsWith('-')) || DEFAULT_PEEKABOO_SCENARIO;
  const noRecord = args.includes('--no-record');
  const noCleanup = args.includes('--no-cleanup') || !args.includes('--allow-cleanup');
  const allowDestructive = args.includes('--allow-destructive');
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
    await cleanup();
  }
  if (!peekabooResult?.success) {
    const outcome = peekabooResult?.infraFailure ? 'infra blocked' : 'failed';
    throw new Error(`Peekaboo scenario ${scenario} ${outcome}; report rendered at ${path.join(state.runDir, 'index.html')}`);
  }
}

function getNixmacWindowRegion() {
  const script = `
tell application "System Events"
  set matches to (processes whose bundle identifier is "com.darkmatter.nixmac")
  if (count of matches) is 0 then error "nixmac is not running as bundle com.darkmatter.nixmac"
  tell item 1 of matches
    if (count of windows) is 0 then error "nixmac has no visible windows"
    set {windowX, windowY} to position of window 1
    set {windowWidth, windowHeight} to size of window 1
    if windowWidth < 1 or windowHeight < 1 then error "nixmac window has invalid bounds"
    return (windowX as text) & "," & (windowY as text) & "," & (windowWidth as text) & "," & (windowHeight as text)
  end tell
end tell`;
  const region = run('osascript', ['-e', script]).trim();
  if (!/^-?\d+,-?\d+,\d+,\d+$/.test(region)) {
    throw new Error(`Invalid nixmac window region from Accessibility: ${region || '<empty>'}`);
  }
  return region;
}

async function capture(args) {
  const label = args[0];
  if (!label) throw new Error('capture requires a label');
  const note = argValue(args, '--note', '');
  const state = await loadState();
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const fileName = `${String(state.screenshots.length + 1).padStart(2, '0')}-${safeLabel}.png`;
  const screenshotPath = path.join(state.runDir, 'screenshots', fileName);
  const windowRegion = getNixmacWindowRegion();
  run('screencapture', ['-x', '-R', windowRegion, screenshotPath]);
  const fileStat = await stat(screenshotPath);
  state.screenshots.push({
    label,
    path: path.relative(state.runDir, screenshotPath),
    capturedAt: new Date().toISOString(),
    note,
    bytes: fileStat.size,
  });
  if (note) state.narrative.push({ ts: new Date().toISOString(), text: note });
  await saveState(state);
  await appendEvent(state, 'screenshot.captured', { label, path: path.relative(state.runDir, screenshotPath), note });
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
  return 'pass';
}

function linkArtifact(pathValue) {
  if (!pathValue) return '';
  const label = escapeHtml(pathValue);
  return `<a href="${label}"><code>${label}</code></a>`;
}

function artifactRows(state) {
  const artifacts = state.peekaboo?.result?.artifacts;
  if (!artifacts) return [];
  return [
    ['Preflight', artifacts.preflight],
    ['Log', artifacts.logFile],
    ['stdout', artifacts.stdout],
    ['stderr', artifacts.stderr],
    ['Legacy JSON', artifacts.resultsFile],
    ['Structured report', artifacts.reportFile],
    ['Video', artifacts.videoFile],
  ].filter(([, artifactPath]) => artifactPath);
}

async function render() {
  const state = await loadState();
  const verdict = verdictFor(state);
  const failures = Object.entries(state.scenarios)
    .filter(([, scenarioState]) => !['pass', 'not_required'].includes(scenarioState.status))
    .map(([key, scenarioState]) => ({ key, ...scenarioState }));
  const artifacts = artifactRows(state);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>nixmac Computer Use Local E2E Evidence</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #111318; color: #eef1f5; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 56px; }
    h1, h2 { margin: 0 0 12px; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; margin-top: 28px; }
    p { color: #c5cbd3; line-height: 1.5; }
    .meta, .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .panel { border: 1px solid #303640; border-radius: 8px; padding: 14px; background: #171a21; }
    .verdict { display: inline-block; border-radius: 999px; padding: 5px 10px; font-weight: 700; text-transform: uppercase; }
    .pass { background: #123d2a; color: #8bf0bb; }
    .fail { background: #471a1a; color: #ff9e9e; }
    .inconclusive { background: #443512; color: #ffd36e; }
    .not_required { background: #29303a; color: #a8b0bc; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 8px; }
    th, td { border: 1px solid #303640; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #20242d; }
    img { width: 100%; border: 1px solid #303640; border-radius: 8px; background: #000; }
    figure { margin: 0 0 18px; }
    figcaption { margin-top: 6px; color: #c5cbd3; font-size: 13px; }
    code { color: #a7d7ff; }
    a { color: #a7d7ff; }
    ul { padding-left: 20px; }
  </style>
</head>
<body>
<main>
  <h1>nixmac Computer Use Local E2E Evidence</h1>
  <p><span class="verdict ${verdict}">Verdict: ${verdict}</span></p>

  <section class="meta">
    <div class="panel"><strong>Timestamp</strong><br>${escapeHtml(state.startedAt)}</div>
    <div class="panel"><strong>Branch</strong><br>${escapeHtml(state.branch)}</div>
    <div class="panel"><strong>SHA</strong><br><code>${escapeHtml(state.sha)}</code></div>
    <div class="panel"><strong>macOS</strong><br>${escapeHtml(state.macosVersion)}</div>
    <div class="panel"><strong>Mode</strong><br>${escapeHtml(state.mode ?? 'deterministic')}</div>
    <div class="panel"><strong>App Command</strong><br><code>${escapeHtml(state.appCommand)}</code></div>
    <div class="panel"><strong>Provider</strong><br><code>${escapeHtml(state.provider?.kind ?? state.setup.mockProvider?.baseUrl ?? 'unavailable')}</code></div>
  </section>

  <h2>Scenario Checklist</h2>
  <table>
    <thead><tr><th>Scenario</th><th>Status</th><th>Notes</th></tr></thead>
    <tbody>
      ${Object.entries(state.scenarios)
        .map(([, scenarioState]) => `<tr>
          <td>${escapeHtml(scenarioState.label)}</td>
          <td><span class="verdict ${scenarioState.status}">${escapeHtml(scenarioState.status)}</span></td>
          <td>${scenarioState.notes.map(escapeHtml).join('<br>') || 'No notes recorded.'}</td>
        </tr>`)
        .join('\n')}
    </tbody>
  </table>

  <h2>Video</h2>
  ${
    state.video?.path
      ? `<video controls src="${escapeHtml(state.video.path)}" style="width:100%;border:1px solid #303640;border-radius:8px;background:#000"></video>
        <p>${escapeHtml(state.video.label || 'Screen recording')}</p>`
      : '<p>No video recorded.</p>'
  }

  <h2>Screenshots</h2>
  ${
    state.screenshots.length
      ? state.screenshots
          .map((shot) => `<figure>
              <img src="${escapeHtml(shot.path)}" alt="${escapeHtml(shot.label)}">
              <figcaption><strong>${escapeHtml(shot.label)}</strong> - ${escapeHtml(shot.note || 'No note')} (${escapeHtml(shot.capturedAt)})</figcaption>
            </figure>`)
          .join('\n')
      : '<p>No screenshots captured.</p>'
  }

  <h2>Artifacts</h2>
  ${
    artifacts.length
      ? `<table>
          <thead><tr><th>Artifact</th><th>Path</th></tr></thead>
          <tbody>
            ${artifacts
              .map(
                ([label, artifactPath]) => `<tr>
                  <td>${escapeHtml(label)}</td>
                  <td>${linkArtifact(artifactPath)}</td>
                </tr>`,
              )
              .join('\n')}
          </tbody>
        </table>`
      : '<p>No runner artifacts recorded.</p>'
  }

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
              .map((claim) => `<tr>
                <td>${escapeHtml(claim.claim)}</td>
                <td><span class="verdict ${claim.status}">${escapeHtml(claim.status)}</span></td>
                <td>${escapeHtml(claim.evidence)}</td>
              </tr>`)
              .join('\n')
          : '<tr><td colspan="3">No claims recorded.</td></tr>'
      }
    </tbody>
  </table>

  <h2>Failures / Open Issues</h2>
  ${
    failures.length
      ? `<ul>${failures
          .map(
            (failure) =>
              `<li><strong>${escapeHtml(failure.status)}:</strong> ${escapeHtml(failure.label)} - ${escapeHtml(failure.notes.join(' ') || 'No detail recorded.')}</li>`,
          )
          .join('\n')}</ul>`
      : '<p>None recorded.</p>'
  }

  <h2>Confirmation Boundaries</h2>
  ${
    state.confirmationBoundaries?.length
      ? `<ul>${state.confirmationBoundaries.map((boundary) => `<li>${escapeHtml(boundary)}</li>`).join('\n')}</ul>`
      : '<p>None recorded.</p>'
  }

  <h2>Cleanup / Restore Status</h2>
  <p>${escapeHtml(state.cleanup.note)}</p>
</main>
</body>
</html>
`;

  const reportPath = path.join(state.runDir, 'index.html');
  await writeFile(reportPath, html, 'utf8');
  await appendEvent(state, 'report.rendered', { path: path.relative(state.runDir, reportPath) });
  console.log(reportPath);
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

function runSelfTest() {
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
    else if (command === 'serve-mock') await serveMock(args[0]);
    else if (command === 'capture') await capture(args);
    else if (command === 'scenario') await scenario(args);
    else if (command === 'confirmation') await confirmation(args);
    else if (command === 'narrative') await narrative(args);
    else if (command === 'app-command') await appCommand(args);
    else if (command === 'render') await render();
    else if (command === 'self-test') runSelfTest();
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
