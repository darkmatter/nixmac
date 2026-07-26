#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PREFLIGHT_FIELDS = Object.freeze([
  "jobId",
  "repo",
  "mergeSha",
  "suiteVersion",
  "harnessSha",
  "actionsRunId",
  "actionsJobId",
  "attemptNumber",
  "runnerName",
  "runnerBackend",
  "runnerImageDigest",
  "buildRunId",
  "artifactId",
  "artifactDigest",
  "appBundlePath",
  "appBundleDigest",
  "cuaDriverCliVersion",
  "cuaDriverAppVersion",
  "captureMode",
  "finalizationMode",
  "accessibilityGranted",
  "screenRecordingGranted",
]);

const BACKENDS = new Set(["cilicon_tart", "static_ssh"]);
const FINALIZATION_MODES = new Set(["local-finalize", "controller-finalize"]);
const SAFE_CAPTURE_MODE = "safe-frame";

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (value.includes("\0")) throw new Error(`${field} must not contain NUL`);
  return value;
}

function requireGitSha(value, field) {
  requireString(value, field);
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${field} must be a full lowercase 40-character Git SHA`);
  }
  return value;
}

function requireSha256(value, field, { prefix = "optional" } = {}) {
  requireString(value, field);
  const pattern = prefix === "required" ? /^sha256:[0-9a-f]{64}$/ : /^(?:sha256:)?[0-9a-f]{64}$/;
  if (!pattern.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest`);
  return value;
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function requireTrue(value, field) {
  if (value !== true) throw new Error(`${field} must be true`);
  return true;
}

function requireAbsoluteNormalizedPath(value, field) {
  requireString(value, field);
  if (!path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new Error(`${field} must be an absolute normalized path`);
  }
  return value;
}

function validatePreflightInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("run preflight input must be an object");
  }
  for (const field of PREFLIGHT_FIELDS) {
    if (!Object.hasOwn(input, field)) throw new Error(`${field} is required`);
  }
  requireString(input.jobId, "jobId");
  requireString(input.repo, "repo");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repo)) {
    throw new Error("repo must be an owner/name repository identity");
  }
  requireGitSha(input.mergeSha, "mergeSha");
  requireString(input.suiteVersion, "suiteVersion");
  requireGitSha(input.harnessSha, "harnessSha");
  requireString(input.actionsRunId, "actionsRunId");
  requireString(input.actionsJobId, "actionsJobId");
  requirePositiveInteger(input.attemptNumber, "attemptNumber");
  requireString(input.runnerName, "runnerName");
  if (!BACKENDS.has(input.runnerBackend)) {
    throw new Error("runnerBackend must be cilicon_tart or static_ssh");
  }
  requireSha256(input.runnerImageDigest, "runnerImageDigest", { prefix: "required" });
  requireString(input.buildRunId, "buildRunId");
  requireString(input.artifactId, "artifactId");
  requireSha256(input.artifactDigest, "artifactDigest", { prefix: "required" });
  requireAbsoluteNormalizedPath(input.appBundlePath, "appBundlePath");
  if (!input.appBundlePath.endsWith(".app")) {
    throw new Error("appBundlePath must identify an .app bundle");
  }
  if (
    input.appBundlePath.startsWith("/Applications/") ||
    input.appBundlePath.startsWith("/System/Applications/")
  ) {
    throw new Error("appBundlePath must be a run-specific staged app, not a shared app");
  }
  requireSha256(input.appBundleDigest, "appBundleDigest", { prefix: "forbidden" });
  requireString(input.cuaDriverCliVersion, "cuaDriverCliVersion");
  requireString(input.cuaDriverAppVersion, "cuaDriverAppVersion");
  if (input.captureMode !== SAFE_CAPTURE_MODE) {
    throw new Error(`captureMode must be ${SAFE_CAPTURE_MODE}`);
  }
  if (!FINALIZATION_MODES.has(input.finalizationMode)) {
    throw new Error("finalizationMode must be local-finalize or controller-finalize");
  }
  if (
    (input.runnerBackend === "static_ssh") !==
    (input.finalizationMode === "controller-finalize")
  ) {
    throw new Error(
      "static_ssh requires controller-finalize and other backends require local-finalize",
    );
  }
  requireTrue(input.accessibilityGranted, "accessibilityGranted");
  requireTrue(input.screenRecordingGranted, "screenRecordingGranted");
  return Object.freeze({ ...input });
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

async function readJson(runDir, relativePath) {
  const filePath = path.join(runDir, relativePath);
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`required run sidecar is missing: ${relativePath}`, { cause: error });
  }
  if (source.trim() === "") throw new Error(`required run sidecar is empty: ${relativePath}`);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`required run sidecar is invalid JSON: ${relativePath}`, { cause: error });
  }
}

async function assertEvidenceUnsealed(runDir) {
  try {
    await lstat(path.join(runDir, "manifest.json"));
    throw new Error("manifest.json already exists; verified evidence is immutable");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function preflightSidecars(input) {
  return {
    "runner/identity.json": {
      version: 1,
      jobId: input.jobId,
      repo: input.repo,
      mergeSha: input.mergeSha,
      suiteVersion: input.suiteVersion,
      harnessSha: input.harnessSha,
      runnerName: input.runnerName,
      runnerBackend: input.runnerBackend,
      runnerImageDigest: input.runnerImageDigest,
      cuaDriverCliVersion: input.cuaDriverCliVersion,
      cuaDriverAppVersion: input.cuaDriverAppVersion,
      captureMode: input.captureMode,
      finalizationMode: input.finalizationMode,
    },
    "runner/permissions.json": {
      version: 1,
      accessibilityGranted: input.accessibilityGranted,
      screenRecordingGranted: input.screenRecordingGranted,
    },
    "artifact/source.json": {
      version: 1,
      buildRunId: input.buildRunId,
      artifactId: input.artifactId,
      artifactDigest: input.artifactDigest,
      appBundlePath: input.appBundlePath,
      appBundleDigest: input.appBundleDigest,
    },
    "attempt.json": {
      version: 1,
      jobId: input.jobId,
      number: input.attemptNumber,
      actionsRunId: input.actionsRunId,
      actionsJobId: input.actionsJobId,
      finalizationMode: input.finalizationMode,
      status: "preflight",
      finalized: false,
      verdict: null,
    },
  };
}

export function preflightInputFromEnvironment({
  env = process.env,
  appBundlePath,
  appBundleDigest,
  cuaDriverCliVersion,
  cuaDriverAppVersion,
  accessibilityGranted,
  screenRecordingGranted,
}) {
  return validatePreflightInput({
    jobId: env.NIXMAC_E2E_JOB_ID || "",
    repo: env.NIXMAC_E2E_REPO || env.GITHUB_REPOSITORY || "",
    mergeSha: env.NIXMAC_E2E_MERGE_SHA || "",
    suiteVersion: env.NIXMAC_E2E_SUITE_VERSION || "",
    harnessSha: env.NIXMAC_E2E_HARNESS_SHA || "",
    actionsRunId: env.NIXMAC_E2E_ACTIONS_RUN_ID || env.GITHUB_RUN_ID || "",
    actionsJobId: env.NIXMAC_E2E_ACTIONS_JOB_ID || "",
    attemptNumber: Number(env.NIXMAC_E2E_ATTEMPT || env.GITHUB_RUN_ATTEMPT || 0),
    runnerName: env.NIXMAC_E2E_RUNNER_NAME || env.RUNNER_NAME || "",
    runnerBackend: env.NIXMAC_E2E_RUNNER_BACKEND || "",
    runnerImageDigest: env.NIXMAC_E2E_RUNNER_IMAGE_DIGEST || "",
    buildRunId: env.NIXMAC_E2E_BUILD_RUN_ID || "",
    artifactId: env.NIXMAC_E2E_ARTIFACT_ID || "",
    artifactDigest: env.NIXMAC_E2E_ARTIFACT_DIGEST || "",
    appBundlePath,
    appBundleDigest,
    cuaDriverCliVersion,
    cuaDriverAppVersion,
    captureMode: SAFE_CAPTURE_MODE,
    finalizationMode: env.NIXMAC_E2E_FINALIZATION_MODE || "",
    accessibilityGranted,
    screenRecordingGranted,
  });
}

export async function writeRunPreflight(runDir, rawInput) {
  requireAbsoluteNormalizedPath(runDir, "runDir");
  const input = validatePreflightInput(rawInput);
  const sidecars = preflightSidecars(input);
  for (const [relativePath, value] of Object.entries(sidecars)) {
    await writeJsonAtomic(path.join(runDir, relativePath), value);
  }
  return sidecars;
}

function mergePreflightSidecars(identity, permissions, artifact, attempt) {
  return {
    jobId: identity.jobId,
    repo: identity.repo,
    mergeSha: identity.mergeSha,
    suiteVersion: identity.suiteVersion,
    harnessSha: identity.harnessSha,
    actionsRunId: attempt.actionsRunId,
    actionsJobId: attempt.actionsJobId,
    attemptNumber: attempt.number,
    runnerName: identity.runnerName,
    runnerBackend: identity.runnerBackend,
    runnerImageDigest: identity.runnerImageDigest,
    buildRunId: artifact.buildRunId,
    artifactId: artifact.artifactId,
    artifactDigest: artifact.artifactDigest,
    appBundlePath: artifact.appBundlePath,
    appBundleDigest: artifact.appBundleDigest,
    cuaDriverCliVersion: identity.cuaDriverCliVersion,
    cuaDriverAppVersion: identity.cuaDriverAppVersion,
    captureMode: identity.captureMode,
    finalizationMode: identity.finalizationMode,
    accessibilityGranted: permissions.accessibilityGranted,
    screenRecordingGranted: permissions.screenRecordingGranted,
  };
}

export async function assertRunPreflight(
  runDir,
  {
    computeAppBundleDigest = async (appBundlePath) => {
      const { hashCuaBundleTree } = await import("./drivers/cua-driver.mjs");
      return hashCuaBundleTree(appBundlePath);
    },
  } = {},
) {
  const [identity, permissions, artifact, attempt] = await Promise.all([
    readJson(runDir, "runner/identity.json"),
    readJson(runDir, "runner/permissions.json"),
    readJson(runDir, "artifact/source.json"),
    readJson(runDir, "attempt.json"),
  ]);
  for (const [name, sidecar] of [
    ["runner identity", identity],
    ["runner permissions", permissions],
    ["artifact source", artifact],
    ["attempt", attempt],
  ]) {
    if (sidecar.version !== 1) throw new Error(`${name} sidecar version must be 1`);
  }
  const input = validatePreflightInput(
    mergePreflightSidecars(identity, permissions, artifact, attempt),
  );
  if (attempt.jobId !== identity.jobId) throw new Error("attempt jobId does not match identity");
  if (attempt.finalizationMode !== identity.finalizationMode) {
    throw new Error("attempt finalizationMode does not match identity");
  }
  if (attempt.status !== "preflight" || attempt.finalized !== false || attempt.verdict !== null) {
    throw new Error("attempt sidecar must be in unfinalized preflight state before UI");
  }
  const actualBundleDigest = await computeAppBundleDigest(input.appBundlePath);
  if (actualBundleDigest !== input.appBundleDigest) {
    throw new Error(
      `app bundle digest mismatch: expected ${input.appBundleDigest}, got ${actualBundleDigest}`,
    );
  }
  return Object.freeze({
    identity,
    permissions,
    artifact,
    attempt,
    input,
    app: Object.freeze({
      appBundlePath: input.appBundlePath,
      appBundleDigest: input.appBundleDigest,
    }),
  });
}

function validateVerdict(value) {
  if (!["pass", "fail", "inconclusive"].includes(value)) {
    throw new Error("verdict must be pass, fail, or inconclusive");
  }
  return value;
}

function validateCleanup(cleanup) {
  if (!cleanup || typeof cleanup !== "object" || Array.isArray(cleanup)) {
    throw new Error("cleanup must be an object");
  }
  for (const field of ["attempted", "restored", "clean"]) {
    if (typeof cleanup[field] !== "boolean") throw new Error(`cleanup.${field} must be boolean`);
  }
  if (!Array.isArray(cleanup.ownedPaths)) throw new Error("cleanup.ownedPaths must be an array");
  const seen = new Set();
  for (const ownedPath of cleanup.ownedPaths) {
    requireAbsoluteNormalizedPath(ownedPath, "cleanup owned path");
    if (ownedPath === path.parse(ownedPath).root) {
      throw new Error("cleanup owned path must not be a filesystem root");
    }
    if (seen.has(ownedPath)) throw new Error(`duplicate cleanup owned path: ${ownedPath}`);
    seen.add(ownedPath);
  }
  if (!Array.isArray(cleanup.remainingProcesses)) {
    throw new Error("cleanup.remainingProcesses must be an array");
  }
  if (typeof cleanup.failureReason !== "string") {
    throw new Error("cleanup.failureReason must be a string");
  }
  return {
    version: 1,
    attempted: cleanup.attempted,
    restored: cleanup.restored,
    clean: cleanup.clean,
    ownedPaths: [...cleanup.ownedPaths],
    remainingProcesses: [...cleanup.remainingProcesses],
    failureReason: cleanup.failureReason,
  };
}

function assertCleanupClean(cleanup) {
  if (
    cleanup.attempted !== true ||
    cleanup.restored !== true ||
    cleanup.clean !== true ||
    cleanup.remainingProcesses.length !== 0 ||
    cleanup.failureReason !== ""
  ) {
    throw new Error("cleanup sidecar must prove attempted, restored, clean final cleanup");
  }
}

function validateHostLease(hostLease) {
  if (!hostLease || typeof hostLease !== "object" || Array.isArray(hostLease)) {
    throw new Error("host lease must be an object");
  }
  requireSha256(hostLease.ownerTokenHash, "hostLease.ownerTokenHash", {
    prefix: "forbidden",
  });
  if (hostLease.acquired !== true || hostLease.released !== true) {
    throw new Error("static host lease must prove acquired and owner-matched released state");
  }
  for (const field of ["acquiredAt", "releasedAt", "lastHeartbeatAt"]) {
    requireString(hostLease[field], `hostLease.${field}`);
    if (!Number.isFinite(Date.parse(hostLease[field]))) {
      throw new Error(`hostLease.${field} must be an ISO timestamp`);
    }
  }
  for (const field of ["waitReason", "quarantineReason"]) {
    if (typeof hostLease[field] !== "string") throw new Error(`hostLease.${field} must be string`);
  }
  if (hostLease.quarantineReason !== "") {
    throw new Error("static host lease cannot pass with a quarantine reason");
  }
  const acquiredAt = Date.parse(hostLease.acquiredAt);
  const releasedAt = Date.parse(hostLease.releasedAt);
  const heartbeatAt = Date.parse(hostLease.lastHeartbeatAt);
  if (releasedAt < acquiredAt || heartbeatAt < acquiredAt || heartbeatAt > releasedAt) {
    throw new Error("static host lease timestamps are not monotonic");
  }
  return { version: 1, ...hostLease };
}

async function finalizeAttempt(runDir, { status, finalized, verdict }) {
  const attempt = await readJson(runDir, "attempt.json");
  const next = {
    ...attempt,
    status,
    finalized,
    verdict: validateVerdict(verdict),
  };
  await writeJsonAtomic(path.join(runDir, "attempt.json"), next);
  return next;
}

export async function stageControllerEvidence(runDir, { verdict }) {
  await assertEvidenceUnsealed(runDir);
  const identity = await readJson(runDir, "runner/identity.json");
  if (
    identity.runnerBackend !== "static_ssh" ||
    identity.finalizationMode !== "controller-finalize"
  ) {
    throw new Error("controller staging requires static_ssh controller-finalize identity");
  }
  return finalizeAttempt(runDir, {
    status: "awaiting-controller",
    finalized: false,
    verdict,
  });
}

async function sealEvidence(runDir) {
  const { createEvidenceManifest, verifyEvidenceManifest } =
    await import("./evidence-manifest.mjs");
  const manifest = await createEvidenceManifest(runDir);
  await verifyEvidenceManifest(runDir);
  return manifest;
}

export async function finalizeLocalEvidence(runDir, { cleanup, verdict }) {
  await assertEvidenceUnsealed(runDir);
  const identity = await readJson(runDir, "runner/identity.json");
  if (identity.runnerBackend === "static_ssh" || identity.finalizationMode !== "local-finalize") {
    throw new Error("local finalization requires a non-static local-finalize identity");
  }
  const normalizedCleanup = validateCleanup(cleanup);
  await writeJsonAtomic(path.join(runDir, "runner", "cleanup.json"), normalizedCleanup);
  await finalizeAttempt(runDir, { status: "final", finalized: true, verdict });
  assertCleanupClean(normalizedCleanup);
  return sealEvidence(runDir);
}

export async function writeRunCleanup(runDir, cleanup) {
  const normalizedCleanup = validateCleanup(cleanup);
  await writeJsonAtomic(path.join(runDir, "runner", "cleanup.json"), normalizedCleanup);
  return normalizedCleanup;
}

export async function finalizeControllerEvidence(runDir, { cleanup, hostLease, verdict }) {
  await writeControllerFinalization(runDir, { cleanup, hostLease, verdict });
  return sealEvidence(runDir);
}

export async function writeControllerFinalization(runDir, { cleanup, hostLease, verdict }) {
  await assertEvidenceUnsealed(runDir);
  const identity = await readJson(runDir, "runner/identity.json");
  if (
    identity.runnerBackend !== "static_ssh" ||
    identity.finalizationMode !== "controller-finalize"
  ) {
    throw new Error("controller finalization requires static_ssh controller-finalize identity");
  }
  await writeJsonAtomic(path.join(runDir, "runner", "cleanup.json"), validateCleanup(cleanup));
  await writeJsonAtomic(
    path.join(runDir, "runner", "host-lease.json"),
    validateHostLease(hostLease),
  );
  await finalizeAttempt(runDir, { status: "final", finalized: true, verdict });
  return {
    cleanup: await readJson(runDir, "runner/cleanup.json"),
    hostLease: await readJson(runDir, "runner/host-lease.json"),
    attempt: await readJson(runDir, "attempt.json"),
  };
}

export function hashOwnerToken(ownerToken) {
  requireString(ownerToken, "ownerToken");
  return createHash("sha256").update(ownerToken).digest("hex");
}

function cliArg(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? "" : args[index + 1] || "";
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "finalize-controller") {
    console.error(
      "Usage: node tests/e2e/computer-use/run-metadata.mjs finalize-controller --run-dir <path> --cleanup-file <path> --host-lease-file <path> --verdict <pass|fail|inconclusive>",
    );
    process.exitCode = 64;
    return;
  }
  const runDir = cliArg(args, "--run-dir");
  const cleanupFile = cliArg(args, "--cleanup-file");
  const hostLeaseFile = cliArg(args, "--host-lease-file");
  const verdict = cliArg(args, "--verdict");
  if (!runDir || !cleanupFile || !hostLeaseFile || !verdict) {
    throw new Error("finalize-controller requires run, cleanup, host-lease, and verdict inputs");
  }
  const [cleanup, hostLease] = await Promise.all([
    JSON.parse(await readFile(path.resolve(cleanupFile), "utf8")),
    JSON.parse(await readFile(path.resolve(hostLeaseFile), "utf8")),
  ]);
  await writeControllerFinalization(path.resolve(runDir), {
    cleanup,
    hostLease,
    verdict,
  });
  console.log(
    JSON.stringify({
      finalized: true,
      manifestCreated: false,
      runDir: path.resolve(runDir),
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
