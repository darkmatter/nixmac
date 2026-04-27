import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  access,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startMockVllmServer, stopMockVllmServer } from './mock-vllm-server.mjs';

const execFileAsync = promisify(execFile);

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APPS_NATIVE_DIR = path.resolve(THIS_DIR, '../../../../');

const CONFIG_TEMPLATE_DIR = path.join(APPS_NATIVE_DIR, 'templates', 'nix-darwin-determinate');
const DEFAULT_E2E_APP_DATA_DIR = '/tmp/nixmac-wdio-app-data';
const NIXMAC_APP_SUPPORT_DIR =
  process.env.NIXMAC_E2E_APP_DATA_DIR || DEFAULT_E2E_APP_DATA_DIR;
const NIXMAC_SETTINGS_PATH = path.join(
  NIXMAC_APP_SUPPORT_DIR,
  'settings.json',
);
const NIXMAC_EVOLVE_STATE_PATH = path.join(NIXMAC_APP_SUPPORT_DIR, 'evolve-state.json');
const NIXMAC_BUILD_STATE_PATH = path.join(NIXMAC_APP_SUPPORT_DIR, 'build-state.json');
const NIXMAC_DB_PATH = path.join(NIXMAC_APP_SUPPORT_DIR, 'nixmac.db');
const NIXMAC_E2E_METADATA_PATH = path.join(NIXMAC_APP_SUPPORT_DIR, 'e2e-env.json');

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getEvalHostname() {
  try {
    const { stdout } = await execFileAsync('scutil', ['--get', 'LocalHostName']);
    const hostname = stdout.trim();
    return hostname || 'localhost';
  } catch {
    return 'localhost';
  }
}

function getCurrentUsername() {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || 'nobody';
  }
}

/**
 * Return a platform triple for templates, e.g. "aarch64-darwin".
 */
function getPlatformTriple() {
  const archMap = { arm64: 'aarch64', x64: 'x86_64' };
  const arch = archMap[process.arch] ?? process.arch;
  const platform = process.platform; // 'darwin' etc.
  return `${arch}-${platform}`;
}

async function listNixFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listNixFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.nix')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function generateNixmacSettings({
  host,
  configDir,
  vllmApiBaseUrl,
  vllmApiKey,
  settingsOverrides = {},
}) {
  const settings = {
    hostAttr: host,
    configDir,
    vllmApiBaseUrl: vllmApiBaseUrl ?? null,
    vllmApiKey: vllmApiKey ?? null,
    evolveProvider: 'vllm',
    summaryProvider: 'vllm',
    ...settingsOverrides,
  };

  await mkdir(path.dirname(NIXMAC_SETTINGS_PATH), { recursive: true });
  await writeFile(NIXMAC_SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
  console.log(`[wdio:test-env] Generated settings at ${NIXMAC_SETTINGS_PATH}`);
}

async function readJsonFileOrThrow(filePath, label) {
  if (!(await pathExists(filePath))) {
    throw new Error(`[wdio:test-env] ${label} file not found at ${filePath}`);
  }

  const raw = await readFile(filePath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `[wdio:test-env] Failed to parse ${label} JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function loadEvolveState() {
  if (!(await pathExists(NIXMAC_EVOLVE_STATE_PATH))) {
    console.log(`[wdio:test-env] No evolve-state file found at ${NIXMAC_EVOLVE_STATE_PATH}`);
    return null;
  }

  const parsed = await readJsonFileOrThrow(NIXMAC_EVOLVE_STATE_PATH, 'evolve-state');
  if (parsed == null) return null;
  return parsed.evolveState ?? parsed;
}

export async function loadBuildState() {
  if (!(await pathExists(NIXMAC_BUILD_STATE_PATH))) {
    console.log(`[wdio:test-env] No build-state file found at ${NIXMAC_BUILD_STATE_PATH}`);
    return null;
  }

  const parsed = await readJsonFileOrThrow(NIXMAC_BUILD_STATE_PATH, 'build-state');
  if (parsed == null) return null;
  return parsed.buildState ?? parsed;
}

export async function loadSettings() {
  return readJsonFileOrThrow(NIXMAC_SETTINGS_PATH, 'settings');
}

async function waitForValue(predicate, { timeout = 60000, interval = 500, timeoutMessage }) {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeout) {
    try {
      const value = await predicate();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`${timeoutMessage}${suffix}`);
}

export async function waitForEvolveStateWithChangeset(options = {}) {
  let lastState = null;

  return waitForValue(
    async () => {
      lastState = await loadEvolveState();
      return Number(lastState?.currentChangesetId) > 0 ? lastState : null;
    },
    {
      timeout: options.timeout ?? 60000,
      interval: options.interval ?? 500,
      timeoutMessage:
        options.timeoutMessage ??
        `Timed out waiting for evolve-state.currentChangesetId > 0. Last state: ${JSON.stringify(lastState)}`,
    },
  );
}

export async function waitForSettingsMatching(predicate, options = {}) {
  let lastSettings = null;

  return waitForValue(
    async () => {
      lastSettings = await loadSettings();
      return (await predicate(lastSettings)) ? lastSettings : null;
    },
    {
      timeout: options.timeout ?? 10000,
      interval: options.interval ?? 250,
      timeoutMessage:
        options.timeoutMessage ??
        `Timed out waiting for settings predicate. Last settings: ${JSON.stringify(lastSettings)}`,
    },
  );
}

export async function loadE2eEnvironmentMetadata() {
  return readJsonFileOrThrow(NIXMAC_E2E_METADATA_PATH, 'e2e-env');
}

export async function getConfigRepoGitDiff({ format = 'structured' } = {}) {
  const settings = await readJsonFileOrThrow(NIXMAC_SETTINGS_PATH, 'settings');
  const repoDir = settings?.configDir;

  if (!repoDir) {
    throw new Error('[wdio:test-env] settings.configDir is missing; initializeConfigRepo may be disabled');
  }

  const [{ stdout: rawDiff }, { stdout: nameStatus }] = await Promise.all([
    execFileAsync('git', ['diff', '--'], { cwd: repoDir }),
    execFileAsync('git', ['diff', '--name-status', '--'], { cwd: repoDir }),
  ]);

  if (format === 'raw') {
    return rawDiff;
  }

  const files = nameStatus
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...pathParts] = line.split(/\s+/);
      return {
        status,
        path: pathParts.join(' '),
      };
    });

  return {
    repoDir,
    raw: rawDiff,
    files,
  };
}

export async function waitForConfigRepoGitDiffContaining(expectedSubstrings, options = {}) {
  const expected = Array.isArray(expectedSubstrings) ? expectedSubstrings : [expectedSubstrings];
  let lastDiff = null;

  return waitForValue(
    async () => {
      lastDiff = await getConfigRepoGitDiff();
      return expected.every((substring) => lastDiff.raw.includes(substring)) ? lastDiff : null;
    },
    {
      timeout: options.timeout ?? 60000,
      interval: options.interval ?? 500,
      timeoutMessage:
        options.timeoutMessage ??
        `Timed out waiting for git diff to include ${expected.join(', ')}. Last diff:\n${lastDiff?.raw ?? ''}`,
    },
  );
}

export async function setMockVllmResponses({ responseFiles = [], responses = null } = {}) {
  const settings = await readJsonFileOrThrow(NIXMAC_SETTINGS_PATH, 'settings');
  const vllmApiBaseUrl = settings?.vllmApiBaseUrl;

  if (!vllmApiBaseUrl) {
    throw new Error('[wdio:test-env] settings.vllmApiBaseUrl is missing; mock server may not be enabled');
  }

  let adminUrl;
  try {
    adminUrl = new URL('/__admin/mock-responses', vllmApiBaseUrl).toString();
  } catch (error) {
    throw new Error(
      `[wdio:test-env] Invalid vLLM base URL in settings (${String(vllmApiBaseUrl)}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const payload = responses
    ? { responses }
    : { responseFiles };

  const response = await fetch(adminUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(
      `[wdio:test-env] Failed to set mock responses at ${adminUrl} (${response.status}): ${raw}`,
    );
  }

  return response.json();
}

async function runGit(args, cwd) {
  await execFileAsync('git', args, { cwd });
}

async function createNixConfigGitRepo(hostname) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nix-config-'));
  console.log(`[wdio:test-env] Creating temporary config repo at ${tmpDir}`);
  await cp(CONFIG_TEMPLATE_DIR, tmpDir, { recursive: true });

  const username = getCurrentUsername();
  const nixFiles = await listNixFiles(tmpDir);
  const platformTriple = getPlatformTriple();
  for (const nixFile of nixFiles) {
    const content = await readFile(nixFile, 'utf-8');
    const updated = content
      .replaceAll('HOSTNAME_PLACEHOLDER', hostname)
      .replaceAll('USERNAME_PLACEHOLDER', username)
      .replaceAll('PLATFORM_PLACEHOLDER', platformTriple);

    if (updated !== content) {
      await writeFile(nixFile, updated, 'utf-8');
    }
  }

  await writeFile(path.join(tmpDir, '.gitignore'), 'flake.lock\n', 'utf-8');

  await runGit(['init'], tmpDir);
  await runGit(['config', 'user.name', 'eval'], tmpDir);
  await runGit(['config', 'user.email', 'eval@test'], tmpDir);
  await runGit(['add', '-A'], tmpDir);
  // history-navigation.spec.mjs asserts this seed commit appears in the History view.
  await runGit(['commit', '-m', 'initial nix config state', '--author', 'eval <eval@test>'], tmpDir);
  await runGit(['update-index', '--refresh'], tmpDir);

  console.log(`[wdio:test-env] Initialized git repo for test config at ${tmpDir}`);

  return tmpDir;
}

export async function setupNixmacTestEnvironment(options = {}) {
  const {
    initializeConfigRepo = false,
    host,
    mockVllm,
    writeSettings = true,
    vllmApiBaseUrl = process.env.VLLM_API_BASE_URL ?? null,
    vllmApiKey = process.env.VLLM_API_KEY ?? null,
    settingsOverrides = {},
  } = options;

  await rm(NIXMAC_APP_SUPPORT_DIR, { recursive: true, force: true });
  await mkdir(NIXMAC_APP_SUPPORT_DIR, { recursive: true });
  console.log(`[wdio:test-env] Using isolated nixmac app data dir: ${NIXMAC_APP_SUPPORT_DIR}`);

  const evalHostname = host || (await getEvalHostname());
  let configDir = null;
  let mockVllmServer = null;
  let resolvedVllmApiBaseUrl = vllmApiBaseUrl;

  if (mockVllm) {
    mockVllmServer = await startMockVllmServer(mockVllm);
    resolvedVllmApiBaseUrl = mockVllmServer.baseUrl;
  }

  if (initializeConfigRepo) {
    configDir = await createNixConfigGitRepo(evalHostname);
  } else {
    console.log('[wdio:test-env] Skipping temp git repo initialization (initializeConfigRepo=false)');
  }

  await writeFile(
    NIXMAC_E2E_METADATA_PATH,
    `${JSON.stringify(
      {
        appDataDir: NIXMAC_APP_SUPPORT_DIR,
        configDir,
        hostAttr: evalHostname,
        settingsPath: writeSettings ? NIXMAC_SETTINGS_PATH : null,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  if (writeSettings) {
    await generateNixmacSettings({
      host: evalHostname,
      configDir,
      vllmApiBaseUrl: resolvedVllmApiBaseUrl,
      vllmApiKey,
      settingsOverrides,
    });
  } else {
    console.log('[wdio:test-env] Skipping initial settings.json generation (writeSettings=false)');
  }

  return {
    appDataDir: NIXMAC_APP_SUPPORT_DIR,
    configDir,
    mockVllmServer,
    hostAttr: evalHostname,
  };
}

export async function teardownNixmacTestEnvironment(context) {
  if (context?.configDir) {
    console.log(`[wdio:test-env] Removing temporary config repo: ${context.configDir}`);
    await rm(context.configDir, { recursive: true, force: true });
  }

  if (context?.appDataDir) {
    console.log(`[wdio:test-env] Removing isolated app data dir: ${context.appDataDir}`);
    await rm(context.appDataDir, { recursive: true, force: true });
  }

  if (context?.mockVllmServer) {
    await stopMockVllmServer(context.mockVllmServer);
  }
}
