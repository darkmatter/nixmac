#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PREFLIGHT_FIELDS = Object.freeze([
  "jobId",
  "repo",
  "mergeSha",
  "appArtifactSha",
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
  "stagingParent",
  "appBundlePath",
  "appBundleDigest",
  "disposableConfigPath",
  "daemonSocketPath",
  "cuaDriverCliVersion",
  "cuaDriverAppVersion",
  "captureMode",
  "finalizationMode",
  "accessibilityGranted",
  "screenRecordingGranted",
  "startedAt",
  "evidencePrefix",
]);

const BACKENDS = new Set(["cilicon_tart", "static_ssh"]);
const FINALIZATION_MODES = new Set(["local-finalize", "controller-finalize"]);
const SAFE_CAPTURE_MODE = "safe-frame";

function canonicalJobId({ repo, mergeSha, suiteVersion }) {
  return `${repo}:${mergeSha}:${suiteVersion}`;
}

function canonicalEvidencePrefix({ jobId, attemptNumber }) {
  return `computer-use-e2e/jobs/${encodeURIComponent(jobId)}/attempt-${attemptNumber}/`;
}

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

function requireIsoTimestamp(value, field) {
  requireString(value, field);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO timestamp`);
  }
  return value;
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
  requireGitSha(input.appArtifactSha, "appArtifactSha");
  if (input.appArtifactSha !== input.mergeSha) {
    throw new Error("appArtifactSha must match mergeSha");
  }
  requireString(input.suiteVersion, "suiteVersion");
  const expectedJobId = canonicalJobId(input);
  if (input.jobId !== expectedJobId) {
    throw new Error(`jobId must match canonical job identity ${expectedJobId}`);
  }
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
  requireAbsoluteNormalizedPath(input.stagingParent, "stagingParent");
  if (input.stagingParent === path.parse(input.stagingParent).root) {
    throw new Error("stagingParent must not be a filesystem root");
  }
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
  if (path.dirname(input.appBundlePath) !== input.stagingParent) {
    throw new Error("appBundlePath must be owned directly by stagingParent");
  }
  requireSha256(input.appBundleDigest, "appBundleDigest", { prefix: "forbidden" });
  for (const [field, value] of [
    ["disposableConfigPath", input.disposableConfigPath],
    ["daemonSocketPath", input.daemonSocketPath],
  ]) {
    requireAbsoluteNormalizedPath(value, field);
    const relative = path.relative(input.stagingParent, value);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`${field} must be uniquely owned beneath stagingParent`);
    }
  }
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
  requireIsoTimestamp(input.startedAt, "startedAt");
  const expectedPrefix = canonicalEvidencePrefix({
    jobId: input.jobId,
    attemptNumber: input.attemptNumber,
  });
  if (input.evidencePrefix !== expectedPrefix) {
    throw new Error(`evidencePrefix must match canonical attempt prefix ${expectedPrefix}`);
  }
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

async function assertPreflightSidecarsAbsent(runDir) {
  for (const relativePath of [
    "runner/identity.json",
    "runner/permissions.json",
    "artifact/source.json",
    "attempt.json",
  ]) {
    try {
      await lstat(path.join(runDir, relativePath));
      throw new Error(`run preflight is already bound: ${relativePath}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
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
      appArtifactSha: input.appArtifactSha,
      stagingParent: input.stagingParent,
      appBundlePath: input.appBundlePath,
      appBundleDigest: input.appBundleDigest,
      disposableConfigPath: input.disposableConfigPath,
      daemonSocketPath: input.daemonSocketPath,
    },
    "attempt.json": {
      version: 1,
      jobId: input.jobId,
      number: input.attemptNumber,
      actionsRunId: input.actionsRunId,
      actionsJobId: input.actionsJobId,
      finalizationMode: input.finalizationMode,
      startedAt: input.startedAt,
      endedAt: null,
      failureClass: null,
      evidencePrefix: input.evidencePrefix,
      capture: {
        status: "not_started",
        uiStarted: false,
        reason: "",
      },
      status: "preflight",
      finalized: false,
      verdict: null,
      lifecycle: {
        identityBound: true,
        uiPreparationAuthorized: true,
        uiStarted: false,
        driverClosed: false,
        cleanupFinalized: false,
        evidenceReady: false,
      },
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
    appArtifactSha: env.NIXMAC_E2E_APP_ARTIFACT_SHA || "",
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
    stagingParent: env.NIXMAC_E2E_STAGING_PARENT || path.dirname(appBundlePath || "/"),
    appBundlePath,
    appBundleDigest,
    disposableConfigPath: env.NIXMAC_E2E_DISPOSABLE_CONFIG_PATH || "",
    daemonSocketPath: env.NIXMAC_E2E_DAEMON_SOCKET_PATH || "",
    cuaDriverCliVersion,
    cuaDriverAppVersion,
    captureMode: SAFE_CAPTURE_MODE,
    finalizationMode: env.NIXMAC_E2E_FINALIZATION_MODE || "",
    accessibilityGranted,
    screenRecordingGranted,
    startedAt: env.NIXMAC_E2E_ATTEMPT_STARTED_AT || "",
    evidencePrefix: canonicalEvidencePrefix({
      jobId: env.NIXMAC_E2E_JOB_ID || "",
      attemptNumber: Number(env.NIXMAC_E2E_ATTEMPT || env.GITHUB_RUN_ATTEMPT || 0),
    }),
  });
}

async function readTrustedAttestation(filePath, label) {
  requireAbsoluteNormalizedPath(filePath, `${label} path`);
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a direct regular file`);
  }
  const source = await readFile(filePath, "utf8");
  if (source.trim() === "") throw new Error(`${label} must not be empty`);
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value;
}

async function defaultProbeHarnessSha({ repoRoot }) {
  const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`trusted harness SHA probe failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function defaultProbeRunnerIdentity({ env }) {
  return readTrustedAttestation(
    env.NIXMAC_E2E_RUNNER_ATTESTATION_PATH || "",
    "runner identity attestation",
  );
}

async function defaultProbeArtifactIdentity({ env }) {
  return readTrustedAttestation(
    env.NIXMAC_E2E_ARTIFACT_ATTESTATION_PATH || "",
    "artifact verification attestation",
  );
}

export async function resolveRunPreflightIdentity(
  {
    env = process.env,
    repoRoot = process.cwd(),
    appBundlePath,
    appBundleDigest,
    cuaDriverCliVersion,
    cuaDriverAppVersion,
    accessibilityGranted,
    screenRecordingGranted,
  },
  {
    probeHarnessSha = defaultProbeHarnessSha,
    probeRunnerIdentity = defaultProbeRunnerIdentity,
    probeArtifactIdentity = defaultProbeArtifactIdentity,
  } = {},
) {
  const repo = requireString(env.NIXMAC_E2E_REPO || "", "repo");
  const mergeSha = requireGitSha(env.NIXMAC_E2E_MERGE_SHA || "", "mergeSha");
  const suiteVersion = requireString(env.NIXMAC_E2E_SUITE_VERSION || "", "suiteVersion");
  const jobId = requireString(env.NIXMAC_E2E_JOB_ID || "", "jobId");
  const expectedJobId = canonicalJobId({ repo, mergeSha, suiteVersion });
  if (jobId !== expectedJobId) {
    throw new Error(`canonical jobId mismatch: expected ${expectedJobId}, got ${jobId}`);
  }
  if ((env.GITHUB_REPOSITORY || "") !== repo) {
    throw new Error("repository identity does not match live GITHUB_REPOSITORY");
  }
  const appArtifactSha = requireGitSha(
    env.NIXMAC_E2E_APP_ARTIFACT_SHA || "",
    "app artifact SHA",
  );
  if (appArtifactSha !== mergeSha) {
    throw new Error("app artifact SHA does not match merge SHA");
  }
  const suppliedHarnessSha = requireGitSha(
    env.NIXMAC_E2E_HARNESS_SHA || "",
    "harnessSha",
  );
  const liveHarnessSha = requireGitSha(
    await probeHarnessSha({ env, repoRoot }),
    "live harness SHA",
  );
  if (liveHarnessSha !== suppliedHarnessSha) {
    throw new Error("trusted live harness SHA does not match supplied harness SHA");
  }
  const runner = await probeRunnerIdentity({ env, repoRoot });
  for (const [label, expected, actual] of [
    ["runner name", env.NIXMAC_E2E_RUNNER_NAME, runner?.name],
    ["runner backend", env.NIXMAC_E2E_RUNNER_BACKEND, runner?.backend],
    ["runner image", env.NIXMAC_E2E_RUNNER_IMAGE_DIGEST, runner?.imageDigest],
  ]) {
    if (requireString(actual || "", `live ${label}`) !== requireString(expected || "", label)) {
      throw new Error(`${label} does not match live attested identity`);
    }
  }
  const artifact = await probeArtifactIdentity({ env, repoRoot });
  if (artifact?.verified !== true) {
    throw new Error("artifact identity was not independently verified");
  }
  for (const [label, expected, actual] of [
    ["artifact ID", env.NIXMAC_E2E_ARTIFACT_ID, artifact?.artifactId],
    ["artifact digest", env.NIXMAC_E2E_ARTIFACT_DIGEST, artifact?.artifactDigest],
    ["artifact build run", env.NIXMAC_E2E_BUILD_RUN_ID, artifact?.buildRunId],
    ["artifact merge SHA", mergeSha, artifact?.mergeSha],
    ["verified app bundle digest", appBundleDigest, artifact?.appBundleDigest],
  ]) {
    if (requireString(actual || "", `verified ${label}`) !== requireString(expected || "", label)) {
      throw new Error(`${label} does not match independently verified artifact identity`);
    }
  }
  const base = preflightInputFromEnvironment({
    env,
    appBundlePath,
    appBundleDigest,
    cuaDriverCliVersion,
    cuaDriverAppVersion,
    accessibilityGranted,
    screenRecordingGranted,
  });
  const startedAt = requireString(
    env.NIXMAC_E2E_ATTEMPT_STARTED_AT || "",
    "attempt startedAt",
  );
  if (!Number.isFinite(Date.parse(startedAt))) {
    throw new Error("attempt startedAt must be an ISO timestamp");
  }
  return Object.freeze({
    ...base,
    appArtifactSha,
    startedAt,
    evidencePrefix: canonicalEvidencePrefix({
      jobId,
      attemptNumber: base.attemptNumber,
    }),
  });
}

export async function writeRunPreflight(runDir, rawInput) {
  requireAbsoluteNormalizedPath(runDir, "runDir");
  await assertEvidenceUnsealed(runDir);
  const input = validatePreflightInput(rawInput);
  await assertPreflightSidecarsAbsent(runDir);
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
    appArtifactSha: artifact.appArtifactSha,
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
    stagingParent: artifact.stagingParent,
    appBundlePath: artifact.appBundlePath,
    appBundleDigest: artifact.appBundleDigest,
    disposableConfigPath: artifact.disposableConfigPath,
    daemonSocketPath: artifact.daemonSocketPath,
    cuaDriverCliVersion: identity.cuaDriverCliVersion,
    cuaDriverAppVersion: identity.cuaDriverAppVersion,
    captureMode: identity.captureMode,
    finalizationMode: identity.finalizationMode,
    accessibilityGranted: permissions.accessibilityGranted,
    screenRecordingGranted: permissions.screenRecordingGranted,
    startedAt: attempt.startedAt,
    evidencePrefix: attempt.evidencePrefix,
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
  if (
    attempt.endedAt !== null ||
    attempt.failureClass !== null ||
    JSON.stringify(attempt.capture) !==
      JSON.stringify({ status: "not_started", uiStarted: false, reason: "" }) ||
    attempt.startedAt !== input.startedAt ||
    attempt.evidencePrefix !== input.evidencePrefix ||
    JSON.stringify(attempt.lifecycle) !==
      JSON.stringify({
        identityBound: true,
        uiPreparationAuthorized: true,
        uiStarted: false,
        driverClosed: false,
        cleanupFinalized: false,
        evidenceReady: false,
      })
  ) {
    throw new Error("attempt sidecar must contain the complete preflight lifecycle identity");
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

function validateCleanup(cleanup, { identity, artifact }) {
  if (!cleanup || typeof cleanup !== "object" || Array.isArray(cleanup)) {
    throw new Error("cleanup must be an object");
  }
  const expectedOwnershipMode =
    identity.runnerBackend === "static_ssh" ? "controller-static" : "local-ephemeral";
  if (cleanup.ownershipMode !== expectedOwnershipMode) {
    throw new Error(`cleanup.ownershipMode must be ${expectedOwnershipMode}`);
  }
  for (const field of ["attempted", "restored", "clean"]) {
    if (typeof cleanup[field] !== "boolean") throw new Error(`cleanup.${field} must be boolean`);
  }
  requireIsoTimestamp(cleanup.startedAt, "cleanup.startedAt");
  requireIsoTimestamp(cleanup.completedAt, "cleanup.completedAt");
  if (Date.parse(cleanup.completedAt) < Date.parse(cleanup.startedAt)) {
    throw new Error("cleanup timestamps must be monotonic");
  }
  if (!Array.isArray(cleanup.ownedPaths) || cleanup.ownedPaths.length === 0) {
    throw new Error("cleanup.ownedPaths must be a non-empty exact ownership array");
  }
  const expectedPathKinds =
    expectedOwnershipMode === "local-ephemeral"
      ? new Map([
          ["staging-parent", artifact.stagingParent],
          ["app-bundle", artifact.appBundlePath],
          ["disposable-config", artifact.disposableConfigPath],
          ["daemon-socket", artifact.daemonSocketPath],
        ])
      : new Map([
          ["remote-staging", artifact.stagingParent],
          ["app-bundle", artifact.appBundlePath],
          ["remote-config", artifact.disposableConfigPath],
          ["daemon-socket", artifact.daemonSocketPath],
        ]);
  if (cleanup.ownedPaths.length !== expectedPathKinds.size) {
    throw new Error("cleanup.ownedPaths must prove every exact owned path");
  }
  const seen = new Set();
  for (const ownedPath of cleanup.ownedPaths) {
    if (!ownedPath || typeof ownedPath !== "object" || Array.isArray(ownedPath)) {
      throw new Error("cleanup owned path must be an attestation object");
    }
    requireString(ownedPath.kind, "cleanup owned path kind");
    requireAbsoluteNormalizedPath(ownedPath.path, "cleanup owned path");
    if (ownedPath.path === path.parse(ownedPath.path).root) {
      throw new Error("cleanup owned path must not be a filesystem root");
    }
    if (seen.has(ownedPath.kind)) {
      throw new Error(`duplicate cleanup owned path kind: ${ownedPath.kind}`);
    }
    seen.add(ownedPath.kind);
    if (
      expectedPathKinds.get(ownedPath.kind) !== ownedPath.path ||
      ownedPath.expectedFinalState !== "absent" ||
      !["absent", "present", "unverified"].includes(ownedPath.observedFinalState)
    ) {
      throw new Error(
        `cleanup owned path ${ownedPath.kind} must match identity and record a final probe state`,
      );
    }
  }
  for (const kind of expectedPathKinds.keys()) {
    if (!seen.has(kind)) throw new Error(`cleanup owned paths missing ${kind}`);
  }
  if (!Array.isArray(cleanup.processInstances) || cleanup.processInstances.length !== 2) {
    throw new Error("cleanup.processInstances must prove exact target and daemon processes");
  }
  const processRoles = new Set();
  for (const processInstance of cleanup.processInstances) {
    if (!processInstance || typeof processInstance !== "object") {
      throw new Error("cleanup process instance must be an object");
    }
    if (!["target", "daemon"].includes(processInstance.role)) {
      throw new Error("cleanup process role must be target or daemon");
    }
    if (processRoles.has(processInstance.role)) {
      throw new Error(`duplicate cleanup process role: ${processInstance.role}`);
    }
    processRoles.add(processInstance.role);
    if (!["owned", "not_started"].includes(processInstance.status)) {
      throw new Error(`cleanup ${processInstance.role} status must be owned or not_started`);
    }
    if (processInstance.status === "owned") {
      requirePositiveInteger(processInstance.pid, `cleanup ${processInstance.role} pid`);
      requireString(
        processInstance.birthMarker,
        `cleanup ${processInstance.role} birthMarker`,
      );
      requireAbsoluteNormalizedPath(
        processInstance.executable,
        `cleanup ${processInstance.role} executable`,
      );
      if (
        processInstance.role === "target" &&
        !processInstance.executable.startsWith(`${artifact.appBundlePath}${path.sep}`)
      ) {
        throw new Error("cleanup target executable must belong to the staged app bundle");
      }
    } else if (
      processInstance.pid !== null ||
      processInstance.birthMarker !== null ||
      processInstance.executable !== null
    ) {
      throw new Error(
        `cleanup ${processInstance.role} not_started process must not fabricate an identity`,
      );
    }
    if (typeof processInstance.terminated !== "boolean") {
      throw new Error(`cleanup ${processInstance.role} terminated must be boolean`);
    }
  }
  for (const role of ["target", "daemon"]) {
    if (!processRoles.has(role)) throw new Error(`cleanup process instances missing ${role}`);
  }
  if (!Array.isArray(cleanup.remainingProcesses)) {
    throw new Error("cleanup.remainingProcesses must be an array");
  }
  if (typeof cleanup.failureReason !== "string") {
    throw new Error("cleanup.failureReason must be a string");
  }
  if (!cleanup.lifecycle || typeof cleanup.lifecycle !== "object") {
    throw new Error("cleanup.lifecycle must be an object");
  }
  for (const field of [
    "driverCloseAttempted",
    "driverClosed",
    "ownershipMatched",
    "pathsProbed",
    "processesProbed",
  ]) {
    if (typeof cleanup.lifecycle[field] !== "boolean") {
      throw new Error(`cleanup.lifecycle.${field} must be boolean`);
    }
  }
  return {
    version: 1,
    ownershipMode: cleanup.ownershipMode,
    attempted: cleanup.attempted,
    restored: cleanup.restored,
    clean: cleanup.clean,
    startedAt: cleanup.startedAt,
    completedAt: cleanup.completedAt,
    ownedPaths: cleanup.ownedPaths.map((entry) => ({ ...entry })),
    processInstances: cleanup.processInstances.map((entry) => ({ ...entry })),
    remainingProcesses: [...cleanup.remainingProcesses],
    failureReason: cleanup.failureReason,
    lifecycle: { ...cleanup.lifecycle },
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
  for (const ownedPath of cleanup.ownedPaths) {
    if (ownedPath.observedFinalState !== "absent") {
      throw new Error(
        `cleanup sidecar must prove ${ownedPath.kind} observedFinalState is absent`,
      );
    }
  }
  for (const processInstance of cleanup.processInstances) {
    if (processInstance.terminated !== true) {
      throw new Error(
        `cleanup sidecar must prove ${processInstance.role} process is terminated`,
      );
    }
  }
  for (const field of [
    "driverCloseAttempted",
    "driverClosed",
    "ownershipMatched",
    "pathsProbed",
    "processesProbed",
  ]) {
    if (cleanup.lifecycle[field] !== true) {
      throw new Error(`cleanup sidecar lifecycle.${field} must be true`);
    }
  }
}

function validateHostLease(hostLease, { trustedOwnerToken }) {
  if (!hostLease || typeof hostLease !== "object" || Array.isArray(hostLease)) {
    throw new Error("host lease must be an object");
  }
  if (Object.keys(hostLease).some((field) => /raw.*token|ownerToken$/i.test(field))) {
    throw new Error("raw owner token must not be stored in host lease evidence");
  }
  const acquiredOwnerTokenHash = requireSha256(
    hostLease.acquiredOwnerTokenHash,
    "hostLease.acquiredOwnerTokenHash",
    { prefix: "forbidden" },
  );
  const releasedOwnerTokenHash = requireSha256(
    hostLease.releasedOwnerTokenHash,
    "hostLease.releasedOwnerTokenHash",
    { prefix: "forbidden" },
  );
  if (
    acquiredOwnerTokenHash === "0".repeat(64) ||
    releasedOwnerTokenHash === "0".repeat(64)
  ) {
    throw new Error("static host lease owner hashes must not be zero");
  }
  const trustedOwnerTokenHash = hashOwnerToken(trustedOwnerToken);
  if (
    acquiredOwnerTokenHash !== releasedOwnerTokenHash ||
    acquiredOwnerTokenHash !== trustedOwnerTokenHash
  ) {
    throw new Error(
      "static host lease must prove owner-matched release against trusted owner token hash",
    );
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

function failureClassForVerdict(verdict) {
  return verdict === "pass" ? "none" : verdict === "fail" ? "product" : "infrastructure";
}

function validateCapture(capture) {
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
    throw new Error("capture lifecycle must be an object");
  }
  if (!["available", "not_started", "not_available"].includes(capture.status)) {
    throw new Error("capture status must be available, not_started, or not_available");
  }
  if (typeof capture.uiStarted !== "boolean" || typeof capture.reason !== "string") {
    throw new Error("capture lifecycle must contain uiStarted and reason");
  }
  if (capture.status === "available") {
    if (capture.uiStarted !== true || capture.reason !== "") {
      throw new Error("available capture must prove UI started and have no failure reason");
    }
  } else if (capture.uiStarted !== false || capture.reason.trim() === "") {
    throw new Error(
      "unavailable capture requires a reason and lifecycle proof that UI never started",
    );
  }
  return { status: capture.status, uiStarted: capture.uiStarted, reason: capture.reason };
}

function resolveFinalCapture(attempt, capture) {
  return validateCapture(
    capture ??
      (attempt.status === "awaiting-controller"
        ? attempt.capture
        : { status: "available", uiStarted: true, reason: "" }),
  );
}

async function finalizeAttempt(
  runDir,
  {
    status,
    finalized,
    verdict,
    completeLifecycle = false,
    capture,
  },
) {
  const attempt = await readJson(runDir, "attempt.json");
  const normalizedVerdict = validateVerdict(verdict);
  const normalizedCapture = resolveFinalCapture(attempt, capture);
  const next = {
    ...attempt,
    status,
    finalized,
    verdict: normalizedVerdict,
    failureClass: failureClassForVerdict(normalizedVerdict),
    endedAt: completeLifecycle ? new Date().toISOString() : null,
    capture: normalizedCapture,
    lifecycle: {
      ...attempt.lifecycle,
      uiStarted: normalizedCapture.uiStarted,
      driverClosed: true,
      cleanupFinalized: completeLifecycle,
      evidenceReady: completeLifecycle,
    },
  };
  await writeJsonAtomic(path.join(runDir, "attempt.json"), next);
  return next;
}

export async function stageControllerEvidence(
  runDir,
  { verdict, capture = { status: "available", uiStarted: true, reason: "" } },
) {
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
    completeLifecycle: false,
    capture,
  });
}

async function sealEvidence(runDir) {
  const { createEvidenceManifest, verifyEvidenceManifest } =
    await import("./evidence-manifest.mjs");
  const manifest = await createEvidenceManifest(runDir);
  await verifyEvidenceManifest(runDir);
  return manifest;
}

export async function finalizeLocalEvidence(
  runDir,
  {
    cleanup,
    verdict,
    capture = { status: "available", uiStarted: true, reason: "" },
  },
) {
  await assertEvidenceUnsealed(runDir);
  const [identity, artifact, attempt] = await Promise.all([
    readJson(runDir, "runner/identity.json"),
    readJson(runDir, "artifact/source.json"),
    readJson(runDir, "attempt.json"),
  ]);
  if (identity.runnerBackend === "static_ssh" || identity.finalizationMode !== "local-finalize") {
    throw new Error("local finalization requires a non-static local-finalize identity");
  }
  try {
    await lstat(path.join(runDir, "runner", "host-lease.json"));
    throw new Error("local finalization forbids runner/host-lease.json");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const normalizedCleanup = validateCleanup(cleanup, { identity, artifact });
  assertCleanupClean(normalizedCleanup);
  const normalizedCapture = resolveFinalCapture(attempt, capture);
  await writeJsonAtomic(path.join(runDir, "runner", "cleanup.json"), normalizedCleanup);
  await finalizeAttempt(runDir, {
    status: "final",
    finalized: true,
    verdict,
    completeLifecycle: true,
    capture: normalizedCapture,
  });
  return sealEvidence(runDir);
}

export async function writeRunCleanup(runDir, cleanup) {
  await assertEvidenceUnsealed(runDir);
  const [identity, artifact] = await Promise.all([
    readJson(runDir, "runner/identity.json"),
    readJson(runDir, "artifact/source.json"),
  ]);
  const normalizedCleanup = validateCleanup(cleanup, { identity, artifact });
  await writeJsonAtomic(path.join(runDir, "runner", "cleanup.json"), normalizedCleanup);
  return normalizedCleanup;
}

export async function finalizeControllerEvidence(
  runDir,
  {
    cleanup,
    hostLease,
    trustedOwnerToken,
    verdict,
    capture,
  },
) {
  await writeControllerFinalization(runDir, {
    cleanup,
    hostLease,
    trustedOwnerToken,
    verdict,
    capture,
  });
  return sealEvidence(runDir);
}

export async function writeControllerFinalization(
  runDir,
  {
    cleanup,
    hostLease,
    trustedOwnerToken,
    verdict,
    capture,
  },
) {
  await assertEvidenceUnsealed(runDir);
  const [identity, artifact, attempt] = await Promise.all([
    readJson(runDir, "runner/identity.json"),
    readJson(runDir, "artifact/source.json"),
    readJson(runDir, "attempt.json"),
  ]);
  if (
    identity.runnerBackend !== "static_ssh" ||
    identity.finalizationMode !== "controller-finalize"
  ) {
    throw new Error("controller finalization requires static_ssh controller-finalize identity");
  }
  const normalizedCleanup = validateCleanup(cleanup, { identity, artifact });
  assertCleanupClean(normalizedCleanup);
  const normalizedLease = validateHostLease(hostLease, { trustedOwnerToken });
  const normalizedCapture = resolveFinalCapture(attempt, capture);
  await writeJsonAtomic(path.join(runDir, "runner", "cleanup.json"), normalizedCleanup);
  await writeJsonAtomic(
    path.join(runDir, "runner", "host-lease.json"),
    normalizedLease,
  );
  await finalizeAttempt(runDir, {
    status: "final",
    finalized: true,
    verdict,
    completeLifecycle: true,
    capture: normalizedCapture,
  });
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
  const trustedOwnerToken = process.env.NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN || "";
  if (!runDir || !cleanupFile || !hostLeaseFile || !verdict) {
    throw new Error("finalize-controller requires run, cleanup, host-lease, and verdict inputs");
  }
  requireString(
    trustedOwnerToken,
    "NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN trusted owner token",
  );
  const [cleanup, hostLease] = await Promise.all([
    JSON.parse(await readFile(path.resolve(cleanupFile), "utf8")),
    JSON.parse(await readFile(path.resolve(hostLeaseFile), "utf8")),
  ]);
  await writeControllerFinalization(path.resolve(runDir), {
    cleanup,
    hostLease,
    trustedOwnerToken,
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
