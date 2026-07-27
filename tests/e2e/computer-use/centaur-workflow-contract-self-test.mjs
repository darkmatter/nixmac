#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseWorkflowYaml } from "./workflow-concurrency-contract.mjs";

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
const workflowName = ".github/workflows/computer-use-e2e-centaur.yml";
const source = readFileSync(path.join(repoRoot, workflowName), "utf8");
const workflow = parseWorkflowYaml({ workflowName, source });
const actionlintConfigName = ".github/actionlint.yaml";
const actionlintConfig = parseWorkflowYaml({
  workflowName: actionlintConfigName,
  source: readFileSync(path.join(repoRoot, actionlintConfigName), "utf8"),
});
const operations = readFileSync(
  path.join(repoRoot, "tests/e2e/computer-use/OPERATIONS.md"),
  "utf8",
);
const evidenceManifestSource = readFileSync(
  path.join(repoRoot, "tests/e2e/computer-use/evidence-manifest.mjs"),
  "utf8",
);
const terminalContractFixture = JSON.parse(
  readFileSync(
    path.join(
      repoRoot,
      "tests/e2e/computer-use/fixtures/terminal-contract.v1.json",
    ),
    "utf8",
  ),
);

function runTerminalContractScenario({
  name,
  backend,
  preflightResult = "success",
  preflightReady = "true",
  terminalStatus = "READY",
  primaryResult = "skipped",
  staticResult = "skipped",
  reportResult = "skipped",
  primaryArtifactId = "",
  primaryArtifactDigest = "",
  staticArtifactId = "",
  staticArtifactDigest = "",
  staticInfraDisposition = "",
  lifecycleResult = "skipped",
  lifecycleDisposition = "",
  lifecycleConsumed = "false",
  lifecycleKey = "",
  reportUrl = "",
  qualificationTier = "production",
}) {
  const contractStep = workflow.jobs.result.steps.find((step) => step.id === "contract");
  assert.ok(contractStep, "result job must expose its terminal contract writer");
  const runRoot = mkdtempSync(path.join(os.tmpdir(), `nixmac-centaur-terminal-${name}-`));
  try {
    const outputPath = path.join(runRoot, "github-output");
    const summaryPath = path.join(runRoot, "github-summary");
    const script = contractStep.run;
    const result = spawnSync("bash", ["-s"], {
      encoding: "utf8",
      env: {
        ...process.env,
        RUNNER_TEMP: runRoot,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        GITHUB_RUN_ID: "12345",
        GITHUB_RUN_ATTEMPT: "1",
        INPUT_JOB_ID: `darkmatter/nixmac:${"a".repeat(40)}:computer-use-v1`,
        PREFLIGHT_RESULT: preflightResult,
        PREFLIGHT_READY: preflightReady,
        TERMINAL_STATUS: terminalStatus,
        PRIMARY_RESULT: primaryResult,
        STATIC_RESULT: staticResult,
        REPORT_RESULT: reportResult,
        PRIMARY_ARTIFACT_ID: primaryArtifactId,
        PRIMARY_ARTIFACT_DIGEST: primaryArtifactDigest,
        STATIC_ARTIFACT_ID: staticArtifactId,
        STATIC_ARTIFACT_DIGEST: staticArtifactDigest,
        STATIC_INFRA_DISPOSITION: staticInfraDisposition,
        LIFECYCLE_RESULT: lifecycleResult,
        LIFECYCLE_DISPOSITION: lifecycleDisposition,
        LIFECYCLE_CONSUMED: lifecycleConsumed,
        LIFECYCLE_KEY: lifecycleKey,
        REPORT_URL: reportUrl,
        INPUT_ATTEMPT: "2",
        INPUT_BACKEND: backend,
        QUALIFICATION_TIER: qualificationTier,
      },
      input: script,
    });
    assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`);
    return {
      contract: JSON.parse(
        readFileSync(path.join(runRoot, "nixmac-e2e-terminal/terminal-contract.json"), "utf8"),
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
  "actionlint must recognize only the trusted custom queues used by this workflow",
);

assert.deepEqual(
  Object.keys(workflow.on),
  ["workflow_dispatch"],
  "Centaur harness must be workflow_dispatch-only",
);

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
assert.deepEqual(Object.keys(dispatch.inputs), requiredInputs, "dispatch inputs must stay exact");
for (const input of requiredInputs) {
  assert.equal(dispatch.inputs[input].required, true, `${input} must be required`);
}
assert.deepEqual(dispatch.inputs.backend.options, ["cilicon_tart", "static_ssh"]);
assert.deepEqual(dispatch.inputs.qualification_tier.options, ["shadow", "production"]);
assert.equal(dispatch.inputs.qualification_tier.default, "production");
assert.match(workflow["run-name"], /inputs\.job_id/);
assert.match(workflow["run-name"], /inputs\.attempt/);
assert.match(workflow["run-name"], /inputs\.attestation_nonce/);
assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
assert.equal(Object.hasOwn(workflow, "concurrency"), false);

const jobs = workflow.jobs;
const preflight = jobs.preflight;
const primary = jobs.primary;
const staticJob = jobs.static_ssh;
const lifecycle = jobs.lifecycle_consumer;
const publish = jobs.publish_report;
const result = jobs.result;
for (const [id, job] of Object.entries({
  preflight,
  primary,
  static_ssh: staticJob,
  lifecycle_consumer: lifecycle,
  publish,
  result,
})) {
  assert.ok(job && typeof job === "object", `missing ${id} job`);
}

assert.equal(preflight["runs-on"], "arc");
assert.equal(
  primary.if,
  "needs.preflight.outputs.ready == 'true' && needs.preflight.outputs.provider_ready == 'true' && inputs.backend == 'cilicon_tart' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
  "the ephemeral pool must remain disabled until trusted preflight validates the checked-in contract and repository gate",
);
assert.equal(
  staticJob.if,
  "needs.preflight.outputs.ready == 'true' && inputs.backend == 'static_ssh' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
);
assert.deepEqual(primary["runs-on"], ["self-hosted", "macOS", "nixmac-e2e"]);
assert.deepEqual(staticJob["runs-on"], ["self-hosted", "linux", "nixmac-e2e-static-controller"]);
assert.equal(
  primary.environment,
  "nixmac-e2e-production",
  "the primary Mac backend must be gated by the main-only production environment",
);
assert.equal(
  staticJob.environment,
  "nixmac-e2e-production",
  "the static Mac backend and its secrets must be gated by the main-only production environment",
);
assert.equal(
  lifecycle.environment,
  "nixmac-e2e-production",
  "the lifecycle consumer credentials must remain behind the main-only production environment",
);
assert.deepEqual(
  lifecycle.needs,
  ["preflight", "primary"],
  "the lifecycle consumer must run only after the ephemeral VM job exits",
);
assert.equal(lifecycle.outputs.consumed, "${{ steps.consume.outputs.consumed }}");
assert.equal(lifecycle.outputs.disposition, "${{ steps.consume.outputs.disposition }}");
assert.match(JSON.stringify(lifecycle), /cilicon-lifecycle-consumer\.mjs/);
assert.match(JSON.stringify(lifecycle), /lifecycle-request/);
assert.match(JSON.stringify(lifecycle), /LIFECYCLE_READER_PRIVATE_KEY/);
assert.match(JSON.stringify(lifecycle), /LIFECYCLE_STORE_URL/);
assert.match(JSON.stringify(lifecycle), /LIFECYCLE_STORE_TOKEN/);
assert.deepEqual(publish.needs, ["preflight", "primary", "static_ssh", "lifecycle_consumer"]);
assert.match(
  publish.if,
  /needs\.lifecycle_consumer\.outputs\.consumed == 'true'[\s\S]*needs\.lifecycle_consumer\.outputs\.disposition == 'destroyed'/,
  "ephemeral report publication must require a consumed destroyed lifecycle attestation",
);
assert.equal(Object.hasOwn(staticJob, "concurrency"), false);
assert.equal(
  staticJob.outputs.infra_disposition,
  "${{ steps.lease.outputs.disposition || steps.initialize.outputs.disposition }}",
  "static failures must expose their classified lease/infrastructure disposition",
);
assert.deepEqual(primary.concurrency, {
  group: "computer-use-e2e-${{ needs.preflight.outputs.job_key }}",
  "cancel-in-progress": false,
});
for (const [job, stepName] of [
  [preflight, "Verify ARC controller toolchain contract"],
  [primary, "Verify ephemeral Mac toolchain contract"],
  [staticJob, "Verify static controller toolchain contract"],
  [publish, "Verify ARC publisher toolchain contract"],
]) {
  const toolchainStep = job.steps.find((step) => step.name === stepName);
  assert.ok(toolchainStep, `${stepName} must exist`);
  assert.match(toolchainStep.run, /command -v/);
  assert.match(toolchainStep.run, /python3/);
  assert.match(toolchainStep.run, /ffmpeg/);
  assert.match(toolchainStep.run, /ffprobe/);
}

const providerContractStep = preflight.steps.find(
  (step) => step.name === "Validate trusted Cilicon provider contract",
);
assert.ok(providerContractStep, "preflight must validate the checked-in provider contract");
assert.match(providerContractStep.run, /validateRuntimeProviderGate/);
assert.equal(preflight.outputs.provider_ready, "${{ steps.classify.outputs.provider_ready }}");

const runtimeIdentityStep = primary.steps.find(
  (step) => step.name === "Verify signed host and runtime identity",
);
assert.ok(runtimeIdentityStep, "the ephemeral runner must verify independently observed identity");
assert.match(runtimeIdentityStep.run, /verifyRuntimeObservation/);
assert.match(runtimeIdentityStep.run, /runtime-observation\.json/);
assert.doesNotMatch(
  source,
  /NIXMAC_E2E_CILICON_IMAGE_DIGEST/,
  "configured image variables must not masquerade as observed runtime identity",
);
const publicReportStep = publish.steps.find(
  (step) => step.name === "Publish verified gh-pages report with optimistic retry",
);
assert.equal(
  publicReportStep.if,
  undefined,
  "publication eligibility belongs on the job so every publication step shares the same gate",
);
assert.equal(
  publish.if,
  "always() && inputs.qualification_tier == 'production' && needs.preflight.outputs.ready == 'true' && ((inputs.backend == 'static_ssh' && needs.static_ssh.result == 'success') || (inputs.backend == 'cilicon_tart' && needs.primary.result == 'success' && needs.lifecycle_consumer.result == 'success' && needs.lifecycle_consumer.outputs.consumed == 'true' && needs.lifecycle_consumer.outputs.disposition == 'destroyed'))",
  "shadow qualification must not mutate the public report branch",
);
assert.match(source, /qualificationTier/);
const staticMacToolchainStep = staticJob.steps.find(
  (step) => step.name === "Verify static Mac toolchain contract",
);
assert.ok(staticMacToolchainStep);
assert.match(staticMacToolchainStep.run, /StrictHostKeyChecking=yes/);
assert.match(staticMacToolchainStep.run, /\/usr\/local\/bin\/cua-driver/);

const preflightText = JSON.stringify(preflight);
assert.match(preflightText, /actions\/checkout@v6/);
const preflightCheckout = preflight.steps.find(
  (step) => step.name === "Checkout trusted default-branch harness",
);
assert.equal(
  preflightCheckout.with.ref,
  "${{ github.sha }}",
  "the trusted harness must bind the API-observable workflow run head SHA",
);
assert.match(preflightText, /BUILD_UNAVAILABLE/);
assert.match(preflightText, /app_artifact_id/);
assert.match(preflightText, /build_run_id/);
assert.match(preflightText, /merge_sha/);
assert.match(preflightText, /app_artifact_digest/);
assert.match(preflightText, /nixmac-macos-app-e2e/);
assert.match(preflightText, /archive_download_url/);
assert.match(preflightText, /workflow_run.*head_sha/);
assert.match(preflightText, /\.github\/workflows\/build\.yaml/);
assert.match(preflightText, /head_repository\.full_name/);
assert.match(preflightText, /workflow_dispatch.*expected_backfill_branch/s);
assert.match(
  preflightText,
  /JOB_ID.*GITHUB_REPOSITORY.*MERGE_SHA.*SUITE_VERSION/,
  "preflight must enforce Task 6's canonical repository/SHA/suite job identity",
);
assert.match(preflightText, /job_key/, "preflight must derive one encoded canonical job key");

for (const [id, job] of Object.entries({ primary, static_ssh: staticJob })) {
  const text = JSON.stringify(job);
  assert.match(text, /run-cua-driver\.mjs/, `${id} must use CuaDriver entrypoint`);
  assert.match(text, /NIXMAC_E2E_ATTEMPT_STARTED_AT/, `${id} must bind attempt start time`);
  assert.match(
    text,
    /NIXMAC_E2E_RUNNER_ATTESTATION_PATH/,
    `${id} must supply live runner attestation`,
  );
  assert.match(
    text,
    /NIXMAC_E2E_ARTIFACT_ATTESTATION_PATH/,
    `${id} must supply independent artifact attestation`,
  );
  assert.match(text, /hashCuaBundleTree/, `${id} must bind Task 6's canonical bundle digest`);
  assert.doesNotMatch(text, /recording\.mp4|ffmpeg.*capture/, `${id} must not record raw video`);
  assert.match(
    text,
    /NIXMAC_E2E_ATTESTATION_NONCE/,
    `${id} must pass the attempt nonce into evidence digest sealing`,
  );
  assert.match(text, /NIXMAC_E2E_FFMPEG_PATH/, `${id} must pin the media verifier in use`);
  assert.match(
    text,
    /NIXMAC_E2E_FFPROBE_PATH/,
    `${id} must pin the all-stream media inventory verifier`,
  );
}
const primaryRunStep = primary.steps.find((step) => step.name === "Run exact app with CuaDriver");
assert.equal(
  primaryRunStep.env.NIXMAC_E2E_STRICT_VERDICT,
  "false",
  "primary must preserve verified product-failure evidence",
);
assert.match(
  primaryRunStep.run,
  /cua-driver-install-contract\.mjs[\s\S]*run-cua-driver\.mjs run/,
  "the symlink target and followed digest must be verified immediately before UI execution",
);
assert.match(primaryRunStep.run, /\/usr\/local\/bin\/cua-driver/);
assert.match(primaryRunStep.run, /runtime-observation\.json/);
assert.doesNotMatch(
  source,
  /Upload (primary|static) diagnostics/,
  "unverified mutable evidence must never be uploaded as diagnostics",
);
assert.match(
  evidenceManifestSource,
  /process\.env\.NIXMAC_E2E_FFMPEG_PATH/,
  "the workflow's explicit media verifier path must be consumed by the evidence scanner",
);
assert.match(
  evidenceManifestSource,
  /process\.env\.NIXMAC_E2E_FFPROBE_PATH/,
  "the workflow's explicit all-stream verifier path must be consumed by the evidence scanner",
);

const staticText = JSON.stringify(staticJob);
const initializeStep = staticJob.steps.find(
  (step) => step.name === "Initialize static terminal contract",
);
const checkoutStepIndex = staticJob.steps.findIndex(
  (step) => step.name === "Checkout trusted default-branch harness",
);
const initializeStepIndex = staticJob.steps.findIndex(
  (step) => step.name === "Initialize static terminal contract",
);
const leaseStep = staticJob.steps.find(
  (step) => step.name === "Acquire shared MacinCloud host lease",
);
const enforceLeaseStep = staticJob.steps.find(
  (step) => step.name === "Enforce classified host lease acquisition",
);
assert.ok(leaseStep, "static transition lane must define lease acquisition");
assert.ok(enforceLeaseStep, "static transition lane must fail through a classified lease guard");
assert.ok(initializeStep, "static controller must precreate a machine-readable terminal contract");
assert.ok(
  initializeStepIndex >= 0 && initializeStepIndex < checkoutStepIndex,
  "terminal disposition must exist before checkout, SSH preparation, or lease acquisition can fail",
);
assert.equal(initializeStep.id, "initialize");
assert.match(initializeStep.run, /CONTROLLER_STARTED/);
assert.match(initializeStep.run, /terminal-disposition\.json/);
assert.equal(
  leaseStep["continue-on-error"],
  true,
  "lease acquisition must persist its disposition before the job fails",
);
assert.match(leaseStep.run, /terminal-disposition\.json/);
assert.match(leaseStep.run, /LEASE_ACQUIRED/);
assert.match(leaseStep.run, /LEASE_BUSY/);
assert.match(leaseStep.run, /LEASE_QUARANTINED/);
assert.match(leaseStep.run, /INFRASTRUCTURE_FAILURE/);
assert.doesNotMatch(
  leaseStep.run,
  /lease_acquired_at=.*date/,
  "lease acquisition evidence must use the helper's post-acquisition host timestamp",
);
assert.match(
  enforceLeaseStep.run,
  /terminal-disposition\.json[\s\S]*LEASE_ACQUIRED/,
  "the guard must consume the persisted machine-readable disposition",
);
assert.match(staticText, /macincloud-host-lease\.sh.*acquire/);
assert.match(staticText, /macincloud-host-lease\.sh.*release/);
assert.match(staticText, /\/private\/tmp\/nixmac-centaur-/);
assert.match(staticText, /\/private\/tmp\/nx-cua-/);
assert.doesNotMatch(staticText, /(?:^|["'= ])\/tmp\/(?:nixmac-centaur|nx-cua)-/);
assert.match(staticText, /StrictHostKeyChecking=yes/);
assert.match(staticText, /UserKnownHostsFile/);
assert.match(staticText, /inventory-before\.json/);
assert.match(staticText, /inventory-after\.json/);
assert.match(staticText, /cuaDriverPids/, "static inventory must probe both owned process roles");
assert.match(
  staticText,
  /NIXMAC_E2E_CONTROLLER_PROCESS_HANDOFF_PATH/,
  "static runner must persist its exact process identities outside the mutable evidence tree",
);
assert.match(
  staticText,
  /controller-process-handoff\.json/,
  "controller must retrieve the runner-owned process handoff before deleting remote staging",
);
assert.match(
  staticText,
  /Application Support\/com\.darkmatter\.nixmac/,
  "static transition lane must back up and restore disposable app-support state",
);
assert.match(
  staticText,
  /app-support\.state/,
  "static transition cleanup must be driven by an attempt-owned state marker",
);
assert.match(staticText, /controller-finalize/);
assert.match(staticText, /quarantine/);
const copyEvidenceStep = staticJob.steps.find(
  (step) => step.name === "Copy static evidence to controller",
);
const cleanupStep = staticJob.steps.find(
  (step) => step.name === "Finalize static cleanup and release lease",
);
const sealStep = staticJob.steps.find((step) => step.name === "Seal immutable static evidence");
const quarantineStep = staticJob.steps.find(
  (step) => step.name === "Quarantine unclean static backend",
);
assert.ok(copyEvidenceStep, "static transition lane must identify whether evidence was copied");
assert.equal(copyEvidenceStep.id, "copy-evidence");
assert.ok(cleanupStep, "static transition lane must define independent host cleanup");
assert.ok(sealStep, "static transition lane must seal evidence only after cleanup");
assert.ok(quarantineStep, "static transition lane must define fail-closed host quarantine");
assert.ok(
  cleanupStep.run.indexOf('[[ "$cleanup_clean" == "true" ]]') <
    cleanupStep.run.indexOf("macincloud-host-lease.sh release"),
  "unclean cleanup must fail before owner-token release so recovery retains an occupied lease",
);
assert.match(
  cleanupStep.run,
  /macincloud-host-lease\.sh release[\s\S]*host_clean=true/,
  "host-clean output must be emitted only after owner-token release succeeds",
);
assert.doesNotMatch(
  cleanupStep.run,
  /artifact\/source\.json|controller-process-handoff\.json|manifest\.json/,
  "host cleanup and owner-token release must not depend on evidence prerequisites",
);
assert.equal(
  sealStep.if,
  "always() && steps.cleanup.outputs.host_clean == 'true' && steps.copy-evidence.outcome == 'success'",
  "immutable evidence sealing must start only after host cleanup and evidence copy succeed",
);
assert.match(
  sealStep.run,
  /dirname "\$app_bundle_path"[\s\S]*== "\$staging_parent"/,
  "the cleanup attestation must bind the app bundle to a direct child of the owned staging root",
);
assert.match(sealStep.run, /\$app_bundle_path" == \*\.app/);
assert.match(
  quarantineStep.if,
  /steps\.cleanup\.outputs\.host_clean != 'true'/,
  "host quarantine must apply only while cleanup or lease ownership is unclean",
);
assert.doesNotMatch(
  staticText,
  /attempt-lifecycle\.ndjson|TERMINAL_COMPLETE|TERMINAL_FAILED/,
  "workflow must defer lifecycle ownership to Task 6's canonical attempt writer",
);
assert.match(
  sealStep.run,
  /cleanup-probe\.json/,
  "controller finalization must create a cleanup-probe attestation",
);
assert.match(
  sealStep.run,
  /ownershipMode.*controller-static[\s\S]*startedAt[\s\S]*completedAt[\s\S]*ownedPaths[\s\S]*processInstances[\s\S]*lifecycle/,
  "controller cleanup must implement Task 6's complete canonical cleanup schema",
);
assert.match(
  sealStep.run,
  /controller-process-handoff\.json[\s\S]*processInstances/,
  "controller cleanup must use exact runner process identities instead of placeholder status",
);
assert.doesNotMatch(
  sealStep.run,
  /role:"(?:target|daemon)",status:"not_started"/,
  "controller must not fabricate not-started process identities after a real run",
);
assert.match(
  sealStep.run,
  /waitReason/,
  "controller lease proof must preserve the trusted metadata CLI's wait-reason contract",
);
assert.match(
  sealStep.run,
  /repo[\s\S]*jobId[\s\S]*attempt[\s\S]*host[\s\S]*acquiredOwnerTokenHash[\s\S]*releasedOwnerTokenHash/,
  "host lease must bind Task 6's exact run identity and owner-matched hashes",
);
assert.match(
  sealStep.run,
  /acquired:true,[\s\S]*released:true/,
  "host lease must attest owner-matched acquisition and release",
);
assert.match(
  sealStep.run,
  /createControllerCleanupProbe/,
  "controller must call Task 6's canonical cleanup-probe API instead of reimplementing it",
);
assert.match(
  sealStep.run,
  /NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN/,
  "trusted owner token must reach Task 6 finalization only through the environment",
);
assert.match(
  sealStep.run,
  /--cleanup-probe-file/,
  "controller finalization must supply the cleanup probe to the trusted metadata CLI",
);

const publishText = JSON.stringify(publish);
assert.equal(
  Object.hasOwn(publish, "concurrency"),
  false,
  "report publication must not use GitHub's one-pending replacement queue",
);
assert.match(publishText, /for attempt in 1 2 3 4 5/);
assert.match(
  publishText,
  /computer-use-e2e\/jobs\/\$\{\{ needs\.preflight\.outputs\.job_key \}\}\/attempt-\$\{\{ inputs\.attempt \}\}/,
);
assert.match(publishText, /evidence-manifest\.mjs materialize/);
assert.match(publishText, /actions\/download-artifact@v7/);
assert.match(publishText, /find.*\*\.canonical\.zip/);
assert.match(publishText, /archive\.sha256/);
assert.doesNotMatch(publishText, /canonical\/manifest\.json/);
const publishStep = publish.steps.find(
  (step) => step.name === "Publish verified gh-pages report with optimistic retry",
);
assert.ok(publishStep);
assert.match(
  publishStep.run,
  /^\s*if git -C "\$site_dir" push -q origin HEAD:gh-pages; then\s*$/m,
  "publisher must update only gh-pages without force",
);
assert.deepEqual(
  publishStep.run
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\bgit\b.*\bpush\b/.test(line)),
  ['if git -C "$site_dir" push -q origin HEAD:gh-pages; then'],
  "publisher must have exactly one non-force push target",
);
assert.ok(
  publishStep.run.indexOf("trap ") < publishStep.run.indexOf('cp -a "$run_dir/."'),
  "publisher cleanup must be armed before the first snapshot copy can fail",
);
assert.ok(
  publishStep.run.indexOf("trap ") < publishStep.run.lastIndexOf('site_dir="$(mktemp -d)"'),
  "publisher cleanup must be armed before allocating its second temporary directory",
);

const primaryCanonicalUpload = primary.steps.find(
  (step) => step.name === "Upload canonical verified evidence",
);
const staticCanonicalUpload = staticJob.steps.find(
  (step) => step.name === "Upload canonical verified static evidence",
);
assert.equal(
  staticCanonicalUpload.with.path.trim(),
  [
    "${{ runner.temp }}/static-controller/evidence.canonical.zip",
    "${{ runner.temp }}/static-controller/evidence.canonical.zip.sha256",
  ].join("\n"),
);
assert.equal(
  primaryCanonicalUpload.with.path.trim(),
  [
    "${{ runner.temp }}/nixmac-centaur-${{ github.run_id }}-${{ github.run_attempt }}/evidence.canonical.zip",
    "${{ runner.temp }}/nixmac-centaur-${{ github.run_id }}-${{ github.run_attempt }}/evidence.canonical.zip.sha256",
  ].join("\n"),
  "primary upload must contain only the exact canonical archive and digest",
);
assert.doesNotMatch(primaryCanonicalUpload.with.path, /\*/);
assert.doesNotMatch(
  JSON.stringify([primaryCanonicalUpload, staticCanonicalUpload]),
  /source-binding|trusted-harness/,
  "canonical artifact must contain exactly one manifest-bound evidence root",
);

const verifyPublishStep = publish.steps.find(
  (step) => step.name === "Verify manifest before publication",
);
assert.ok(verifyPublishStep);
assert.match(verifyPublishStep.run, /NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN/);
assert.match(verifyPublishStep.run, /NIXMAC_E2E_PYTHON_PATH/);
assert.match(verifyPublishStep.run, /NIXMAC_E2E_FFMPEG_PATH/);
assert.match(verifyPublishStep.run, /NIXMAC_E2E_FFPROBE_PATH/);
assert.match(
  verifyPublishStep.run,
  /GITHUB_REPOSITORY.*GITHUB_RUN_ID.*INPUT_JOB_ID.*INPUT_ATTEMPT.*ATTESTATION_NONCE/s,
  "static publication must recompute the same attempt-bound lease owner token",
);

const staticRunStep = staticJob.steps.find(
  (step) => step.name === "Run CuaDriver on leased static host",
);
assert.equal(staticRunStep.env.STATIC_IMAGE_DIGEST, "${{ vars.NIXMAC_E2E_STATIC_IMAGE_DIGEST }}");
assert.equal(staticRunStep.env.NIXMAC_E2E_STRICT_VERDICT, "false");
const staticRunCommands = staticRunStep.run
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
assert.equal(staticRunCommands[0], "set -euo pipefail");
assert.equal(
  staticRunCommands[1],
  '[[ "$STATIC_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]',
  "static image identity must fail closed before SSH or runner interpolation",
);
assert.match(staticRunStep.run, /static_image_digest_q=.*printf.*%q/);
assert.match(
  staticRunStep.run,
  /NIXMAC_E2E_RUNNER_IMAGE_DIGEST=\$static_image_digest_q/,
  "validated image digest must be shell-quoted before remote interpolation",
);

const credentialCleanupStep = staticJob.steps.find(
  (step) => step.name === "Remove static controller credentials",
);
assert.ok(credentialCleanupStep);
assert.equal(credentialCleanupStep.if, "always()");
assert.match(credentialCleanupStep.run, /nixmac-ssh\/key/);
assert.match(credentialCleanupStep.run, /nixmac-host-owner-token/);

const resultText = JSON.stringify(result);
assert.match(resultText, /BUILD_UNAVAILABLE/);
assert.match(resultText, /artifact-id/);
assert.match(resultText, /artifact-digest/);
assert.match(resultText, /retention-days.*90/);
assert.match(
  resultText,
  /STATIC_INFRA_DISPOSITION[\s\S]*infra-disposition/,
  "the terminal summary must expose the classified static infrastructure disposition",
);
assert.match(resultText, /terminal-contract\.json/);
assert.match(resultText, /ABORTED_API_SYNTHESIS_REQUIRED/);
assert.match(resultText, /actions\/upload-artifact@v7/);
const terminalContractStep = result.steps.find(
  (step) => step.name === "Write one terminal contract",
);
assert.equal(terminalContractStep.env.PREFLIGHT_RESULT, "${{ needs.preflight.result }}");
assert.equal(terminalContractStep.env.INPUT_JOB_ID, "${{ inputs.job_id }}");
assert.equal(terminalContractStep.env.INPUT_ATTEMPT, "${{ inputs.attempt }}");
assert.equal(terminalContractStep.env.INPUT_BACKEND, "${{ inputs.backend }}");
assert.equal(terminalContractStep.env.QUALIFICATION_TIER, "${{ inputs.qualification_tier }}");
assert.doesNotMatch(
  terminalContractStep.run,
  /\$\{\{ inputs\.(?:job_id|attempt|backend) \}\}/,
  "result scripting must route dispatch inputs through its environment boundary",
);
assert.match(
  terminalContractStep.run,
  /PREFLIGHT_RESULT.*cancelled[\s\S]*ABORTED_API_SYNTHESIS_REQUIRED/s,
);
assert.match(
  terminalContractStep.run,
  /INPUT_BACKEND.*static_ssh[\s\S]*-z "\$STATIC_INFRA_DISPOSITION"[\s\S]*ABORTED_API_SYNTHESIS_REQUIRED/s,
);
assert.match(
  resultText,
  /cancelled[\s\S]*runner_lost[\s\S]*GitHub run\/job API/,
  "no-runner cancellation must have an explicit API-synthesized ABORTED contract",
);

for (const disposition of ["LEASE_BUSY", "LEASE_QUARANTINED", "INFRASTRUCTURE_FAILURE"]) {
  const observed = runTerminalContractScenario({
    name: disposition.toLowerCase(),
    backend: "static_ssh",
    staticResult: "failure",
    staticInfraDisposition: disposition,
  });
  assert.equal(observed.contract.terminalStatus, "ABORTED");
  assert.equal(
    observed.contract.infraDisposition,
    disposition,
    `${disposition} must survive the terminal contract without reclassification`,
  );
  assert.equal(
    observed.contract.requiresApiSynthesis,
    false,
    `${disposition} already has a workflow-owned terminal disposition`,
  );
  assert.match(observed.outputs, /workflow_ok=false/);
}

for (const scenario of [
  {
    name: "primary-cancelled",
    backend: "cilicon_tart",
    primaryResult: "cancelled",
  },
  {
    name: "static-runner-lost",
    backend: "static_ssh",
    staticResult: "failure",
    staticInfraDisposition: "CONTROLLER_STARTED",
  },
]) {
  const observed = runTerminalContractScenario(scenario);
  assert.equal(observed.contract.terminalStatus, "ABORTED");
  assert.equal(observed.contract.infraDisposition, "ABORTED_API_SYNTHESIS_REQUIRED");
  assert.equal(observed.contract.requiresApiSynthesis, true);
  assert.match(observed.outputs, /workflow_ok=false/);
}

const complete = runTerminalContractScenario({
  name: "complete",
  backend: "cilicon_tart",
  primaryResult: "success",
  reportResult: "success",
  primaryArtifactId: "98765",
  primaryArtifactDigest: `sha256:${"a".repeat(64)}`,
  lifecycleResult: "success",
  lifecycleDisposition: "destroyed",
  lifecycleConsumed: "true",
  lifecycleKey: "c".repeat(64),
  reportUrl: "https://example.invalid/report",
});
assert.equal(complete.contract.terminalStatus, "COMPLETE");
assert.equal(complete.contract.requiresApiSynthesis, false);
assert.match(complete.outputs, /workflow_ok=true/);

const staticComplete = runTerminalContractScenario({
  name: "static-frozen-contract",
  backend: "static_ssh",
  staticResult: "success",
  reportResult: "success",
  staticArtifactId: "98765",
  staticArtifactDigest: `sha256:${"a".repeat(64)}`,
  staticInfraDisposition: "LEASE_ACQUIRED",
  reportUrl: terminalContractFixture.reportUrl,
});
assert.deepEqual(
  {
    ...staticComplete.contract,
    observedAt: terminalContractFixture.observedAt,
  },
  terminalContractFixture,
  "the producer must emit the frozen cross-repo terminal contract",
);

const shadowComplete = runTerminalContractScenario({
  name: "shadow-complete",
  backend: "cilicon_tart",
  qualificationTier: "shadow",
  primaryResult: "success",
  reportResult: "skipped",
  primaryArtifactId: "98766",
  primaryArtifactDigest: `sha256:${"b".repeat(64)}`,
  lifecycleResult: "success",
  lifecycleDisposition: "destroyed",
  lifecycleConsumed: "true",
  lifecycleKey: "d".repeat(64),
});
assert.equal(shadowComplete.contract.terminalStatus, "COMPLETE");
assert.equal(shadowComplete.contract.qualificationTier, "shadow");
assert.equal(shadowComplete.contract.reportUrl, "");
assert.match(shadowComplete.outputs, /workflow_ok=true/);

const missingLifecycle = runTerminalContractScenario({
  name: "missing-lifecycle",
  backend: "cilicon_tart",
  primaryResult: "success",
  reportResult: "success",
  primaryArtifactId: "98767",
  primaryArtifactDigest: `sha256:${"c".repeat(64)}`,
  reportUrl: "https://example.invalid/unsafe-report",
});
assert.equal(missingLifecycle.contract.terminalStatus, "ABORTED");
assert.equal(missingLifecycle.contract.infraDisposition, "LIFECYCLE_UNVERIFIED");
assert.match(missingLifecycle.outputs, /workflow_ok=false/);

const quarantinedLifecycle = runTerminalContractScenario({
  name: "quarantined-lifecycle",
  backend: "cilicon_tart",
  primaryResult: "success",
  reportResult: "skipped",
  primaryArtifactId: "98768",
  primaryArtifactDigest: `sha256:${"d".repeat(64)}`,
  lifecycleResult: "success",
  lifecycleDisposition: "quarantined",
  lifecycleConsumed: "true",
  lifecycleKey: "e".repeat(64),
});
assert.equal(quarantinedLifecycle.contract.terminalStatus, "ABORTED");
assert.equal(quarantinedLifecycle.contract.infraDisposition, "LIFECYCLE_QUARANTINED");
assert.match(quarantinedLifecycle.outputs, /workflow_ok=false/);

const buildUnavailable = runTerminalContractScenario({
  name: "build-unavailable",
  backend: "cilicon_tart",
  preflightResult: "success",
  preflightReady: "false",
  terminalStatus: "BUILD_UNAVAILABLE",
});
assert.equal(buildUnavailable.contract.terminalStatus, "BUILD_UNAVAILABLE");
assert.equal(buildUnavailable.contract.requiresApiSynthesis, false);

const preflightCancelled = runTerminalContractScenario({
  name: "preflight-cancelled",
  backend: "cilicon_tart",
  preflightResult: "cancelled",
  preflightReady: "",
  terminalStatus: "",
});
assert.equal(preflightCancelled.contract.terminalStatus, "ABORTED");
assert.equal(preflightCancelled.contract.infraDisposition, "ABORTED_API_SYNTHESIS_REQUIRED");
assert.equal(preflightCancelled.contract.requiresApiSynthesis, true);

assert.doesNotMatch(
  source,
  /pull_request_target|issue_comment|pull-requests:\s*write|issues:\s*write/,
);
assert.doesNotMatch(source, /buzz|slack|create-or-update-comment|gh pr comment/i);
assert.match(
  operations,
  /nixmac-e2e-production[\s\S]*deployment branch[\s\S]*main/i,
  "operations must require a protected production environment restricted to main",
);
assert.match(
  operations,
  /terminal-contract\.json[\s\S]*GitHub run\/job API[\s\S]*ABORTED/,
  "operations must define API-synthesized ABORTED when no runner-side contract can exist",
);
assert.match(
  operations,
  /automation\/nixmac-e2e-backfill\/<merged-sha>[\s\S]*branch or tag, not a raw commit SHA[\s\S]*delete only the exact deterministic branch/s,
  "backfill operations must use and safely clean up a deterministic exact-SHA branch",
);

console.log("Centaur workflow contract self-test passed.");
