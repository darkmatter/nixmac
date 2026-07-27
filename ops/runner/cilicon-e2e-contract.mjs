#!/usr/bin/env node

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import path from "node:path";

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const FULL_GIT_SHA = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const IMAGE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SHADOW_PROMOTION_STATE = "shadow-qualified-v1";
const PRODUCTION_PROMOTION_STATE = "production-qualified-v1";
const QUALIFIED_STATES = Object.freeze([SHADOW_PROMOTION_STATE, PRODUCTION_PROMOTION_STATE]);
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
]);
const RUNTIME_OBSERVED_FIELDS = Object.freeze([
  "runnerName",
  "runnerImageDigest",
  "attestationPolicy.expectedHostId",
  "hostEcho.cycleId",
  "hostEcho.clonePath",
]);
const CONTRACT_KNOWN_FIELDS = Object.freeze([
  "attestationPolicy.attestorKeyId",
  "attestationPolicy.sinkRepository",
  "attestationPolicy.sinkRef",
]);

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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function verifyEd25519(payload, signature, publicKeyPem, field) {
  string(signature, field, { pattern: /^[A-Za-z0-9+/]+={0,2}$/ });
  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    fail("qualification.attestor.publicKeyPem must be a valid public key");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    fail("qualification.attestor.publicKeyPem must be an Ed25519 public key");
  }
  let accepted = false;
  try {
    accepted = verifySignature(
      null,
      Buffer.from(payload),
      publicKey,
      Buffer.from(signature, "base64"),
    );
  } catch {
    accepted = false;
  }
  if (!accepted) fail(`${field} is invalid`);
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
  if (!["disabled", ...QUALIFIED_STATES].includes(activation.state)) {
    fail(
      `activation.state must be disabled, ${SHADOW_PROMOTION_STATE}, or ${PRODUCTION_PROMOTION_STATE}`,
    );
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
  if (
    !QUALIFIED_STATES.includes(activation.promotionVariable.requiredValue) ||
    (activation.state !== "disabled" &&
      activation.promotionVariable.requiredValue !== activation.state)
  ) {
    fail("activation promotion value must exactly match the qualified activation state");
  }
  if (!Array.isArray(activation.blockers)) {
    fail("activation.blockers must be an array");
  }
  if (activation.state === "disabled")
    uniqueNonemptyStrings(activation.blockers, "activation.blockers");
  if (QUALIFIED_STATES.includes(activation.state) && activation.blockers.length !== 0) {
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
      "builtAt",
      "maxAgeSeconds",
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
  if (image.sourceTemplate !== "ops/images/nixmac-e2e-runner-tahoe.pkr.hcl") {
    fail("qualification.image.sourceTemplate must identify the qualified E2E Packer template");
  }
  canonicalTimestamp(image.builtAt, "qualification.image.builtAt");
  positiveInteger(image.maxAgeSeconds, "qualification.image.maxAgeSeconds");
  if (image.maxAgeSeconds > 7 * 24 * 60 * 60) {
    fail("qualification.image.maxAgeSeconds must not exceed seven days");
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
      "executableDigest",
      "appBundleDigest",
      "cliVersion",
      "appVersion",
      "bundleId",
      "signingIdentity",
      "teamId",
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
  string(cuaDriver.executableDigest, "qualification.cuaDriver.executableDigest", {
    pattern: SHA256,
  });
  string(cuaDriver.appBundleDigest, "qualification.cuaDriver.appBundleDigest", {
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
  string(cuaDriver.teamId, "qualification.cuaDriver.teamId", {
    pattern: /^[A-Z0-9]{10}$/,
  });
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
    ["kind", "appPath", "bundleId", "signingIdentity", "teamId"],
    "qualification.tcc.target",
  );
  if (tcc.target.kind !== "app-bundle") fail("TCC target must be an app-bundle");
  if (
    tcc.target.appPath !== cuaDriver.appPath ||
    tcc.target.bundleId !== cuaDriver.bundleId ||
    tcc.target.signingIdentity !== cuaDriver.signingIdentity ||
    tcc.target.teamId !== cuaDriver.teamId
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

function validateAttestor(attestor) {
  exactKeys(
    attestor,
    ["algorithm", "keyId", "publicKeyPem", "runtimeObservationPath", "maxObservationAgeSeconds"],
    "qualification.attestor",
  );
  if (attestor.algorithm !== "ed25519") {
    fail("qualification.attestor.algorithm must be ed25519");
  }
  string(attestor.keyId, "qualification.attestor.keyId", { pattern: SAFE_ID });
  string(attestor.publicKeyPem, "qualification.attestor.publicKeyPem");
  let publicKey;
  try {
    publicKey = createPublicKey(attestor.publicKeyPem);
  } catch {
    fail("qualification.attestor.publicKeyPem must be a valid public key");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    fail("qualification.attestor.publicKeyPem must be an Ed25519 public key");
  }
  absoluteNormalizedPath(
    attestor.runtimeObservationPath,
    "qualification.attestor.runtimeObservationPath",
  );
  if (attestor.runtimeObservationPath !== "/var/db/nixmac-e2e/runtime-observation.json") {
    fail("qualification.attestor.runtimeObservationPath must use the protected host mount");
  }
  positiveInteger(
    attestor.maxObservationAgeSeconds,
    "qualification.attestor.maxObservationAgeSeconds",
  );
  if (attestor.maxObservationAgeSeconds > 3600) {
    fail("qualification.attestor.maxObservationAgeSeconds must not exceed one hour");
  }
}

function validateLifecycleConfig(lifecycle) {
  exactKeys(
    lifecycle,
    [
      "mountPath",
      "quarantineSentinel",
      "sinkRepository",
      "sinkRef",
      "sinkPathPrefix",
      "requiredStatusCheck",
      "sinkCredential",
      "consumerCredential",
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
  if (lifecycle.sinkRef !== "refs/heads/main") {
    fail("qualification.lifecycle.sinkRef must use the protected main branch");
  }
  string(lifecycle.sinkPathPrefix, "qualification.lifecycle.sinkPathPrefix", {
    pattern: /^[A-Za-z0-9][A-Za-z0-9._/-]*\/$/,
  });
  if (lifecycle.sinkPathPrefix.startsWith("/") || lifecycle.sinkPathPrefix.includes("..")) {
    fail("qualification.lifecycle.sinkPathPrefix must be a safe repository path prefix");
  }
  string(lifecycle.requiredStatusCheck, "qualification.lifecycle.requiredStatusCheck", {
    pattern: SAFE_ID,
  });
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
    lifecycle.consumerCredential,
    ["appId", "installationId", "repository", "permissions"],
    "qualification.lifecycle.consumerCredential",
  );
  exactKeys(
    lifecycle.consumerCredential.permissions,
    ["administration", "checks", "contents"],
    "qualification.lifecycle.consumerCredential.permissions",
  );
  positiveInteger(
    lifecycle.consumerCredential.appId,
    "qualification.lifecycle.consumerCredential.appId",
  );
  positiveInteger(
    lifecycle.consumerCredential.installationId,
    "qualification.lifecycle.consumerCredential.installationId",
  );
  if (
    lifecycle.consumerCredential.repository !== lifecycle.sinkRepository ||
    lifecycle.consumerCredential.permissions.administration !== "read" ||
    lifecycle.consumerCredential.permissions.checks !== "read" ||
    lifecycle.consumerCredential.permissions.contents !== "read"
  ) {
    fail("consumer credential must have exact read permissions on the attestation sink");
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
  const appIds = [
    lifecycle.sinkCredential.appId,
    lifecycle.consumerCredential.appId,
    lifecycle.inventoryCredential.appId,
  ];
  const installationIds = [
    lifecycle.sinkCredential.installationId,
    lifecycle.consumerCredential.installationId,
    lifecycle.inventoryCredential.installationId,
  ];
  if (new Set(appIds).size !== 3 || new Set(installationIds).size !== 3) {
    fail("writer, consumer, and inventory Apps and installations must be distinct");
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
    ["image", "cuaDriver", "testUser", "tools", "tcc", "attestor", "lifecycle", "capacity"],
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
  validateAttestor(qualification.attestor);
  validateLifecycleConfig(qualification.lifecycle);
  validateCapacity(qualification.capacity);
}

export function validateProviderContract(contract) {
  object(contract, "contract");
  const expected = QUALIFIED_STATES.includes(contract.activation?.state)
    ? ["version", "activation", "upstream", "provider", "requiredQualifiedFields", "qualification"]
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
  if (QUALIFIED_STATES.includes(contract.activation.state)) {
    validateQualification(contract.qualification);
  }
  return structuredClone(contract);
}

export function validateRuntimeProviderGate(
  contractInput,
  { requestedTier, repositoryPromotionState },
) {
  const contract = validateProviderContract(contractInput);
  if (!["shadow", "production"].includes(requestedTier)) {
    fail("requestedTier must be shadow or production");
  }
  if (contract.activation.state === "disabled") {
    fail("the checked-in provider contract is disabled");
  }
  if (requestedTier === "production" && contract.activation.state !== PRODUCTION_PROMOTION_STATE) {
    fail("production execution requires a production-qualified checked-in contract");
  }
  if (repositoryPromotionState !== contract.activation.state) {
    fail("repository promotion state must exactly match the checked-in provider contract");
  }
  const imageDigest = contract.qualification.image.reference.split("@")[1];
  return Object.freeze({
    accepted: true,
    activationState: contract.activation.state,
    requestedTier,
    imageDigest,
    runtimeObservationPath: contract.qualification.attestor.runtimeObservationPath,
    attestorKeyId: contract.qualification.attestor.keyId,
  });
}

export function runtimeObservationSigningPayload(observationInput) {
  const observation = structuredClone(observationInput);
  if (observation?.provenance && typeof observation.provenance === "object") {
    delete observation.provenance.signature;
  }
  return canonicalJson(observation);
}

export function verifyImageAdmission(contractInput, { admittedAt }) {
  const contract = validateProviderContract(contractInput);
  if (contract.activation.state === "disabled") {
    fail("the checked-in provider contract is disabled");
  }
  canonicalTimestamp(admittedAt, "admittedAt");
  const admissionTime = Date.parse(admittedAt);
  const imageBuiltAt = Date.parse(contract.qualification.image.builtAt);
  if (imageBuiltAt > admissionTime + IMAGE_CLOCK_SKEW_MS) {
    fail("qualified runner image is from the future");
  }
  if (
    admissionTime - imageBuiltAt >
    contract.qualification.image.maxAgeSeconds * 1000
  ) {
    fail("qualified runner image is stale");
  }
  return Object.freeze({
    accepted: true,
    admittedAt,
    imageDigest: contract.qualification.image.reference.split("@")[1],
  });
}

export function verifyRuntimeObservation(contractInput, observation, { observedAt }) {
  const contract = validateProviderContract(contractInput);
  if (contract.activation.state === "disabled") {
    fail("the checked-in provider contract is disabled");
  }
  exactKeys(
    observation,
    ["version", "observedAt", "host", "image", "cuaDriver", "tcc", "provenance"],
    "runtimeObservation",
  );
  if (observation.version !== 1) fail("runtimeObservation.version must be 1");
  canonicalTimestamp(observation.observedAt, "runtimeObservation.observedAt");
  canonicalTimestamp(observedAt, "observedAt");
  exactKeys(
    observation.host,
    ["hostId", "cycleId", "clonePath", "runnerName"],
    "runtimeObservation.host",
  );
  string(observation.host.hostId, "runtimeObservation.host.hostId", { pattern: SAFE_ID });
  string(observation.host.cycleId, "runtimeObservation.host.cycleId", { pattern: SAFE_ID });
  absoluteNormalizedPath(observation.host.clonePath, "runtimeObservation.host.clonePath");
  string(observation.host.runnerName, "runtimeObservation.host.runnerName", {
    pattern: SAFE_ID,
  });
  exactKeys(
    observation.image,
    ["reference", "digest", "admittedAt"],
    "runtimeObservation.image",
  );
  immutableReference(observation.image.reference, "runtimeObservation.image.reference");
  string(observation.image.digest, "runtimeObservation.image.digest", { pattern: SHA256 });
  canonicalTimestamp(observation.image.admittedAt, "runtimeObservation.image.admittedAt");
  exactKeys(
    observation.cuaDriver,
    [
      "artifactDigest",
      "executableDigest",
      "appBundleDigest",
      "cliVersion",
      "appVersion",
      "bundleId",
      "signingIdentity",
      "teamId",
      "appPath",
      "appExecutable",
      "cliSymlink",
    ],
    "runtimeObservation.cuaDriver",
  );
  for (const field of ["artifactDigest", "executableDigest", "appBundleDigest"]) {
    string(observation.cuaDriver[field], `runtimeObservation.cuaDriver.${field}`, {
      pattern: SHA256,
    });
  }
  for (const field of [
    "cliVersion",
    "appVersion",
    "bundleId",
    "signingIdentity",
    "teamId",
    "appPath",
    "appExecutable",
    "cliSymlink",
  ]) {
    string(observation.cuaDriver[field], `runtimeObservation.cuaDriver.${field}`);
  }
  exactKeys(
    observation.tcc,
    [
      "target",
      "services",
      "aquaSession",
      "accessibilityGranted",
      "screenRecordingGranted",
      "smokePassed",
    ],
    "runtimeObservation.tcc",
  );
  exactKeys(
    observation.tcc.target,
    ["kind", "appPath", "bundleId", "signingIdentity", "teamId"],
    "runtimeObservation.tcc.target",
  );
  exactStringArray(
    observation.tcc.services,
    REQUIRED_TCC_SERVICES,
    "runtimeObservation.tcc.services",
  );
  for (const field of [
    "aquaSession",
    "accessibilityGranted",
    "screenRecordingGranted",
    "smokePassed",
  ]) {
    requiredTrue(observation.tcc[field], `runtimeObservation.tcc.${field}`);
  }
  exactKeys(
    observation.provenance,
    ["algorithm", "attestorKeyId", "signature"],
    "runtimeObservation.provenance",
  );
  if (
    observation.provenance.algorithm !== contract.qualification.attestor.algorithm ||
    observation.provenance.attestorKeyId !== contract.qualification.attestor.keyId
  ) {
    fail("runtime observation attestor provenance must match the qualified contract");
  }
  verifyEd25519(
    runtimeObservationSigningPayload(observation),
    observation.provenance.signature,
    contract.qualification.attestor.publicKeyPem,
    "runtime observation signature",
  );

  const observedImageDigest = observation.image.reference.split("@")[1];
  if (
    observation.image.reference !== contract.qualification.image.reference ||
    observation.image.digest !== observedImageDigest
  ) {
    fail("runtime image identity must exactly match the qualified immutable image");
  }
  const expectedCuaDriver = contract.qualification.cuaDriver;
  for (const field of Object.keys(observation.cuaDriver)) {
    if (observation.cuaDriver[field] !== expectedCuaDriver[field]) {
      fail("runtime CuaDriver identity must exactly match the qualified identity");
    }
  }
  const expectedTcc = contract.qualification.tcc;
  if (
    canonicalJson(observation.tcc.target) !== canonicalJson(expectedTcc.target) ||
    canonicalJson(observation.tcc.services) !== canonicalJson(expectedTcc.services)
  ) {
    fail("runtime TCC identity must exactly match the qualified CuaDriver app");
  }
  const observationTime = Date.parse(observation.observedAt);
  const verificationTime = Date.parse(observedAt);
  const admissionTime = Date.parse(observation.image.admittedAt);
  verifyImageAdmission(contract, { admittedAt: observation.image.admittedAt });
  if (
    admissionTime > verificationTime + IMAGE_CLOCK_SKEW_MS ||
    observationTime < admissionTime - IMAGE_CLOCK_SKEW_MS
  ) {
    fail("runtime image admission timestamp is inconsistent");
  }
  if (
    observationTime > verificationTime ||
    verificationTime - observationTime >
      contract.qualification.attestor.maxObservationAgeSeconds * 1000
  ) {
    fail("runtime observation is stale or from the future");
  }
  return Object.freeze({
    accepted: true,
    hostId: observation.host.hostId,
    cycleId: observation.host.cycleId,
    clonePath: observation.host.clonePath,
    runnerName: observation.host.runnerName,
    imageDigest: observation.image.digest,
    attestorKeyId: observation.provenance.attestorKeyId,
    observedAt: observation.observedAt,
  });
}

export function createLifecycleRequest(contractInput, { workflow, runtime, requestedAt }) {
  const contract = validateProviderContract(contractInput);
  if (contract.activation.state === "disabled") {
    fail("the checked-in provider contract is disabled");
  }
  exactKeys(
    workflow,
    [
      "repo",
      "jobId",
      "mergeSha",
      "suiteVersion",
      "attempt",
      "attestationNonce",
      "githubRunId",
      "githubRunAttempt",
    ],
    "workflow",
  );
  exactKeys(
    runtime,
    [
      "accepted",
      "hostId",
      "cycleId",
      "clonePath",
      "runnerName",
      "imageDigest",
      "attestorKeyId",
      "observedAt",
    ],
    "runtime",
  );
  requiredTrue(runtime.accepted, "runtime.accepted");
  if (runtime.attestorKeyId !== contract.qualification.attestor.keyId) {
    fail("runtime attestor must match the qualified lifecycle contract");
  }
  return validateLifecycleRequest({
    version: 1,
    ...workflow,
    runnerName: runtime.runnerName,
    runnerImageDigest: runtime.imageDigest,
    requestedAt,
    attestationPolicy: {
      expectedHostId: runtime.hostId,
      attestorKeyId: contract.qualification.attestor.keyId,
      sinkRepository: contract.qualification.lifecycle.sinkRepository,
      sinkRef: contract.qualification.lifecycle.sinkRef,
    },
    fieldProvenance: {
      workflowKnown: [...WORKFLOW_KNOWN_FIELDS],
      runtimeObserved: [...RUNTIME_OBSERVED_FIELDS],
      contractKnown: [...CONTRACT_KNOWN_FIELDS],
    },
    hostEcho: {
      cycleId: runtime.cycleId,
      clonePath: runtime.clonePath,
    },
  });
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
      "attestationPolicy",
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
  exactKeys(
    request.attestationPolicy,
    ["expectedHostId", "attestorKeyId", "sinkRepository", "sinkRef"],
    "request.attestationPolicy",
  );
  string(request.attestationPolicy.expectedHostId, "request.attestationPolicy.expectedHostId", {
    pattern: SAFE_ID,
  });
  string(request.attestationPolicy.attestorKeyId, "request.attestationPolicy.attestorKeyId", {
    pattern: SAFE_ID,
  });
  string(request.attestationPolicy.sinkRepository, "request.attestationPolicy.sinkRepository", {
    pattern: REPOSITORY,
  });
  if (request.attestationPolicy.sinkRef !== "refs/heads/main") {
    fail("request.attestationPolicy.sinkRef must be refs/heads/main");
  }
  exactKeys(
    request.fieldProvenance,
    ["workflowKnown", "runtimeObserved", "contractKnown"],
    "request.fieldProvenance",
  );
  exactStringArray(
    request.fieldProvenance.workflowKnown,
    WORKFLOW_KNOWN_FIELDS,
    "request.fieldProvenance.workflowKnown",
  );
  exactStringArray(
    request.fieldProvenance.runtimeObserved,
    RUNTIME_OBSERVED_FIELDS,
    "request.fieldProvenance.runtimeObserved",
  );
  exactStringArray(
    request.fieldProvenance.contractKnown,
    CONTRACT_KNOWN_FIELDS,
    "request.fieldProvenance.contractKnown",
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
    attestationPolicy: {
      expectedHostId: attestation.hostId,
      attestorKeyId: attestation.provenance.attestorKeyId,
      sinkRepository: attestation.provenance.sinkRepository,
      sinkRef: attestation.provenance.sinkRef,
    },
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
    attestationPolicy: request.attestationPolicy,
    hostEcho: request.hostEcho,
  };
}

function lifecycleKey(request) {
  return createHash("sha256")
    .update(canonicalJson(requestIdentity(request)))
    .digest("hex");
}

export function lifecycleAttestationPath(requestInput, contractInput) {
  const request = validateLifecycleRequest(requestInput);
  const contract = validateProviderContract(contractInput);
  if (contract.activation.state === "disabled") {
    fail("the checked-in provider contract is disabled");
  }
  return `${contract.qualification.lifecycle.sinkPathPrefix}${lifecycleKey(request)}.json`;
}

function lifecycleAttestationCore(attestationInput) {
  const attestation = structuredClone(attestationInput);
  delete attestation.provenance;
  return attestation;
}

export function lifecycleAttestationBlobDigest(attestation) {
  return sha256(canonicalJson(lifecycleAttestationCore(attestation)));
}

export function lifecycleAttestationSigningPayload(attestationInput) {
  const attestation = structuredClone(attestationInput);
  if (attestation?.provenance && typeof attestation.provenance === "object") {
    delete attestation.provenance.signature;
  }
  return canonicalJson(attestation);
}

export function verifyLifecycleAttestationCandidate(
  requestInput,
  attestation,
  { contract: contractInput, observedAt, sourceObservation } = {},
) {
  const request = validateLifecycleRequest(requestInput);
  if (!contractInput) fail("a trusted qualified provider contract is required");
  const contract = validateProviderContract(contractInput);
  if (contract.activation.state === "disabled") {
    fail("the checked-in provider contract is disabled");
  }
  canonicalTimestamp(observedAt, "observedAt");
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
      "provenance",
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
  exactKeys(
    attestation.provenance,
    [
      "algorithm",
      "attestorKeyId",
      "sinkRepository",
      "sinkRef",
      "sinkPath",
      "blobDigest",
      "signature",
    ],
    "attestation.provenance",
  );
  string(attestation.provenance.attestorKeyId, "attestation.provenance.attestorKeyId", {
    pattern: SAFE_ID,
  });
  string(attestation.provenance.sinkRepository, "attestation.provenance.sinkRepository", {
    pattern: REPOSITORY,
  });
  string(attestation.provenance.sinkPath, "attestation.provenance.sinkPath");
  string(attestation.provenance.blobDigest, "attestation.provenance.blobDigest", {
    pattern: SHA256,
  });

  if (attestation.provenance.attestorKeyId !== request.attestationPolicy.attestorKeyId) {
    fail("attestor provenance must exactly match the trusted lifecycle request");
  }
  if (
    attestation.provenance.sinkRepository !== request.attestationPolicy.sinkRepository ||
    attestation.provenance.sinkRef !== request.attestationPolicy.sinkRef
  ) {
    fail("protected sink provenance must exactly match the trusted lifecycle request");
  }
  if (
    canonicalJson(attestationIdentity(attestation)) !== canonicalJson(requestIdentity(request))
  ) {
    fail("attestation identity must exactly match the trusted lifecycle request");
  }
  if (attestation.hostId !== request.attestationPolicy.expectedHostId) {
    fail("attestation identity must exactly match the trusted lifecycle request host");
  }

  const attestor = contract.qualification.attestor;
  const lifecycle = contract.qualification.lifecycle;
  if (
    request.attestationPolicy.attestorKeyId !== attestor.keyId ||
    attestation.provenance.attestorKeyId !== attestor.keyId ||
    attestation.provenance.algorithm !== attestor.algorithm
  ) {
    fail("attestor provenance must exactly match the trusted qualified contract");
  }
  const expectedSinkPath = lifecycleAttestationPath(request, contract);
  if (
    request.attestationPolicy.sinkRepository !== lifecycle.sinkRepository ||
    request.attestationPolicy.sinkRef !== lifecycle.sinkRef ||
    attestation.provenance.sinkRepository !== lifecycle.sinkRepository ||
    attestation.provenance.sinkRef !== lifecycle.sinkRef ||
    attestation.provenance.sinkPath !== expectedSinkPath
  ) {
    fail("protected sink provenance must exactly match the trusted lifecycle request");
  }
  const expectedBlobDigest = lifecycleAttestationBlobDigest(attestation);
  if (attestation.provenance.blobDigest !== expectedBlobDigest) {
    fail("attestation blob digest does not match the signed lifecycle payload");
  }
  verifyEd25519(
    lifecycleAttestationSigningPayload(attestation),
    attestation.provenance.signature,
    attestor.publicKeyPem,
    "lifecycle attestation signature",
  );

  exactKeys(
    sourceObservation,
    [
      "repository",
      "ref",
      "path",
      "commit",
      "blobSha",
      "blobDigest",
      "fetchedAt",
      "authenticatedBy",
      "branchProtectionVerified",
      "readbackVerified",
      "requiredStatusChecks",
    ],
    "sourceObservation",
  );
  string(sourceObservation.repository, "sourceObservation.repository", {
    pattern: REPOSITORY,
  });
  string(sourceObservation.path, "sourceObservation.path");
  string(sourceObservation.commit, "sourceObservation.commit", {
    pattern: FULL_GIT_SHA,
  });
  string(sourceObservation.blobSha, "sourceObservation.blobSha", {
    pattern: FULL_GIT_SHA,
  });
  string(sourceObservation.blobDigest, "sourceObservation.blobDigest", {
    pattern: SHA256,
  });
  canonicalTimestamp(sourceObservation.fetchedAt, "sourceObservation.fetchedAt");
  exactKeys(
    sourceObservation.authenticatedBy,
    ["appId", "installationId"],
    "sourceObservation.authenticatedBy",
  );
  positiveInteger(
    sourceObservation.authenticatedBy.appId,
    "sourceObservation.authenticatedBy.appId",
  );
  positiveInteger(
    sourceObservation.authenticatedBy.installationId,
    "sourceObservation.authenticatedBy.installationId",
  );
  requiredTrue(
    sourceObservation.branchProtectionVerified,
    "sourceObservation.branchProtectionVerified",
  );
  requiredTrue(sourceObservation.readbackVerified, "sourceObservation.readbackVerified");
  if (
    !Array.isArray(sourceObservation.requiredStatusChecks) ||
    sourceObservation.requiredStatusChecks.length !== 1 ||
    sourceObservation.requiredStatusChecks[0] !== lifecycle.requiredStatusCheck
  ) {
    fail("sourceObservation must prove the required protected-sink status check");
  }
  if (
    sourceObservation.repository !== attestation.provenance.sinkRepository ||
    sourceObservation.ref !== attestation.provenance.sinkRef ||
    sourceObservation.path !== attestation.provenance.sinkPath ||
    sourceObservation.blobDigest !== attestation.provenance.blobDigest ||
    sourceObservation.authenticatedBy.appId !== lifecycle.consumerCredential.appId ||
    sourceObservation.authenticatedBy.installationId !== lifecycle.consumerCredential.installationId
  ) {
    fail("protected sink provenance must be independently authenticated");
  }

  const maxAgeSeconds = 4 * 60 * 60;
  const requestedAt = Date.parse(request.requestedAt);
  const attestedAt = Date.parse(attestation.attestedAt);
  if (attestedAt < requestedAt || attestedAt - requestedAt > maxAgeSeconds * 1000) {
    fail("attestation timestamp is stale or precedes the request");
  }
  const verificationTime = Date.parse(observedAt);
  const fetchedAt = Date.parse(sourceObservation.fetchedAt);
  if (attestedAt > verificationTime || verificationTime - attestedAt > maxAgeSeconds * 1000) {
    fail("attestation observation time is stale or precedes the attestation");
  }
  if (
    fetchedAt < attestedAt ||
    fetchedAt > verificationTime ||
    verificationTime - fetchedAt > 5 * 60 * 1000
  ) {
    fail("protected sink observation is stale or has an invalid timestamp");
  }

  const key = lifecycleKey(request);

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
    consumptionRecord: Object.freeze({
      observedAt,
      sinkCommit: sourceObservation.commit,
      blobDigest: sourceObservation.blobDigest,
    }),
  });
}

export function completeLifecycleConsumption(candidate, consumed) {
  if (
    !candidate ||
    candidate.accepted !== true ||
    typeof candidate.lifecycleKey !== "string" ||
    !["destroyed", "quarantined"].includes(candidate.disposition)
  ) {
    fail("a verified lifecycle candidate is required");
  }
  if (consumed !== true) fail("lifecycle attestation is replayed");
  return Object.freeze({
    accepted: true,
    consumed: true,
    lifecycleKey: candidate.lifecycleKey,
    disposition: candidate.disposition,
    promotionEligible: candidate.promotionEligible,
    containmentVerified: candidate.containmentVerified,
  });
}

export function verifyLifecycleAttestation(
  requestInput,
  attestation,
  { contract: contractInput, consumptionLedger, observedAt, sourceObservation } = {},
) {
  if (
    !consumptionLedger ||
    consumptionLedger.kind !== "durable-lifecycle-consumption-v1" ||
    typeof consumptionLedger.consume !== "function"
  ) {
    fail("a durable consumption ledger is required");
  }
  const candidate = verifyLifecycleAttestationCandidate(requestInput, attestation, {
    contract: contractInput,
    observedAt,
    sourceObservation,
  });
  return completeLifecycleConsumption(
    candidate,
    consumptionLedger.consume(candidate.lifecycleKey, candidate.consumptionRecord),
  );
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

  const shadowBlockers = [];
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
    if (metrics[field] !== 0) shadowBlockers.push(`${label} must be zero`);
  }
  if (metrics.publishedResults !== metrics.verifiedReports) {
    shadowBlockers.push("every published result must link to a verified report");
  }
  const quarantinedAttempts = metrics.attempts.filter(
    (attempt) => attempt.result === "quarantined",
  ).length;
  if (quarantinedAttempts > 0) {
    shadowBlockers.push(
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
    shadowBlockers.push("ten consecutive destroyed exact-SHA qualification jobs are required");
  }

  const percentageWindowOpen = metrics.jobs >= 50 || metrics.observationDays >= 30;
  const productionBlockers = [...shadowBlockers];
  if (percentageWindowOpen) {
    const terminalRate = ratio(metrics.terminalWithoutHuman, metrics.jobs, "terminalWithoutHuman");
    if (terminalRate < 0.98) {
      productionBlockers.push("terminal-without-human rate must be at least 98%");
    }
    const startRate = ratio(
      metrics.startsWithin15Minutes,
      metrics.startsWithCapacity,
      "startsWithin15Minutes",
    );
    if (metrics.startsWithCapacity === 0 || startRate < 0.95) {
      productionBlockers.push(
        "start-within-15-minutes rate must be at least 95% when capacity exists",
      );
    }
    const inconclusiveRate = ratio(
      metrics.infrastructureInconclusive,
      metrics.jobs,
      "infrastructureInconclusive",
    );
    if (inconclusiveRate >= 0.02) {
      productionBlockers.push("infrastructure-inconclusive rate must be below 2%");
    }
  } else {
    productionBlockers.push(
      "production qualification requires at least 50 jobs or 30 days of observation",
    );
  }

  return Object.freeze({
    shadowReady: shadowBlockers.length === 0,
    productionReady: productionBlockers.length === 0,
    shadowBlockers: Object.freeze(shadowBlockers),
    productionBlockers: Object.freeze(productionBlockers),
    consecutiveSuccessful,
    percentageWindowOpen,
  });
}

export const ciliconE2eContractConstants = Object.freeze({
  shadowPromotionState: SHADOW_PROMOTION_STATE,
  productionPromotionState: PRODUCTION_PROMOTION_STATE,
  qualifiedStates: QUALIFIED_STATES,
  promotionVariable: PROMOTION_VARIABLE,
  requiredLabels: REQUIRED_LABELS,
  requiredTccServices: REQUIRED_TCC_SERVICES,
  requiredTools: REQUIRED_TOOLS,
  workflowKnownFields: WORKFLOW_KNOWN_FIELDS,
  runtimeObservedFields: RUNTIME_OBSERVED_FIELDS,
  contractKnownFields: CONTRACT_KNOWN_FIELDS,
});
