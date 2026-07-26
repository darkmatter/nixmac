#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
];
assert.deepEqual(Object.keys(dispatch.inputs), requiredInputs, "dispatch inputs must stay exact");
for (const input of requiredInputs) {
  assert.equal(dispatch.inputs[input].required, true, `${input} must be required`);
}
assert.deepEqual(dispatch.inputs.backend.options, ["cilicon_tart", "static_ssh"]);
assert.match(workflow["run-name"], /inputs\.job_id/);
assert.match(workflow["run-name"], /inputs\.attempt/);
assert.match(workflow["run-name"], /inputs\.attestation_nonce/);
assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
assert.equal(Object.hasOwn(workflow, "concurrency"), false);

const jobs = workflow.jobs;
const preflight = jobs.preflight;
const primary = jobs.primary;
const staticJob = jobs.static_ssh;
const publish = jobs.publish_report;
const result = jobs.result;
for (const [id, job] of Object.entries({
  preflight,
  primary,
  static_ssh: staticJob,
  publish,
  result,
})) {
  assert.ok(job && typeof job === "object", `missing ${id} job`);
}

assert.equal(preflight["runs-on"], "arc");
assert.equal(
  primary.if,
  "needs.preflight.outputs.ready == 'true' && inputs.backend == 'cilicon_tart' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
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

const preflightText = JSON.stringify(preflight);
assert.match(preflightText, /actions\/checkout@v6/);
assert.match(preflightText, /ref.*github\.event\.repository\.default_branch/);
assert.match(preflightText, /BUILD_UNAVAILABLE/);
assert.match(preflightText, /app_artifact_id/);
assert.match(preflightText, /build_run_id/);
assert.match(preflightText, /merge_sha/);
assert.match(preflightText, /app_artifact_digest/);
assert.match(preflightText, /nixmac-macos-app-e2e/);
assert.match(preflightText, /archive_download_url/);
assert.match(preflightText, /workflow_run.*head_sha/);
assert.match(
  preflightText,
  /JOB_ID.*GITHUB_REPOSITORY.*MERGE_SHA.*SUITE_VERSION/,
  "preflight must enforce Task 6's canonical repository/SHA/suite job identity",
);
assert.match(preflightText, /job_key/, "preflight must derive one encoded canonical job key");

for (const [id, job] of Object.entries({ primary, static_ssh: staticJob })) {
  const text = JSON.stringify(job);
  assert.match(text, /run-cua-driver\.mjs/, `${id} must use CuaDriver entrypoint`);
  assert.match(text, /actions\/upload-artifact@v7/, `${id} must always upload diagnostics`);
  assert.match(text, /always\(\)/, `${id} must always upload diagnostics`);
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
    /NIXMAC_E2E_STRICT_VERDICT.*false/,
    `${id} must preserve verified product-failure evidence instead of failing before upload`,
  );
  assert.match(
    text,
    /NIXMAC_E2E_ATTESTATION_NONCE/,
    `${id} must pass the attempt nonce into evidence digest sealing`,
  );
  assert.match(
    text,
    /NIXMAC_E2E_FFPROBE_PATH/,
    `${id} must pin ffprobe for all-stream evidence inspection`,
  );
}

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
const leaseStep = staticJob.steps.find((step) => step.name === "Acquire shared MacinCloud host lease");
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
const sealStep = staticJob.steps.find(
  (step) => step.name === "Seal immutable static evidence",
);
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
assert.match(
  sealStep.if,
  /steps\.cleanup\.outputs\.host_clean == 'true'[\s\S]*steps\.copy-evidence\.outcome == 'success'/,
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
assert.match(publishText, /git.*fetch.*gh-pages[\s\S]*git.*push/);
assert.match(
  publishText,
  /computer-use-e2e\/jobs\/\$\{\{ needs\.preflight\.outputs\.job_key \}\}\/attempt-\$\{\{ inputs\.attempt \}\}/,
);
assert.match(publishText, /evidence-manifest\.mjs verify/);
assert.match(publishText, /actions\/download-artifact@v7/);
assert.doesNotMatch(
  publishText,
  /find.*manifest\.json/,
  "publisher must require one manifest at the canonical artifact root",
);
assert.match(publishText, /canonical\/manifest\.json/);

const primaryCanonicalUpload = primary.steps.find(
  (step) => step.name === "Upload canonical verified evidence",
);
const staticCanonicalUpload = staticJob.steps.find(
  (step) => step.name === "Upload canonical verified static evidence",
);
assert.equal(staticCanonicalUpload.with.path.trim(), "${{ runner.temp }}/static-controller/evidence/");
assert.equal(
  primaryCanonicalUpload.with.path.trim(),
  "${{ runner.temp }}/nixmac-centaur-${{ github.run_id }}-${{ github.run_attempt }}/evidence/",
  "primary upload must flatten the one exact evidence directory to the artifact root",
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
assert.match(
  verifyPublishStep.run,
  /GITHUB_REPOSITORY.*GITHUB_RUN_ID.*INPUT_JOB_ID.*INPUT_ATTEMPT.*ATTESTATION_NONCE/s,
  "static publication must recompute the same attempt-bound lease owner token",
);

const staticRunStep = staticJob.steps.find(
  (step) => step.name === "Run CuaDriver on leased static host",
);
assert.equal(
  staticRunStep.env.STATIC_IMAGE_DIGEST,
  "${{ vars.NIXMAC_E2E_STATIC_IMAGE_DIGEST }}",
);
assert.match(staticRunStep.run, /\^sha256:\[0-9a-f\]\{64\}\$/);
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
assert.equal(
  terminalContractStep.env.PREFLIGHT_RESULT,
  "${{ needs.preflight.result }}",
);
assert.equal(terminalContractStep.env.INPUT_JOB_ID, "${{ inputs.job_id }}");
assert.doesNotMatch(
  terminalContractStep.run,
  /\$\{\{ inputs\.job_id \}\}/,
  "result scripting must not interpolate an unvalidated string input into bash",
);
assert.match(
  terminalContractStep.run,
  /PREFLIGHT_RESULT.*cancelled[\s\S]*ABORTED_API_SYNTHESIS_REQUIRED/s,
);
assert.match(
  terminalContractStep.run,
  /inputs\.backend.*static_ssh[\s\S]*-z "\$STATIC_INFRA_DISPOSITION"[\s\S]*ABORTED_API_SYNTHESIS_REQUIRED/s,
);
assert.match(
  resultText,
  /cancelled[\s\S]*runner_lost[\s\S]*GitHub run\/job API/,
  "no-runner cancellation must have an explicit API-synthesized ABORTED contract",
);

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

console.log("Centaur workflow contract self-test passed.");
