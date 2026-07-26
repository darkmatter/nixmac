#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assertCuratedSafeFrameVideoMetadata, safeFrameVideoPath } from "./report.mjs";

const MANIFEST_PATH = "manifest.json";
const REQUIRED_FIXED_PATHS = Object.freeze([
  "artifact/source.json",
  "attempt.json",
  "events.json",
  "index.html",
  "runner/cleanup.json",
  "runner/identity.json",
  "runner/permissions.json",
  "state.json",
]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireNonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function validateRelativePath(relativePath) {
  requireNonEmpty(relativePath, "evidence path");
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").includes("..") ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath === "." ||
    relativePath.startsWith("./")
  ) {
    throw new Error(
      `evidence path must be a normalized relative path without parent traversal: ${relativePath}`,
    );
  }
  if (relativePath.includes("\0")) throw new Error("evidence path must not contain NUL");
  return relativePath;
}

function validatePathList(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("evidence path list must be a non-empty array");
  }
  const seen = new Set();
  return paths.map((relativePath) => {
    validateRelativePath(relativePath);
    if (relativePath === MANIFEST_PATH) {
      throw new Error("manifest.json cannot include itself");
    }
    if (seen.has(relativePath)) throw new Error(`duplicate evidence path: ${relativePath}`);
    seen.add(relativePath);
    return relativePath;
  });
}

async function readRequiredJson(runDir, relativePath) {
  const absolutePath = path.join(runDir, relativePath);
  let source;
  try {
    source = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`required evidence file is missing: ${relativePath}`, { cause: error });
  }
  if (source.trim() === "") throw new Error(`required evidence file is empty: ${relativePath}`);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`required evidence file is invalid JSON: ${relativePath}`, { cause: error });
  }
}

async function listEvidenceFiles(runDir) {
  const files = [];
  async function walk(directory, relativeDirectory = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      validateRelativePath(relativePath);
      if (relativePath === MANIFEST_PATH) continue;
      const absolutePath = path.join(runDir, ...relativePath.split("/"));
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new Error(`evidence tree must not contain symlink: ${relativePath}`);
      }
      if (stats.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (stats.isFile()) {
        files.push(relativePath);
      } else {
        throw new Error(`evidence tree contains unsupported filesystem entry: ${relativePath}`);
      }
    }
  }
  await walk(runDir);
  return files.sort();
}

async function fileRecord(runDir, relativePath) {
  validateRelativePath(relativePath);
  const absolutePath = path.join(runDir, ...relativePath.split("/"));
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    throw new Error(`required evidence file is missing: ${relativePath}`, { cause: error });
  }
  if (stats.isSymbolicLink())
    throw new Error(`required evidence file is a symlink: ${relativePath}`);
  if (!stats.isFile()) throw new Error(`required evidence path is not a file: ${relativePath}`);
  if (stats.size <= 0) throw new Error(`required evidence file is empty: ${relativePath}`);
  let handle;
  try {
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    throw new Error(
      `required evidence file could not be opened without following symlinks: ${relativePath}`,
      {
        cause: error,
      },
    );
  }
  let bytes;
  let openedStats;
  try {
    openedStats = await handle.stat();
    if (
      !openedStats.isFile() ||
      openedStats.dev !== stats.dev ||
      openedStats.ino !== stats.ino ||
      openedStats.size !== stats.size
    ) {
      throw new Error(`required evidence file changed while opening: ${relativePath}`);
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  const finalStats = await lstat(absolutePath);
  if (
    finalStats.isSymbolicLink() ||
    finalStats.dev !== openedStats.dev ||
    finalStats.ino !== openedStats.ino ||
    finalStats.size !== bytes.length
  ) {
    throw new Error(`required evidence file changed while hashing: ${relativePath}`);
  }
  return {
    path: relativePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

function requireVersionOne(value, label) {
  requireObject(value, label);
  if (value.version !== 1) throw new Error(`${label} version must be 1`);
  return value;
}

function requireFinalCleanup(cleanup) {
  requireVersionOne(cleanup, "cleanup sidecar");
  if (
    cleanup.attempted !== true ||
    cleanup.restored !== true ||
    cleanup.clean !== true ||
    !Array.isArray(cleanup.remainingProcesses) ||
    cleanup.remainingProcesses.length !== 0 ||
    cleanup.failureReason !== ""
  ) {
    throw new Error("cleanup sidecar is not finalized clean");
  }
}

function requireReleasedLease(hostLease) {
  requireVersionOne(hostLease, "host lease sidecar");
  const acquiredAt = Date.parse(hostLease.acquiredAt);
  const releasedAt = Date.parse(hostLease.releasedAt);
  const heartbeatAt = Date.parse(hostLease.lastHeartbeatAt);
  if (
    !/^[0-9a-f]{64}$/.test(hostLease.ownerTokenHash || "") ||
    hostLease.acquired !== true ||
    hostLease.released !== true ||
    !Number.isFinite(acquiredAt) ||
    !Number.isFinite(releasedAt) ||
    !Number.isFinite(heartbeatAt) ||
    releasedAt < acquiredAt ||
    heartbeatAt < acquiredAt ||
    heartbeatAt > releasedAt ||
    hostLease.quarantineReason !== ""
  ) {
    throw new Error("static host lease does not prove owner-matched release");
  }
}

function validateSafeFrameVideo(state, paths) {
  requireObject(state, "state");
  assertCuratedSafeFrameVideoMetadata(state.video);
  if (!paths.includes(safeFrameVideoPath)) {
    throw new Error(`curated safe-frame video is missing: ${safeFrameVideoPath}`);
  }
  for (const [field, prefix] of [
    ["screenshots", "screenshots/"],
    ["textSnapshots", "texts/"],
  ]) {
    if (!Array.isArray(state[field]) || state[field].length === 0) {
      throw new Error(`state ${field} must contain retained safe evidence`);
    }
    const seen = new Set();
    for (const artifact of state[field]) {
      const artifactPath = validateRelativePath(artifact?.path);
      if (!artifactPath.startsWith(prefix) || !paths.includes(artifactPath)) {
        throw new Error(`state ${field} references missing or unsafe evidence: ${artifactPath}`);
      }
      if (seen.has(artifactPath)) {
        throw new Error(`state ${field} contains duplicate evidence path: ${artifactPath}`);
      }
      seen.add(artifactPath);
    }
  }
  const nonCuratedVideos = paths.filter(
    (relativePath) =>
      /\.(?:mp4|mov|m4v)$/i.test(relativePath) && relativePath !== safeFrameVideoPath,
  );
  if (nonCuratedVideos.length > 0) {
    throw new Error(
      `raw whole-run video is forbidden; only curated safe-frame video may be retained: ${nonCuratedVideos.join(", ")}`,
    );
  }
}

async function readManifestInputs(runDir, paths) {
  for (const requiredPath of REQUIRED_FIXED_PATHS) {
    if (!paths.includes(requiredPath)) {
      throw new Error(`required evidence file is missing from manifest input: ${requiredPath}`);
    }
  }
  const [identity, permissions, artifact, attempt, cleanup, state] = await Promise.all([
    readRequiredJson(runDir, "runner/identity.json"),
    readRequiredJson(runDir, "runner/permissions.json"),
    readRequiredJson(runDir, "artifact/source.json"),
    readRequiredJson(runDir, "attempt.json"),
    readRequiredJson(runDir, "runner/cleanup.json"),
    readRequiredJson(runDir, "state.json"),
  ]);
  for (const [label, sidecar] of [
    ["runner identity", identity],
    ["runner permissions", permissions],
    ["artifact source", artifact],
    ["attempt", attempt],
  ]) {
    requireVersionOne(sidecar, label);
  }
  for (const [field, value] of [
    ["identity.jobId", identity.jobId],
    ["identity.repo", identity.repo],
    ["identity.mergeSha", identity.mergeSha],
    ["identity.suiteVersion", identity.suiteVersion],
    ["identity.harnessSha", identity.harnessSha],
    ["identity.runnerBackend", identity.runnerBackend],
    ["identity.runnerName", identity.runnerName],
    ["identity.runnerImageDigest", identity.runnerImageDigest],
    ["identity.cuaDriverCliVersion", identity.cuaDriverCliVersion],
    ["identity.cuaDriverAppVersion", identity.cuaDriverAppVersion],
    ["identity.captureMode", identity.captureMode],
    ["identity.finalizationMode", identity.finalizationMode],
    ["artifact.buildRunId", artifact.buildRunId],
    ["artifact.artifactId", artifact.artifactId],
    ["artifact.artifactDigest", artifact.artifactDigest],
    ["artifact.appBundlePath", artifact.appBundlePath],
    ["artifact.appBundleDigest", artifact.appBundleDigest],
    ["attempt.jobId", attempt.jobId],
    ["attempt.actionsRunId", attempt.actionsRunId],
    ["attempt.actionsJobId", attempt.actionsJobId],
  ]) {
    requireNonEmpty(value, field);
  }
  if (
    !/^[0-9a-f]{40}$/.test(identity.mergeSha) ||
    !/^[0-9a-f]{40}$/.test(identity.harnessSha) ||
    !/^sha256:[0-9a-f]{64}$/.test(identity.runnerImageDigest) ||
    !/^sha256:[0-9a-f]{64}$/.test(artifact.artifactDigest) ||
    !/^[0-9a-f]{64}$/.test(artifact.appBundleDigest)
  ) {
    throw new Error("identity sidecars contain malformed immutable digests");
  }
  if (permissions.accessibilityGranted !== true || permissions.screenRecordingGranted !== true) {
    throw new Error("permission identity sidecar must prove Accessibility and Screen Recording");
  }
  if (
    attempt.jobId !== identity.jobId ||
    attempt.finalizationMode !== identity.finalizationMode ||
    attempt.status !== "final" ||
    attempt.finalized !== true
  ) {
    throw new Error("attempt sidecar is not finalized or does not match runner identity");
  }
  if (!Number.isSafeInteger(attempt.number) || attempt.number <= 0) {
    throw new Error("attempt number must be a positive integer");
  }
  if (!["pass", "fail", "inconclusive"].includes(attempt.verdict)) {
    throw new Error("attempt verdict is invalid");
  }
  if (state.verdict !== attempt.verdict) {
    throw new Error("state verdict does not match finalized attempt verdict");
  }
  requireFinalCleanup(cleanup);
  if (identity.captureMode !== "safe-frame") {
    throw new Error("CuaDriver captureMode must be safe-frame");
  }
  validateSafeFrameVideo(state, paths);
  if (identity.runnerBackend === "static_ssh") {
    if (
      identity.finalizationMode !== "controller-finalize" ||
      !paths.includes("runner/host-lease.json")
    ) {
      throw new Error("static_ssh requires controller-finalize and runner/host-lease.json");
    }
    requireReleasedLease(await readRequiredJson(runDir, "runner/host-lease.json"));
  } else if (identity.finalizationMode !== "local-finalize") {
    throw new Error("non-static runner requires local-finalize");
  }
  return { artifact, attempt, identity, state };
}

async function expectedManifest(runDir, paths) {
  const stablePaths = validatePathList(paths).sort();
  const { artifact, attempt, identity, state } = await readManifestInputs(runDir, stablePaths);
  const files = [];
  for (const relativePath of stablePaths) files.push(await fileRecord(runDir, relativePath));
  return {
    version: 1,
    job: {
      id: identity.jobId,
      repo: identity.repo,
      mergeSha: identity.mergeSha,
      suiteVersion: identity.suiteVersion,
    },
    attempt: {
      number: attempt.number,
      actionsRunId: attempt.actionsRunId,
      actionsJobId: attempt.actionsJobId,
    },
    harness: { sha: identity.harnessSha },
    app: {
      artifactId: artifact.artifactId,
      artifactDigest: artifact.artifactDigest,
      bundleDigest: artifact.appBundleDigest,
    },
    runner: {
      backend: identity.runnerBackend,
      name: identity.runnerName,
      imageDigest: identity.runnerImageDigest,
    },
    cuaDriver: {
      cliVersion: identity.cuaDriverCliVersion,
      appBundleVersion: identity.cuaDriverAppVersion,
      captureMode: identity.captureMode,
    },
    verdict: state.verdict,
    files,
  };
}

export async function createEvidenceManifest(runDir, { requiredPaths = null } = {}) {
  const absoluteRunDir = path.resolve(runDir);
  const paths =
    requiredPaths === null
      ? await listEvidenceFiles(absoluteRunDir)
      : validatePathList(requiredPaths);
  for (const relativePath of paths) await fileRecord(absoluteRunDir, relativePath);
  const manifestPath = path.join(absoluteRunDir, MANIFEST_PATH);
  try {
    await lstat(manifestPath);
    throw new Error("manifest.json already exists; verified evidence is immutable");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const manifest = await expectedManifest(absoluteRunDir, paths);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return manifest;
}

export async function verifyEvidenceManifest(runDir) {
  const absoluteRunDir = path.resolve(runDir);
  const manifest = requireVersionOne(
    await readRequiredJson(absoluteRunDir, MANIFEST_PATH),
    "evidence manifest",
  );
  if (!Array.isArray(manifest.files)) throw new Error("evidence manifest files must be an array");
  const manifestPaths = validatePathList(manifest.files.map((entry) => entry?.path));
  const treePaths = await listEvidenceFiles(absoluteRunDir);
  if (JSON.stringify(manifestPaths) !== JSON.stringify([...manifestPaths].sort())) {
    throw new Error("evidence manifest file paths are not in stable lexical order");
  }
  if (JSON.stringify(manifestPaths) !== JSON.stringify(treePaths)) {
    throw new Error("evidence tree file set does not match immutable manifest");
  }
  const expected = await expectedManifest(absoluteRunDir, treePaths);
  for (let index = 0; index < expected.files.length; index += 1) {
    const actualRecord = manifest.files[index];
    const expectedRecord = expected.files[index];
    if (actualRecord?.sha256 !== expectedRecord.sha256) {
      throw new Error(`evidence digest mismatch for ${expectedRecord.path}`);
    }
    if (actualRecord?.bytes !== expectedRecord.bytes) {
      throw new Error(`evidence byte count mismatch for ${expectedRecord.path}`);
    }
  }
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
    throw new Error("evidence manifest metadata mismatch");
  }
  return manifest;
}

function cliArg(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? "" : args[index + 1] || "";
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const runDir = cliArg(args, "--run-dir");
  if (!runDir || !["create", "verify"].includes(command)) {
    console.error(
      "Usage: node tests/e2e/computer-use/evidence-manifest.mjs <create|verify> --run-dir <path>",
    );
    process.exitCode = 64;
    return;
  }
  const result =
    command === "create"
      ? await createEvidenceManifest(runDir)
      : await verifyEvidenceManifest(runDir);
  console.log(
    JSON.stringify({
      manifest: path.join(path.resolve(runDir), MANIFEST_PATH),
      files: result.files.length,
      verdict: result.verdict,
      verified: command === "verify",
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
