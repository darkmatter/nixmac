import { lstat, mkdir, rmdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const MUTATION_LOCK_TIMEOUT_MS = 30_000;

function validateRunDir(runDir) {
  if (typeof runDir !== "string" || !path.isAbsolute(runDir) || path.normalize(runDir) !== runDir) {
    throw new Error("evidence run directory must be an absolute normalized path");
  }
}

function mutationLockPath(runDir) {
  return path.join(path.dirname(runDir), `.${path.basename(runDir)}.evidence-mutation.lock`);
}

export async function assertEvidenceTreeMutable(runDir) {
  validateRunDir(runDir);
  try {
    await lstat(path.join(runDir, "manifest.json"));
    throw new Error("manifest.json already exists; verified evidence is immutable");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function acquireMutationLock(runDir) {
  validateRunDir(runDir);
  const lockPath = mutationLockPath(runDir);
  const deadline = Date.now() + MUTATION_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      return async () => {
        await rmdir(lockPath);
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for evidence mutation lock: ${lockPath}`);
      }
      await delay(10);
    }
  }
}

export async function withEvidenceTreeMutation(runDir, mutate) {
  if (typeof mutate !== "function") throw new TypeError("evidence mutation must be a function");
  const release = await acquireMutationLock(runDir);
  try {
    await assertEvidenceTreeMutable(runDir);
    return await mutate();
  } finally {
    await release();
  }
}
