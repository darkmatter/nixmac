import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const CONTROL_TIMEOUT_MS = 30_000;
const CONTROL_POLL_MS = 10;
const writerContext = new AsyncLocalStorage();

function validateRunDir(runDir) {
  if (typeof runDir !== "string" || !path.isAbsolute(runDir) || path.normalize(runDir) !== runDir) {
    throw new Error("evidence run directory must be an absolute normalized path");
  }
}

export function evidenceControlPaths(runDir) {
  validateRunDir(runDir);
  const controlDirectory = path.join(
    path.dirname(runDir),
    `.${path.basename(runDir)}.evidence-control`,
  );
  return Object.freeze({
    controlDirectory,
    activeWritersDirectory: path.join(controlDirectory, "active-writers"),
    admissionLockPath: path.join(controlDirectory, "admission.lock"),
    admissionClosedPath: path.join(controlDirectory, "admission.closed"),
    sealerLockPath: path.join(controlDirectory, "sealer.lock"),
  });
}

async function directDirectory(filePath, label) {
  const stats = await lstat(filePath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a direct directory: ${filePath}`);
  }
}

async function ensureControlDirectories(runDir) {
  const paths = evidenceControlPaths(runDir);
  await mkdir(paths.controlDirectory, { recursive: true, mode: 0o700 });
  await directDirectory(paths.controlDirectory, "evidence control directory");
  await mkdir(paths.activeWritersDirectory, { mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  await directDirectory(paths.activeWritersDirectory, "active-writers registry");
  return paths;
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function acquireDirectoryLock(lockPath, label) {
  const deadline = Date.now() + CONTROL_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      return async () => {
        await rmdir(lockPath);
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ${label}: ${lockPath}`);
      }
      await delay(CONTROL_POLL_MS);
    }
  }
}

async function assertWriterAdmissionOpen(runDir, paths = evidenceControlPaths(runDir)) {
  if (
    (await pathExists(paths.admissionClosedPath)) ||
    (await pathExists(path.join(runDir, "manifest.json")))
  ) {
    throw new Error("evidence writer admission is closed; verified evidence is immutable");
  }
}

async function registerWriter(runDir) {
  const paths = await ensureControlDirectories(runDir);
  const releaseAdmissionLock = await acquireDirectoryLock(
    paths.admissionLockPath,
    "evidence admission lock",
  );
  const registrationPath = path.join(
    paths.activeWritersDirectory,
    `${process.pid}-${randomUUID()}`,
  );
  try {
    await assertWriterAdmissionOpen(runDir, paths);
    await mkdir(registrationPath, { mode: 0o700 });
  } finally {
    await releaseAdmissionLock();
  }
  return async () => {
    await rmdir(registrationPath);
  };
}

export async function assertEvidenceTreeMutable(runDir) {
  validateRunDir(runDir);
  const paths = await ensureControlDirectories(runDir);
  await assertWriterAdmissionOpen(runDir, paths);
}

export async function withEvidenceTreeMutation(runDir, mutate) {
  if (typeof mutate !== "function") throw new TypeError("evidence mutation must be a function");
  validateRunDir(runDir);
  const inheritedRegistration = writerContext.getStore();
  if (inheritedRegistration?.runDir === runDir && inheritedRegistration.active === true) {
    return mutate();
  }
  const unregister = await registerWriter(runDir);
  const registration = { active: true, runDir };
  try {
    return await writerContext.run(registration, mutate);
  } finally {
    registration.active = false;
    await unregister();
  }
}

async function closeWriterAdmission(runDir) {
  const paths = await ensureControlDirectories(runDir);
  const releaseAdmissionLock = await acquireDirectoryLock(
    paths.admissionLockPath,
    "evidence admission lock",
  );
  try {
    if (!(await pathExists(paths.admissionClosedPath))) {
      await writeFile(
        paths.admissionClosedPath,
        `${JSON.stringify({
          version: 1,
          closedAt: new Date().toISOString(),
          closedByPid: process.pid,
        })}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
    }
  } finally {
    await releaseAdmissionLock();
  }
  return paths;
}

async function drainActiveWriters(paths) {
  const deadline = Date.now() + CONTROL_TIMEOUT_MS;
  for (;;) {
    const activeWriters = await readdir(paths.activeWritersDirectory);
    if (activeWriters.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out draining registered evidence writers: ${activeWriters.join(", ")}`,
      );
    }
    await delay(CONTROL_POLL_MS);
  }
}

export async function withEvidenceTreeSeal(runDir, seal) {
  if (typeof seal !== "function") throw new TypeError("evidence seal must be a function");
  validateRunDir(runDir);
  const inheritedRegistration = writerContext.getStore();
  if (inheritedRegistration?.runDir === runDir && inheritedRegistration.active === true) {
    throw new Error("an admitted evidence writer cannot seal its own active evidence tree");
  }
  const paths = await closeWriterAdmission(runDir);
  const releaseSealerLock = await acquireDirectoryLock(
    paths.sealerLockPath,
    "evidence sealer lock",
  );
  try {
    await drainActiveWriters(paths);
    return await seal();
  } finally {
    await releaseSealerLock();
  }
}
