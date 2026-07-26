#!/usr/bin/env node

import { createHash } from "node:crypto";
import path from "node:path";

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const FULL_GIT_SHA = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const PROMOTION_STATE = "qualified-v1";
const PROMOTION_VARIABLE = "NIXMAC_E2E_CILICON_PROMOTION_STATE";
const REQUIRED_LABELS = Object.freeze(["self-hosted", "macOS", "nixmac-e2e"]);
const REQUIRED_TCC_SERVICES = Object.freeze(["accessibility", "screenRecording"]);
const REQUIRED_TOOLS = Object.freeze([
  "ditto",
  "ffmpeg",
  "ffprobe",
  "jq",
  "node",
  "python3",
  "shasum",
]);
const WORKFLOW_KNOWN_FIELDS = Object.freeze([
  "repo",
  "jobId",
  "mergeSha",
  "suiteVersion",
  "attempt",
  "attestationNonce",
  "githubRunId",
  "githubRunAttempt",
  "runnerName",
  "runnerImageDigest",
]);
const HOST_ECHO_FIELDS = Object.freeze(["hostEcho.cycleId", "hostEcho.clonePath"]);

function fail(message) {
  throw new Error(message);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  return value;
}

function exactKeys(value, expected, field) {
  object(value, field);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${field} keys must be exactly: ${wanted.join(", ")}`);
  }
}

function string(value, field, { pattern } = {}) {
  if (typeof value !== "string" || value.trim() === "") fail(`${field} must be non-empty`);
  if (value.includes("\0")) fail(`${field} must not contain NUL`);
  if (pattern && !pattern.test(value)) fail(`${field} has an invalid format`);
  return value;
}

function boolean(value, field) {
  if (typeof value !== "boolean") fail(`${field} must be boolean`);
  return value;
}

function requiredTrue(value, field) {
  if (value !== true) fail(`${field} must be true`);
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive integer`);
  return value;
}

function nonnegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${field} must be a nonnegative integer`);
  }
  return value;
}

function positiveNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${field} must be a positive number`);
  }
  return value;
}

function canonicalTimestamp(value, field) {
  string(value, field);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(`${field} must be a canonical UTC ISO timestamp`);
  }
  return value;
}

function absoluteNormalizedPath(value, field) {
  string(value, field);
  if (!path.isAbsolute(value) || path.normalize(value) !== value) {
    fail(`${field} must be an absolute normalized path`);
  }
  if (value === path.parse(value).root) fail(`${field} must not be a filesystem root`);
  return value;
}

function immutableReference(value, field) {
  string(value, field);
  if (!/^ghcr\.io\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@sha256:[0-9a-f]{64}$/.test(value)) {
    fail(`${field} must be an immutable GHCR @sha256 reference`);
  }
  return value;
}

function exactStringArray(value, expected, field) {
  if (!Array.isArray(value) || value.length !== expected.length) {
    fail(`${field} must contain exactly ${expected.join(", ")}`);
  }
  expected.forEach((item, index) => {
    if (value[index] !== item) fail(`${field} must contain exactly ${expected.join(", ")}`);
  });
}

function uniqueNonemptyStrings(value, field) {
  if (!Array.isArray(value) || value.length === 0) fail(`${field} must be a non-empty array`);
  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    string(entry, `${field}[${index}]`, { pattern: /^[A-Z][A-Z0-9_]+$/ });
    if (seen.has(entry)) fail(`${field} must not contain duplicates`);
    seen.add(entry);
  }
}

export function requiredDedicatedHosts({ peakJobsPerHour, p95CycleMinutes }) {
  positiveNumber(peakJobsPerHour, "peakJobsPerHour");
  positiveNumber(p95CycleMinutes, "p95CycleMinutes");
  return Math.max(2, Math.ceil((peakJobsPerHour * p95CycleMinutes * 1.5) / 60) + 1);
}

function validateActivation(activation) {
  exactKeys(activation, ["state", "promotionVariable", "blockers"], "activation");
  if (!["disabled", PROMOTION_STATE].includes(activation.state)) {
    fail(`activation.state must be disabled or ${PROMOTION_STATE}`);
  }
  exactKeys(
    activation.promotionVariable,
    ["name", "scope", "requiredValue"],
    "activation.promotionVariable",
  );
  if (activation.promotionVariable.name !== PROMOTION_VARIABLE) {
    fail(`activation.promotionVariable.name must be ${PROMOTION_VARIABLE}`);
  }
  if (activation.promotionVariable.scope !== "repository") {
    fail("activation promotion variable must be repository-scoped");
  }
  if (activation.promotionVariable.requiredValue !== PROMOTION_STATE) {
    fail(`activation promotion value must be ${PROMOTION_STATE}`);
  }
  if (!Array.isArray(activation.blockers)) {
    fail("activation.blockers must be an array");
  }
  if (activation.state === "disabled")
    uniqueNonemptyStrings(activation.blockers, "activation.blockers");
  if (activation.state === PROMOTION_STATE && activation.blockers.length !== 0) {
    fail("qualified activation must not retain blockers");
  }
}

function validateUpstream(upstream) {
  exactKeys(
    upstream,
    ["repository", "pullRequest", "requiredPaths", "reuseConventions"],
    "upstream",
  );
  if (upstream.repository !== "darkmatter/nixmac")
    fail("upstream.repository must be darkmatter/nixmac");
  if (upstream.pullRequest !== 604) fail("upstream.pullRequest must be 604");
  exactStringArray(
    upstream.requiredPaths,
    [".github/workflows/macos-ci-image.yaml", "ops/images/nixmac-runner-tahoe.pkr.hcl"],
    "upstream.requiredPaths",
  );
  exactStringArray(
    upstream.reuseConventions,
    [
      "packer-tart",
      "pinned-cirrus-tahoe-base",
      "ghcr-publication",
      "isolated-image-builder",
      "xcode-boot-verification",
      "pre-push-secret-scan",
    ],
    "upstream.reuseConventions",
  );
}

function validateProvider(provider) {
  exactKeys(
    provider,
    ["backend", "labels", "oneVmPerAttempt", "capacityOnePerHost", "sharedWithBuildFleet"],
    "provider",
  );
  if (provider.backend !== "cilicon_tart") fail("provider.backend must be cilicon_tart");
  exactStringArray(provider.labels, REQUIRED_LABELS, "provider.labels");
  requiredTrue(provider.oneVmPerAttempt, "provider.oneVmPerAttempt");
  requiredTrue(provider.capacityOnePerHost, "provider.capacityOnePerHost");
  if (provider.sharedWithBuildFleet !== false) {
    fail("provider.sharedWithBuildFleet must be false");
  }
}

function validateImage(image) {
  exactKeys(
    image,
    [
      "reference",
      "baseReference",
      "sourceWorkflow",
      "sourceTemplate",
      "digestVerified",
      "secretScanPassed",
      "containsSecrets",
    ],
    "qualification.image",
  );
  immutableReference(image.reference, "qualification.image.reference");
  immutableReference(image.baseReference, "qualification.image.baseReference");
  if (image.sourceWorkflow !== ".github/workflows/macos-ci-image.yaml") {
    fail("qualification.image.sourceWorkflow must reuse PR #604's image workflow");
  }
  if (image.sourceTemplate !== "ops/images/nixmac-runner-tahoe.pkr.hcl") {
    fail("qualification.image.sourceTemplate must reuse PR #604's Packer template");
  }
  requiredTrue(image.digestVerified, "qualification.image.digestVerified");
  requiredTrue(image.secretScanPassed, "qualification.image.secretScanPassed");
  if (image.containsSecrets !== false) fail("qualification.image.containsSecrets must be false");
}

function validateCuaDriver(cuaDriver) {
  exactKeys(
    cuaDriver,
    [
      "artifactUrl",
      "artifactDigest",
      "cliVersion",
      "appVersion",
      "bundleId",
      "signingIdentity",
      "appPath",
      "appExecutable",
      "cliSymlink",
      "standaloneLaunchMode",
    ],
    "qualification.cuaDriver",
  );
  string(cuaDriver.artifactUrl, "qualification.cuaDriver.artifactUrl");
  let artifactUrl;
  try {
    artifactUrl = new URL(cuaDriver.artifactUrl);
  } catch {
    fail("qualification.cuaDriver.artifactUrl must be an absolute URL");
  }
  if (
    artifactUrl.protocol !== "https:" ||
    /(?:^|[-_/])latest(?:[-_/]|$)/i.test(artifactUrl.pathname)
  ) {
    fail("qualification.cuaDriver.artifactUrl must be immutable HTTPS and must not use latest");
  }
  string(cuaDriver.artifactDigest, "qualification.cuaDriver.artifactDigest", {
    pattern: SHA256,
  });
  string(cuaDriver.cliVersion, "qualification.cuaDriver.cliVersion", {
    pattern: /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/,
  });
  string(cuaDriver.appVersion, "qualification.cuaDriver.appVersion", {
    pattern: /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/,
  });
  if (cuaDriver.cliVersion !== cuaDriver.appVersion) {
    fail("CuaDriver CLI and app versions must match");
  }
  string(cuaDriver.bundleId, "qualification.cuaDriver.bundleId", {
    pattern: BUNDLE_ID,
  });
  string(cuaDriver.signingIdentity, "qualification.cuaDriver.signingIdentity");
  absoluteNormalizedPath(cuaDriver.appPath, "qualification.cuaDriver.appPath");
  if (!cuaDriver.appPath.endsWith("/CuaDriver.app")) {
    fail("qualification.cuaDriver.appPath must identify CuaDriver.app");
  }
  absoluteNormalizedPath(cuaDriver.appExecutable, "qualification.cuaDriver.appExecutable");
  if (cuaDriver.appExecutable !== path.join(cuaDriver.appPath, "Contents", "MacOS", "cua-driver")) {
    fail("qualification.cuaDriver.appExecutable must be owned by CuaDriver.app");
  }
  if (cuaDriver.cliSymlink !== "/usr/local/bin/cua-driver") {
    fail("qualification.cuaDriver.cliSymlink must be /usr/local/bin/cua-driver");
  }
  if (cuaDriver.standaloneLaunchMode !== "app-owned-daemon") {
    fail("qualification.cuaDriver.standaloneLaunchMode must be app-owned-daemon");
  }
}

function validateTcc(tcc, cuaDriver) {
  exactKeys(tcc, ["target", "services", "firstBoot", "agedBoot"], "qualification.tcc");
  exactKeys(
    tcc.target,
    ["kind", "appPath", "bundleId", "signingIdentity"],
    "qualification.tcc.target",
  );
  if (tcc.target.kind !== "app-bundle") fail("TCC target must be an app-bundle");
  if (
    tcc.target.appPath !== cuaDriver.appPath ||
    tcc.target.bundleId !== cuaDriver.bundleId ||
    tcc.target.signingIdentity !== cuaDriver.signingIdentity
  ) {
    fail("TCC target must exactly match the pinned CuaDriver.app identity");
  }
  exactStringArray(tcc.services, REQUIRED_TCC_SERVICES, "qualification.tcc.services");
  for (const boot of ["firstBoot", "agedBoot"]) {
    exactKeys(
      tcc[boot],
      ["aquaSession", "accessibilityGranted", "screenRecordingGranted", "smokePassed"],
      `qualification.tcc.${boot}`,
    );
    for (const field of [
      "aquaSession",
      "accessibilityGranted",
      "screenRecordingGranted",
      "smokePassed",
    ]) {
      requiredTrue(tcc[boot][field], `qualification.tcc.${boot}.${field}`);
    }
  }
}

function validateTools(tools) {
  exactKeys(tools, REQUIRED_TOOLS, "qualification.tools");
  for (const tool of REQUIRED_TOOLS) requiredTrue(tools[tool], `qualification.tools.${tool}`);
}

function validateLifecycleConfig(lifecycle) {
  exactKeys(
    lifecycle,
    [
      "mountPath",
      "quarantineSentinel",
      "sinkRepository",
      "sinkCredential",
      "inventoryCredential",
      "oneVmPerAttempt",
      "capacityOnePerHost",
    ],
    "qualification.lifecycle",
  );
  absoluteNormalizedPath(lifecycle.mountPath, "qualification.lifecycle.mountPath");
  absoluteNormalizedPath(
    lifecycle.quarantineSentinel,
    "qualification.lifecycle.quarantineSentinel",
  );
  if (lifecycle.quarantineSentinel !== "/var/db/nixmac-e2e-quarantined") {
    fail("qualification.lifecycle.quarantineSentinel must use the dedicated host sentinel");
  }
  if (lifecycle.sinkRepository !== "darkmatter/nixmac-e2e-attestations") {
    fail("qualification.lifecycle.sinkRepository must use the protected attestation sink");
  }
  exactKeys(
    lifecycle.sinkCredential,
    ["appId", "installationId", "repository", "permissions"],
    "qualification.lifecycle.sinkCredential",
  );
  exactKeys(
    lifecycle.sinkCredential.permissions,
    ["contents"],
    "qualification.lifecycle.sinkCredential.permissions",
  );
  positiveInteger(lifecycle.sinkCredential.appId, "qualification.lifecycle.sinkCredential.appId");
  positiveInteger(
    lifecycle.sinkCredential.installationId,
    "qualification.lifecycle.sinkCredential.installationId",
  );
  if (
    lifecycle.sinkCredential.repository !== lifecycle.sinkRepository ||
    lifecycle.sinkCredential.permissions.contents !== "write"
  ) {
    fail("sink credential must have only Contents write on the attestation sink");
  }
  exactKeys(
    lifecycle.inventoryCredential,
    ["appId", "installationId", "repository", "permissions"],
    "qualification.lifecycle.inventoryCredential",
  );
  exactKeys(
    lifecycle.inventoryCredential.permissions,
    ["administration"],
    "qualification.lifecycle.inventoryCredential.permissions",
  );
  positiveInteger(
    lifecycle.inventoryCredential.appId,
    "qualification.lifecycle.inventoryCredential.appId",
  );
  positiveInteger(
    lifecycle.inventoryCredential.installationId,
    "qualification.lifecycle.inventoryCredential.installationId",
  );
  if (
    lifecycle.inventoryCredential.repository !== "darkmatter/nixmac" ||
    lifecycle.inventoryCredential.permissions.administration !== "read"
  ) {
    fail("inventory credential must have only Administration read on darkmatter/nixmac");
  }
  if (
    lifecycle.sinkCredential.appId === lifecycle.inventoryCredential.appId ||
    lifecycle.sinkCredential.installationId === lifecycle.inventoryCredential.installationId
  ) {
    fail("sink-write and inventory-read GitHub Apps and installations must be distinct");
  }
  requiredTrue(lifecycle.oneVmPerAttempt, "qualification.lifecycle.oneVmPerAttempt");
  requiredTrue(lifecycle.capacityOnePerHost, "qualification.lifecycle.capacityOnePerHost");
}

function validateCapacity(capacity) {
  exactKeys(
    capacity,
    [
      "peakJobsPerHour",
      "p95CycleMinutes",
      "dedicatedHosts",
      "p95StartMinutesWithOneHostQuarantined",
    ],
    "qualification.capacity",
  );
  const minimum = requiredDedicatedHosts(capacity);
  positiveInteger(capacity.dedicatedHosts, "qualification.capacity.dedicatedHosts");
  if (capacity.dedicatedHosts < minimum) {
    fail(`qualification.capacity.dedicatedHosts must be at least ${minimum}`);
  }
  positiveNumber(
    capacity.p95StartMinutesWithOneHostQuarantined,
    "qualification.capacity.p95StartMinutesWithOneHostQuarantined",
  );
  if (capacity.p95StartMinutesWithOneHostQuarantined >= 15) {
    fail("one-host-quarantined p95 start latency must be under 15 minutes");
  }
}

function validateQualification(qualification) {
  exactKeys(
    qualification,
    ["image", "cuaDriver", "testUser", "tools", "tcc", "lifecycle", "capacity"],
    "qualification",
  );
  validateImage(qualification.image);
  validateCuaDriver(qualification.cuaDriver);
  exactKeys(qualification.testUser, ["username", "personal"], "qualification.testUser");
  string(qualification.testUser.username, "qualification.testUser.username", {
    pattern: /^[a-z_][a-z0-9_-]{0,31}$/,
  });
  if (qualification.testUser.personal !== false) {
    fail("qualification.testUser.personal must be false");
  }
  validateTools(qualification.tools);
  validateTcc(qualification.tcc, qualification.cuaDriver);
  validateLifecycleConfig(qualification.lifecycle);
  validateCapacity(qualification.capacity);
}

export function validateProviderContract(contract) {
  object(contract, "contract");
  const expected =
    contract.activation?.state === PROMOTION_STATE
      ? [
          "version",
          "activation",
          "upstream",
          "provider",
          "requiredQualifiedFields",
          "qualification",
        ]
      : ["version", "activation", "upstream", "provider", "requiredQualifiedFields"];
  exactKeys(contract, expected, "contract");
  if (contract.version !== 1) fail("contract.version must be 1");
  validateActivation(contract.activation);
  validateUpstream(contract.upstream);
  validateProvider(contract.provider);
  if (
    !Array.isArray(contract.requiredQualifiedFields) ||
    contract.requiredQualifiedFields.length === 0
  ) {
    fail("requiredQualifiedFields must be a non-empty array");
  }
  const uniqueFields = new Set(contract.requiredQualifiedFields);
  if (
    uniqueFields.size !== contract.requiredQualifiedFields.length ||
    contract.requiredQualifiedFields.some(
      (field) => typeof field !== "string" || !field.startsWith("qualification."),
    )
  ) {
    fail("requiredQualifiedFields must contain unique qualification paths");
  }
  if (contract.activation.state === PROMOTION_STATE) validateQualification(contract.qualification);
  return structuredClone(contract);
}

function validateHostEcho(hostEcho) {
  exactKeys(hostEcho, ["cycleId", "clonePath"], "request.hostEcho");
  string(hostEcho.cycleId, "request.hostEcho.cycleId", { pattern: SAFE_ID });
  absoluteNormalizedPath(hostEcho.clonePath, "request.hostEcho.clonePath");
}

export function validateLifecycleRequest(request) {
  exactKeys(
    request,
    [
      "version",
      "repo",
      "jobId",
      "mergeSha",
      "suiteVersion",
      "attempt",
      "attestationNonce",
      "githubRunId",
      "githubRunAttempt",
      "runnerName",
      "runnerImageDigest",
      "requestedAt",
      "fieldProvenance",
      "hostEcho",
    ],
    "request",
  );
  if (request.version !== 1) fail("request.version must be 1");
  string(request.repo, "request.repo", { pattern: REPOSITORY });
  string(request.mergeSha, "request.mergeSha", { pattern: FULL_GIT_SHA });
  string(request.suiteVersion, "request.suiteVersion", {
    pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  });
  const expectedJobId = `${request.repo}:${request.mergeSha}:${request.suiteVersion}`;
  if (request.jobId !== expectedJobId) fail("request.jobId must be canonical");
  positiveInteger(request.attempt, "request.attempt");
  string(request.attestationNonce, "request.attestationNonce", {
    pattern: /^[A-Za-z0-9_-]{32,128}$/,
  });
  positiveInteger(request.githubRunId, "request.githubRunId");
  positiveInteger(request.githubRunAttempt, "request.githubRunAttempt");
  string(request.runnerName, "request.runnerName", { pattern: SAFE_ID });
  string(request.runnerImageDigest, "request.runnerImageDigest", {
    pattern: SHA256,
  });
  canonicalTimestamp(request.requestedAt, "request.requestedAt");
  exactKeys(request.fieldProvenance, ["workflowKnown", "hostEcho"], "request.fieldProvenance");
  exactStringArray(
    request.fieldProvenance.workflowKnown,
    WORKFLOW_KNOWN_FIELDS,
    "request.fieldProvenance.workflowKnown",
  );
  exactStringArray(
    request.fieldProvenance.hostEcho,
    HOST_ECHO_FIELDS,
    "request.fieldProvenance.hostEcho",
  );
  validateHostEcho(request.hostEcho);
  return structuredClone(request);
}

function attestationIdentity(attestation) {
  return {
    repo: attestation.repo,
    jobId: attestation.jobId,
    mergeSha: attestation.mergeSha,
    suiteVersion: attestation.suiteVersion,
    attempt: attestation.attempt,
    attestationNonce: attestation.attestationNonce,
    githubRunId: attestation.githubRunId,
    githubRunAttempt: attestation.githubRunAttempt,
    runnerName: attestation.runnerName,
    runnerImageDigest: attestation.runnerImageDigest,
    hostEcho: {
      cycleId: attestation.cycleId,
      clonePath: attestation.clonePath,
    },
  };
}

function requestIdentity(request) {
  return {
    repo: request.repo,
    jobId: request.jobId,
    mergeSha: request.mergeSha,
    suiteVersion: request.suiteVersion,
    attempt: request.attempt,
    attestationNonce: request.attestationNonce,
    githubRunId: request.githubRunId,
    githubRunAttempt: request.githubRunAttempt,
    runnerName: request.runnerName,
    runnerImageDigest: request.runnerImageDigest,
    hostEcho: request.hostEcho,
  };
}

function lifecycleKey(request) {
  return createHash("sha256")
    .update(JSON.stringify(requestIdentity(request)))
    .digest("hex");
}

export function verifyLifecycleAttestation(
  requestInput,
  attestation,
  { consumedKeys = new Set(), maxAgeSeconds = 4 * 60 * 60 } = {},
) {
  const request = validateLifecycleRequest(requestInput);
  exactKeys(
    attestation,
    [
      "version",
      "result",
      "repo",
      "jobId",
      "mergeSha",
      "suiteVersion",
      "attempt",
      "attestationNonce",
      "githubRunId",
      "githubRunAttempt",
      "runnerName",
      "runnerImageDigest",
      "cycleId",
      "clonePath",
      "hostId",
      "attestedAt",
      "runnerDeregistered",
      "clonePathAbsent",
      "matchingClonePaths",
      "quarantine",
    ],
    "attestation",
  );
  if (attestation.version !== 1) fail("attestation.version must be 1");
  if (!["destroyed", "quarantined"].includes(attestation.result)) {
    fail("attestation.result must be destroyed or quarantined");
  }
  string(attestation.hostId, "attestation.hostId", { pattern: SAFE_ID });
  canonicalTimestamp(attestation.attestedAt, "attestation.attestedAt");
  boolean(attestation.runnerDeregistered, "attestation.runnerDeregistered");
  boolean(attestation.clonePathAbsent, "attestation.clonePathAbsent");
  if (!Array.isArray(attestation.matchingClonePaths)) {
    fail("attestation.matchingClonePaths must be an array");
  }
  for (const [index, clonePath] of attestation.matchingClonePaths.entries()) {
    absoluteNormalizedPath(clonePath, `attestation.matchingClonePaths[${index}]`);
  }
  exactKeys(attestation.quarantine, ["marked", "reason"], "attestation.quarantine");
  boolean(attestation.quarantine.marked, "attestation.quarantine.marked");
  if (typeof attestation.quarantine.reason !== "string") {
    fail("attestation.quarantine.reason must be a string");
  }

  if (
    JSON.stringify(attestationIdentity(attestation)) !== JSON.stringify(requestIdentity(request))
  ) {
    fail("attestation identity must exactly match the trusted lifecycle request");
  }

  positiveNumber(maxAgeSeconds, "maxAgeSeconds");
  const requestedAt = Date.parse(request.requestedAt);
  const attestedAt = Date.parse(attestation.attestedAt);
  if (attestedAt < requestedAt || attestedAt - requestedAt > maxAgeSeconds * 1000) {
    fail("attestation timestamp is stale or precedes the request");
  }

  const key = lifecycleKey(request);
  if (consumedKeys.has(key)) fail("lifecycle attestation is replayed");

  if (attestation.result === "destroyed") {
    if (
      !attestation.runnerDeregistered ||
      !attestation.clonePathAbsent ||
      attestation.matchingClonePaths.length !== 0
    ) {
      fail("destroyed attestation requires runner deregistration and unambiguous clone absence");
    }
    if (attestation.quarantine.marked || attestation.quarantine.reason !== "") {
      fail("destroyed attestation must not claim host quarantine");
    }
  } else {
    if (!attestation.quarantine.marked || attestation.quarantine.reason.trim() === "") {
      fail("quarantined attestation requires a host marker and non-empty reason");
    }
  }

  return Object.freeze({
    accepted: true,
    lifecycleKey: key,
    disposition: attestation.result,
    promotionEligible: attestation.result === "destroyed",
    containmentVerified:
      attestation.result === "destroyed" || attestation.quarantine.marked === true,
  });
}

function ratio(numerator, denominator, field) {
  nonnegativeInteger(numerator, `${field}.numerator`);
  nonnegativeInteger(denominator, `${field}.denominator`);
  if (numerator > denominator) fail(`${field} numerator must not exceed denominator`);
  return denominator === 0 ? 0 : numerator / denominator;
}

export function evaluatePromotion(metrics) {
  exactKeys(
    metrics,
    [
      "observationDays",
      "jobs",
      "qualificationJobs",
      "attempts",
      "missingMergedPrs",
      "duplicateTerminalPublications",
      "identityDigestMismatches",
      "unclassifiedFailures",
      "cleanupFailures",
      "destructionFailures",
      "attestationFailures",
      "publishedResults",
      "verifiedReports",
      "terminalWithoutHuman",
      "startsWithin15Minutes",
      "startsWithCapacity",
      "infrastructureInconclusive",
    ],
    "metrics",
  );
  positiveNumber(metrics.observationDays, "metrics.observationDays");
  nonnegativeInteger(metrics.jobs, "metrics.jobs");
  if (!Array.isArray(metrics.qualificationJobs)) {
    fail("metrics.qualificationJobs must be an array");
  }
  if (metrics.qualificationJobs.length !== metrics.jobs) {
    fail("metrics.jobs must equal the number of qualificationJobs");
  }
  const qualificationJobIds = new Set();
  for (const [index, job] of metrics.qualificationJobs.entries()) {
    exactKeys(
      job,
      ["jobId", "mergeSha", "exactSha", "evidenceVerified", "productPassed", "terminalPublished"],
      `metrics.qualificationJobs[${index}]`,
    );
    string(job.jobId, `metrics.qualificationJobs[${index}].jobId`, {
      pattern: SAFE_ID,
    });
    string(job.mergeSha, `metrics.qualificationJobs[${index}].mergeSha`, {
      pattern: FULL_GIT_SHA,
    });
    if (!job.jobId.includes(`:${job.mergeSha}:`)) {
      fail(`metrics.qualificationJobs[${index}].jobId must bind mergeSha`);
    }
    if (qualificationJobIds.has(job.jobId)) {
      fail("metrics.qualificationJobs must contain distinct logical jobs");
    }
    qualificationJobIds.add(job.jobId);
    for (const field of ["exactSha", "evidenceVerified", "productPassed", "terminalPublished"]) {
      boolean(job[field], `metrics.qualificationJobs[${index}].${field}`);
    }
  }
  if (!Array.isArray(metrics.attempts)) fail("metrics.attempts must be an array");
  const attemptedJobIds = new Set();
  for (const [index, attempt] of metrics.attempts.entries()) {
    exactKeys(attempt, ["jobId", "result"], `metrics.attempts[${index}]`);
    string(attempt.jobId, `metrics.attempts[${index}].jobId`, {
      pattern: SAFE_ID,
    });
    if (!qualificationJobIds.has(attempt.jobId)) {
      fail(`metrics.attempts[${index}].jobId must identify a qualification job`);
    }
    attemptedJobIds.add(attempt.jobId);
    if (!["destroyed", "quarantined"].includes(attempt.result)) {
      fail(`metrics.attempts[${index}].result must be destroyed or quarantined`);
    }
  }
  if (
    qualificationJobIds.size !== attemptedJobIds.size ||
    [...qualificationJobIds].some((jobId) => !attemptedJobIds.has(jobId))
  ) {
    fail("every qualification job must have at least one lifecycle attempt");
  }
  for (const field of [
    "missingMergedPrs",
    "duplicateTerminalPublications",
    "identityDigestMismatches",
    "unclassifiedFailures",
    "cleanupFailures",
    "destructionFailures",
    "attestationFailures",
    "publishedResults",
    "verifiedReports",
    "terminalWithoutHuman",
    "startsWithin15Minutes",
    "startsWithCapacity",
    "infrastructureInconclusive",
  ]) {
    nonnegativeInteger(metrics[field], `metrics.${field}`);
  }
  if (metrics.verifiedReports > metrics.publishedResults) {
    fail("metrics.verifiedReports must not exceed publishedResults");
  }
  ratio(metrics.terminalWithoutHuman, metrics.jobs, "terminalWithoutHuman");
  ratio(metrics.startsWithin15Minutes, metrics.startsWithCapacity, "startsWithin15Minutes");
  ratio(metrics.infrastructureInconclusive, metrics.jobs, "infrastructureInconclusive");

  const blockers = [];
  const zeroGate = [
    ["missingMergedPrs", "missing merged PRs"],
    ["duplicateTerminalPublications", "duplicate terminal publications"],
    ["identityDigestMismatches", "identity/digest mismatches"],
    ["unclassifiedFailures", "unclassified failures"],
    ["cleanupFailures", "cleanup failures"],
    ["destructionFailures", "destruction failures"],
    ["attestationFailures", "attestation failures"],
  ];
  for (const [field, label] of zeroGate) {
    if (metrics[field] !== 0) blockers.push(`${label} must be zero`);
  }
  if (metrics.publishedResults !== metrics.verifiedReports) {
    blockers.push("every published result must link to a verified report");
  }
  const quarantinedAttempts = metrics.attempts.filter(
    (attempt) => attempt.result === "quarantined",
  ).length;
  if (quarantinedAttempts > 0) {
    blockers.push(
      "quarantined attempts count as destruction failures during absolute qualification",
    );
  }
  const consecutive = [...metrics.qualificationJobs]
    .reverse()
    .findIndex(
      (job) =>
        !job.exactSha ||
        !job.evidenceVerified ||
        !job.productPassed ||
        !job.terminalPublished ||
        metrics.attempts.some(
          (attempt) => attempt.jobId === job.jobId && attempt.result !== "destroyed",
        ),
    );
  const consecutiveSuccessful = consecutive === -1 ? metrics.qualificationJobs.length : consecutive;
  if (consecutiveSuccessful < 10) {
    blockers.push("ten consecutive destroyed exact-SHA qualification jobs are required");
  }

  const percentageWindowOpen = metrics.jobs >= 50 || metrics.observationDays >= 30;
  if (percentageWindowOpen) {
    const terminalRate = ratio(metrics.terminalWithoutHuman, metrics.jobs, "terminalWithoutHuman");
    if (terminalRate < 0.98) blockers.push("terminal-without-human rate must be at least 98%");
    const startRate = ratio(
      metrics.startsWithin15Minutes,
      metrics.startsWithCapacity,
      "startsWithin15Minutes",
    );
    if (metrics.startsWithCapacity === 0 || startRate < 0.95) {
      blockers.push("start-within-15-minutes rate must be at least 95% when capacity exists");
    }
    const inconclusiveRate = ratio(
      metrics.infrastructureInconclusive,
      metrics.jobs,
      "infrastructureInconclusive",
    );
    if (inconclusiveRate >= 0.02) {
      blockers.push("infrastructure-inconclusive rate must be below 2%");
    }
  }

  return Object.freeze({
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers),
    consecutiveSuccessful,
    percentageWindowOpen,
  });
}

export const ciliconE2eContractConstants = Object.freeze({
  promotionState: PROMOTION_STATE,
  promotionVariable: PROMOTION_VARIABLE,
  requiredLabels: REQUIRED_LABELS,
  requiredTccServices: REQUIRED_TCC_SERVICES,
  requiredTools: REQUIRED_TOOLS,
  workflowKnownFields: WORKFLOW_KNOWN_FIELDS,
  hostEchoFields: HOST_ECHO_FIELDS,
});
