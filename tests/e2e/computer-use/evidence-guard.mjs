import { lstat } from "node:fs/promises";
import path from "node:path";

export async function assertEvidenceTreeMutable(runDir) {
  if (typeof runDir !== "string" || !path.isAbsolute(runDir) || path.normalize(runDir) !== runDir) {
    throw new Error("evidence run directory must be an absolute normalized path");
  }
  try {
    await lstat(path.join(runDir, "manifest.json"));
    throw new Error("manifest.json already exists; verified evidence is immutable");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
