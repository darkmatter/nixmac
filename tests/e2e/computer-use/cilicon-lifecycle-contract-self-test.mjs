#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ciliconE2eContractConstants,
  evaluatePromotion,
  requiredDedicatedHosts,
  validateLifecycleRequest,
  validateProviderContract,
  verifyLifecycleAttestation,
} from "../../../ops/runner/cilicon-e2e-contract.mjs";
import { parseWorkflowYaml } from "./workflow-concurrency-contract.mjs";

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
const contractPath = path.join(repoRoot, "ops/images/nixmac-e2e-runner.contract.json");
const workflowPath = path.join(repoRoot, ".github/workflows/computer-use-e2e-centaur.yml");
const operationsPath = path.join(repoRoot, "tests/e2e/computer-use/OPERATIONS.md");

const clone = (value) => structuredClone(value);
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
    improperlyEnabled.activation.state = "qualified-v1";
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
    state: "qualified-v1",
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
      cliVersion: "0.12.6",
      appVersion: "0.12.6",
      bundleId: "com.example.CuaDriver",
      signingIdentity: "Developer ID Application: CuaDriver Example (ABCDE12345)",
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
    lifecycle: {
      mountPath: "/var/db/nixmac-e2e/cycles",
      quarantineSentinel: "/var/db/nixmac-e2e-quarantined",
      sinkRepository: "darkmatter/nixmac-e2e-attestations",
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
assert.equal(validateProviderContract(qualified).activation.state, "qualified-v1");

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
    fieldProvenance: {
      workflowKnown: [...ciliconE2eContractConstants.workflowKnownFields],
      hostEcho: [...ciliconE2eContractConstants.hostEchoFields],
    },
    hostEcho: {
      cycleId: "cycle-99",
      clonePath: "/Users/Shared/Cilicon/vms/cycle-99",
    },
  };
}

const request = validateLifecycleRequest(lifecycleRequest());
assert.deepEqual(request.fieldProvenance.hostEcho, ["hostEcho.cycleId", "hostEcho.clonePath"]);

function destroyedAttestation(requestInput = lifecycleRequest()) {
  return {
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
  };
}

const destroyed = verifyLifecycleAttestation(lifecycleRequest(), destroyedAttestation());
assert.equal(destroyed.disposition, "destroyed");
assert.equal(destroyed.promotionEligible, true);
assert.equal(destroyed.containmentVerified, true);

function attestationMutation(name, mutate, message) {
  const candidateRequest = lifecycleRequest();
  const candidateAttestation = destroyedAttestation(candidateRequest);
  mutate(candidateRequest, candidateAttestation);
  assert.throws(
    () => verifyLifecycleAttestation(candidateRequest, candidateAttestation),
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
const quarantined = verifyLifecycleAttestation(quarantineRequest, quarantineAttestation);
assert.equal(quarantined.disposition, "quarantined");
assert.equal(quarantined.promotionEligible, false);
assert.equal(quarantined.containmentVerified, true);

const unmarkedQuarantine = clone(quarantineAttestation);
unmarkedQuarantine.quarantine.marked = false;
assert.throws(
  () => verifyLifecycleAttestation(quarantineRequest, unmarkedQuarantine),
  /requires a host marker/,
);
assert.throws(
  () =>
    verifyLifecycleAttestation(lifecycleRequest(), destroyedAttestation(), {
      consumedKeys: new Set([destroyed.lifecycleKey]),
    }),
  /replayed/,
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
assert.equal(absoluteReady.ready, true);
assert.equal(absoluteReady.consecutiveSuccessful, 10);
assert.equal(absoluteReady.percentageWindowOpen, false);

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
assert.equal(retryInflationBlocked.ready, false);
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
assert.equal(quarantineBlocked.ready, false);
assert.equal(quarantineBlocked.consecutiveSuccessful, 0);
assert.ok(quarantineBlocked.blockers.some((blocker) => blocker.includes("destruction failures")));

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
assert.equal(percentageReady.ready, true);
assert.equal(percentageReady.percentageWindowOpen, true);

const boundaryFailure = clone(percentageMetrics);
boundaryFailure.infrastructureInconclusive = 1;
assert.equal(
  evaluatePromotion(boundaryFailure).ready,
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
  "needs.preflight.outputs.ready == 'true' && inputs.backend == 'cilicon_tart' && vars.NIXMAC_E2E_CILICON_PROMOTION_STATE == 'qualified-v1' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
);
assert.deepEqual(primary["runs-on"], ["self-hosted", "macOS", "nixmac-e2e"]);
assert.equal(primary.environment, "nixmac-e2e-production");
const toolchainStep = primary.steps.find(
  (step) => step.name === "Verify ephemeral Mac toolchain contract",
);
assert.match(
  toolchainStep.run,
  /NIXMAC_E2E_CILICON_IMAGE_DIGEST.*sha256:\[0-9a-f\]\{64\}/,
  "the gated pool must still reject a mutable or missing image identity",
);

const operations = readFileSync(operationsPath, "utf8");
assert.match(operations, /Tart\/Cilicon lane is disabled/i);
assert.match(operations, /PR #604[\s\S]*not on `main`/i);
assert.match(operations, /repository-level[\s\S]*NIXMAC_E2E_CILICON_PROMOTION_STATE/);
assert.match(operations, /code review and local tests cannot qualify/i);
assert.match(operations, /one host\s+quarantined/i);

console.log("Cilicon E2E lifecycle contract self-test passed.");
