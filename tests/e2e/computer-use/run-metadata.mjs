#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { withEvidenceTreeMutation } from "./evidence-guard.mjs";
import { escapeReportHtml, finalCleanupAttestationHtml } from "./report.mjs";

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
  "daemonSocketDirectory",
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
  requireAbsoluteNormalizedPath(input.disposableConfigPath, "disposableConfigPath");
  const configRelative = path.relative(input.stagingParent, input.disposableConfigPath);
  if (configRelative === "" || configRelative.startsWith("..") || path.isAbsolute(configRelative)) {
    throw new Error("disposableConfigPath must be uniquely owned beneath stagingParent");
  }
  requireAbsoluteNormalizedPath(input.daemonSocketDirectory, "daemonSocketDirectory");
  requireAbsoluteNormalizedPath(input.daemonSocketPath, "daemonSocketPath");
  if (
    input.daemonSocketDirectory === path.parse(input.daemonSocketDirectory).root ||
    path.dirname(input.daemonSocketPath) !== input.daemonSocketDirectory ||
    input.daemonSocketDirectory === input.stagingParent ||
    !path.basename(input.daemonSocketDirectory).startsWith("nx-cua-")
  ) {
    throw new Error(
      "daemon socket must use a separate uniquely owned nx-cua system-temp directory",
    );
  }
  if (Buffer.byteLength(input.daemonSocketPath, "utf8") > 103) {
    throw new Error("daemonSocketPath exceeds the Unix socket 103-byte limit");
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

async function writeJsonAtomic(runDir, filePath, value) {
  await withEvidenceTreeMutation(runDir, async () => {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  });
}

async function writeTextAtomic(runDir, filePath, value) {
  await withEvidenceTreeMutation(runDir, async () => {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporaryPath, value, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, filePath);
  });
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

function preflightSidecars(input, { permissionsStatus = "granted" } = {}) {
  if (!["pending", "granted"].includes(permissionsStatus)) {
    throw new Error("initial permissions status must be pending or granted");
  }
  const permissionsGranted = permissionsStatus === "granted";
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
      status: permissionsStatus,
      accessibilityGranted: permissionsGranted ? input.accessibilityGranted : null,
      screenRecordingGranted: permissionsGranted ? input.screenRecordingGranted : null,
      probedAt: permissionsGranted ? input.startedAt : null,
      reason: permissionsGranted ? "" : "awaiting live CuaDriver permission probe",
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
      daemonSocketDirectory: input.daemonSocketDirectory,
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
        current: permissionsGranted ? "READY" : "PROVISIONING",
        history: permissionsGranted
          ? [
              { state: "PROVISIONING", at: input.startedAt },
              { state: "READY", at: input.startedAt },
            ]
          : [{ state: "PROVISIONING", at: input.startedAt }],
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
    daemonSocketDirectory: env.NIXMAC_E2E_DAEMON_SOCKET_DIRECTORY || "",
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
  const appArtifactSha = requireGitSha(env.NIXMAC_E2E_APP_ARTIFACT_SHA || "", "app artifact SHA");
  if (appArtifactSha !== mergeSha) {
    throw new Error("app artifact SHA does not match merge SHA");
  }
  const suppliedHarnessSha = requireGitSha(env.NIXMAC_E2E_HARNESS_SHA || "", "harnessSha");
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
  const startedAt = requireString(env.NIXMAC_E2E_ATTEMPT_STARTED_AT || "", "attempt startedAt");
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

export async function writeRunProvisioning(runDir, rawInput) {
  requireAbsoluteNormalizedPath(runDir, "runDir");
  return withEvidenceTreeMutation(runDir, () => writeRunProvisioningAdmitted(runDir, rawInput));
}

async function writeRunProvisioningAdmitted(runDir, rawInput) {
  const input = validatePreflightInput(rawInput);
  await assertPreflightSidecarsAbsent(runDir);
  const sidecars = preflightSidecars(input, { permissionsStatus: "pending" });
  for (const [relativePath, value] of Object.entries(sidecars)) {
    await writeJsonAtomic(runDir, path.join(runDir, relativePath), value);
  }
  return sidecars;
}

export async function recordRunPermissions(runDir, permissionProbe) {
  requireAbsoluteNormalizedPath(runDir, "runDir");
  return withEvidenceTreeMutation(runDir, () =>
    recordRunPermissionsAdmitted(runDir, permissionProbe),
  );
}

async function recordRunPermissionsAdmitted(
  runDir,
  {
    accessibilityGranted,
    screenRecordingGranted,
    reason = "",
    probedAt = new Date().toISOString(),
  },
) {
  if (typeof accessibilityGranted !== "boolean" || typeof screenRecordingGranted !== "boolean") {
    throw new Error("permission probe results must be boolean");
  }
  if (typeof reason !== "string") throw new Error("permission probe reason must be a string");
  requireIsoTimestamp(probedAt, "permission probe timestamp");
  const [identity, permissions, artifact, attempt] = await Promise.all([
    readJson(runDir, "runner/identity.json"),
    readJson(runDir, "runner/permissions.json"),
    readJson(runDir, "artifact/source.json"),
    readJson(runDir, "attempt.json"),
  ]);
  if (
    permissions.status !== "pending" ||
    permissions.accessibilityGranted !== null ||
    permissions.screenRecordingGranted !== null ||
    attempt.lifecycle?.current !== "PROVISIONING"
  ) {
    throw new Error("permission probe may only complete a pending PROVISIONING attempt");
  }
  const granted = accessibilityGranted && screenRecordingGranted;
  const nextPermissions = {
    version: 1,
    status: granted ? "granted" : "denied",
    accessibilityGranted,
    screenRecordingGranted,
    probedAt,
    reason: granted ? "" : requireString(reason, "denied permission reason"),
  };
  const nextAttempt = {
    ...attempt,
    lifecycle: granted
      ? transitionAttemptLifecycle(attempt.lifecycle, ["READY"], probedAt)
      : validateAttemptLifecycle(attempt.lifecycle),
  };
  if (granted) {
    validatePreflightInput(
      mergePreflightSidecars(identity, nextPermissions, artifact, nextAttempt),
    );
  }
  await writeJsonAtomic(runDir, path.join(runDir, "runner", "permissions.json"), nextPermissions);
  await writeJsonAtomic(runDir, path.join(runDir, "attempt.json"), nextAttempt);
  return Object.freeze({ permissions: nextPermissions, attempt: nextAttempt });
}

export async function transitionRunAttempt(runDir, state, options = {}) {
  requireAbsoluteNormalizedPath(runDir, "runDir");
  return withEvidenceTreeMutation(runDir, () =>
    transitionRunAttemptAdmitted(runDir, state, options),
  );
}

async function transitionRunAttemptAdmitted(runDir, state, { at = new Date().toISOString() } = {}) {
  requireIsoTimestamp(at, "attempt lifecycle transition timestamp");
  if (!Object.hasOwn(ATTEMPT_TRANSITIONS, state)) {
    throw new Error(`unknown attempt lifecycle state: ${state}`);
  }
  const attempt = await readJson(runDir, "attempt.json");
  const next = {
    ...attempt,
    lifecycle: transitionAttemptLifecycle(attempt.lifecycle, [state], at),
  };
  await writeJsonAtomic(runDir, path.join(runDir, "attempt.json"), next);
  return Object.freeze(next);
}

export async function writeRunPreflight(runDir, rawInput) {
  return withEvidenceTreeMutation(runDir, () => writeRunPreflightAdmitted(runDir, rawInput));
}

async function writeRunPreflightAdmitted(runDir, rawInput) {
  const input = validatePreflightInput(rawInput);
  await writeRunProvisioning(runDir, input);
  await recordRunPermissions(runDir, {
    accessibilityGranted: input.accessibilityGranted,
    screenRecordingGranted: input.screenRecordingGranted,
    probedAt: input.startedAt,
  });
  return {
    "runner/identity.json": await readJson(runDir, "runner/identity.json"),
    "runner/permissions.json": await readJson(runDir, "runner/permissions.json"),
    "artifact/source.json": await readJson(runDir, "artifact/source.json"),
    "attempt.json": await readJson(runDir, "attempt.json"),
  };
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
    daemonSocketDirectory: artifact.daemonSocketDirectory,
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

async function readAndValidateRunIdentity(
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
  if (
    permissions.status !== "granted" ||
    permissions.accessibilityGranted !== true ||
    permissions.screenRecordingGranted !== true ||
    permissions.reason !== "" ||
    !Number.isFinite(Date.parse(permissions.probedAt))
  ) {
    throw new Error("runner permission sidecar must prove a granted live permission probe");
  }
  const input = validatePreflightInput(
    mergePreflightSidecars(identity, permissions, artifact, attempt),
  );
  if (attempt.jobId !== identity.jobId) throw new Error("attempt jobId does not match identity");
  if (attempt.finalizationMode !== identity.finalizationMode) {
    throw new Error("attempt finalizationMode does not match identity");
  }
  const actualBundleDigest = await computeAppBundleDigest(input.appBundlePath);
  if (actualBundleDigest !== input.appBundleDigest) {
    throw new Error(
      `app bundle digest mismatch: expected ${input.appBundleDigest}, got ${actualBundleDigest}`,
    );
  }
  return { identity, permissions, artifact, attempt, input };
}

function validatedIdentityResult({ identity, permissions, artifact, attempt, input }) {
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

export async function assertRunPreflight(runDir, options = {}) {
  const result = await readAndValidateRunIdentity(runDir, options);
  const { attempt, input, permissions } = result;
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
    attempt.lifecycle?.current !== "READY" ||
    attempt.lifecycle?.history?.length !== 2 ||
    attempt.lifecycle.history[0]?.state !== "PROVISIONING" ||
    attempt.lifecycle.history[0]?.at !== input.startedAt ||
    attempt.lifecycle.history[1]?.state !== "READY" ||
    attempt.lifecycle.history[1]?.at !== permissions.probedAt ||
    Date.parse(attempt.lifecycle.history[1].at) < Date.parse(input.startedAt)
  ) {
    throw new Error("attempt sidecar must contain the complete preflight lifecycle identity");
  }
  return validatedIdentityResult(result);
}

export async function assertRunPostRunIdentity(runDir, options = {}) {
  const result = await readAndValidateRunIdentity(runDir, options);
  const { attempt, input, permissions } = result;
  if (
    attempt.status !== "preflight" ||
    attempt.finalized !== false ||
    attempt.verdict !== null ||
    attempt.endedAt !== null ||
    attempt.failureClass !== null ||
    JSON.stringify(attempt.capture) !==
      JSON.stringify({ status: "not_started", uiStarted: false, reason: "" }) ||
    attempt.startedAt !== input.startedAt ||
    attempt.evidencePrefix !== input.evidencePrefix
  ) {
    throw new Error("post-run identity must remain unfinalized before evidence finalization");
  }
  const lifecycle = validateAttemptLifecycle(attempt.lifecycle);
  const states = lifecycle.history.map((transition) => transition.state);
  const allowedStates = [
    ["PROVISIONING", "READY"],
    ["PROVISIONING", "READY", "RUNNING"],
    ["PROVISIONING", "READY", "RUNNING", "UPLOADING"],
  ];
  if (
    !allowedStates.some((allowed) => JSON.stringify(allowed) === JSON.stringify(states)) ||
    lifecycle.history[0]?.at !== input.startedAt ||
    lifecycle.history[1]?.at !== permissions.probedAt
  ) {
    throw new Error(
      "post-run identity lifecycle must be the exact READY, RUNNING, or UPLOADING progression",
    );
  }
  return validatedIdentityResult(result);
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
          ["daemon-socket-directory", artifact.daemonSocketDirectory],
          ["daemon-socket", artifact.daemonSocketPath],
        ])
      : new Map([
          ["remote-staging", artifact.stagingParent],
          ["app-bundle", artifact.appBundlePath],
          ["remote-config", artifact.disposableConfigPath],
          ["daemon-socket-directory", artifact.daemonSocketDirectory],
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
      requireString(processInstance.birthMarker, `cleanup ${processInstance.role} birthMarker`);
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
      throw new Error(`cleanup sidecar must prove ${ownedPath.kind} observedFinalState is absent`);
    }
  }
  for (const processInstance of cleanup.processInstances) {
    if (processInstance.terminated !== true) {
      throw new Error(`cleanup sidecar must prove ${processInstance.role} process is terminated`);
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

async function defaultPathExists(ownedPath) {
  try {
    await lstat(ownedPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function defaultProcessExists(processInstance) {
  try {
    process.kill(processInstance.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function independentlyProbeLocalCleanup(
  cleanup,
  { pathExists = defaultPathExists, processExists = defaultProcessExists } = {},
) {
  if (typeof pathExists !== "function" || typeof processExists !== "function") {
    throw new Error("local cleanup probes must be functions");
  }
  const pathExistence = await Promise.all(
    cleanup.ownedPaths.map((ownedPath) => pathExists(ownedPath.path)),
  );
  const processExistence = await Promise.all(
    cleanup.processInstances.map((processInstance) =>
      processInstance.status === "owned" ? processExists(processInstance) : false,
    ),
  );
  const ownedPaths = cleanup.ownedPaths.map((ownedPath, index) => ({
    ...ownedPath,
    observedFinalState: pathExistence[index] ? "present" : "absent",
  }));
  const processInstances = cleanup.processInstances.map((processInstance, index) => ({
    ...processInstance,
    terminated: !processExistence[index],
  }));
  const remainingProcesses = processInstances
    .filter((processInstance) => processInstance.terminated !== true)
    .map((processInstance) => ({
      role: processInstance.role,
      pid: processInstance.pid,
      birthMarker: processInstance.birthMarker,
      executable: processInstance.executable,
    }));
  const presentPaths = ownedPaths.filter((ownedPath) => ownedPath.observedFinalState !== "absent");
  const probed = {
    ...cleanup,
    clean: presentPaths.length === 0 && remainingProcesses.length === 0,
    ownedPaths,
    processInstances,
    remainingProcesses,
    failureReason:
      presentPaths.length > 0 || remainingProcesses.length > 0
        ? [
            ...presentPaths.map((ownedPath) => `path still exists: ${ownedPath.path}`),
            ...remainingProcesses.map(
              (processInstance) =>
                `process still exists: ${processInstance.role} pid=${processInstance.pid}`,
            ),
          ].join("; ")
        : "",
    lifecycle: {
      ...cleanup.lifecycle,
      pathsProbed: true,
      processesProbed: true,
    },
  };
  if (!probed.clean) {
    throw new Error(`live cleanup probe failed: ${probed.failureReason}`);
  }
  return probed;
}

const FINAL_LEASE_WAIT_REASONS = new Set(["", "live-owner-wait-completed"]);

function assertNoRawTrustedOwnerToken(
  value,
  trustedOwnerToken,
  label = "host lease",
  seen = new WeakSet(),
) {
  requireString(trustedOwnerToken, "trusted owner token");
  if (typeof value === "string") {
    if (value.includes(trustedOwnerToken)) {
      throw new Error(`raw owner token must not be stored in ${label} evidence`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new Error(`${label} evidence must not contain cyclic values`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoRawTrustedOwnerToken(item, trustedOwnerToken, label, seen);
    }
  } else {
    for (const [field, item] of Object.entries(value)) {
      assertNoRawTrustedOwnerToken(item, trustedOwnerToken, `${label}.${field}`, seen);
    }
  }
  seen.delete(value);
}

function validateHostLease(hostLease, { identity, attempt, trustedOwnerToken }) {
  if (!hostLease || typeof hostLease !== "object" || Array.isArray(hostLease)) {
    throw new Error("host lease must be an object");
  }
  assertNoRawTrustedOwnerToken(hostLease, trustedOwnerToken);
  const allowedFields = new Set([
    "version",
    "acquired",
    "released",
    "repo",
    "jobId",
    "attempt",
    "host",
    "acquiredOwnerTokenHash",
    "releasedOwnerTokenHash",
    "acquiredAt",
    "releasedAt",
    "lastHeartbeatAt",
    "waitReason",
    "quarantineReason",
  ]);
  for (const field of Object.keys(hostLease)) {
    if (allowedFields.has(field)) continue;
    const normalizedField = field.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedField.includes("token")) {
      throw new Error("raw owner token must not be stored in host lease evidence");
    }
    throw new Error(`host lease contains unexpected field: ${field}`);
  }
  if (hostLease.version !== undefined && hostLease.version !== 1) {
    throw new Error("host lease version must be 1 when provided");
  }
  if (hostLease.acquired !== true || hostLease.released !== true) {
    throw new Error("static host lease must explicitly prove acquired and released");
  }
  for (const [field, expected] of [
    ["repo", identity.repo],
    ["jobId", identity.jobId],
    ["attempt", attempt.number],
    ["host", identity.runnerName],
  ]) {
    if (hostLease[field] !== expected) {
      throw new Error(`static host lease ${field} does not match the bound run identity`);
    }
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
  if (acquiredOwnerTokenHash === "0".repeat(64) || releasedOwnerTokenHash === "0".repeat(64)) {
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
  if (!FINAL_LEASE_WAIT_REASONS.has(hostLease.waitReason)) {
    throw new Error(
      `hostLease.waitReason must be one of: ${[...FINAL_LEASE_WAIT_REASONS]
        .map((value) => value || "<none>")
        .join(", ")}`,
    );
  }
  if (hostLease.quarantineReason !== "") {
    throw new Error("hostLease.quarantineReason must be the final-pass <none> enum");
  }
  const acquiredAt = Date.parse(hostLease.acquiredAt);
  const releasedAt = Date.parse(hostLease.releasedAt);
  const heartbeatAt = Date.parse(hostLease.lastHeartbeatAt);
  if (releasedAt < acquiredAt || heartbeatAt < acquiredAt || heartbeatAt > releasedAt) {
    throw new Error("static host lease timestamps are not monotonic");
  }
  const normalizedLease = { ...hostLease };
  delete normalizedLease.version;
  return { version: 1, ...normalizedLease };
}

function cleanupObservationDigest(cleanup) {
  return createHash("sha256").update(JSON.stringify(cleanup)).digest("hex");
}

function controllerProbeBinding({ cleanupDigest, repo, jobId, attempt, host }) {
  return JSON.stringify({
    version: 1,
    repo,
    jobId,
    attempt,
    host,
    cleanupDigest,
  });
}

export function createControllerCleanupProbe({
  cleanup,
  repo,
  jobId,
  attempt,
  host,
  trustedOwnerToken,
}) {
  requireString(repo, "controller cleanup probe repo");
  requireString(jobId, "controller cleanup probe jobId");
  requirePositiveInteger(attempt, "controller cleanup probe attempt");
  requireString(host, "controller cleanup probe host");
  requireString(trustedOwnerToken, "controller cleanup probe trusted owner token");
  const cleanupDigest = cleanupObservationDigest(cleanup);
  const binding = controllerProbeBinding({ cleanupDigest, repo, jobId, attempt, host });
  return {
    version: 1,
    generatedBy: "controller",
    repo,
    jobId,
    attempt,
    host,
    cleanupDigest,
    ownerTokenHmac: createHmac("sha256", trustedOwnerToken).update(binding).digest("hex"),
  };
}

function validateControllerCleanupProbe(
  cleanupProbe,
  { cleanup, identity, attempt, trustedOwnerToken },
) {
  if (!cleanupProbe || typeof cleanupProbe !== "object" || Array.isArray(cleanupProbe)) {
    throw new Error("controller cleanup probe attestation is required");
  }
  const expected = createControllerCleanupProbe({
    cleanup,
    repo: identity.repo,
    jobId: identity.jobId,
    attempt: attempt.number,
    host: identity.runnerName,
    trustedOwnerToken,
  });
  if (
    cleanupProbe.version !== 1 ||
    cleanupProbe.generatedBy !== "controller" ||
    JSON.stringify(cleanupProbe) !== JSON.stringify(expected)
  ) {
    throw new Error("controller cleanup probe attestation does not match trusted observations");
  }
  return expected;
}

function failureClassForVerdict(verdict) {
  return verdict === "pass" ? "none" : verdict === "fail" ? "product" : "infrastructure";
}

const ATTEMPT_TRANSITIONS = Object.freeze({
  PROVISIONING: new Set(["READY", "ABORTED"]),
  READY: new Set(["RUNNING", "ABORTED"]),
  RUNNING: new Set(["UPLOADING", "ABORTED"]),
  UPLOADING: new Set(["VERIFYING", "ABORTED"]),
  VERIFYING: new Set(["SUCCEEDED", "FAILED", "ABORTED"]),
  SUCCEEDED: new Set(),
  FAILED: new Set(),
  ABORTED: new Set(),
});

function validateAttemptLifecycle(lifecycle) {
  if (
    !lifecycle ||
    typeof lifecycle !== "object" ||
    !Array.isArray(lifecycle.history) ||
    lifecycle.history.length === 0
  ) {
    throw new Error("attempt lifecycle history is required");
  }
  let previous = null;
  let previousAt = -Infinity;
  for (const [index, transition] of lifecycle.history.entries()) {
    if (!transition || !Object.hasOwn(ATTEMPT_TRANSITIONS, transition.state)) {
      throw new Error(`attempt lifecycle transition ${index} has an invalid state`);
    }
    requireIsoTimestamp(transition.at, `attempt lifecycle transition ${index} timestamp`);
    const timestamp = Date.parse(transition.at);
    if (timestamp < previousAt) {
      throw new Error("attempt lifecycle transition timestamps must be monotonic");
    }
    if (previous === null) {
      if (transition.state !== "PROVISIONING") {
        throw new Error("attempt lifecycle must begin at PROVISIONING");
      }
    } else if (!ATTEMPT_TRANSITIONS[previous].has(transition.state)) {
      throw new Error(`illegal attempt lifecycle transition ${previous} -> ${transition.state}`);
    }
    previous = transition.state;
    previousAt = timestamp;
  }
  if (lifecycle.current !== previous) {
    throw new Error("attempt lifecycle current state must match its final history transition");
  }
  return {
    current: lifecycle.current,
    history: lifecycle.history.map((transition) => ({ ...transition })),
  };
}

function transitionAttemptLifecycle(lifecycle, states, at = new Date().toISOString()) {
  const normalized = validateAttemptLifecycle(lifecycle);
  for (const state of states) {
    const current = normalized.current;
    if (!ATTEMPT_TRANSITIONS[current]?.has(state)) {
      throw new Error(`illegal attempt lifecycle transition ${current} -> ${state}`);
    }
    const previousAt = normalized.history.at(-1).at;
    const transitionAt = Date.parse(at) >= Date.parse(previousAt) ? at : previousAt;
    normalized.history.push({ state, at: transitionAt });
    normalized.current = state;
  }
  return normalized;
}

function terminalStateForVerdict(verdict) {
  return verdict === "pass" ? "SUCCEEDED" : verdict === "fail" ? "FAILED" : "ABORTED";
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

function cleanupStateForReport(cleanup) {
  const controllerOwned = cleanup.ownershipMode === "controller-static";
  return {
    ...structuredClone(cleanup),
    note: controllerOwned
      ? "Controller cleanup attestation: owner-matched host release is clean; exact owned paths are absent and owned processes are terminated."
      : "Local cleanup attestation: exact run-owned paths are absent and owned processes are terminated.",
  };
}

async function writeFinalCleanupArtifacts(runDir, cleanup) {
  const state = await readJson(runDir, "state.json");
  const previousCleanupNote = typeof state.cleanup?.note === "string" ? state.cleanup.note : "";
  state.cleanup = cleanupStateForReport(cleanup);
  await writeJsonAtomic(runDir, path.join(runDir, "state.json"), state);

  const reportPath = path.join(runDir, "index.html");
  const report = await readFile(reportPath, "utf8");
  const marker = '<section id="final-cleanup-attestation"';
  if (report.includes(marker)) {
    throw new Error("final cleanup report attestation already exists");
  }
  const attestation = finalCleanupAttestationHtml(state.cleanup);
  let updatedReport = previousCleanupNote
    ? report.replaceAll(escapeReportHtml(previousCleanupNote), escapeReportHtml(state.cleanup.note))
    : report;
  const cleanupNoteIndex = updatedReport.indexOf(escapeReportHtml(state.cleanup.note));
  const signalStart =
    cleanupNoteIndex === -1
      ? -1
      : updatedReport.lastIndexOf('<div class="signal signal-', cleanupNoteIndex);
  const signalEnd = signalStart === -1 ? -1 : updatedReport.indexOf("</div>", cleanupNoteIndex);
  if (
    signalStart !== -1 &&
    signalEnd !== -1 &&
    updatedReport.slice(signalStart, signalEnd).includes("<strong>Remote restore</strong>")
  ) {
    const replacement = `<div class="signal signal-pass"><span class="verdict pass">pass</span><strong>Remote restore</strong><small>${escapeReportHtml(state.cleanup.note)}</small></div>`;
    updatedReport =
      updatedReport.slice(0, signalStart) +
      replacement +
      updatedReport.slice(signalEnd + "</div>".length);
  }
  const insertionPoint = report.includes("</body>")
    ? "</body>"
    : report.includes("</html>")
      ? "</html>"
      : "";
  const nextReport = insertionPoint
    ? updatedReport.replace(insertionPoint, `${attestation}\n${insertionPoint}`)
    : `${updatedReport}\n${attestation}\n`;
  await writeTextAtomic(runDir, reportPath, nextReport);
}

async function finalizeAttempt(
  runDir,
  { status, finalized, verdict, completeLifecycle = false, capture },
) {
  const attempt = await readJson(runDir, "attempt.json");
  const normalizedVerdict = validateVerdict(verdict);
  const normalizedCapture = resolveFinalCapture(attempt, capture);
  let lifecycle = validateAttemptLifecycle(attempt.lifecycle);
  if (completeLifecycle) {
    if (normalizedCapture.uiStarted) {
      if (lifecycle.current === "READY") {
        lifecycle = transitionAttemptLifecycle(lifecycle, ["RUNNING"]);
      }
      if (lifecycle.current === "RUNNING") {
        lifecycle = transitionAttemptLifecycle(lifecycle, ["UPLOADING"]);
      }
      if (lifecycle.current === "UPLOADING") {
        lifecycle = transitionAttemptLifecycle(lifecycle, ["VERIFYING"]);
      }
      lifecycle = transitionAttemptLifecycle(lifecycle, [
        terminalStateForVerdict(normalizedVerdict),
      ]);
    } else {
      lifecycle = transitionAttemptLifecycle(lifecycle, ["ABORTED"]);
    }
  } else if (normalizedCapture.uiStarted) {
    if (lifecycle.current === "READY") {
      lifecycle = transitionAttemptLifecycle(lifecycle, ["RUNNING"]);
    }
    if (lifecycle.current === "RUNNING") {
      lifecycle = transitionAttemptLifecycle(lifecycle, ["UPLOADING"]);
    }
  }
  const next = {
    ...attempt,
    status,
    finalized,
    verdict: normalizedVerdict,
    failureClass: failureClassForVerdict(normalizedVerdict),
    endedAt: completeLifecycle ? new Date().toISOString() : null,
    capture: normalizedCapture,
    lifecycle,
  };
  await writeJsonAtomic(runDir, path.join(runDir, "attempt.json"), next);
  return next;
}

export async function stageControllerEvidence(runDir, options) {
  return withEvidenceTreeMutation(runDir, () => stageControllerEvidenceAdmitted(runDir, options));
}

async function stageControllerEvidenceAdmitted(
  runDir,
  { verdict, capture = { status: "available", uiStarted: true, reason: "" } },
) {
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

async function sealEvidence(runDir, { trustedOwnerToken = "" } = {}) {
  const { createEvidenceManifest, verifyEvidenceManifest } =
    await import("./evidence-manifest.mjs");
  const options = trustedOwnerToken ? { trustedOwnerToken } : {};
  const manifest = await createEvidenceManifest(runDir, options);
  await verifyEvidenceManifest(runDir, options);
  return manifest;
}

export async function finalizeLocalEvidence(runDir, options, probes = {}) {
  await withEvidenceTreeMutation(runDir, () =>
    finalizeLocalEvidenceAdmitted(runDir, options, probes),
  );
  return sealEvidence(runDir);
}

async function finalizeLocalEvidenceAdmitted(
  runDir,
  { cleanup, verdict, capture = { status: "available", uiStarted: true, reason: "" } },
  probes = {},
) {
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
  const probedCleanup = await independentlyProbeLocalCleanup(normalizedCleanup, probes);
  assertCleanupClean(probedCleanup);
  const normalizedCapture = resolveFinalCapture(attempt, capture);
  await writeJsonAtomic(runDir, path.join(runDir, "runner", "cleanup.json"), probedCleanup);
  await writeFinalCleanupArtifacts(runDir, probedCleanup);
  await finalizeAttempt(runDir, {
    status: "final",
    finalized: true,
    verdict,
    completeLifecycle: true,
    capture: normalizedCapture,
  });
}

export async function writeRunCleanup(runDir, cleanup) {
  return withEvidenceTreeMutation(runDir, () => writeRunCleanupAdmitted(runDir, cleanup));
}

async function writeRunCleanupAdmitted(runDir, cleanup) {
  const [identity, artifact] = await Promise.all([
    readJson(runDir, "runner/identity.json"),
    readJson(runDir, "artifact/source.json"),
  ]);
  const normalizedCleanup = validateCleanup(cleanup, { identity, artifact });
  await writeJsonAtomic(runDir, path.join(runDir, "runner", "cleanup.json"), normalizedCleanup);
  return normalizedCleanup;
}

export async function finalizeControllerEvidence(
  runDir,
  { cleanup, cleanupProbe, hostLease, trustedOwnerToken, verdict, capture },
) {
  await writeControllerFinalization(runDir, {
    cleanup,
    cleanupProbe,
    hostLease,
    trustedOwnerToken,
    verdict,
    capture,
  });
  return sealEvidence(runDir, { trustedOwnerToken });
}

export async function writeControllerFinalization(runDir, options) {
  return withEvidenceTreeMutation(runDir, () =>
    writeControllerFinalizationAdmitted(runDir, options),
  );
}

async function writeControllerFinalizationAdmitted(
  runDir,
  { cleanup, cleanupProbe, hostLease, trustedOwnerToken, verdict, capture },
) {
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
  const normalizedLease = validateHostLease(hostLease, {
    identity,
    attempt,
    trustedOwnerToken,
  });
  const normalizedCleanupProbe = validateControllerCleanupProbe(cleanupProbe, {
    cleanup: normalizedCleanup,
    identity,
    attempt,
    trustedOwnerToken,
  });
  const normalizedCapture = resolveFinalCapture(attempt, capture);
  await writeJsonAtomic(runDir, path.join(runDir, "runner", "cleanup.json"), normalizedCleanup);
  await writeJsonAtomic(runDir, path.join(runDir, "runner", "host-lease.json"), normalizedLease);
  await writeJsonAtomic(
    runDir,
    path.join(runDir, "runner", "cleanup-probe.json"),
    normalizedCleanupProbe,
  );
  await writeFinalCleanupArtifacts(runDir, normalizedCleanup);
  await finalizeAttempt(runDir, {
    status: "final",
    finalized: true,
    verdict,
    completeLifecycle: true,
    capture: normalizedCapture,
  });
  return {
    cleanup: await readJson(runDir, "runner/cleanup.json"),
    cleanupProbe: await readJson(runDir, "runner/cleanup-probe.json"),
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
      "Usage: node tests/e2e/computer-use/run-metadata.mjs finalize-controller --run-dir <path> --cleanup-file <path> --cleanup-probe-file <path> --host-lease-file <path> --verdict <pass|fail|inconclusive>",
    );
    process.exitCode = 64;
    return;
  }
  const runDir = cliArg(args, "--run-dir");
  const cleanupFile = cliArg(args, "--cleanup-file");
  const cleanupProbeFile = cliArg(args, "--cleanup-probe-file");
  const hostLeaseFile = cliArg(args, "--host-lease-file");
  const verdict = cliArg(args, "--verdict");
  const trustedOwnerToken = process.env.NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN || "";
  if (!runDir || !cleanupFile || !cleanupProbeFile || !hostLeaseFile || !verdict) {
    throw new Error(
      "finalize-controller requires run, cleanup, cleanup-probe, host-lease, and verdict inputs",
    );
  }
  requireString(trustedOwnerToken, "NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN trusted owner token");
  const [cleanup, cleanupProbe, hostLease] = await Promise.all([
    JSON.parse(await readFile(path.resolve(cleanupFile), "utf8")),
    JSON.parse(await readFile(path.resolve(cleanupProbeFile), "utf8")),
    JSON.parse(await readFile(path.resolve(hostLeaseFile), "utf8")),
  ]);
  await writeControllerFinalization(path.resolve(runDir), {
    cleanup,
    cleanupProbe,
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
