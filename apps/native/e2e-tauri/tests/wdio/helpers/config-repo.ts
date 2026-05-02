import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  access,
  cp,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const APPS_NATIVE_DIR = path.resolve(THIS_DIR, '../../../../');
const CONFIG_TEMPLATE_DIR = path.join(APPS_NATIVE_DIR, 'templates', 'nix-darwin-determinate');
const NIXMAC_APP_SUPPORT_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'com.darkmatter.nixmac',
);
const NIXMAC_SETTINGS_PATH = path.join(NIXMAC_APP_SUPPORT_DIR, 'settings.json');

export interface GitDiffResult {
  repoDir: string;
  raw: string;
  files: Array<{ status: string; path: string }>;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonFileOrThrow(filePath: string, label: string): Promise<unknown> {
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

function getCurrentUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env['USER'] || 'nobody';
  }
}

function getPlatformTriple(): string {
  const archMap: Record<string, string> = { arm64: 'aarch64', x64: 'x86_64' };
  const arch = archMap[process.arch] ?? process.arch;
  const platform = process.platform;
  return `${arch}-${platform}`;
}

async function listNixFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

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

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

export async function createNixConfigGitRepo(hostname: string): Promise<string> {
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
  await runGit(['commit', '-m', 'initial nix config state', '--author', 'eval <eval@test>'], tmpDir);
  await runGit(['update-index', '--refresh'], tmpDir);

  console.log(`[wdio:test-env] Initialized git repo for test config at ${tmpDir}`);

  return tmpDir;
}

export async function createEmptyConfigDir(): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nix-config-empty-'));

  await runGit(['init'], tmpDir);
  await runGit(['config', 'user.name', 'eval'], tmpDir);
  await runGit(['config', 'user.email', 'eval@test'], tmpDir);

  console.log(`[wdio:test-env] Created empty temporary git config dir at ${tmpDir} (no initial commit)`);
  return tmpDir;
}

export async function getConfigRepoDir(): Promise<string> {
  const settings = (await readJsonFileOrThrow(NIXMAC_SETTINGS_PATH, 'settings')) as Record<string, unknown>;
  const repoDir = settings?.['configDir'] as string | undefined;

  if (!repoDir) {
    throw new Error('[wdio:test-env] settings.configDir is missing');
  }

  return repoDir;
}

export async function getConfigRepoGitDiff({ format = 'structured' }: { format?: string } = {}): Promise<GitDiffResult | string> {
  const repoDir = await getConfigRepoDir();

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
        status: status ?? '',
        path: pathParts.join(' '),
      };
    });

  return {
    repoDir,
    raw: rawDiff,
    files,
  };
}

export async function assertConfigRepoInitialized(): Promise<{ repoDir: string }> {
  const repoDir = await getConfigRepoDir();

  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoDir }));
  } catch (error) {
    throw new Error(
      `[wdio:test-env] Expected configDir to be an initialized git repo (${repoDir}), but git rev-parse failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (stdout.trim() !== 'true') {
    throw new Error(
      `[wdio:test-env] Expected configDir to be a git repo (${repoDir}), got rev-parse output: ${stdout.trim()}`,
    );
  }

  return { repoDir };
}

export async function assertConfigRepoFileExists(relativePath: string): Promise<string> {
  const repoDir = await getConfigRepoDir();
  const absolutePath = path.join(repoDir, relativePath);

  if (!(await pathExists(absolutePath))) {
    throw new Error(
      `[wdio:test-env] Expected file to exist in config repo: ${absolutePath}`,
    );
  }

  return absolutePath;
}

export async function assertConfigRepoClean(): Promise<{ repoDir: string }> {
  const repoDir = await getConfigRepoDir();

  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: repoDir });
  const status = stdout.trim();

  if (status) {
    throw new Error(
      `[wdio:test-env] Expected config repo to be clean (${repoDir}), found pending changes:\n${status}`,
    );
  }

  return { repoDir };
}

export async function resetConfigRepoToInitialState(): Promise<{ repoDir: string }> {
  const repoDir = await getConfigRepoDir();

  // Reset all unstaged changes
  await runGit(['checkout', '-f'], repoDir);
  
  // Reset to the initial commit (HEAD)
  await runGit(['reset', '--hard', 'HEAD'], repoDir);

  console.log(`[wdio:test-env] Reset config repo to initial state: ${repoDir}`);

  return { repoDir };
}

export async function waitForConfigRepoInitialized({ timeout = 120000, interval = 1000 }: { timeout?: number; interval?: number } = {}): Promise<{ repoDir: string }> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeout) {
    try {
      return await assertConfigRepoInitialized();
    } catch (error) {
      lastError = error;
      await sleep(interval);
    }
  }

  throw new Error(
    `[wdio:test-env] Timed out waiting for config repo initialization: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export async function waitForConfigRepoFileExists(relativePath: string, { timeout = 120000, interval = 1000 }: { timeout?: number; interval?: number } = {}): Promise<string> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeout) {
    try {
      return await assertConfigRepoFileExists(relativePath);
    } catch (error) {
      lastError = error;
      await sleep(interval);
    }
  }

  throw new Error(
    `[wdio:test-env] Timed out waiting for config repo file ${relativePath}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export async function waitForConfigRepoClean({ timeout = 120000, interval = 1000 }: { timeout?: number; interval?: number } = {}): Promise<{ repoDir: string }> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeout) {
    try {
      return await assertConfigRepoClean();
    } catch (error) {
      lastError = error;
      await sleep(interval);
    }
  }

  throw new Error(
    `[wdio:test-env] Timed out waiting for clean config repo: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
