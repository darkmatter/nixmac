#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ciliconE2eContractConstants,
  evaluatePromotion,
  lifecycleAttestationBlobDigest,
  lifecycleAttestationPath,
  lifecycleAttestationSigningPayload,
  requiredDedicatedHosts,
  runtimeObservationSigningPayload,
  validateLifecycleRequest,
  validateProviderContract,
  validateRuntimeProviderGate,
  verifyLifecycleAttestation,
  verifyRuntimeObservation,
} from "../../../ops/runner/cilicon-e2e-contract.mjs";
import { parseWorkflowYaml } from "./workflow-concurrency-contract.mjs";

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
const contractPath = path.join(repoRoot, "ops/images/nixmac-e2e-runner.contract.json");
const workflowPath = path.join(repoRoot, ".github/workflows/computer-use-e2e-centaur.yml");
const operationsPath = path.join(repoRoot, "tests/e2e/computer-use/OPERATIONS.md");

const clone = (value) => structuredClone(value);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const signPayload = (payload) => sign(null, Buffer.from(payload), privateKey).toString("base64");
const checkedInContract = JSON.parse(readFileSync(contractPath, "utf8"));
const validatedDisabled = validateProviderContract(checkedInContract);

assert.equal(validatedDisabled.activation.state, "disabled");
assert.equal(
  validatedDisabled.activation.promotionVariable.scope,
  "repository",
  "a job-level if gate cannot consume environment-scoped variables",
);
assert.ok(validatedDisabled.activation.blockers.includes("PR_604_NOT_MERGED"));
assert.throws(
  () => {
    const improperlyEnabled = clone(checkedInContract);
    improperlyEnabled.activation.state = "production-qualified-v1";
    improperlyEnabled.activation.promotionVariable.requiredValue = "production-qualified-v1";
    improperlyEnabled.activation.blockers = [];
    validateProviderContract(improperlyEnabled);
  },
  /contract keys must be exactly.*qualification/,
  "the checked-in disabled contract cannot be activated without qualification evidence",
);

function qualifiedContract() {
  const contract = clone(checkedInContract);
  contract.activation = {
    ...contract.activation,
    state: "production-qualified-v1",
    promotionVariable: {
      ...contract.activation.promotionVariable,
      requiredValue: "production-qualified-v1",
    },
    blockers: [],
  };
  contract.qualification = {
    image: {
      reference: `ghcr.io/darkmatter/nixmac-e2e-runner@sha256:${"a".repeat(64)}`,
      baseReference: `ghcr.io/cirruslabs/macos-tahoe-base@sha256:${"b".repeat(64)}`,
      sourceWorkflow: ".github/workflows/macos-ci-image.yaml",
      sourceTemplate: "ops/images/nixmac-runner-tahoe.pkr.hcl",
      digestVerified: true,
      secretScanPassed: true,
      containsSecrets: false,
    },
    cuaDriver: {
      artifactUrl: "https://example.invalid/cuadriver/releases/0.12.6/CuaDriver.zip",
      artifactDigest: `sha256:${"c".repeat(64)}`,
      executableDigest: `sha256:${"d".repeat(64)}`,
      appBundleDigest: `sha256:${"e".repeat(64)}`,
      cliVersion: "0.12.6",
      appVersion: "0.12.6",
      bundleId: "com.example.CuaDriver",
      signingIdentity: "Developer ID Application: CuaDriver Example (ABCDE12345)",
      teamId: "ABCDE12345",
      appPath: "/Applications/CuaDriver.app",
      appExecutable: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
      cliSymlink: "/usr/local/bin/cua-driver",
      standaloneLaunchMode: "app-owned-daemon",
    },
    testUser: {
      username: "nixmac_e2e",
      personal: false,
    },
    tools: Object.fromEntries(
      ciliconE2eContractConstants.requiredTools.map((tool) => [tool, true]),
    ),
    tcc: {
      target: {
        kind: "app-bundle",
        appPath: "/Applications/CuaDriver.app",
        bundleId: "com.example.CuaDriver",
        signingIdentity: "Developer ID Application: CuaDriver Example (ABCDE12345)",
        teamId: "ABCDE12345",
      },
      services: ["accessibility", "screenRecording"],
      firstBoot: {
        aquaSession: true,
        accessibilityGranted: true,
        screenRecordingGranted: true,
        smokePassed: true,
      },
      agedBoot: {
        aquaSession: true,
        accessibilityGranted: true,
        screenRecordingGranted: true,
        smokePassed: true,
      },
    },
    attestor: {
      algorithm: "ed25519",
      keyId: "nixmac-e2e-attestor-2026-07",
      publicKeyPem,
      runtimeObservationPath: "/var/db/nixmac-e2e/runtime-observation.json",
      maxObservationAgeSeconds: 900,
    },
    lifecycle: {
      mountPath: "/var/db/nixmac-e2e/cycles",
      quarantineSentinel: "/var/db/nixmac-e2e-quarantined",
      sinkRepository: "darkmatter/nixmac-e2e-attestations",
      sinkRef: "refs/heads/main",
      sinkPathPrefix: "lifecycle/",
      requiredStatusCheck: "verify-lifecycle-attestation",
      sinkCredential: {
        appId: 1001,
        installationId: 101,
        repository: "darkmatter/nixmac-e2e-attestations",
        permissions: {
          contents: "write",
        },
      },
      inventoryCredential: {
        appId: 2002,
        installationId: 202,
        repository: "darkmatter/nixmac",
        permissions: {
          administration: "read",
        },
      },
      oneVmPerAttempt: true,
      capacityOnePerHost: true,
    },
    capacity: {
      peakJobsPerHour: 4,
      p95CycleMinutes: 30,
      dedicatedHosts: 4,
      p95StartMinutesWithOneHostQuarantined: 10,
    },
  };
  return contract;
}

assert.equal(requiredDedicatedHosts({ peakJobsPerHour: 4, p95CycleMinutes: 30 }), 4);
const qualified = qualifiedContract();
assert.equal(
  validateProviderContract(qualified).activation.state,
  "production-qualified-v1",
);
assert.equal(
  validateRuntimeProviderGate(qualified, {
    requestedTier: "production",
    repositoryPromotionState: "production-qualified-v1",
  }).imageDigest,
  `sha256:${"a".repeat(64)}`,
);
assert.throws(
  () =>
    validateRuntimeProviderGate(checkedInContract, {
      requestedTier: "production",
      repositoryPromotionState: "production-qualified-v1",
    }),
  /disabled/,
  "a mutable repository variable must not bypass the checked-in disabled contract",
);
assert.throws(
  () =>
    validateRuntimeProviderGate(qualified, {
      requestedTier: "production",
      repositoryPromotionState: "shadow-qualified-v1",
    }),
  /repository promotion state/,
);
const shadowQualified = qualifiedContract();
shadowQualified.activation.state = "shadow-qualified-v1";
shadowQualified.activation.promotionVariable.requiredValue = "shadow-qualified-v1";
assert.equal(
  validateRuntimeProviderGate(shadowQualified, {
    requestedTier: "shadow",
    repositoryPromotionState: "shadow-qualified-v1",
  }).activationState,
  "shadow-qualified-v1",
);
assert.throws(
  () =>
    validateRuntimeProviderGate(shadowQualified, {
      requestedTier: "production",
      repositoryPromotionState: "shadow-qualified-v1",
    }),
  /production-qualified/,
  "shadow qualification must never authorize production execution",
);

function providerMutation(name, mutate, message) {
  const candidate = qualifiedContract();
  mutate(candidate);
  assert.throws(() => validateProviderContract(candidate), message, name);
}

providerMutation(
  "floating image reference",
  (value) => {
    value.qualification.image.reference = "ghcr.io/darkmatter/nixmac-e2e-runner:latest";
  },
  /immutable GHCR/,
);
providerMutation(
  "floating CuaDriver artifact",
  (value) => {
    value.qualification.cuaDriver.artifactUrl =
      "https://example.invalid/cuadriver/releases/latest/CuaDriver.zip";
  },
  /must not use latest/,
);
providerMutation(
  "mismatched CuaDriver app and CLI",
  (value) => {
    value.qualification.cuaDriver.cliVersion = "0.12.5";
  },
  /CLI and app versions must match/,
);
providerMutation(
  "CuaDriver executable outside app",
  (value) => {
    value.qualification.cuaDriver.appExecutable = "/usr/local/bin/cua-driver";
  },
  /must be owned by CuaDriver\.app/,
);
providerMutation(
  "raw CLI TCC target",
  (value) => {
    value.qualification.tcc.target.kind = "raw-cli";
  },
  /TCC target must be an app-bundle/,
);
providerMutation(
  "TCC identity drift",
  (value) => {
    value.qualification.tcc.target.bundleId = "com.example.OtherDriver";
  },
  /must exactly match/,
);
providerMutation(
  "failed first boot TCC",
  (value) => {
    value.qualification.tcc.firstBoot.screenRecordingGranted = false;
  },
  /must be true/,
);
providerMutation(
  "failed aged boot smoke",
  (value) => {
    value.qualification.tcc.agedBoot.smokePassed = false;
  },
  /must be true/,
);
providerMutation(
  "secret-bearing image",
  (value) => {
    value.qualification.image.containsSecrets = true;
  },
  /containsSecrets must be false/,
);
providerMutation(
  "shared GitHub App identity",
  (value) => {
    value.qualification.lifecycle.inventoryCredential.appId =
      value.qualification.lifecycle.sinkCredential.appId;
  },
  /Apps and installations must be distinct/,
);
providerMutation(
  "over-privileged sink GitHub App",
  (value) => {
    value.qualification.lifecycle.sinkCredential.permissions.actions = "write";
  },
  /permissions keys must be exactly/,
);
providerMutation(
  "inventory credential installed on sink",
  (value) => {
    value.qualification.lifecycle.inventoryCredential.repository =
      "darkmatter/nixmac-e2e-attestations";
  },
  /Administration read on darkmatter\/nixmac/,
);
providerMutation(
  "insufficient capacity",
  (value) => {
    value.qualification.capacity.dedicatedHosts = 3;
  },
  /must be at least 4/,
);
providerMutation(
  "wrong label",
  (value) => {
    value.provider.labels[2] = "nixmac-mac";
  },
  /provider\.labels must contain exactly/,
);
providerMutation(
  "reused VM policy",
  (value) => {
    value.provider.oneVmPerAttempt = false;
  },
  /must be true/,
);
providerMutation(
  "multi-cycle host",
  (value) => {
    value.qualification.lifecycle.capacityOnePerHost = false;
  },
  /must be true/,
);

function runtimeObservation() {
  const value = {
    version: 1,
    observedAt: "2026-07-26T18:05:00.000Z",
    host: {
      hostId: "cilicon-host-01",
      cycleId: "cycle-99",
      clonePath: "/Users/Shared/Cilicon/vms/cycle-99",
      runnerName: "nixmac-e2e-host01-cycle99",
    },
    image: {
      reference: qualified.qualification.image.reference,
      digest: `sha256:${"a".repeat(64)}`,
    },
    cuaDriver: {
      artifactDigest: qualified.qualification.cuaDriver.artifactDigest,
      executableDigest: qualified.qualification.cuaDriver.executableDigest,
      appBundleDigest: qualified.qualification.cuaDriver.appBundleDigest,
      cliVersion: qualified.qualification.cuaDriver.cliVersion,
      appVersion: qualified.qualification.cuaDriver.appVersion,
      bundleId: qualified.qualification.cuaDriver.bundleId,
      signingIdentity: qualified.qualification.cuaDriver.signingIdentity,
      teamId: qualified.qualification.cuaDriver.teamId,
      appPath: qualified.qualification.cuaDriver.appPath,
      appExecutable: qualified.qualification.cuaDriver.appExecutable,
      cliSymlink: qualified.qualification.cuaDriver.cliSymlink,
    },
    tcc: {
      target: clone(qualified.qualification.tcc.target),
      services: [...qualified.qualification.tcc.services],
      aquaSession: true,
      accessibilityGranted: true,
      screenRecordingGranted: true,
      smokePassed: true,
    },
    provenance: {
      algorithm: "ed25519",
      attestorKeyId: qualified.qualification.attestor.keyId,
      signature: "",
    },
  };
  value.provenance.signature = signPayload(runtimeObservationSigningPayload(value));
  return value;
}

const observedRuntime = verifyRuntimeObservation(qualified, runtimeObservation(), {
  observedAt: "2026-07-26T18:06:00.000Z",
});
assert.equal(observedRuntime.imageDigest, `sha256:${"a".repeat(64)}`);
assert.equal(observedRuntime.hostId, "cilicon-host-01");

function runtimeMutation(name, mutate, message, { resign = true } = {}) {
  const candidate = runtimeObservation();
  mutate(candidate);
  if (resign) {
    candidate.provenance.signature = signPayload(runtimeObservationSigningPayload(candidate));
  }
  assert.throws(
    () =>
      verifyRuntimeObservation(qualified, candidate, {
        observedAt: "2026-07-26T18:06:00.000Z",
      }),
    message,
    name,
  );
}

runtimeMutation(
  "signed but wrong image digest",
  (value) => {
    value.image.digest = `sha256:${"f".repeat(64)}`;
  },
  /image identity/,
);
runtimeMutation(
  "signed but wrong executable hash",
  (value) => {
    value.cuaDriver.executableDigest = `sha256:${"f".repeat(64)}`;
  },
  /CuaDriver identity/,
);
runtimeMutation(
  "signed but wrong code-signing identity",
  (value) => {
    value.cuaDriver.signingIdentity = "Developer ID Application: Forged (ZZZZZ99999)";
  },
  /CuaDriver identity/,
);
runtimeMutation(
  "signed but wrong Team ID",
  (value) => {
    value.cuaDriver.teamId = "ZZZZZ99999";
  },
  /CuaDriver identity/,
);
runtimeMutation(
  "signed but wrong TCC target",
  (value) => {
    value.tcc.target.bundleId = "com.example.OtherDriver";
  },
  /TCC identity/,
);
runtimeMutation(
  "stale host observation",
  (value) => {
    value.observedAt = "2026-07-26T17:00:00.000Z";
  },
  /runtime observation is stale/,
);
runtimeMutation(
  "tampered signed observation",
  (value) => {
    value.host.hostId = "cilicon-host-evil";
  },
  /signature is invalid/,
  { resign: false },
);

function lifecycleRequest() {
  return {
    version: 1,
    repo: "darkmatter/nixmac",
    jobId: `darkmatter/nixmac:${"d".repeat(40)}:computer-use-v1`,
    mergeSha: "d".repeat(40),
    suiteVersion: "computer-use-v1",
    attempt: 2,
    attestationNonce: "nonce_".padEnd(64, "x"),
    githubRunId: 123456789,
    githubRunAttempt: 3,
    runnerName: "nixmac-e2e-host01-cycle99",
    runnerImageDigest: `sha256:${"a".repeat(64)}`,
    requestedAt: "2026-07-26T18:00:00.000Z",
    attestationPolicy: {
      expectedHostId: "cilicon-host-01",
      attestorKeyId: qualified.qualification.attestor.keyId,
      sinkRepository: qualified.qualification.lifecycle.sinkRepository,
      sinkRef: qualified.qualification.lifecycle.sinkRef,
    },
    fieldProvenance: {
      workflowKnown: [...ciliconE2eContractConstants.workflowKnownFields],
      runtimeObserved: [...ciliconE2eContractConstants.runtimeObservedFields],
      contractKnown: [...ciliconE2eContractConstants.contractKnownFields],
    },
    hostEcho: {
      cycleId: "cycle-99",
      clonePath: "/Users/Shared/Cilicon/vms/cycle-99",
    },
  };
}

const request = validateLifecycleRequest(lifecycleRequest());
assert.deepEqual(request.fieldProvenance.runtimeObserved, [
  "runnerName",
  "runnerImageDigest",
  "attestationPolicy.expectedHostId",
  "hostEcho.cycleId",
  "hostEcho.clonePath",
]);

function destroyedAttestation(requestInput = lifecycleRequest()) {
  const value = {
    version: 1,
    result: "destroyed",
    repo: requestInput.repo,
    jobId: requestInput.jobId,
    mergeSha: requestInput.mergeSha,
    suiteVersion: requestInput.suiteVersion,
    attempt: requestInput.attempt,
    attestationNonce: requestInput.attestationNonce,
    githubRunId: requestInput.githubRunId,
    githubRunAttempt: requestInput.githubRunAttempt,
    runnerName: requestInput.runnerName,
    runnerImageDigest: requestInput.runnerImageDigest,
    cycleId: requestInput.hostEcho.cycleId,
    clonePath: requestInput.hostEcho.clonePath,
    hostId: "cilicon-host-01",
    attestedAt: "2026-07-26T18:30:00.000Z",
    runnerDeregistered: true,
    clonePathAbsent: true,
    matchingClonePaths: [],
    quarantine: {
      marked: false,
      reason: "",
    },
    provenance: {
      algorithm: "ed25519",
      attestorKeyId: requestInput.attestationPolicy.attestorKeyId,
      sinkRepository: requestInput.attestationPolicy.sinkRepository,
      sinkRef: requestInput.attestationPolicy.sinkRef,
      sinkPath: lifecycleAttestationPath(requestInput, qualified),
      blobDigest: "",
      signature: "",
    },
  };
  value.provenance.blobDigest = lifecycleAttestationBlobDigest(value);
  value.provenance.signature = signPayload(lifecycleAttestationSigningPayload(value));
  return value;
}

function durableLedger() {
  const consumed = new Map();
  return {
    kind: "durable-lifecycle-consumption-v1",
    consume(key, record) {
      if (consumed.has(key)) return false;
      consumed.set(key, record);
      return true;
    },
  };
}

function sourceObservation(attestation) {
  return {
    repository: attestation.provenance.sinkRepository,
    ref: attestation.provenance.sinkRef,
    path: attestation.provenance.sinkPath,
    commit: "f".repeat(40),
    blobDigest: attestation.provenance.blobDigest,
    fetchedAt: "2026-07-26T18:31:00.000Z",
    authenticatedBy: {
      appId: qualified.qualification.lifecycle.sinkCredential.appId,
      installationId: qualified.qualification.lifecycle.sinkCredential.installationId,
    },
    branchProtectionVerified: true,
    requiredStatusChecks: [qualified.qualification.lifecycle.requiredStatusCheck],
  };
}

function verifyLifecycle(requestInput, attestation, overrides = {}) {
  return verifyLifecycleAttestation(requestInput, attestation, {
    contract: qualified,
    consumptionLedger: durableLedger(),
    observedAt: "2026-07-26T18:31:00.000Z",
    sourceObservation: sourceObservation(attestation),
    ...overrides,
  });
}

const destroyed = verifyLifecycle(lifecycleRequest(), destroyedAttestation());
assert.equal(destroyed.disposition, "destroyed");
assert.equal(destroyed.promotionEligible, true);
assert.equal(destroyed.containmentVerified, true);

function attestationMutation(name, mutate, message) {
  const candidateRequest = lifecycleRequest();
  const candidateAttestation = destroyedAttestation(candidateRequest);
  mutate(candidateRequest, candidateAttestation);
  candidateAttestation.provenance.blobDigest =
    lifecycleAttestationBlobDigest(candidateAttestation);
  candidateAttestation.provenance.signature = signPayload(
    lifecycleAttestationSigningPayload(candidateAttestation),
  );
  assert.throws(
    () => verifyLifecycle(candidateRequest, candidateAttestation),
    message,
    name,
  );
}

for (const [name, field, value] of [
  ["forged job ID", "jobId", `darkmatter/nixmac:${"e".repeat(40)}:computer-use-v1`],
  ["mismatched attempt", "attempt", 3],
  ["mismatched nonce", "attestationNonce", "forged_".padEnd(64, "z")],
  ["mismatched GitHub run attempt", "githubRunAttempt", 4],
  ["mismatched runner", "runnerName", "nixmac-e2e-other"],
  ["mismatched image", "runnerImageDigest", `sha256:${"f".repeat(64)}`],
  ["mismatched cycle", "cycleId", "cycle-other"],
  ["mismatched clone", "clonePath", "/Users/Shared/Cilicon/vms/cycle-other"],
  ["mismatched host", "hostId", "cilicon-host-other"],
]) {
  attestationMutation(
    name,
    (_request, attestation) => {
      attestation[field] = value;
    },
    /identity must exactly match/,
  );
}

attestationMutation(
  "runner remains registered under destroyed claim",
  (_request, attestation) => {
    attestation.runnerDeregistered = false;
  },
  /requires runner deregistration/,
);
attestationMutation(
  "exact clone remains under destroyed claim",
  (_request, attestation) => {
    attestation.clonePathAbsent = false;
  },
  /unambiguous clone absence/,
);
attestationMutation(
  "second matching clone",
  (_request, attestation) => {
    attestation.matchingClonePaths = ["/Users/Shared/Cilicon/vms/cycle-99-copy"];
  },
  /unambiguous clone absence/,
);
attestationMutation(
  "stale attestation",
  (_request, attestation) => {
    attestation.attestedAt = "2026-07-27T00:00:00.000Z";
  },
  /timestamp is stale/,
);
attestationMutation(
  "unknown field",
  (_request, attestation) => {
    attestation.untrusted = true;
  },
  /keys must be exactly/,
);

const quarantineRequest = lifecycleRequest();
const quarantineAttestation = destroyedAttestation(quarantineRequest);
quarantineAttestation.result = "quarantined";
quarantineAttestation.runnerDeregistered = false;
quarantineAttestation.clonePathAbsent = false;
quarantineAttestation.matchingClonePaths = [quarantineRequest.hostEcho.clonePath];
quarantineAttestation.quarantine = {
  marked: true,
  reason: "runner deregistration timed out; host admission stopped",
};
quarantineAttestation.provenance.blobDigest =
  lifecycleAttestationBlobDigest(quarantineAttestation);
quarantineAttestation.provenance.signature = signPayload(
  lifecycleAttestationSigningPayload(quarantineAttestation),
);
const quarantined = verifyLifecycle(quarantineRequest, quarantineAttestation);
assert.equal(quarantined.disposition, "quarantined");
assert.equal(quarantined.promotionEligible, false);
assert.equal(quarantined.containmentVerified, true);

const unmarkedQuarantine = clone(quarantineAttestation);
unmarkedQuarantine.quarantine.marked = false;
unmarkedQuarantine.provenance.blobDigest =
  lifecycleAttestationBlobDigest(unmarkedQuarantine);
unmarkedQuarantine.provenance.signature = signPayload(
  lifecycleAttestationSigningPayload(unmarkedQuarantine),
);
assert.throws(
  () => verifyLifecycle(quarantineRequest, unmarkedQuarantine),
  /requires a host marker/,
);
const sharedLedger = durableLedger();
const replayRequest = lifecycleRequest();
const replayAttestation = destroyedAttestation(replayRequest);
verifyLifecycle(replayRequest, replayAttestation, { consumptionLedger: sharedLedger });
assert.throws(
  () =>
    verifyLifecycle(replayRequest, replayAttestation, {
      consumptionLedger: sharedLedger,
    }),
  /replayed/,
);
assert.throws(
  () =>
    verifyLifecycleAttestation(lifecycleRequest(), destroyedAttestation(), {
      contract: qualified,
      observedAt: "2026-07-26T18:31:00.000Z",
      sourceObservation: sourceObservation(destroyedAttestation()),
    }),
  /durable consumption ledger is required/,
);
assert.throws(
  () =>
    verifyLifecycle(lifecycleRequest(), destroyedAttestation(), {
      observedAt: "2026-07-26T23:00:00.000Z",
    }),
  /observation time is stale/,
);
const wrongSinkAttestation = destroyedAttestation();
const wrongSinkSource = sourceObservation(wrongSinkAttestation);
wrongSinkSource.repository = "darkmatter/unprotected-attestations";
assert.throws(
  () =>
    verifyLifecycle(lifecycleRequest(), wrongSinkAttestation, {
      sourceObservation: wrongSinkSource,
    }),
  /protected sink provenance/,
);
const unprotectedSinkAttestation = destroyedAttestation();
const unprotectedSinkSource = sourceObservation(unprotectedSinkAttestation);
unprotectedSinkSource.requiredStatusChecks = [];
assert.throws(
  () =>
    verifyLifecycle(lifecycleRequest(), unprotectedSinkAttestation, {
      sourceObservation: unprotectedSinkSource,
    }),
  /required protected-sink status check/,
);
const wrongAttestor = destroyedAttestation();
wrongAttestor.provenance.attestorKeyId = "unknown-attestor";
wrongAttestor.provenance.blobDigest = lifecycleAttestationBlobDigest(wrongAttestor);
wrongAttestor.provenance.signature = signPayload(
  lifecycleAttestationSigningPayload(wrongAttestor),
);
assert.throws(
  () => verifyLifecycle(lifecycleRequest(), wrongAttestor),
  /attestor provenance/,
);

function successfulJob(index) {
  const mergeSha = index.toString(16).padStart(40, "0");
  return {
    jobId: `darkmatter/nixmac:${mergeSha}:computer-use-v1`,
    mergeSha,
    exactSha: true,
    evidenceVerified: true,
    productPassed: true,
    terminalPublished: true,
  };
}

function promotionMetrics() {
  const qualificationJobs = Array.from({ length: 10 }, (_unused, index) =>
    successfulJob(index + 1),
  );
  return {
    observationDays: 10,
    jobs: 10,
    qualificationJobs,
    attempts: qualificationJobs.map((job) => ({
      jobId: job.jobId,
      result: "destroyed",
    })),
    missingMergedPrs: 0,
    duplicateTerminalPublications: 0,
    identityDigestMismatches: 0,
    unclassifiedFailures: 0,
    cleanupFailures: 0,
    destructionFailures: 0,
    attestationFailures: 0,
    publishedResults: 10,
    verifiedReports: 10,
    terminalWithoutHuman: 10,
    startsWithin15Minutes: 10,
    startsWithCapacity: 10,
    infrastructureInconclusive: 0,
  };
}

const absoluteReady = evaluatePromotion(promotionMetrics());
assert.equal(absoluteReady.shadowReady, true);
assert.equal(
  absoluteReady.productionReady,
  false,
  "ten jobs opens shadow qualification, never production",
);
assert.equal(absoluteReady.consecutiveSuccessful, 10);
assert.equal(absoluteReady.percentageWindowOpen, false);
assert.ok(
  absoluteReady.productionBlockers.some((blocker) => blocker.includes("50 jobs or 30 days")),
);

const retryInflation = promotionMetrics();
retryInflation.jobs = 1;
retryInflation.qualificationJobs = [retryInflation.qualificationJobs[0]];
retryInflation.attempts = Array.from({ length: 10 }, () => ({
  jobId: retryInflation.qualificationJobs[0].jobId,
  result: "destroyed",
}));
retryInflation.publishedResults = 1;
retryInflation.verifiedReports = 1;
retryInflation.terminalWithoutHuman = 1;
retryInflation.startsWithin15Minutes = 1;
retryInflation.startsWithCapacity = 1;
const retryInflationBlocked = evaluatePromotion(retryInflation);
assert.equal(retryInflationBlocked.shadowReady, false);
assert.equal(retryInflationBlocked.productionReady, false);
assert.equal(
  retryInflationBlocked.consecutiveSuccessful,
  1,
  "ten attempts for one job must not satisfy the ten-job qualification gate",
);

const quarantinedMetrics = promotionMetrics();
const quarantinedJob = {
  ...successfulJob(11),
  productPassed: false,
  terminalPublished: false,
};
quarantinedMetrics.qualificationJobs.push(quarantinedJob);
quarantinedMetrics.attempts.push({
  jobId: quarantinedJob.jobId,
  result: "quarantined",
});
quarantinedMetrics.jobs += 1;
const quarantineBlocked = evaluatePromotion(quarantinedMetrics);
assert.equal(quarantineBlocked.shadowReady, false);
assert.equal(quarantineBlocked.productionReady, false);
assert.equal(quarantineBlocked.consecutiveSuccessful, 0);
assert.ok(
  quarantineBlocked.shadowBlockers.some((blocker) =>
    blocker.includes("destruction failures"),
  ),
);

const percentageMetrics = promotionMetrics();
percentageMetrics.observationDays = 30;
percentageMetrics.jobs = 50;
percentageMetrics.qualificationJobs = Array.from({ length: 50 }, (_unused, index) =>
  successfulJob(index + 1),
);
percentageMetrics.attempts = percentageMetrics.qualificationJobs.map((job) => ({
  jobId: job.jobId,
  result: "destroyed",
}));
percentageMetrics.publishedResults = 50;
percentageMetrics.verifiedReports = 50;
percentageMetrics.terminalWithoutHuman = 49;
percentageMetrics.startsWithin15Minutes = 48;
percentageMetrics.startsWithCapacity = 50;
const percentageReady = evaluatePromotion(percentageMetrics);
assert.equal(percentageReady.shadowReady, true);
assert.equal(percentageReady.productionReady, true);
assert.equal(percentageReady.percentageWindowOpen, true);

const boundaryFailure = clone(percentageMetrics);
boundaryFailure.infrastructureInconclusive = 1;
assert.equal(
  evaluatePromotion(boundaryFailure).productionReady,
  false,
  "exactly 2% infrastructure-inconclusive must fail the fewer-than-2% gate",
);

const workflowSource = readFileSync(workflowPath, "utf8");
const workflow = parseWorkflowYaml({
  workflowName: ".github/workflows/computer-use-e2e-centaur.yml",
  source: workflowSource,
});
const primary = workflow.jobs.primary;
assert.equal(
  primary.if,
  "needs.preflight.outputs.ready == 'true' && needs.preflight.outputs.provider_ready == 'true' && inputs.backend == 'cilicon_tart' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
);
assert.deepEqual(primary["runs-on"], ["self-hosted", "macOS", "nixmac-e2e"]);
assert.equal(primary.environment, "nixmac-e2e-production");
const toolchainStep = primary.steps.find(
  (step) => step.name === "Verify ephemeral Mac toolchain contract",
);
assert.match(
  toolchainStep.run,
  /runtime-observation\.json/,
  "the gated pool must verify a host-attested runtime observation",
);
assert.doesNotMatch(
  workflowSource,
  /NIXMAC_E2E_CILICON_IMAGE_DIGEST/,
  "the runner identity must come from an observed signed runtime fact, not a configuration echo",
);
assert.match(workflowSource, /verifyRuntimeObservation/);
assert.match(workflowSource, /validateRuntimeProviderGate/);
assert.match(workflowSource, /TeamIdentifier/);

const operations = readFileSync(operationsPath, "utf8");
assert.match(operations, /Tart\/Cilicon lane is disabled/i);
assert.match(operations, /PR #604[\s\S]*not on `main`/i);
assert.match(operations, /repository-level[\s\S]*NIXMAC_E2E_CILICON_PROMOTION_STATE/);
assert.match(operations, /code review and local tests cannot qualify/i);
assert.match(operations, /one host\s+quarantined/i);
assert.match(operations, /shadow-qualified-v1[\s\S]*production-qualified-v1/i);
assert.match(operations, /runtime-observation\.json[\s\S]*Ed25519/i);
assert.match(operations, /durable[\s\S]*consumption ledger/i);

console.log("Cilicon E2E lifecycle contract self-test passed.");
