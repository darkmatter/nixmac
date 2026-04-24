import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { startMockVllmServer, stopMockVllmServer } from './mock-vllm-server.mjs';
import { isPlaybackMode } from './vllm-test-mode.mjs';
import {
  assertConfigRepoClean,
  assertConfigRepoFileExists,
  assertConfigRepoInitialized,
  createEmptyConfigDir,
  createNixConfigGitRepo,
  getConfigRepoDir,
  getConfigRepoGitDiff,
  waitForConfigRepoClean,
  waitForConfigRepoFileExists,
  waitForConfigRepoInitialized,
} from './config-repo.mjs';

const execFileAsync = promisify(execFile);

const NIXMAC_APP_SUPPORT_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'com.darkmatter.nixmac',
);
const NIXMAC_SETTINGS_PATH = path.join(
  NIXMAC_APP_SUPPORT_DIR,
  'settings.json',
);
const NIXMAC_EVOLVE_STATE_PATH = path.join(NIXMAC_APP_SUPPORT_DIR, 'evolve-state.json');
const NIXMAC_BUILD_STATE_PATH = path.join(NIXMAC_APP_SUPPORT_DIR, 'build-state.json');
const NIXMAC_DB_PATH = path.join(NIXMAC_APP_SUPPORT_DIR, 'nixmac.db');

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

async function backupNixmacSettings() {
  if (!(await pathExists(NIXMAC_SETTINGS_PATH))) {
    console.log(`[wdio:test-env] No existing settings found to back up at ${NIXMAC_SETTINGS_PATH}`);
    return null;
  }

  const backupPath = `${NIXMAC_SETTINGS_PATH}.bak`;
  await copyFile(NIXMAC_SETTINGS_PATH, backupPath);
  console.log(`[wdio:test-env] Backed up settings: ${NIXMAC_SETTINGS_PATH} -> ${backupPath}`);
  return backupPath;
}

async function restoreNixmacSettings(backupPath) {
  if (!backupPath) {
    console.log('[wdio:test-env] No settings backup to restore');
    return;
  }

  if (!(await pathExists(backupPath))) {
    console.log(`[wdio:test-env] Settings backup not found, skipping restore: ${backupPath}`);
    return;
  }

  await mkdir(path.dirname(NIXMAC_SETTINGS_PATH), { recursive: true });
  await copyFile(backupPath, NIXMAC_SETTINGS_PATH);
  await unlink(backupPath);
  console.log(`[wdio:test-env] Restored settings from backup: ${backupPath}`);
}

async function backupStatefulFile(statePath, label) {
  if (!(await pathExists(statePath))) {
    console.log(`[wdio:test-env] No existing ${label} found to back up at ${statePath}`);
    return null;
  }

  const backupPath = `${statePath}.bak`;
  await copyFile(statePath, backupPath);
  console.log(`[wdio:test-env] Backed up ${label}: ${statePath} -> ${backupPath}`);
  return backupPath;
}

async function restoreStatefulFile(backupPath, targetPath, label) {
  if (!backupPath) {
    console.log(`[wdio:test-env] No ${label} backup to restore`);
    return;
  }

  if (!(await pathExists(backupPath))) {
    console.log(`[wdio:test-env] ${label} backup not found, skipping restore: ${backupPath}`);
    return;
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(backupPath, targetPath);
  await unlink(backupPath);
  console.log(`[wdio:test-env] Restored ${label} from backup: ${backupPath}`);
}

async function generateNixmacSettings({ host, configDir, vllmApiBaseUrl, vllmApiKey }) {
  const settings = {
    hostAttr: host,
    configDir,
    vllmApiBaseUrl: vllmApiBaseUrl ?? null,
    vllmApiKey: vllmApiKey ?? null,
    evolveProvider: 'vllm',
    summaryProvider: 'vllm',
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

export async function setMockVllmResponses({ responseFiles = [], responses = null } = {}) {
  if (!isPlaybackMode()) {
    console.log('[wdio:test-env] Skipping setMockVllmResponses because playback mode is disabled');
    return { skipped: true, reason: 'playback-mode-disabled' };
  }

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

export {
  assertConfigRepoClean,
  assertConfigRepoFileExists,
  assertConfigRepoInitialized,
  getConfigRepoDir,
  getConfigRepoGitDiff,
  waitForConfigRepoClean,
  waitForConfigRepoFileExists,
  waitForConfigRepoInitialized,
};

export async function setupNixmacTestEnvironment(options = {}) {
  const {
    initializeConfigRepo = false,
    initializeEmptyConfigDir = false,
    host,
    mockVllm,
    vllmApiBaseUrl = process.env.VLLM_API_BASE_URL ?? null,
    vllmApiKey = process.env.VLLM_API_KEY ?? null,
  } = options;

  if (initializeConfigRepo && initializeEmptyConfigDir) {
    throw new Error(
      '[wdio:test-env] initializeConfigRepo and initializeEmptyConfigDir are mutually exclusive',
    );
  }

  const backupPath = await backupNixmacSettings();
  const evolveBackupPath = await backupStatefulFile(NIXMAC_EVOLVE_STATE_PATH, 'evolve-state');
  const buildBackupPath = await backupStatefulFile(NIXMAC_BUILD_STATE_PATH, 'build-state');
  const dbBackupPath = await backupStatefulFile(NIXMAC_DB_PATH, 'nixmac.db');
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
  } else if (initializeEmptyConfigDir) {
    configDir = await createEmptyConfigDir();
  } else {
    console.log('[wdio:test-env] Skipping temp config dir initialization (initializeConfigRepo=false, initializeEmptyConfigDir=false)');
  }

  await generateNixmacSettings({
    host: evalHostname,
    configDir,
    vllmApiBaseUrl: resolvedVllmApiBaseUrl,
    vllmApiKey,
  });

  // Clear any existing evolve/build/db state so tests start from a clean slate
  if (await pathExists(NIXMAC_EVOLVE_STATE_PATH)) {
    await unlink(NIXMAC_EVOLVE_STATE_PATH);
    console.log(`[wdio:test-env] Cleared existing evolve-state at ${NIXMAC_EVOLVE_STATE_PATH}`);
  }

  if (await pathExists(NIXMAC_BUILD_STATE_PATH)) {
    await unlink(NIXMAC_BUILD_STATE_PATH);
    console.log(`[wdio:test-env] Cleared existing build-state at ${NIXMAC_BUILD_STATE_PATH}`);
  }

  if (await pathExists(NIXMAC_DB_PATH)) {
    await unlink(NIXMAC_DB_PATH);
    console.log(`[wdio:test-env] Cleared existing DB state at ${NIXMAC_DB_PATH}`);
  }

  return {
    backupPath,
    evolveBackupPath,
    buildBackupPath,
    dbBackupPath,
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

  await restoreNixmacSettings(context?.backupPath ?? null);
  await restoreStatefulFile(context?.evolveBackupPath ?? null, NIXMAC_EVOLVE_STATE_PATH, 'evolve-state');
  await restoreStatefulFile(context?.buildBackupPath ?? null, NIXMAC_BUILD_STATE_PATH, 'build-state');
  await restoreStatefulFile(context?.dbBackupPath ?? null, NIXMAC_DB_PATH, 'nixmac.db');

  if (context?.mockVllmServer) {
    await stopMockVllmServer(context.mockVllmServer);
  }
}
