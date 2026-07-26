#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  realpathSync,
} from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { withEvidenceTreeSeal } from "./evidence-guard.mjs";
import {
  assertCuratedSafeFrameVideoMetadata,
  finalCleanupAttestationHtml,
  finalResultAttestationHtml,
  safeFrameVideoPath,
} from "./report.mjs";
import { containsUnmaskedSecret } from "./redaction.mjs";
import {
  scenarioCatalogDigest,
  suiteContract,
  validateScenarioContract,
} from "./suite-contract.mjs";

const MANIFEST_PATH = "manifest.json";
const MAX_EVIDENCE_FILES = 512;
const MAX_EVIDENCE_ENTRIES = 1024;
const MAX_EVIDENCE_FILE_BYTES = 256 * 1024 * 1024;
const MAX_EVIDENCE_TOTAL_BYTES = 1024 * 1024 * 1024;
const EVIDENCE_SCAN_DEADLINE_SECONDS = 180;
const EVIDENCE_SCAN_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const FINAL_LEASE_WAIT_REASONS = new Set(["", "live-owner-wait-completed"]);
const HOST_LEASE_FIELDS = new Set([
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

function assertNoRawTrustedOwnerToken(value, trustedOwnerToken, seen = new WeakSet()) {
  requireNonEmpty(trustedOwnerToken, "trusted owner token for authenticated controller evidence");
  if (typeof value === "string") {
    if (value.includes(trustedOwnerToken)) {
      throw new Error("raw owner token must not be retained in authenticated controller evidence");
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) {
    throw new Error("authenticated controller evidence must not contain cyclic values");
  }
  seen.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    assertNoRawTrustedOwnerToken(item, trustedOwnerToken, seen);
  }
  seen.delete(value);
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

function fixedExecutable(candidates, label, configuredPath = "") {
  const canonicalExecutable = (candidate) => {
    try {
      const resolved = realpathSync(candidate);
      const stats = lstatSync(resolved);
      if (!stats.isFile() || stats.isSymbolicLink()) return "";
      accessSync(resolved, fsConstants.X_OK);
      return resolved;
    } catch {
      return "";
    }
  };
  if (configuredPath) {
    const resolved = canonicalExecutable(configuredPath);
    if (
      !path.isAbsolute(configuredPath) ||
      path.normalize(configuredPath) !== configuredPath ||
      !resolved
    ) {
      throw new Error(
        `${label} configured path must resolve to a direct executable from an absolute normalized path`,
      );
    }
    return resolved;
  }
  const executable = candidates.map(canonicalExecutable).find(Boolean);
  if (!executable) {
    throw new Error(`${label} is required for bounded evidence validation`);
  }
  return executable;
}

function runEvidenceScanner(scannerArgs) {
  const python = fixedExecutable(
    ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"],
    "python3",
    process.env.NIXMAC_E2E_PYTHON_PATH || "",
  );
  const ffmpeg = fixedExecutable(
    ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"],
    "ffmpeg",
    process.env.NIXMAC_E2E_FFMPEG_PATH || "",
  );
  const ffprobe = fixedExecutable(
    ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe"],
    "ffprobe",
    process.env.NIXMAC_E2E_FFPROBE_PATH || "",
  );
  const scannerPath = fileURLToPath(new URL("./evidence-scan.py", import.meta.url));
  const result = spawnSync(
    python,
    [
      scannerPath,
      ...scannerArgs,
      "--ffmpeg",
      ffmpeg,
      "--ffprobe",
      ffprobe,
      "--max-files",
      String(MAX_EVIDENCE_FILES),
      "--max-entries",
      String(MAX_EVIDENCE_ENTRIES),
      "--max-file-bytes",
      String(MAX_EVIDENCE_FILE_BYTES),
      "--max-total-bytes",
      String(MAX_EVIDENCE_TOTAL_BYTES),
      "--deadline-seconds",
      String(EVIDENCE_SCAN_DEADLINE_SECONDS),
    ],
    {
      encoding: "utf8",
      timeout: (EVIDENCE_SCAN_DEADLINE_SECONDS + 5) * 1000,
      maxBuffer: EVIDENCE_SCAN_MAX_OUTPUT_BYTES,
    },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.error?.message || "unknown scanner failure")
      .trim()
      .slice(0, 8192);
    throw new Error(`bounded descriptor-relative evidence scan failed: ${detail}`);
  }
  let scan;
  try {
    scan = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error("bounded evidence scanner returned invalid JSON", { cause: error });
  }
  if (
    !Array.isArray(scan.files) ||
    !scan.captured ||
    typeof scan.captured !== "object" ||
    scan.files.length !== scan.fileCount ||
    !Number.isSafeInteger(scan.totalBytes) ||
    scan.totalBytes <= 0
  ) {
    throw new Error("bounded evidence scanner returned an invalid result");
  }
  return scan;
}

function scanEvidenceTree(runDir, mode, { archiveOut = "" } = {}) {
  requireNonEmpty(runDir, "evidence run root");
  if (!path.isAbsolute(runDir) || path.normalize(runDir) !== runDir) {
    throw new Error("evidence run root must be an absolute normalized path");
  }
  if (
    archiveOut &&
    (mode !== "verify" ||
      !path.isAbsolute(archiveOut) ||
      path.normalize(archiveOut) !== archiveOut ||
      path.dirname(archiveOut) !== path.dirname(runDir) ||
      archiveOut.startsWith(`${runDir}${path.sep}`))
  ) {
    throw new Error("canonical archive must be an absolute normalized evidence-root sibling");
  }
  return runEvidenceScanner([
    "--run-dir",
    runDir,
    "--mode",
    mode,
    ...(archiveOut ? ["--archive-out", archiveOut] : []),
  ]);
}

function scanEvidenceArchive(archivePath) {
  requireNonEmpty(archivePath, "canonical evidence archive");
  if (!path.isAbsolute(archivePath) || path.normalize(archivePath) !== archivePath) {
    throw new Error("canonical evidence archive must be an absolute normalized path");
  }
  return runEvidenceScanner(["--mode", "archive-verify", "--archive", archivePath]);
}

function readRequiredJson(scan, relativePath) {
  const source = scan.captured[relativePath];
  if (typeof source !== "string") {
    throw new Error(`required evidence file is missing: ${relativePath}`);
  }
  if (source.trim() === "") throw new Error(`required evidence file is empty: ${relativePath}`);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`required evidence file is invalid JSON: ${relativePath}`, { cause: error });
  }
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

function requireStateCleanupMatches(state, cleanup) {
  const expectedNote =
    cleanup.ownershipMode === "controller-static"
      ? "Controller cleanup attestation: owner-matched host release is clean; exact owned paths are absent and owned processes are terminated."
      : "Local cleanup attestation: exact run-owned paths are absent and owned processes are terminated.";
  const expected = { ...cleanup, note: expectedNote };
  if (JSON.stringify(state.cleanup) !== JSON.stringify(expected)) {
    throw new Error("state cleanup does not match the trusted final cleanup sidecar");
  }
}

function requireReleasedLease(hostLease, { identity, attempt, trustedOwnerToken }) {
  requireVersionOne(hostLease, "host lease sidecar");
  assertNoRawTrustedOwnerToken(hostLease, trustedOwnerToken);
  if (
    Object.keys(hostLease).length !== HOST_LEASE_FIELDS.size ||
    Object.keys(hostLease).some((field) => !HOST_LEASE_FIELDS.has(field))
  ) {
    throw new Error("host lease sidecar must contain only the exact persisted lease schema");
  }
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
    !FINAL_LEASE_WAIT_REASONS.has(hostLease.waitReason) ||
    hostLease.quarantineReason !== ""
  ) {
    throw new Error("static host lease does not prove owner-matched release");
  }
  requireNonEmpty(trustedOwnerToken, "trusted owner token for authenticated controller evidence");
  const trustedOwnerTokenHash = createHash("sha256").update(trustedOwnerToken).digest("hex");
  if (acquiredOwnerTokenHash !== trustedOwnerTokenHash) {
    throw new Error("static host lease owner hash does not match the trusted owner token");
  }
}

function requireControllerCleanupProbe(
  cleanupProbe,
  { cleanup, identity, attempt, trustedOwnerToken },
) {
  requireVersionOne(cleanupProbe, "controller cleanup probe sidecar");
  const cleanupDigest = createHash("sha256").update(JSON.stringify(cleanup)).digest("hex");
  requireNonEmpty(trustedOwnerToken, "trusted owner token for authenticated controller evidence");
  const binding = JSON.stringify({
    version: 1,
    repo: identity.repo,
    jobId: identity.jobId,
    attempt: attempt.number,
    host: identity.runnerName,
    cleanupDigest,
  });
  const expectedOwnerTokenHmac = createHmac("sha256", trustedOwnerToken)
    .update(binding)
    .digest("hex");
  if (
    cleanupProbe.generatedBy !== "controller" ||
    cleanupProbe.repo !== identity.repo ||
    cleanupProbe.jobId !== identity.jobId ||
    cleanupProbe.attempt !== attempt.number ||
    cleanupProbe.host !== identity.runnerName ||
    cleanupProbe.cleanupDigest !== cleanupDigest ||
    cleanupProbe.ownerTokenHmac !== expectedOwnerTokenHmac
  ) {
    throw new Error(
      "controller cleanup probe sidecar is not authenticated by the trusted owner token",
    );
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

async function readManifestInputs(scan, paths, { trustedOwnerToken = "" } = {}) {
  for (const [relativePath, source] of Object.entries(scan.captured)) {
    if (typeof source !== "string") {
      throw new Error(`captured text evidence is not a string: ${relativePath}`);
    }
    if (source.includes("\0")) {
      throw new Error(`captured text evidence contains NUL: ${relativePath}`);
    }
    if (containsUnmaskedSecret(source)) {
      throw new Error(`captured text evidence contains an unmasked secret: ${relativePath}`);
    }
  }
  for (const requiredPath of REQUIRED_FIXED_PATHS) {
    if (!paths.includes(requiredPath)) {
      throw new Error(`required evidence file is missing from manifest input: ${requiredPath}`);
    }
  }
  const [identity, permissions, artifact, attempt, cleanup, state, events] = await Promise.all([
    readRequiredJson(scan, "runner/identity.json"),
    readRequiredJson(scan, "runner/permissions.json"),
    readRequiredJson(scan, "artifact/source.json"),
    readRequiredJson(scan, "attempt.json"),
    readRequiredJson(scan, "runner/cleanup.json"),
    readRequiredJson(scan, "state.json"),
    readRequiredJson(scan, "events.json"),
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
    ["identity.scenarioCatalogDigest", identity.scenarioCatalogDigest],
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
    ["attempt.attestationNonceDigest", attempt.attestationNonceDigest],
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
    identity.scenarioCatalogDigest !== scenarioCatalogDigest ||
    !/^sha256:[0-9a-f]{64}$/.test(identity.runnerImageDigest) ||
    !/^sha256:[0-9a-f]{64}$/.test(artifact.artifactDigest) ||
    !/^[0-9a-f]{64}$/.test(artifact.appBundleDigest) ||
    !/^sha256:[0-9a-f]{64}$/.test(attempt.attestationNonceDigest) ||
    attempt.attestationNonceDigest === `sha256:${"0".repeat(64)}`
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
  validateScenarioContract(state.scenarios);
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("events.json must contain at least one canonical event");
  }
  let previousEventTimestamp = -Infinity;
  for (const [index, event] of events.entries()) {
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      typeof event.type !== "string" ||
      event.type.trim() === "" ||
      typeof event.ts !== "string"
    ) {
      throw new Error(`event ${index} must contain canonical ts and type fields`);
    }
    const timestamp = Date.parse(event.ts);
    if (
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString() !== event.ts ||
      timestamp < previousEventTimestamp
    ) {
      throw new Error(`event ${index} has an invalid or nonmonotonic timestamp`);
    }
    previousEventTimestamp = timestamp;
  }
  if (attempt.verdict === "pass" && state.runFailure !== null && state.runFailure !== undefined) {
    throw new Error("PASS is forbidden whenever state.runFailure exists");
  }
  requireFinalCleanup(cleanup, { identity, artifact });
  requireStateCleanupMatches(state, cleanup);
  const report = scan.captured["index.html"];
  const expectedCleanupAttestation = finalCleanupAttestationHtml(state.cleanup);
  if (
    report.split('id="final-cleanup-attestation"').length !== 2 ||
    !report.includes(expectedCleanupAttestation)
  ) {
    throw new Error("human report cleanup attestation does not exactly match structured state");
  }
  const counts = { passed: 0, failed: 0, inconclusive: 0, not_required: 0 };
  const statusToCount = {
    pass: "passed",
    fail: "failed",
    inconclusive: "inconclusive",
    not_required: "not_required",
  };
  for (const scenario of Object.values(state.scenarios)) {
    counts[statusToCount[scenario.status]] += 1;
  }
  const expectedResultAttestation = finalResultAttestationHtml({
    identity,
    attempt,
    counts,
    verdict: state.verdict,
  });
  if (
    report.split('id="final-result-attestation"').length !== 2 ||
    !report.includes(expectedResultAttestation)
  ) {
    throw new Error("human report result attestation does not exactly match structured state");
  }
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
    requireReleasedLease(await readRequiredJson(scan, "runner/host-lease.json"), {
      identity,
      attempt,
      trustedOwnerToken,
    });
    requireControllerCleanupProbe(await readRequiredJson(scan, "runner/cleanup-probe.json"), {
      cleanup,
      identity,
      attempt,
      trustedOwnerToken,
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

async function expectedManifest(scan, options = {}) {
  const paths = scan.files.map((record) => record.path);
  const stablePaths = validatePathList(paths).sort();
  const { artifact, attempt, identity, state } = await readManifestInputs(
    scan,
    stablePaths,
    options,
  );
  if (JSON.stringify(paths) !== JSON.stringify(stablePaths)) {
    throw new Error("descriptor-relative scanner returned unstable evidence ordering");
  }
  const files = scan.files;
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
      attestationNonceDigest: attempt.attestationNonceDigest,
      lifecycle: attempt.lifecycle,
    },
    suite: {
      version: suiteContract.version,
      scenarioContractVersion: suiteContract.scenarioContractVersion,
      scenarioCatalogDigest,
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

function validateManifestOptions(options) {
  if (
    !options ||
    typeof options !== "object" ||
    Object.keys(options).some((key) => key !== "trustedOwnerToken")
  ) {
    throw new Error(
      "manifest operations accept only trustedOwnerToken; path-selection options are forbidden",
    );
  }
  if (
    Object.hasOwn(options, "trustedOwnerToken") &&
    (typeof options.trustedOwnerToken !== "string" || options.trustedOwnerToken.trim() === "")
  ) {
    throw new Error("trustedOwnerToken must be a non-empty string when provided");
  }
  return { trustedOwnerToken: options.trustedOwnerToken || "" };
}

export async function createEvidenceManifest(runDir, options = {}) {
  const validatedOptions = validateManifestOptions(options);
  return withEvidenceTreeSeal(runDir, async () => {
    const scan = scanEvidenceTree(runDir, "create");
    const manifest = await expectedManifest(scan, validatedOptions);
    await writeFile(path.join(runDir, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return manifest;
  });
}

async function verifyManifestScan(scan, validatedOptions) {
  let manifestSource;
  try {
    manifestSource = JSON.parse(scan.manifest);
  } catch (error) {
    throw new Error("required evidence file is invalid JSON: manifest.json", { cause: error });
  }
  const manifest = requireVersionOne(manifestSource, "evidence manifest");
  if (!Array.isArray(manifest.files)) throw new Error("evidence manifest files must be an array");
  const manifestPaths = validatePathList(manifest.files.map((entry) => entry?.path));
  const treePaths = scan.files.map((entry) => entry.path);
  if (JSON.stringify(manifestPaths) !== JSON.stringify([...manifestPaths].sort())) {
    throw new Error("evidence manifest file paths are not in stable lexical order");
  }
  if (JSON.stringify(manifestPaths) !== JSON.stringify(treePaths)) {
    throw new Error("evidence tree file set does not match immutable manifest");
  }
  const expected = await expectedManifest(scan, validatedOptions);
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

export async function verifyEvidenceManifest(runDir, options = {}) {
  const validatedOptions = validateManifestOptions(options);
  return withEvidenceTreeSeal(runDir, () =>
    verifyManifestScan(scanEvidenceTree(runDir, "verify"), validatedOptions),
  );
}

export function canonicalEvidenceArchivePaths(runDir) {
  requireNonEmpty(runDir, "evidence run root");
  if (!path.isAbsolute(runDir) || path.normalize(runDir) !== runDir) {
    throw new Error("evidence run root must be an absolute normalized path");
  }
  const archivePath = path.join(
    path.dirname(runDir),
    `${path.basename(runDir)}.canonical.zip`,
  );
  return Object.freeze({
    archivePath,
    digestPath: `${archivePath}.sha256`,
  });
}

function canonicalArchiveResult(manifest, archive, digestPath) {
  if (
    !archive ||
    typeof archive !== "object" ||
    !/^[0-9a-f]{64}$/.test(archive.sha256 || "") ||
    !Number.isSafeInteger(archive.bytes) ||
    archive.bytes <= 0 ||
    !Number.isSafeInteger(archive.entryCount) ||
    archive.entryCount !== manifest.files.length + 1
  ) {
    throw new Error("canonical evidence archive scanner returned an invalid result");
  }
  return {
    version: 1,
    manifest,
    archive: {
      format: "zip",
      archivePath: archive.path,
      digestPath,
      sha256: archive.sha256,
      bytes: archive.bytes,
      entries: archive.entryCount,
    },
  };
}

async function writeCanonicalArchiveDigest(archive, digestPath) {
  const expectedPath = `${archive.path}.sha256`;
  if (digestPath !== expectedPath) {
    throw new Error("canonical archive digest path must be the fixed archive sibling");
  }
  const source = `${archive.sha256}  ${path.basename(archive.path)}\n`;
  await writeFile(digestPath, source, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function validateCanonicalArchiveVerifyOptions(archivePath, options) {
  if (
    !options ||
    typeof options !== "object" ||
    Object.keys(options).some((key) => !["digestPath", "trustedOwnerToken"].includes(key))
  ) {
    throw new Error(
      "canonical archive verification accepts only digestPath and trustedOwnerToken",
    );
  }
  const digestPath = options.digestPath || `${archivePath}.sha256`;
  if (
    digestPath !== `${archivePath}.sha256` ||
    !path.isAbsolute(digestPath) ||
    path.normalize(digestPath) !== digestPath
  ) {
    throw new Error("canonical archive digest path must be the fixed archive sibling");
  }
  return {
    digestPath,
    manifestOptions: validateManifestOptions(
      options.trustedOwnerToken ? { trustedOwnerToken: options.trustedOwnerToken } : {},
    ),
  };
}

export async function createCanonicalEvidenceArchive(runDir, options = {}) {
  const validatedOptions = validateManifestOptions(options);
  const { archivePath, digestPath } = canonicalEvidenceArchivePaths(runDir);
  return withEvidenceTreeSeal(runDir, async () => {
    const initialScan = scanEvidenceTree(runDir, "create");
    const manifest = await expectedManifest(initialScan, validatedOptions);
    await writeFile(path.join(runDir, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    const sourceArchiveScan = scanEvidenceTree(runDir, "verify", { archiveOut: archivePath });
    const sourceManifest = await verifyManifestScan(sourceArchiveScan, validatedOptions);
    const archivedScan = scanEvidenceArchive(archivePath);
    const archivedManifest = await verifyManifestScan(archivedScan, validatedOptions);
    if (
      JSON.stringify(sourceManifest) !== JSON.stringify(manifest) ||
      JSON.stringify(archivedManifest) !== JSON.stringify(manifest) ||
      sourceArchiveScan.archive?.sha256 !== archivedScan.archive?.sha256 ||
      sourceArchiveScan.archive?.bytes !== archivedScan.archive?.bytes
    ) {
      throw new Error("canonical archive does not match the descriptor-bound evidence snapshot");
    }
    await writeCanonicalArchiveDigest(archivedScan.archive, digestPath);
    return canonicalArchiveResult(archivedManifest, archivedScan.archive, digestPath);
  });
}

export async function verifyCanonicalEvidenceArchive(archivePath, options = {}) {
  requireNonEmpty(archivePath, "canonical evidence archive");
  if (!path.isAbsolute(archivePath) || path.normalize(archivePath) !== archivePath) {
    throw new Error("canonical evidence archive must be an absolute normalized path");
  }
  const { digestPath, manifestOptions } = validateCanonicalArchiveVerifyOptions(
    archivePath,
    options,
  );
  const scan = scanEvidenceArchive(archivePath);
  const manifest = await verifyManifestScan(scan, manifestOptions);
  const expectedDigest = `${scan.archive.sha256}  ${path.basename(archivePath)}\n`;
  const digestSource = await readFile(digestPath, "utf8");
  if (digestSource !== expectedDigest) {
    throw new Error("canonical archive digest sidecar does not match the exact archive");
  }
  return canonicalArchiveResult(manifest, scan.archive, digestPath);
}

function cliArg(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? "" : args[index + 1] || "";
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const runDir = cliArg(args, "--run-dir");
  const archivePath = cliArg(args, "--archive");
  const validCreate = command === "create" && runDir && !archivePath;
  const validVerify = command === "verify" && archivePath && !runDir;
  if (!validCreate && !validVerify) {
    console.error(
      "Usage: evidence-manifest.mjs create --run-dir <path> | verify --archive <path>",
    );
    process.exitCode = 64;
    return;
  }
  const trustedOwnerOptions = process.env.NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN
    ? { trustedOwnerToken: process.env.NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN }
    : {};
  const result =
    command === "create"
      ? await createCanonicalEvidenceArchive(runDir, trustedOwnerOptions)
      : await verifyCanonicalEvidenceArchive(archivePath, trustedOwnerOptions);
  console.log(
    JSON.stringify({
      archive: result.archive.archivePath,
      digest: result.archive.digestPath,
      files: result.manifest.files.length,
      verdict: result.manifest.verdict,
      verified: command === "verify",
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
