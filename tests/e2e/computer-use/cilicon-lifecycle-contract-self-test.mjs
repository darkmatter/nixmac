#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ciliconE2eContractConstants,
  completeLifecycleConsumption,
  createLifecycleRequest,
  evaluatePromotion,
  lifecycleAttestationBlobDigest,
  lifecycleAttestationPath,
  lifecycleAttestationSigningPayload,
  requiredDedicatedHosts,
  runtimeObservationSigningPayload,
  validateLifecycleRequest,
  validateProviderContract,
  validateRuntimeProviderGate,
  verifyImageAdmission,
  verifyLifecycleAttestation,
  verifyLifecycleAttestationCandidate,
  verifyRuntimeObservation,
} from "../../../ops/runner/cilicon-e2e-contract.mjs";
import { consumeLifecycleFromProtectedSink } from "../../../ops/runner/cilicon-lifecycle-consumer.mjs";
import {
  attestLifecycle,
  checkCycleAdmission,
  prepareCycle,
  retireIdleRunner,
  signRuntimeObservation,
  waitForLocalCloneAbsence,
  waitForRunnerDeregistration,
} from "../../../ops/runner/cilicon-e2e-host.mjs";
import { parseWorkflowYaml } from "./workflow-concurrency-contract.mjs";

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
const contractPath = path.join(repoRoot, "ops/images/nixmac-e2e-runner.contract.json");
const workflowPath = path.join(repoRoot, ".github/workflows/computer-use-e2e-centaur.yml");
const buildWorkflowPath = path.join(repoRoot, ".github/workflows/build.yaml");
const imageWorkflowPath = path.join(repoRoot, ".github/workflows/macos-ci-image.yaml");
const operationsPath = path.join(repoRoot, "tests/e2e/computer-use/OPERATIONS.md");
const e2eImageTemplatePath = path.join(
  repoRoot,
  "ops/images/nixmac-e2e-runner-tahoe.pkr.hcl",
);
const e2eImageProvisionerPath = path.join(
  repoRoot,
  "ops/images/provision-nixmac-e2e-runner.sh",
);
const e2eImageQualifierPath = path.join(
  repoRoot,
  "ops/images/qualify-nixmac-e2e-runner.sh",
);
const e2eImageRefresherPath = path.join(
  repoRoot,
  "ops/images/refresh-nixmac-e2e-runner.sh",
);
const hostControllerPath = path.join(repoRoot, "ops/runner/cilicon-e2e-host.mjs");
const cycleWrapperPath = path.join(repoRoot, "ops/runner/cilicon-e2e-cycle-wrapper.sh");
const lifecycleAttestorPath = path.join(
  repoRoot,
  "ops/runner/cilicon-e2e-lifecycle-attestor.sh",
);
const gracefulQuitPath = path.join(
  repoRoot,
  "ops/runner/cilicon-e2e-graceful-quit.swift",
);
const cycleLaunchdPath = path.join(
  repoRoot,
  "ops/runner/com.darkmatter.nixmac-e2e-cycle.plist",
);
const hostInstallerPath = path.join(repoRoot, "ops/runner/install-cilicon-e2e-host.sh");
const ciliconInstallerPath = path.join(repoRoot, "ops/runner/install-cilicon-v2.4.2.sh");
const quarantineHelperPath = path.join(
  repoRoot,
  "ops/runner/nixmac-e2e-mark-quarantine.sh",
);

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
assert.ok(validatedDisabled.activation.blockers.includes("LIFECYCLE_CONSUMER_APP_NOT_PROVISIONED"));
assert.ok(
  validatedDisabled.activation.blockers.includes(
    "DURABLE_LIFECYCLE_CONSUMPTION_STORE_NOT_PROVISIONED",
  ),
);
assert.ok(
  validatedDisabled.requiredQualifiedFields.includes("qualification.image.builtAt") &&
    validatedDisabled.requiredQualifiedFields.includes("qualification.image.maxAgeSeconds"),
  "qualified contracts must bind and expire the immutable image build",
);
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
      sourceTemplate: "ops/images/nixmac-e2e-runner-tahoe.pkr.hcl",
      builtAt: "2026-07-26T12:00:00.000Z",
      maxAgeSeconds: 7 * 24 * 60 * 60,
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
      consumerCredential: {
        appId: 3003,
        installationId: 303,
        repository: "darkmatter/nixmac-e2e-attestations",
        permissions: {
          administration: "read",
          checks: "read",
          contents: "read",
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
assert.equal(validateProviderContract(qualified).activation.state, "production-qualified-v1");
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
  "over-age image policy",
  (value) => {
    value.qualification.image.maxAgeSeconds = 8 * 24 * 60 * 60;
  },
  /must not exceed seven days/,
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
  "consumer reuses the host writer identity",
  (value) => {
    value.qualification.lifecycle.consumerCredential.appId =
      value.qualification.lifecycle.sinkCredential.appId;
  },
  /writer, consumer, and inventory Apps and installations must be distinct/,
);
providerMutation(
  "under-privileged lifecycle consumer",
  (value) => {
    value.qualification.lifecycle.consumerCredential.permissions.checks = "write";
  },
  /consumer credential must have exact read permissions/,
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
      admittedAt: "2026-07-26T18:00:00.000Z",
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

const createdRequest = createLifecycleRequest(qualified, {
  workflow: {
    repo: "darkmatter/nixmac",
    jobId: `darkmatter/nixmac:${"d".repeat(40)}:computer-use-v1`,
    mergeSha: "d".repeat(40),
    suiteVersion: "computer-use-v1",
    attempt: 2,
    attestationNonce: "nonce_".padEnd(64, "x"),
    githubRunId: 123456789,
    githubRunAttempt: 3,
  },
  runtime: observedRuntime,
  requestedAt: "2026-07-26T18:00:00.000Z",
});
assert.deepEqual(createdRequest, lifecycleRequest());

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
    value.image.admittedAt = "2026-07-26T16:59:00.000Z";
    value.observedAt = "2026-07-26T17:00:00.000Z";
  },
  /runtime observation is stale/,
);
{
  const expiredImageObservation = runtimeObservation();
  expiredImageObservation.image.admittedAt = "2026-08-03T12:00:01.000Z";
  expiredImageObservation.observedAt = "2026-08-03T12:00:01.000Z";
  expiredImageObservation.provenance.signature = signPayload(
    runtimeObservationSigningPayload(expiredImageObservation),
  );
  assert.throws(
    () =>
      verifyRuntimeObservation(qualified, expiredImageObservation, {
        observedAt: "2026-08-03T12:00:01.000Z",
      }),
    /qualified runner image is stale/,
    "an expired image must fail even with a fresh signed host observation",
  );
}
assert.equal(
  verifyImageAdmission(qualified, {
    admittedAt: "2026-08-02T11:59:59.000Z",
  }).accepted,
  true,
);
assert.throws(
  () =>
    verifyImageAdmission(qualified, {
      admittedAt: "2026-08-03T12:00:01.000Z",
    }),
  /image is stale/,
);
assert.equal(
  verifyImageAdmission(qualified, {
    admittedAt: "2026-07-26T11:55:00.000Z",
  }).accepted,
  true,
);
assert.throws(
  () =>
    verifyImageAdmission(qualified, {
      admittedAt: "2026-07-26T11:54:59.000Z",
    }),
  /image is from the future/,
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
for (const [name, mutate, message] of [
  [
    "non-canonical request job id",
    (value) => {
      value.jobId = "darkmatter/nixmac:wrong:computer-use-v1";
    },
    /jobId/,
  ],
  [
    "short request nonce",
    (value) => {
      value.attestationNonce = "short";
    },
    /attestationNonce/,
  ],
  [
    "unprotected sink ref",
    (value) => {
      value.attestationPolicy.sinkRef = "refs/heads/other";
    },
    /sinkRef/,
  ],
]) {
  const candidate = lifecycleRequest();
  mutate(candidate);
  assert.throws(() => validateLifecycleRequest(candidate), message, name);
}

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
    blobSha: "b".repeat(40),
    blobDigest: attestation.provenance.blobDigest,
    fetchedAt: "2026-07-26T18:31:00.000Z",
    authenticatedBy: {
      appId: qualified.qualification.lifecycle.consumerCredential.appId,
      installationId: qualified.qualification.lifecycle.consumerCredential.installationId,
    },
    branchProtectionVerified: true,
    readbackVerified: true,
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

const lifecycleCandidate = verifyLifecycleAttestationCandidate(
  lifecycleRequest(),
  destroyedAttestation(),
  {
    contract: qualified,
    observedAt: "2026-07-26T18:31:00.000Z",
    sourceObservation: sourceObservation(destroyedAttestation()),
  },
);
assert.match(lifecycleCandidate.lifecycleKey, /^[0-9a-f]{64}$/);
assert.equal(lifecycleCandidate.disposition, "destroyed");
assert.equal(completeLifecycleConsumption(lifecycleCandidate, true).promotionEligible, true);
assert.throws(() => completeLifecycleConsumption(lifecycleCandidate, false), /replayed/);

const productionConsumption = await consumeLifecycleFromProtectedSink({
  request: lifecycleRequest(),
  contract: qualified,
  observedAt: "2026-07-26T18:31:00.000Z",
  sinkClient: {
    kind: "authenticated-github-protected-sink-v1",
    async fetchAttestation() {
      const attestation = destroyedAttestation();
      return {
        attestation,
        sourceObservation: sourceObservation(attestation),
      };
    },
  },
  storageAdapter: {
    kind: "durable-lifecycle-consumption-v1",
    async consume(key, record) {
      assert.match(key, /^[0-9a-f]{64}$/);
      assert.equal(record.sinkCommit, "f".repeat(40));
      return true;
    },
  },
});
assert.equal(productionConsumption.consumed, true);
assert.equal(productionConsumption.disposition, "destroyed");
await assert.rejects(
  () =>
    consumeLifecycleFromProtectedSink({
      request: lifecycleRequest(),
      contract: qualified,
      observedAt: "2026-07-26T18:31:00.000Z",
      sinkClient: {
        kind: "authenticated-github-protected-sink-v1",
        async fetchAttestation() {
          const attestation = destroyedAttestation();
          return {
            attestation,
            sourceObservation: sourceObservation(attestation),
          };
        },
      },
      storageAdapter: {
        kind: "durable-lifecycle-consumption-v1",
        async consume() {
          return false;
        },
      },
    }),
  /replayed/,
);

const destroyed = verifyLifecycle(lifecycleRequest(), destroyedAttestation());
assert.equal(destroyed.disposition, "destroyed");
assert.equal(destroyed.promotionEligible, true);
assert.equal(destroyed.containmentVerified, true);

{
  const tamperedSignature = destroyedAttestation();
  tamperedSignature.provenance.signature = Buffer.alloc(64, 7).toString("base64");
  assert.throws(
    () =>
      verifyLifecycleAttestationCandidate(lifecycleRequest(), tamperedSignature, {
        contract: qualified,
        observedAt: "2026-07-26T18:31:00.000Z",
        sourceObservation: sourceObservation(tamperedSignature),
      }),
    /signature is invalid/,
  );
}
{
  const tamperedBlobDigest = destroyedAttestation();
  tamperedBlobDigest.provenance.blobDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () =>
      verifyLifecycleAttestationCandidate(lifecycleRequest(), tamperedBlobDigest, {
        contract: qualified,
        observedAt: "2026-07-26T18:31:00.000Z",
        sourceObservation: sourceObservation(tamperedBlobDigest),
      }),
    /blob digest does not match/,
  );
}
{
  const attestation = destroyedAttestation();
  const mismatchedSource = sourceObservation(attestation);
  mismatchedSource.blobDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () =>
      verifyLifecycleAttestationCandidate(lifecycleRequest(), attestation, {
        contract: qualified,
        observedAt: "2026-07-26T18:31:00.000Z",
        sourceObservation: mismatchedSource,
      }),
    /protected sink provenance/,
  );
}

function attestationMutation(name, mutate, message) {
  const candidateRequest = lifecycleRequest();
  const candidateAttestation = destroyedAttestation(candidateRequest);
  mutate(candidateRequest, candidateAttestation);
  candidateAttestation.provenance.blobDigest = lifecycleAttestationBlobDigest(candidateAttestation);
  candidateAttestation.provenance.signature = signPayload(
    lifecycleAttestationSigningPayload(candidateAttestation),
  );
  assert.throws(() => verifyLifecycle(candidateRequest, candidateAttestation), message, name);
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
quarantineAttestation.provenance.blobDigest = lifecycleAttestationBlobDigest(quarantineAttestation);
quarantineAttestation.provenance.signature = signPayload(
  lifecycleAttestationSigningPayload(quarantineAttestation),
);
const quarantined = verifyLifecycle(quarantineRequest, quarantineAttestation);
assert.equal(quarantined.disposition, "quarantined");
assert.equal(quarantined.promotionEligible, false);
assert.equal(quarantined.containmentVerified, true);

const unmarkedQuarantine = clone(quarantineAttestation);
unmarkedQuarantine.quarantine.marked = false;
unmarkedQuarantine.provenance.blobDigest = lifecycleAttestationBlobDigest(unmarkedQuarantine);
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
wrongAttestor.provenance.signature = signPayload(lifecycleAttestationSigningPayload(wrongAttestor));
assert.throws(() => verifyLifecycle(lifecycleRequest(), wrongAttestor), /attestor provenance/);

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
  quarantineBlocked.shadowBlockers.some((blocker) => blocker.includes("destruction failures")),
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
assert.match(operations, /MacStadium bare-metal IaaS[\s\S]*Orka is not a thin adapter/i);
assert.match(operations, /cannot silently grant Screen Recording/i);
assert.match(operations, /maximum qualified age of[\s\S]*seven days/i);
assert.match(operations, /qualified execution slots/i);
assert.match(operations, /Cilicon Image and Host Rotation[\s\S]*nixmac-e2e-drain/i);
const buildWorkflowSource = readFileSync(buildWorkflowPath, "utf8");
assert.match(buildWorkflowSource, /cilicon-lifecycle-consumer-self-test\.mjs/);
assert.match(buildWorkflowSource, /cua-driver-install-contract-self-test\.mjs/);

const e2eImageTemplate = readFileSync(e2eImageTemplatePath, "utf8");
const e2eImageProvisioner = readFileSync(e2eImageProvisionerPath, "utf8");
const e2eImageQualifier = readFileSync(e2eImageQualifierPath, "utf8");
const e2eImageRefresher = readFileSync(e2eImageRefresherPath, "utf8");
const e2eImageSources = [
  e2eImageTemplate,
  e2eImageProvisioner,
  e2eImageQualifier,
  e2eImageRefresher,
].join("\n");
assert.match(e2eImageTemplate, /source_image/);
assert.match(e2eImageTemplate, /source_image_digest/);
assert.match(e2eImageSources, /cua-driver-rs-v0\.12\.6/);
assert.match(e2eImageSources, /c64017d5878d022df34137082fb918ae0d4304e28890569ff14458f1a54fd361/);
assert.match(e2eImageSources, /eae725a09e0cdbda4bb37058a0393b86f7c97b5dda3769a10b1d79269ba8b334/);
assert.match(e2eImageSources, /9b702de4f1591a59428f01e76eceab5a11552d19c26329eef75f0669ddc44da0/);
assert.match(e2eImageSources, /com\.trycua\.driver/);
assert.match(e2eImageSources, /YCK386LBJ7/);
assert.match(e2eImageSources, /nixmac_e2e/);
assert.match(e2eImageSources, /\/Applications\/CuaDriver\.app/);
assert.match(e2eImageSources, /\/usr\/local\/bin\/cua-driver/);
assert.match(e2eImageSources, /Accessibility/);
assert.match(e2eImageSources, /ScreenCapture/);
assert.match(e2eImageSources, /\/Library\/Application Support\/com\.apple\.TCC\/TCC\.db/);
assert.doesNotMatch(e2eImageSources, /CREATE TABLE IF NOT EXISTS access/);
assert.match(e2eImageSources, /\/etc\/paths\.d\/nixmac-e2e-homebrew/);
assert.match(e2eImageSources, /screenLock off/);
assert.match(e2eImageSources, /ffmpeg/);
assert.match(e2eImageTemplate, /refresh-nixmac-e2e-runner\.sh/);
assert.match(e2eImageRefresher, /Runner\.Worker/);
assert.match(e2eImageRefresher, /runtime-probe\.refresh\.json/);
assert.match(e2eImageRefresher, /observedAt == \$expected/);
assert.doesNotMatch(e2eImageProvisioner, /\/tmp\/\*/);
assert.doesNotMatch(
  e2eImageTemplate,
  /(?:github|sink|inventory).*(?:token|private.?key|secret)/i,
  "the immutable VM image must not accept runtime credentials",
);
for (const imageScript of [
  e2eImageProvisionerPath,
  e2eImageQualifierPath,
  e2eImageRefresherPath,
]) {
  const syntax = spawnSync("/bin/bash", ["-n", imageScript], { encoding: "utf8" });
  assert.equal(syntax.status, 0, `${path.basename(imageScript)} must parse: ${syntax.stderr}`);
}

const hostControllerTest = spawnSync(process.execPath, [hostControllerPath, "self-test"], {
  encoding: "utf8",
});
assert.equal(hostControllerTest.status, 0, hostControllerTest.stderr);
assert.match(readFileSync(hostControllerPath, "utf8"), /runtime-probe\.json/);
assert.match(readFileSync(hostControllerPath, "utf8"), /two|absentSamples >= 2/);

for (const scriptPath of [cycleWrapperPath, lifecycleAttestorPath]) {
  const syntax = spawnSync("/bin/bash", ["-n", scriptPath], { encoding: "utf8" });
  assert.equal(
    syntax.status,
    0,
    `${path.basename(scriptPath)} must parse as bash: ${syntax.stderr}`,
  );
  const selfTest = spawnSync("/bin/bash", [scriptPath, "--self-test"], {
    encoding: "utf8",
    env: { ...process.env, NIXMAC_E2E_SELF_TEST: "1" },
  });
  assert.equal(
    selfTest.status,
    0,
    `${path.basename(scriptPath)} self-test failed:\n${selfTest.stdout}\n${selfTest.stderr}`,
  );
}
for (const scriptPath of [hostInstallerPath, ciliconInstallerPath, quarantineHelperPath]) {
  const syntax = spawnSync("/bin/bash", ["-n", scriptPath], { encoding: "utf8" });
  assert.equal(syntax.status, 0, `${path.basename(scriptPath)} must parse: ${syntax.stderr}`);
}

const cycleWrapper = readFileSync(cycleWrapperPath, "utf8");
const hostController = readFileSync(hostControllerPath, "utf8");
const cycleHostSources = `${cycleWrapper}\n${hostController}`;
assert.match(cycleWrapper, /\/private\/var\/db\/nixmac-e2e-host/);
assert.doesNotMatch(cycleWrapper, /REQUEST_TIMEOUT_SECONDS/);
assert.match(cycleWrapper, /wait_for_request_with_runtime_refresh/);
assert.match(cycleWrapper, /FINISHED_WITHOUT_REQUEST_GRACE_SECONDS/);
assert.match(cycleWrapper, /runner-finished\.json/);
assert.match(cycleWrapper, /nixmac-e2e-quarantined/);
assert.match(cycleWrapper, /mkdir.*LOCK_DIR/);
assert.match(cycleWrapper, /reclaimed stale capacity-one cycle lock/);
assert.match(cycleWrapper, /check-image-admission/);
assert.match(cycleWrapper, /check-cycle-admission/);
assert.match(cycleWrapper, /wait-clone-absent/);
assert.match(cycleWrapper, /retire-idle-runner/);
assert.match(cycleWrapper, /DRAIN_SENTINEL/);
assert.match(cycleWrapper, /PENDING_DRAIN_CLEANUP/);
assert.match(cycleWrapper, /drain_idle_cycle/);
assert.match(
  cycleWrapper,
  /wait-clone-absent[\s\S]*?\|\|[\s\S]*?return 76/,
  "drain clone-absence proof must fail closed even when drain_idle_cycle is called from an OR-list",
);
assert.match(
  cycleWrapper,
  /if ! \/usr\/bin\/python3[\s\S]*?drained-cycle\.json[\s\S]*?then[\s\S]*?return 76/,
  "drain evidence persistence must fail closed even when drain_idle_cycle is called from an OR-list",
);
assert.match(cycleHostSources, /runner-busy\.json/);
assert.match(cycleHostSources, /directoryMounts/);
assert.match(cycleHostSources, /vmClonePath/);
assert.match(cycleHostSources, /runnerName/);
assert.match(cycleWrapper, /attestation-request\.json/);
assert.match(cycleWrapper, /claimed-attestation-request\.json/);
assert.match(cycleWrapper, /runtime-observation\.json/);
assert.match(cycleHostSources, /runner-finished\.json/);
assert.match(cycleHostSources, /postRun/);
assert.match(cycleHostSources, /while :; do \/bin\/sleep 3600/);
assert.match(cycleHostSources, /wait-runner-absent/);
assert.match(cycleHostSources, /runtime-refresh-failed/);
assert.match(cycleHostSources, /vm-generation-/);
assert.match(cycleWrapper, /vm_generation_is_unique/);
assert.match(cycleHostSources, /runner-finished\.json/);
assert.match(cycleHostSources, /delay: 900/);
assert.match(cycleWrapper, /cilicon-e2e-lifecycle-attestor\.sh/);
assert.match(cycleWrapper, /ambiguous/i);
assert.match(cycleWrapper, /owned_cilicon_process/);
assert.match(cycleWrapper, /ps -p "\$pid" -o command=/);

const lifecycleAttestor = readFileSync(lifecycleAttestorPath, "utf8");
const attestorSources = `${lifecycleAttestor}\n${hostController}`;
assert.match(lifecycleAttestor, /NIXMAC_E2E_INVENTORY_APP_ID/);
assert.match(lifecycleAttestor, /NIXMAC_E2E_SINK_APP_ID/);
assert.match(lifecycleAttestor, /refusing to contain non-owned process/);
assert.match(attestorSources, /\/actions\/runners/);
assert.match(attestorSources, /repository_dispatch/);
assert.match(attestorSources, /protected sink confirmation/);
assert.match(attestorSources, /attempt <= 5/);
assert.match(attestorSources, /lifecycleAttestationSigningPayload/);
assert.match(attestorSources, /lifecycleAttestationPath/);
assert.match(lifecycleAttestor, /runner.*deregistr/i);
assert.match(lifecycleAttestor, /clone.*absent/i);
assert.match(lifecycleAttestor, /quarantin/i);
assert.doesNotMatch(lifecycleAttestor, /kill -TERM/);
const gracefulQuit = readFileSync(gracefulQuitPath, "utf8");
assert.match(gracefulQuit, /NSRunningApplication/);
assert.match(gracefulQuit, /application\.terminate\(\)/);
assert.match(gracefulQuit, /matching\.count == 1/);

const cycleLaunchdSource = readFileSync(cycleLaunchdPath, "utf8");
const plistLint = spawnSync("/usr/bin/plutil", ["-lint", cycleLaunchdPath], {
  encoding: "utf8",
});
assert.equal(plistLint.status, 0, plistLint.stderr);
assert.match(cycleLaunchdSource, /com\.darkmatter\.nixmac-e2e-cycle/);
assert.match(cycleLaunchdSource, /cilicon-e2e-cycle-wrapper\.sh/);
assert.match(cycleLaunchdSource, /KeepAlive/);
assert.match(cycleLaunchdSource, /ThrottleInterval/);
assert.match(cycleLaunchdSource, /\/opt\/homebrew\/bin/);
assert.match(cycleLaunchdSource, /\/private\/var\/db\/nixmac-e2e-host/);
const hostInstaller = readFileSync(hostInstallerPath, "utf8");
assert.match(hostInstaller, /visudo -cf/);
assert.match(hostInstaller, /launchctl bootstrap/);
assert.match(hostInstaller, /attestor private key does not match/);
assert.match(hostInstaller, /ghcr\.io\/token/);
assert.match(hostInstaller, /docker-content-digest/);
assert.match(hostInstaller, /tart clone "\$image_reference"/);
assert.match(hostInstaller, /swiftc -O/);
assert.match(hostInstaller, /%s %s:staff 640 10 10240 \* J\\n/);
assert.doesNotMatch(hostInstaller, /%s\\\\t640/);
const ciliconInstaller = readFileSync(ciliconInstallerPath, "utf8");
assert.match(ciliconInstaller, /v2\.4\.2/);
assert.match(ciliconInstaller, /b4886bc74d6c4a802b24ef3bc40afa894d8cc13e9c25a912fdc6940a1a79a17c/);
const quarantineHelper = readFileSync(quarantineHelperPath, "utf8");
assert.match(quarantineHelper, /SENTINEL="\/var\/db\/nixmac-e2e-quarantined"/);
assert.doesNotMatch(quarantineHelper, /\$\{?SENTINEL:-/);

const imageWorkflowSource = readFileSync(imageWorkflowPath, "utf8");
assert.match(imageWorkflowSource, /nixmac-e2e-runner-tahoe\.pkr\.hcl/);
assert.match(imageWorkflowSource, /e2e_image_digest/);
assert.match(imageWorkflowSource, /first boot/i);
assert.match(imageWorkflowSource, /second cold boot/i);
assert.match(imageWorkflowSource, /secret scan/i);
assert.match(imageWorkflowSource, /Prove anonymous immutable E2E pull/);
assert.match(imageWorkflowSource, /docker-content-digest/);
assert.match(
  imageWorkflowSource,
  /secret scan[\s\S]*push/i,
  "the E2E image must pass its secret scan before any registry push",
);
const primaryStepNames = primary.steps.map((step) => step.name);
assert.ok(
  primaryStepNames.indexOf("Run exact app with CuaDriver") <
    primaryStepNames.indexOf("Upload trusted lifecycle request"),
  "the test must finish before its lifecycle request is uploaded",
);
assert.ok(
  primaryStepNames.indexOf("Upload trusted lifecycle request") <
    primaryStepNames.indexOf("Publish lifecycle teardown request to host"),
  "the teardown signal must be the final action after durable request upload",
);

const hostCycleRoot = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "nixmac-cilicon-host-cycle-")),
);
try {
  const hostContractPath = path.join(hostCycleRoot, "contract.json");
  const hostStatePath = path.join(hostCycleRoot, "cycle-1", "host-state.json");
  const hostConfigPath = path.join(hostCycleRoot, "cycle-1", "cilicon.yml");
  const hostCycleDir = path.dirname(hostStatePath);
  const hostClonePath = path.join(hostCycleRoot, "clones", "cycle-1");
  const hostRunnerKeyPath = path.join(hostCycleRoot, "runner.pem");
  const hostAttestorKeyPath = path.join(hostCycleRoot, "attestor.pem");
  const hostInventoryKeyPath = path.join(hostCycleRoot, "inventory.pem");
  const hostSinkKeyPath = path.join(hostCycleRoot, "sink.pem");
  const hostProbePath = path.join(hostCycleDir, "exchange", "runtime-probe.json");
  const hostObservationPath = path.join(
    hostCycleDir,
    "exchange",
    "runtime-observation.json",
  );
  const hostRequestPath = path.join(hostCycleDir, "claimed-attestation-request.json");
  const hostAttestationPath = path.join(hostCycleDir, "lifecycle-attestation.json");
  const hostQuarantinePath = path.join(hostCycleRoot, "quarantined.json");
  await mkdir(hostCycleDir, { recursive: true });
  await mkdir(path.dirname(hostClonePath), { recursive: true });
  await writeFile(hostContractPath, `${JSON.stringify(qualified, null, 2)}\n`);
  await writeFile(hostRunnerKeyPath, "runner fixture\n");
  await writeFile(hostAttestorKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  const inventoryKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sinkKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await writeFile(
    hostInventoryKeyPath,
    inventoryKeys.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  await writeFile(
    hostSinkKeyPath,
    sinkKeys.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  await prepareCycle({
    contractPath: hostContractPath,
    statePath: hostStatePath,
    configPath: hostConfigPath,
    cycleDir: hostCycleDir,
    hostId: "cilicon-host-01",
    cycleId: "cycle-1",
    clonePath: hostClonePath,
    runnerName: "cilicon-host-01-cycle-1",
    runnerAppId: "4004",
    runnerPrivateKeyPath: hostRunnerKeyPath,
    sshUsername: "nixmac_e2e",
    sshPassword: "fixture-only",
    now: () => new Date("2026-07-26T18:00:00.000Z"),
  });
  assert.equal(
    (
      await checkCycleAdmission({
        contractPath: hostContractPath,
        statePath: hostStatePath,
        now: () => new Date("2026-07-26T18:01:00.000Z"),
      })
    ).accepted,
    true,
  );
  {
    let runnerDeleted = false;
    let runnerBusy = true;
    let runnerClock = Date.parse("2026-07-26T18:01:00.000Z");
    const runnerAppPrivateKey = inventoryKeys.privateKey.export({
      type: "pkcs8",
      format: "pem",
    });
    const runnerFetch = async (url, options = {}) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/repos/darkmatter/nixmac/installation") {
        return new Response(
          JSON.stringify({
            id: 3003,
            app_id: 4004,
            repository_selection: "selected",
          }),
          { status: 200 },
        );
      }
      if (parsed.pathname === "/app/installations/3003") {
        return new Response(
          JSON.stringify({
            id: 3003,
            app_id: 4004,
            repository_selection: "selected",
          }),
          { status: 200 },
        );
      }
      if (parsed.pathname === "/app/installations/3003/access_tokens") {
        return new Response(
          JSON.stringify({
            token: "runner-token",
            expires_at: "2026-07-26T19:00:00.000Z",
            permissions: { administration: "write" },
            repositories: [{ full_name: "darkmatter/nixmac" }],
          }),
          { status: 201 },
        );
      }
      if (
        parsed.pathname === "/repos/darkmatter/nixmac/actions/runners" &&
        options.method !== "DELETE"
      ) {
        const runners = runnerDeleted
          ? []
          : [
              {
                id: 77,
                name: "cilicon-host-01-cycle-1",
                busy: runnerBusy,
                status: "online",
              },
            ];
        return new Response(JSON.stringify({ total_count: runners.length, runners }), {
          status: 200,
        });
      }
      if (
        parsed.pathname === "/repos/darkmatter/nixmac/actions/runners/77" &&
        options.method === "DELETE"
      ) {
        runnerDeleted = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected runner retirement request: ${options.method ?? "GET"} ${url}`);
    };
    const busyRetirement = await retireIdleRunner({
      contract: qualified,
      state: JSON.parse(await readFile(hostStatePath, "utf8")),
      runnerAppId: 4004,
      runnerPrivateKeyPem: runnerAppPrivateKey,
      fetchImpl: runnerFetch,
      apiBaseUrl: "https://api.github.test",
      sleep: async (milliseconds) => {
        runnerClock += milliseconds;
      },
      now: () => new Date(runnerClock),
    });
    assert.equal(busyRetirement.retired, false);
    assert.equal(busyRetirement.busy, true);
    runnerBusy = false;
    const retired = await retireIdleRunner({
      contract: qualified,
      state: JSON.parse(await readFile(hostStatePath, "utf8")),
      runnerAppId: 4004,
      runnerPrivateKeyPem: runnerAppPrivateKey,
      fetchImpl: runnerFetch,
      apiBaseUrl: "https://api.github.test",
      sleep: async (milliseconds) => {
        runnerClock += milliseconds;
      },
      now: () => new Date(runnerClock),
    });
    assert.equal(retired.retired, true);
    assert.equal(retired.alreadyAbsent, false);
    assert.equal(runnerDeleted, true);
  }
  {
    let cloneAbsenceClock = 0;
    const cloneAbsence = await waitForLocalCloneAbsence({
      state: JSON.parse(await readFile(hostStatePath, "utf8")),
      timeoutMs: 10_000,
      pollMs: 1,
      sleep: async () => {
        cloneAbsenceClock += 1;
      },
      now: () => new Date(cloneAbsenceClock),
    });
    assert.equal(cloneAbsence.clonePathAbsent, true);
    assert.deepEqual(cloneAbsence.matchingClonePaths, []);
  }
  const renderedConfig = await readFile(hostConfigPath, "utf8");
  assert.match(renderedConfig, /oci:\/\/ghcr\.io\/darkmatter\/nixmac-e2e-runner:sha256:/);
  assert.match(renderedConfig, /runtime-probe\.json/);
  assert.match(renderedConfig, /runtime-observation\.json/);
  assert.match(renderedConfig, /guestFolder: "nixmac-e2e"/);
  const probeCuaDriver = Object.fromEntries(
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
    ].map((field) => [field, qualified.qualification.cuaDriver[field]]),
  );
  await writeFile(
    hostProbePath,
    `${JSON.stringify(
      {
        version: 1,
        observedAt: "2026-07-26T18:00:01.000Z",
        cuaDriver: probeCuaDriver,
        tcc: {
          target: qualified.qualification.tcc.target,
          services: qualified.qualification.tcc.services,
          aquaSession: true,
          accessibilityGranted: true,
          screenRecordingGranted: true,
          smokePassed: true,
        },
      },
      null,
      2,
    )}\n`,
  );
  const hostObservation = await signRuntimeObservation({
    contractPath: hostContractPath,
    statePath: hostStatePath,
    probePath: hostProbePath,
    signingKeyPath: hostAttestorKeyPath,
    outputPath: hostObservationPath,
    now: () => new Date("2026-07-26T18:00:02.000Z"),
  });
  const hostRuntime = verifyRuntimeObservation(qualified, hostObservation, {
    observedAt: "2026-07-26T18:00:02.000Z",
  });
  const hostRequest = createLifecycleRequest(qualified, {
    workflow: {
      repo: "darkmatter/nixmac",
      jobId: `darkmatter/nixmac:${"d".repeat(40)}:computer-use-v1`,
      mergeSha: "d".repeat(40),
      suiteVersion: "computer-use-v1",
      attempt: 2,
      attestationNonce: "nonce_".padEnd(64, "x"),
      githubRunId: 123456789,
      githubRunAttempt: 3,
    },
    runtime: hostRuntime,
    requestedAt: "2026-07-26T18:10:00.000Z",
  });
  const reorderedHostRequest = structuredClone(hostRequest);
  reorderedHostRequest.attestationPolicy = {
    sinkRef: hostRequest.attestationPolicy.sinkRef,
    sinkRepository: hostRequest.attestationPolicy.sinkRepository,
    attestorKeyId: hostRequest.attestationPolicy.attestorKeyId,
    expectedHostId: hostRequest.attestationPolicy.expectedHostId,
  };
  reorderedHostRequest.hostEcho = {
    clonePath: hostRequest.hostEcho.clonePath,
    cycleId: hostRequest.hostEcho.cycleId,
  };
  assert.equal(
    lifecycleAttestationPath(reorderedHostRequest, qualified),
    lifecycleAttestationPath(hostRequest, qualified),
    "lifecycle identity hashing must not depend on JSON key insertion order",
  );
  const reorderedAttestation = destroyedAttestation(reorderedHostRequest);
  assert.doesNotThrow(() =>
    verifyLifecycleAttestationCandidate(reorderedHostRequest, reorderedAttestation, {
      contract: qualified,
      observedAt: "2026-07-26T18:31:00.000Z",
      sourceObservation: sourceObservation(reorderedAttestation),
    }),
  );
  await writeFile(hostRequestPath, `${JSON.stringify(hostRequest, null, 2)}\n`);

  let inventoryRequests = 0;
  let inventoryTransientFailures = 0;
  let sinkDispatches = 0;
  let persistedSinkAttestation = null;
  let sinkConfirmationMisses = 0;
  const jsonResponse = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
  const exactGithubFetch = async (url, options) => {
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (parsed.pathname === "/app/installations/202") {
      return jsonResponse({ id: 202, app_id: 2002, repository_selection: "selected" });
    }
    if (parsed.pathname === "/app/installations/202/access_tokens") {
      assert.deepEqual(body, {
        repositories: ["nixmac"],
        permissions: { administration: "read" },
      });
      return jsonResponse(
        {
          token: "inventory-token",
          expires_at: "2026-07-26T19:00:00.000Z",
          permissions: { administration: "read" },
          repositories: [{ full_name: "darkmatter/nixmac" }],
        },
        201,
      );
    }
    if (parsed.pathname === "/repos/darkmatter/nixmac/actions/runners") {
      if (inventoryTransientFailures > 0) {
        inventoryTransientFailures -= 1;
        return jsonResponse({ message: "temporary outage" }, 503);
      }
      inventoryRequests += 1;
      assert.equal(options.headers.authorization, "Bearer inventory-token");
      return jsonResponse({ total_count: 0, runners: [] });
    }
    if (parsed.pathname === "/app/installations/101") {
      return jsonResponse({ id: 101, app_id: 1001, repository_selection: "selected" });
    }
    if (parsed.pathname === "/app/installations/101/access_tokens") {
      assert.deepEqual(body, {
        repositories: ["nixmac-e2e-attestations"],
        permissions: { contents: "write" },
      });
      return jsonResponse(
        {
          token: "sink-token",
          expires_at: "2026-07-26T19:00:00.000Z",
          permissions: { contents: "write" },
          repositories: [{ full_name: "darkmatter/nixmac-e2e-attestations" }],
        },
        201,
      );
    }
    if (parsed.pathname === "/repos/darkmatter/nixmac-e2e-attestations/dispatches") {
      sinkDispatches += 1;
      assert.equal(options.headers.authorization, "Bearer sink-token");
      assert.equal(body.event_type, "cilicon_lifecycle_attestation");
      persistedSinkAttestation = body.client_payload.attestation;
      return new Response(null, { status: 204 });
    }
    if (
      parsed.pathname.startsWith(
        "/repos/darkmatter/nixmac-e2e-attestations/contents/lifecycle/",
      )
    ) {
      if (sinkConfirmationMisses > 0) {
        sinkConfirmationMisses -= 1;
        return jsonResponse({ message: "not persisted yet" }, 404);
      }
      assert.ok(persistedSinkAttestation);
      return jsonResponse({
        type: "file",
        path: persistedSinkAttestation.provenance.sinkPath,
        encoding: "base64",
        content: Buffer.from(
          `${JSON.stringify(persistedSinkAttestation, null, 2)}\n`,
        ).toString("base64"),
      });
    }
    throw new Error(`unexpected GitHub request ${options.method} ${parsed.pathname}${parsed.search}`);
  };
  inventoryTransientFailures = 1;
  const deregistration = await waitForRunnerDeregistration({
    state: JSON.parse(await readFile(hostStatePath, "utf8")),
    inventoryCredential: qualified.qualification.lifecycle.inventoryCredential,
    inventoryPrivateKeyPem: await readFile(hostInventoryKeyPath, "utf8"),
    fetchImpl: exactGithubFetch,
    apiBaseUrl: "https://api.github.com",
    timeoutMs: 10,
    pollMs: 1,
    sleep: async () => {},
    now: () => new Date("2026-07-26T18:29:00.000Z"),
  });
  assert.deepEqual(deregistration, { runnerDeregistered: true, samples: 2 });
  assert.equal(inventoryRequests, 2);
  inventoryRequests = 0;
  const destroyed = await attestLifecycle({
    contractPath: hostContractPath,
    statePath: hostStatePath,
    requestPath: hostRequestPath,
    signingKeyPath: hostAttestorKeyPath,
    inventoryPrivateKeyPath: hostInventoryKeyPath,
    sinkPrivateKeyPath: hostSinkKeyPath,
    outputPath: hostAttestationPath,
    quarantineSentinel: hostQuarantinePath,
    fetchImpl: exactGithubFetch,
    sleep: async () => {},
    now: () => new Date("2026-07-26T18:30:00.000Z"),
  });
  assert.equal(destroyed.result, "destroyed");
  assert.equal(inventoryRequests, 2, "clone and runner absence require two observations");
  assert.equal(sinkDispatches, 1);

  await attestLifecycle({
    contractPath: hostContractPath,
    statePath: hostStatePath,
    requestPath: hostRequestPath,
    signingKeyPath: hostAttestorKeyPath,
    inventoryPrivateKeyPath: hostInventoryKeyPath,
    sinkPrivateKeyPath: hostSinkKeyPath,
    outputPath: hostAttestationPath,
    quarantineSentinel: hostQuarantinePath,
    fetchImpl: exactGithubFetch,
    sleep: async () => {},
    now: () => new Date("2026-07-26T18:31:00.000Z"),
  });
  assert.equal(inventoryRequests, 2, "restart must reuse the exact persisted attestation");
  assert.equal(sinkDispatches, 2, "restart may idempotently replay the exact sink dispatch");

  let forcedClock = Date.parse("2026-07-26T18:31:30.000Z");
  sinkConfirmationMisses = 4;
  const dispatchesBeforeConfirmationRetry = sinkDispatches;
  const forcedQuarantine = await attestLifecycle({
    contractPath: hostContractPath,
    statePath: hostStatePath,
    requestPath: hostRequestPath,
    signingKeyPath: hostAttestorKeyPath,
    inventoryPrivateKeyPath: hostInventoryKeyPath,
    sinkPrivateKeyPath: hostSinkKeyPath,
    outputPath: path.join(hostCycleDir, "forced-quarantine-attestation.json"),
    quarantineSentinel: hostQuarantinePath,
    forcedQuarantineReason: "normal Cilicon termination was not proved",
    fetchImpl: exactGithubFetch,
    sleep: async (milliseconds) => {
      forcedClock += milliseconds;
    },
    now: () => new Date(forcedClock),
  });
  assert.equal(forcedQuarantine.result, "quarantined");
  assert.equal(forcedQuarantine.runnerDeregistered, true);
  assert.equal(forcedQuarantine.clonePathAbsent, true);
  assert.match(forcedQuarantine.quarantine.reason, /termination was not proved/);
  assert.equal(
    sinkDispatches - dispatchesBeforeConfirmationRetry,
    2,
    "the host must re-dispatch until protected main confirms the exact attestation",
  );

  let timeoutClock = Date.parse("2026-07-26T18:32:00.000Z");
  const runnerNeverDeregisteredFetch = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/repos/darkmatter/nixmac/actions/runners") {
      return jsonResponse({
        total_count: 1,
        runners: [{ name: "cilicon-host-01-cycle-1" }],
      });
    }
    return exactGithubFetch(url, options);
  };
  const timedOut = await attestLifecycle({
    contractPath: hostContractPath,
    statePath: hostStatePath,
    requestPath: hostRequestPath,
    signingKeyPath: hostAttestorKeyPath,
    inventoryPrivateKeyPath: hostInventoryKeyPath,
    sinkPrivateKeyPath: hostSinkKeyPath,
    outputPath: path.join(hostCycleDir, "timeout-attestation.json"),
    quarantineSentinel: hostQuarantinePath,
    fetchImpl: runnerNeverDeregisteredFetch,
    timeoutMs: 2,
    pollMs: 1,
    sleep: async (milliseconds) => {
      timeoutClock += milliseconds;
    },
    now: () => new Date(timeoutClock),
  });
  assert.equal(timedOut.result, "quarantined");
  assert.equal(timedOut.runnerDeregistered, false);
  assert.match(timedOut.quarantine.reason, /timed out/);
  assert.equal(JSON.parse(await readFile(hostQuarantinePath, "utf8")).cycleId, "cycle-1");

  const mismatchedRequestPath = path.join(hostCycleDir, "mismatched-request.json");
  const mismatchedRequest = structuredClone(hostRequest);
  mismatchedRequest.runnerName = "forged-runner";
  await writeFile(mismatchedRequestPath, `${JSON.stringify(mismatchedRequest)}\n`);
  await assert.rejects(
    () =>
      attestLifecycle({
        contractPath: hostContractPath,
        statePath: hostStatePath,
        requestPath: mismatchedRequestPath,
        signingKeyPath: hostAttestorKeyPath,
        inventoryPrivateKeyPath: hostInventoryKeyPath,
        sinkPrivateKeyPath: hostSinkKeyPath,
        outputPath: path.join(hostCycleDir, "forged-attestation.json"),
        quarantineSentinel: hostQuarantinePath,
        fetchImpl: exactGithubFetch,
      }),
    /host cycle/,
    "a guest cannot redirect a host attestation to a forged runner identity",
  );
} finally {
  await rm(hostCycleRoot, { recursive: true, force: true });
}

console.log("Cilicon E2E lifecycle contract self-test passed.");
