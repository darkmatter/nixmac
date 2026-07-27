#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseWorkflowYaml } from "./workflow-concurrency-contract.mjs";

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
const workflowName = ".github/workflows/computer-use-e2e-centaur.yml";
const source = readFileSync(path.join(repoRoot, workflowName), "utf8");
const workflow = parseWorkflowYaml({ workflowName, source });
const actionlintConfig = parseWorkflowYaml({
  workflowName: ".github/actionlint.yaml",
  source: readFileSync(path.join(repoRoot, ".github/actionlint.yaml"), "utf8"),
});
const terminalFixture = JSON.parse(
  readFileSync(
    path.join(repoRoot, "tests/e2e/computer-use/fixtures/terminal-contract.v2.json"),
    "utf8",
  ),
);
const operations = readFileSync(
  path.join(repoRoot, "tests/e2e/computer-use/OPERATIONS.md"),
  "utf8",
);
const readme = readFileSync(
  path.join(repoRoot, "tests/e2e/computer-use/README.md"),
  "utf8",
);

function stepNamed(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing step ${name}`);
  return step;
}

function runPreflightClassifier({
  name,
  status = "READY",
  toolchain = "success",
  inputs = "success",
  artifact = "success",
  bind = "success",
}) {
  const step = workflow.jobs.preflight.steps.find((candidate) => candidate.id === "classify");
  assert.ok(step, "preflight must expose its classifier");
  const substitutions = new Map([
    ["${{ steps.toolchain.outcome }}", toolchain],
    ["${{ steps.inputs.outcome }}", inputs],
    ["${{ steps.artifact.outcome }}", artifact],
    ["${{ steps.bind.outcome }}", bind],
  ]);
  let script = step.run;
  for (const [expression, value] of substitutions) {
    script = script.replaceAll(expression, value);
  }
  assert.doesNotMatch(script, /\$\{\{/, `${name}: all workflow expressions must be bound`);

  const runRoot = mkdtempSync(path.join(os.tmpdir(), `nixmac-centaur-preflight-${name}-`));
  try {
    const preflightDir = path.join(runRoot, "centaur-preflight");
    const outputPath = path.join(runRoot, "github-output");
    mkdirSync(preflightDir, { recursive: true });
    writeFileSync(path.join(preflightDir, "terminal-status"), `${status}\n`);
    const result = spawnSync("bash", ["-s"], {
      encoding: "utf8",
      env: {
        ...process.env,
        RUNNER_TEMP: runRoot,
        GITHUB_OUTPUT: outputPath,
      },
      input: script,
    });
    assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`);
    return Object.fromEntries(
      readFileSync(outputPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
}

function runTerminalContractScenario({
  name,
  preflightResult = "success",
  preflightReady = "true",
  terminalStatus = "READY",
  staticResult = "success",
  reportResult = "success",
  staticArtifactId = "98765",
  staticArtifactDigest = `sha256:${"a".repeat(64)}`,
  staticInfraDisposition = "LEASE_ACQUIRED",
  qualificationTier = "production",
  reportUrl = terminalFixture.reportUrl,
  evidenceStorage = terminalFixture.evidenceStorage,
}) {
  const step = stepNamed(workflow.jobs.result, "Write one terminal contract");
  const runRoot = mkdtempSync(path.join(os.tmpdir(), `nixmac-centaur-result-${name}-`));
  try {
    const outputPath = path.join(runRoot, "github-output");
    const storage = evidenceStorage || {};
    const result = spawnSync("bash", ["-s"], {
      encoding: "utf8",
      env: {
        ...process.env,
        RUNNER_TEMP: runRoot,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: path.join(runRoot, "summary"),
        GITHUB_RUN_ID: terminalFixture.workflowRunId,
        GITHUB_RUN_ATTEMPT: terminalFixture.workflowRunAttempt,
        PREFLIGHT_RESULT: preflightResult,
        PREFLIGHT_READY: preflightReady,
        TERMINAL_STATUS: terminalStatus,
        STATIC_RESULT: staticResult,
        REPORT_RESULT: reportResult,
        STATIC_ARTIFACT_ID: staticArtifactId,
        STATIC_ARTIFACT_DIGEST: staticArtifactDigest,
        STATIC_INFRA_DISPOSITION: staticInfraDisposition,
        REPORT_URL: reportUrl,
        STORAGE_RECEIPT_KEY: storage.receipt?.key || "",
        STORAGE_RECEIPT_DIGEST: storage.receipt?.digest || "",
        STORAGE_BUCKET: storage.bucket || "",
        STORAGE_ARCHIVE_KEY: storage.archive?.key || "",
        STORAGE_ARCHIVE_DIGEST: storage.archive?.digest || "",
        STORAGE_ARCHIVE_BYTES: String(storage.archive?.bytes || ""),
        STORAGE_MANIFEST_KEY: storage.report?.manifestKey || "",
        STORAGE_MANIFEST_DIGEST: storage.report?.manifestDigest || "",
        EVIDENCE_EXPIRES_AT: storage.evidenceExpiresAt || "",
        INPUT_JOB_ID: terminalFixture.jobId,
        INPUT_ATTEMPT: String(terminalFixture.attempt),
        INPUT_BACKEND: "static_ssh",
        QUALIFICATION_TIER: qualificationTier,
      },
      input: step.run,
    });
    assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`);
    return {
      contract: JSON.parse(
        readFileSync(
          path.join(runRoot, "nixmac-e2e-terminal/terminal-contract.json"),
          "utf8",
        ),
      ),
      outputs: readFileSync(outputPath, "utf8"),
    };
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
}

assert.deepEqual(
  actionlintConfig["self-hosted-runner"].labels,
  ["arc", "nixmac-e2e", "nixmac-e2e-static-controller"],
  "actionlint must recognize only the queues owned by this branch",
);
assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
assert.equal(Object.hasOwn(workflow, "concurrency"), false);

const dispatch = workflow.on.workflow_dispatch;
const requiredInputs = [
  "merge_sha",
  "job_id",
  "attempt",
  "suite_version",
  "build_run_id",
  "app_artifact_id",
  "app_artifact_digest",
  "attestation_nonce",
  "backend",
  "qualification_tier",
];
assert.deepEqual(Object.keys(dispatch.inputs), requiredInputs);
for (const input of requiredInputs) {
  assert.equal(dispatch.inputs[input].required, true, `${input} must be required`);
}
assert.deepEqual(dispatch.inputs.backend.options, ["static_ssh"]);
assert.deepEqual(dispatch.inputs.qualification_tier.options, ["shadow", "production"]);
assert.equal(dispatch.inputs.qualification_tier.default, "production");

const jobs = workflow.jobs;
assert.deepEqual(
  Object.keys(jobs),
  ["preflight", "static_ssh", "publish_report", "result"],
  "the clean workflow must own one static backend and one terminal result",
);
const { preflight, static_ssh: staticJob, publish_report: publish, result } = jobs;

assert.equal(preflight["runs-on"], "arc");
assert.equal(preflight["timeout-minutes"], 15);
assert.deepEqual(Object.keys(preflight.outputs), [
  "ready",
  "terminal_status",
  "harness_sha",
  "job_key",
]);
const preflightText = JSON.stringify(preflight);
assert.match(preflightText, /actions\/checkout@v6/);
assert.match(preflightText, /nixmac-macos-app-e2e/);
assert.match(preflightText, /\.github\/workflows\/build\.yaml/);
assert.match(preflightText, /producing_event.*push/);
assert.match(preflightText, /producing_head_branch.*DEFAULT_BRANCH/);
assert.match(preflightText, /workflow_run_head_sha.*MERGE_SHA/);
assert.match(preflightText, /head_repository\.full_name/);
assert.match(preflightText, /sha256:\[0-9a-f\]\{64\}/);
assert.match(preflightText, /ditto|preserved\.zip|nixmac-macos-app-preserved\.zip/);
assert.doesNotMatch(
  preflightText,
  /workflow_dispatch.*producing_event|operator rebuild|backfill/i,
  "Centaur must consume only a default-branch push artifact",
);

assert.equal(staticJob.needs, "preflight");
assert.equal(
  staticJob.if,
  "needs.preflight.outputs.ready == 'true' && inputs.backend == 'static_ssh' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
);
assert.deepEqual(staticJob["runs-on"], [
  "self-hosted",
  "linux",
  "nixmac-e2e-static-controller",
]);
assert.equal(staticJob.environment, "nixmac-e2e-production");
assert.equal(staticJob["timeout-minutes"], 180);
assert.equal(Object.hasOwn(staticJob, "concurrency"), false);
assert.equal(
  staticJob.outputs.infra_disposition,
  "${{ steps.lease.outputs.disposition || steps.initialize.outputs.disposition }}",
);

const staticText = JSON.stringify(staticJob);
for (const required of [
  "StrictHostKeyChecking=yes",
  "macincloud-host-lease.sh acquire",
  "macincloud-host-lease.sh release",
  "run-cua-driver.mjs",
  "NIXMAC_E2E_ATTESTATION_NONCE",
  "NIXMAC_E2E_RUNNER_ATTESTATION_PATH",
  "NIXMAC_E2E_ARTIFACT_ATTESTATION_PATH",
  "hashCuaBundleTree",
  "createControllerCleanupProbe",
  "controller-process-handoff.json",
  "cleanup-probe.json",
]) {
  assert.match(staticText, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(staticText, /recording\.mp4|ffmpeg.*capture/i);
const cleanupStep = stepNamed(staticJob, "Finalize static cleanup and release lease");
const copyEvidenceStep = stepNamed(staticJob, "Copy static evidence to controller");
const sealStep = stepNamed(staticJob, "Seal immutable static evidence");
const quarantineStep = stepNamed(staticJob, "Quarantine unclean static backend");
assert.equal(copyEvidenceStep.id, "copy-evidence");
assert.equal(cleanupStep.id, "cleanup");
assert.equal(sealStep.id, "seal");
assert.ok(
  cleanupStep.run.indexOf('[[ "$cleanup_clean" == "true" ]]') <
    cleanupStep.run.indexOf("macincloud-host-lease.sh release"),
  "unclean cleanup must fail before releasing the owner token",
);
assert.equal(
  sealStep.if,
  "always() && steps.cleanup.outputs.host_clean == 'true' && steps.copy-evidence.outcome == 'success'",
);
assert.match(quarantineStep.if, /steps\.cleanup\.outputs\.host_clean != 'true'/);
const uploadStep = stepNamed(staticJob, "Upload canonical verified static evidence");
assert.equal(uploadStep.id, "upload");
assert.deepEqual(
  uploadStep.with.path.trim().split("\n"),
  [
    "${{ runner.temp }}/static-controller/evidence.canonical.zip",
    "${{ runner.temp }}/static-controller/evidence.canonical.zip.sha256",
  ],
);

assert.deepEqual(publish.needs, ["preflight", "static_ssh"]);
assert.equal(
  publish.if,
  "always() && inputs.qualification_tier == 'production' && needs.preflight.outputs.ready == 'true' && needs.static_ssh.result == 'success'",
);
assert.equal(publish["runs-on"], "arc");
assert.equal(publish.environment, "nixmac-e2e-evidence-writer");
assert.deepEqual(publish.permissions, { contents: "read", actions: "read" });
const publishStep = stepNamed(
  publish,
  "Publish immutable private evidence and read back receipt",
);
assert.equal(publishStep.id, "publish");
assert.equal(
  publishStep.env.E2E_EVIDENCE_R2_ACCESS_KEY_ID,
  "${{ secrets.NIXMAC_E2E_EVIDENCE_R2_ACCESS_KEY_ID }}",
);
assert.equal(
  publishStep.env.E2E_EVIDENCE_R2_SECRET_ACCESS_KEY,
  "${{ secrets.NIXMAC_E2E_EVIDENCE_R2_SECRET_ACCESS_KEY }}",
);
assert.match(publishStep.run, /publish-private-evidence\.mjs publish/);
assert.match(publishStep.run, /--output "\$GITHUB_OUTPUT"/);

assert.deepEqual(result.needs, ["preflight", "static_ssh", "publish_report"]);
assert.equal(result.if, "always()");
assert.equal(result["runs-on"], "arc");
const terminalStep = stepNamed(result, "Write one terminal contract");
assert.equal(terminalStep.env.INPUT_BACKEND, "${{ inputs.backend }}");
assert.match(terminalStep.run, /\[\[ "\$INPUT_BACKEND" == "static_ssh" \]\]/);
assert.match(terminalStep.run, /lifecycle_required=false/);
assert.match(terminalStep.run, /lifecycle_result="not_required"/);
assert.match(terminalStep.run, /ABORTED_API_SYNTHESIS_REQUIRED/);
assert.match(terminalStep.run, /GitHub run\/job API/);
assert.doesNotMatch(
  source,
  /cilicon|nixmac-image-builder|ops\/images|macos-ci-image|provider_ready|lifecycle_consumer/i,
  "the clean static workflow must not depend on Cooper's image or ephemeral-provider work",
);
assert.doesNotMatch(
  source,
  /pull_request_target|issue_comment|pull-requests:\s*write|issues:\s*write|buzz|slack|gh pr comment/i,
);
assert.match(
  operations,
  /Centaur Merged-SHA Lane[\s\S]*nixmac-macos-app-e2e[\s\S]*does not create branches or request rebuilds[\s\S]*ABORTED/,
  "operations must document exact-artifact ownership and terminal failure handling",
);
assert.match(
  operations,
  /nixmac-e2e-production[\s\S]*nixmac-e2e-evidence-writer[\s\S]*pooled\s+ephemeral Mac provider[\s\S]*separate\s+provider-owned\s+change/,
  "operations must document the static transition lane and provider-independent scale boundary",
);
assert.match(
  readme,
  /Post-Merge Centaur Workflow[\s\S]*static_ssh[\s\S]*does not post PR comments or team messages/,
  "README must distinguish post-merge Centaur execution from the PR workflow",
);

assert.deepEqual(runPreflightClassifier({ name: "ready" }), {
  ready: "true",
  terminal_status: "READY",
});
assert.equal(
  runPreflightClassifier({ name: "toolchain", toolchain: "failure" }).terminal_status,
  "PREFLIGHT_INVALID",
);
assert.equal(
  runPreflightClassifier({
    name: "artifact-unavailable",
    status: "BUILD_UNAVAILABLE",
    artifact: "failure",
    bind: "skipped",
  }).terminal_status,
  "BUILD_UNAVAILABLE",
);
assert.equal(
  runPreflightClassifier({ name: "binding", bind: "failure" }).terminal_status,
  "ARTIFACT_INVALID",
);

const complete = runTerminalContractScenario({ name: "complete" });
assert.deepEqual(
  { ...complete.contract, observedAt: terminalFixture.observedAt },
  terminalFixture,
  "the static workflow must emit the frozen cross-repository terminal contract",
);
assert.match(complete.outputs, /workflow_ok=true/);

const shadow = runTerminalContractScenario({
  name: "shadow",
  qualificationTier: "shadow",
  reportResult: "skipped",
  reportUrl: "",
  evidenceStorage: null,
});
assert.equal(shadow.contract.terminalStatus, "COMPLETE");
assert.equal(shadow.contract.reportUrl, "");
assert.equal(shadow.contract.evidenceStorage, null);

for (const disposition of ["LEASE_BUSY", "LEASE_QUARANTINED", "INFRASTRUCTURE_FAILURE"]) {
  const observed = runTerminalContractScenario({
    name: disposition.toLowerCase(),
    staticResult: "failure",
    staticArtifactId: "",
    staticArtifactDigest: "",
    staticInfraDisposition: disposition,
    reportResult: "skipped",
    reportUrl: "",
    evidenceStorage: null,
  });
  assert.equal(observed.contract.terminalStatus, "ABORTED");
  assert.equal(observed.contract.infraDisposition, disposition);
  assert.equal(observed.contract.requiresApiSynthesis, false);
}

const cancelled = runTerminalContractScenario({
  name: "cancelled",
  staticResult: "cancelled",
  staticArtifactId: "",
  staticArtifactDigest: "",
  staticInfraDisposition: "CONTROLLER_STARTED",
  reportResult: "skipped",
  reportUrl: "",
  evidenceStorage: null,
});
assert.equal(cancelled.contract.terminalStatus, "ABORTED");
assert.equal(cancelled.contract.infraDisposition, "ABORTED_API_SYNTHESIS_REQUIRED");
assert.equal(cancelled.contract.requiresApiSynthesis, true);

const buildUnavailable = runTerminalContractScenario({
  name: "build-unavailable",
  preflightReady: "false",
  terminalStatus: "BUILD_UNAVAILABLE",
  staticResult: "skipped",
  staticArtifactId: "",
  staticArtifactDigest: "",
  staticInfraDisposition: "",
  reportResult: "skipped",
  reportUrl: "",
  evidenceStorage: null,
});
assert.equal(buildUnavailable.contract.terminalStatus, "BUILD_UNAVAILABLE");
assert.equal(buildUnavailable.contract.requiresApiSynthesis, false);

console.log("Centaur workflow contract self-test passed.");
