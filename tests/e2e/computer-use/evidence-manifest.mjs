#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath, writeFile } from "node:fs/promises";
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

async function assertCanonicalRunRoot(runDir) {
  requireNonEmpty(runDir, "evidence run root");
  if (!path.isAbsolute(runDir) || path.normalize(runDir) !== runDir) {
    throw new Error("evidence run root must be an absolute normalized path");
  }
  const stats = await lstat(runDir);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("evidence run root must be a direct directory, not a symlink");
  }
  const canonical = await realpath(runDir);
  if (canonical !== runDir) {
    throw new Error(
      `evidence run root and every ancestor must be canonical without symlinks: ${runDir}`,
    );
  }
  return runDir;
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
    if ((await realpath(directory)) !== directory) {
      throw new Error(`evidence directory must be canonical without symlinks: ${directory}`);
    }
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

function requireCanonicalAbsolutePath(value, label) {
  requireNonEmpty(value, label);
  if (!path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new Error(`${label} must be an absolute normalized path`);
  }
  return value;
}

function requireFinalCleanup(cleanup, { identity, artifact }) {
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
  const ownershipMode =
    identity.runnerBackend === "static_ssh" ? "controller-static" : "local-ephemeral";
  if (cleanup.ownershipMode !== ownershipMode) {
    throw new Error(`cleanup sidecar ownershipMode must be ${ownershipMode}`);
  }
  const startedAt = Date.parse(cleanup.startedAt);
  const completedAt = Date.parse(cleanup.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    throw new Error("cleanup sidecar timestamps are invalid");
  }
  const expectedPaths =
    ownershipMode === "local-ephemeral"
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
  if (!Array.isArray(cleanup.ownedPaths) || cleanup.ownedPaths.length !== expectedPaths.size) {
    throw new Error("cleanup sidecar must contain every exact owned path");
  }
  const seenPaths = new Set();
  for (const ownedPath of cleanup.ownedPaths) {
    if (
      !ownedPath ||
      expectedPaths.get(ownedPath.kind) !== ownedPath.path ||
      ownedPath.expectedFinalState !== "absent" ||
      ownedPath.observedFinalState !== "absent"
    ) {
      throw new Error("cleanup sidecar owned path does not prove exact absence");
    }
    requireCanonicalAbsolutePath(ownedPath.path, "cleanup owned path");
    if (seenPaths.has(ownedPath.kind)) throw new Error("cleanup sidecar owned path is duplicated");
    seenPaths.add(ownedPath.kind);
  }
  if (!Array.isArray(cleanup.processInstances) || cleanup.processInstances.length !== 2) {
    throw new Error("cleanup sidecar must contain exact target and daemon process instances");
  }
  const roles = new Set();
  for (const processInstance of cleanup.processInstances) {
    if (
      !["target", "daemon"].includes(processInstance?.role) ||
      !["owned", "not_started"].includes(processInstance?.status) ||
      processInstance.terminated !== true
    ) {
      throw new Error("cleanup sidecar process instance is incomplete or not terminated");
    }
    if (processInstance.status === "owned") {
      if (
        !Number.isSafeInteger(processInstance.pid) ||
        processInstance.pid <= 0 ||
        typeof processInstance.birthMarker !== "string" ||
        processInstance.birthMarker === ""
      ) {
        throw new Error("cleanup sidecar owned process identity is incomplete");
      }
      requireCanonicalAbsolutePath(processInstance.executable, "cleanup process executable");
      if (
        processInstance.role === "target" &&
        !processInstance.executable.startsWith(`${artifact.appBundlePath}${path.sep}`)
      ) {
        throw new Error("cleanup target executable is outside the staged app bundle");
      }
    } else if (
      processInstance.pid !== null ||
      processInstance.birthMarker !== null ||
      processInstance.executable !== null
    ) {
      throw new Error("cleanup not_started process must not fabricate an identity");
    }
    if (roles.has(processInstance.role)) throw new Error("cleanup sidecar process role duplicated");
    roles.add(processInstance.role);
  }
  if (!roles.has("target") || !roles.has("daemon")) {
    throw new Error("cleanup sidecar must contain target and daemon process roles");
  }
  for (const field of [
    "driverCloseAttempted",
    "driverClosed",
    "ownershipMatched",
    "pathsProbed",
    "processesProbed",
  ]) {
    if (cleanup.lifecycle?.[field] !== true) {
      throw new Error(`cleanup sidecar lifecycle.${field} must be true`);
    }
  }
}

function requireReleasedLease(hostLease, { identity, attempt }) {
  requireVersionOne(hostLease, "host lease sidecar");
  const acquiredAt = Date.parse(hostLease.acquiredAt);
  const releasedAt = Date.parse(hostLease.releasedAt);
  const heartbeatAt = Date.parse(hostLease.lastHeartbeatAt);
  const acquiredOwnerTokenHash = hostLease.acquiredOwnerTokenHash || "";
  const releasedOwnerTokenHash = hostLease.releasedOwnerTokenHash || "";
  if (
    !/^[0-9a-f]{64}$/.test(acquiredOwnerTokenHash) ||
    acquiredOwnerTokenHash === "0".repeat(64) ||
    acquiredOwnerTokenHash !== releasedOwnerTokenHash ||
    hostLease.acquired !== true ||
    hostLease.released !== true ||
    hostLease.repo !== identity.repo ||
    hostLease.jobId !== identity.jobId ||
    hostLease.attempt !== attempt.number ||
    hostLease.host !== identity.runnerName ||
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

function requireControllerCleanupProbe(cleanupProbe, { cleanup, identity, attempt }) {
  requireVersionOne(cleanupProbe, "controller cleanup probe sidecar");
  const cleanupDigest = createHash("sha256").update(JSON.stringify(cleanup)).digest("hex");
  if (
    cleanupProbe.generatedBy !== "controller" ||
    cleanupProbe.repo !== identity.repo ||
    cleanupProbe.jobId !== identity.jobId ||
    cleanupProbe.attempt !== attempt.number ||
    cleanupProbe.host !== identity.runnerName ||
    cleanupProbe.cleanupDigest !== cleanupDigest ||
    !/^[0-9a-f]{64}$/.test(cleanupProbe.ownerTokenHmac || "") ||
    cleanupProbe.ownerTokenHmac === "0".repeat(64)
  ) {
    throw new Error("controller cleanup probe sidecar is not bound to cleanup and run identity");
  }
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

function requireFinalAttemptLifecycle(attempt) {
  const lifecycle = requireObject(attempt.lifecycle, "attempt lifecycle");
  if (!Array.isArray(lifecycle.history) || lifecycle.history.length < 2) {
    throw new Error("attempt lifecycle history is incomplete");
  }
  let previousState = null;
  let previousAt = -Infinity;
  for (const [index, transition] of lifecycle.history.entries()) {
    if (!transition || !Object.hasOwn(ATTEMPT_TRANSITIONS, transition.state)) {
      throw new Error(`attempt lifecycle transition ${index} has an invalid state`);
    }
    const timestamp = Date.parse(transition.at);
    if (!Number.isFinite(timestamp) || timestamp < previousAt) {
      throw new Error("attempt lifecycle transition timestamps are invalid or nonmonotonic");
    }
    if (previousState === null) {
      if (transition.state !== "PROVISIONING") {
        throw new Error("attempt lifecycle must begin at PROVISIONING");
      }
    } else if (!ATTEMPT_TRANSITIONS[previousState].has(transition.state)) {
      throw new Error(
        `illegal attempt lifecycle transition ${previousState} -> ${transition.state}`,
      );
    }
    previousState = transition.state;
    previousAt = timestamp;
  }
  if (lifecycle.current !== previousState) {
    throw new Error("attempt lifecycle current state does not match transition history");
  }
  const expectedTerminal =
    attempt.verdict === "pass" ? "SUCCEEDED" : attempt.verdict === "fail" ? "FAILED" : "ABORTED";
  if (lifecycle.current !== expectedTerminal) {
    throw new Error(
      `attempt lifecycle terminal state ${lifecycle.current} does not match verdict ${attempt.verdict}`,
    );
  }
  const states = lifecycle.history.map((transition) => transition.state);
  if (expectedTerminal !== "ABORTED") {
    const expectedPrefix = ["PROVISIONING", "READY", "RUNNING", "UPLOADING", "VERIFYING"];
    if (JSON.stringify(states.slice(0, -1)) !== JSON.stringify(expectedPrefix)) {
      throw new Error("completed attempt lifecycle is missing a required state transition");
    }
  }
  return lifecycle;
}

function validateSafeFrameEvidence(state, paths, attempt) {
  requireObject(state, "state");
  requireObject(attempt.capture, "attempt capture");
  const capture = attempt.capture;
  if (
    !["available", "not_started", "not_available"].includes(capture.status) ||
    typeof capture.uiStarted !== "boolean" ||
    typeof capture.reason !== "string"
  ) {
    throw new Error("attempt capture lifecycle is invalid");
  }
  const visualPaths = paths.filter(
    (relativePath) =>
      relativePath.startsWith("screenshots/") ||
      relativePath.startsWith("video/") ||
      /\.(?:png|jpe?g|gif|webp|heic|tiff?|bmp|mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i.test(
        relativePath,
      ),
  );
  const lifecycleStates = Array.isArray(attempt.lifecycle?.history)
    ? attempt.lifecycle.history.map((transition) => transition.state)
    : [];
  if (capture.uiStarted === false) {
    if (
      !["not_started", "not_available"].includes(capture.status) ||
      capture.reason.trim() === "" ||
      lifecycleStates.includes("RUNNING")
    ) {
      throw new Error(
        "pre-UI evidence requires an explicit unavailable capture reason and lifecycle proof",
      );
    }
    if (visualPaths.length !== 0 || !Array.isArray(state.screenshots) || state.screenshots.length) {
      throw new Error("pre-UI evidence must retain zero visual files and zero screenshots");
    }
    if (
      !state.video ||
      !["not_started", "not_available"].includes(state.video.status) ||
      Object.hasOwn(state.video, "path")
    ) {
      throw new Error("pre-UI state video must explicitly be not_started or not_available");
    }
  } else {
    if (
      capture.status !== "available" ||
      capture.reason !== "" ||
      !lifecycleStates.includes("RUNNING")
    ) {
      throw new Error("UI-started evidence must declare available capture lifecycle");
    }
    assertCuratedSafeFrameVideoMetadata(state.video);
    if (!paths.includes(safeFrameVideoPath)) {
      throw new Error(`curated safe-frame video is missing: ${safeFrameVideoPath}`);
    }
    if (!Array.isArray(state.screenshots) || state.screenshots.length === 0) {
      throw new Error("state screenshots must contain retained safe evidence");
    }
  }
  for (const [field, prefix] of [
    ...(capture.uiStarted ? [["screenshots", "screenshots/"]] : []),
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
      const expectedExtension = field === "screenshots" ? ".png" : ".txt";
      if (path.extname(artifactPath).toLowerCase() !== expectedExtension) {
        throw new Error(`state ${field} evidence must use ${expectedExtension}: ${artifactPath}`);
      }
      if (seen.has(artifactPath)) {
        throw new Error(`state ${field} contains duplicate evidence path: ${artifactPath}`);
      }
      seen.add(artifactPath);
    }
  }
  if (capture.uiStarted) {
    const referencedScreenshots = new Set(
      state.screenshots.map((artifact) => validateRelativePath(artifact.path)),
    );
    const retainedImages = paths.filter((relativePath) =>
      /\.(?:png|jpe?g|gif|webp|heic|tiff?|bmp)$/i.test(relativePath),
    );
    const unreferencedImages = retainedImages.filter(
      (relativePath) => !referencedScreenshots.has(relativePath),
    );
    if (unreferencedImages.length > 0) {
      throw new Error(
        `unreferenced visual files are forbidden in sealed evidence: ${unreferencedImages.join(", ")}`,
      );
    }
  } else if (
    state.textSnapshots.length !== 1 ||
    state.textSnapshots[0]?.path !== "texts/pre-ui-blocker.txt"
  ) {
    throw new Error("pre-UI evidence may retain only texts/pre-ui-blocker.txt");
  }
  const extraVideoDirectoryFiles = paths.filter(
    (relativePath) => relativePath.startsWith("video/") && relativePath !== safeFrameVideoPath,
  );
  if (extraVideoDirectoryFiles.length > 0) {
    throw new Error(
      `video directory may contain only ${safeFrameVideoPath}: ${extraVideoDirectoryFiles.join(", ")}`,
    );
  }
  const nonCuratedVideos = paths.filter(
    (relativePath) =>
      /\.(?:mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i.test(relativePath) &&
      relativePath !== safeFrameVideoPath,
  );
  if (nonCuratedVideos.length > 0) {
    throw new Error(
      `forbidden video artifact; only curated safe-frame video may be retained: ${nonCuratedVideos.join(", ")}`,
    );
  }
  const allowedPaths = new Set(REQUIRED_FIXED_PATHS);
  for (const artifact of state.textSnapshots) allowedPaths.add(artifact.path);
  if (capture.uiStarted) {
    for (const artifact of state.screenshots) allowedPaths.add(artifact.path);
    allowedPaths.add(safeFrameVideoPath);
  }
  if (paths.includes("runner/host-lease.json")) {
    allowedPaths.add("runner/host-lease.json");
  }
  if (paths.includes("runner/cleanup-probe.json")) {
    allowedPaths.add("runner/cleanup-probe.json");
  }
  const forbiddenPaths = paths.filter((relativePath) => !allowedPaths.has(relativePath));
  if (forbiddenPaths.length > 0) {
    throw new Error(
      `evidence tree contains files outside the explicit allowlist: ${forbiddenPaths.join(", ")}`,
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
    ["artifact.appArtifactSha", artifact.appArtifactSha],
    ["artifact.stagingParent", artifact.stagingParent],
    ["artifact.appBundlePath", artifact.appBundlePath],
    ["artifact.appBundleDigest", artifact.appBundleDigest],
    ["artifact.disposableConfigPath", artifact.disposableConfigPath],
    ["artifact.daemonSocketDirectory", artifact.daemonSocketDirectory],
    ["artifact.daemonSocketPath", artifact.daemonSocketPath],
    ["attempt.jobId", attempt.jobId],
    ["attempt.actionsRunId", attempt.actionsRunId],
    ["attempt.actionsJobId", attempt.actionsJobId],
    ["attempt.startedAt", attempt.startedAt],
    ["attempt.endedAt", attempt.endedAt],
    ["attempt.failureClass", attempt.failureClass],
    ["attempt.evidencePrefix", attempt.evidencePrefix],
  ]) {
    requireNonEmpty(value, field);
  }
  if (
    !/^[0-9a-f]{40}$/.test(identity.mergeSha) ||
    artifact.appArtifactSha !== identity.mergeSha ||
    !/^[0-9a-f]{40}$/.test(identity.harnessSha) ||
    !/^sha256:[0-9a-f]{64}$/.test(identity.runnerImageDigest) ||
    !/^sha256:[0-9a-f]{64}$/.test(artifact.artifactDigest) ||
    !/^[0-9a-f]{64}$/.test(artifact.appBundleDigest)
  ) {
    throw new Error("identity sidecars contain malformed immutable digests");
  }
  const canonicalJobId = `${identity.repo}:${identity.mergeSha}:${identity.suiteVersion}`;
  if (identity.jobId !== canonicalJobId) {
    throw new Error("runner identity jobId does not match canonical identity");
  }
  const expectedEvidencePrefix = `computer-use-e2e/jobs/${encodeURIComponent(identity.jobId)}/attempt-${attempt.number}/`;
  if (attempt.evidencePrefix !== expectedEvidencePrefix) {
    throw new Error("attempt evidencePrefix does not match canonical identity");
  }
  const startedAt = Date.parse(attempt.startedAt);
  const endedAt = Date.parse(attempt.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    throw new Error("attempt lifecycle timestamps are invalid");
  }
  const permissionsGranted =
    permissions.status === "granted" &&
    permissions.accessibilityGranted === true &&
    permissions.screenRecordingGranted === true &&
    permissions.reason === "" &&
    Number.isFinite(Date.parse(permissions.probedAt));
  const permissionsDenied =
    permissions.status === "denied" &&
    typeof permissions.accessibilityGranted === "boolean" &&
    typeof permissions.screenRecordingGranted === "boolean" &&
    (!permissions.accessibilityGranted || !permissions.screenRecordingGranted) &&
    typeof permissions.reason === "string" &&
    permissions.reason.trim() !== "" &&
    Number.isFinite(Date.parse(permissions.probedAt));
  const permissionsPending =
    permissions.status === "pending" &&
    permissions.accessibilityGranted === null &&
    permissions.screenRecordingGranted === null &&
    permissions.probedAt === null &&
    typeof permissions.reason === "string" &&
    permissions.reason.trim() !== "";
  if (!permissionsGranted && !permissionsDenied && !permissionsPending) {
    throw new Error("permission identity sidecar contains an invalid live-probe state");
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
  const expectedFailureClass =
    attempt.verdict === "pass" ? "none" : attempt.verdict === "fail" ? "product" : "infrastructure";
  if (attempt.failureClass !== expectedFailureClass) {
    throw new Error("attempt normalized failureClass is incomplete");
  }
  requireFinalAttemptLifecycle(attempt);
  const lifecycleStates = attempt.lifecycle.history.map((transition) => transition.state);
  if (permissionsGranted !== lifecycleStates.includes("READY")) {
    throw new Error("permission probe status does not match the READY lifecycle transition");
  }
  if (attempt.lifecycle.current !== "ABORTED" && !permissionsGranted) {
    throw new Error("a completed UI attempt requires granted Accessibility and Screen Recording");
  }
  if (attempt.capture?.uiStarted === true && !permissionsGranted) {
    throw new Error("UI evidence is forbidden without granted Accessibility and Screen Recording");
  }
  if (state.verdict !== attempt.verdict) {
    throw new Error("state verdict does not match finalized attempt verdict");
  }
  requireFinalCleanup(cleanup, { identity, artifact });
  if (identity.captureMode !== "safe-frame") {
    throw new Error("CuaDriver captureMode must be safe-frame");
  }
  validateSafeFrameEvidence(state, paths, attempt);
  if (identity.runnerBackend === "static_ssh") {
    if (
      identity.finalizationMode !== "controller-finalize" ||
      !paths.includes("runner/host-lease.json") ||
      !paths.includes("runner/cleanup-probe.json")
    ) {
      throw new Error("static_ssh requires controller-finalize and runner/host-lease.json");
    }
    requireReleasedLease(await readRequiredJson(runDir, "runner/host-lease.json"), {
      identity,
      attempt,
    });
    requireControllerCleanupProbe(await readRequiredJson(runDir, "runner/cleanup-probe.json"), {
      cleanup,
      identity,
      attempt,
    });
  } else {
    if (identity.finalizationMode !== "local-finalize") {
      throw new Error("non-static runner requires local-finalize");
    }
    if (paths.includes("runner/host-lease.json") || paths.includes("runner/cleanup-probe.json")) {
      throw new Error("local-finalize evidence forbids controller lease/probe sidecars");
    }
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
      lifecycle: attempt.lifecycle,
    },
    harness: { sha: identity.harnessSha },
    app: {
      artifactSha: artifact.appArtifactSha,
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

export async function createEvidenceManifest(runDir, options = {}) {
  if (!options || typeof options !== "object" || Object.keys(options).length !== 0) {
    throw new Error(
      "createEvidenceManifest accepts no path-selection options; it always binds the full evidence tree",
    );
  }
  const absoluteRunDir = await assertCanonicalRunRoot(runDir);
  const paths = await listEvidenceFiles(absoluteRunDir);
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
  const absoluteRunDir = await assertCanonicalRunRoot(runDir);
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
