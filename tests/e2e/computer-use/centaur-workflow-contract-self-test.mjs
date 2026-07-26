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
  "needs.preflight.outputs.ready == 'true' && inputs.backend == 'cilicon_tart'",
);
assert.equal(
  staticJob.if,
  "needs.preflight.outputs.ready == 'true' && inputs.backend == 'static_ssh'",
);
assert.deepEqual(primary["runs-on"], ["self-hosted", "macOS", "nixmac-e2e"]);
assert.deepEqual(staticJob["runs-on"], ["self-hosted", "linux", "nixmac-e2e-static-controller"]);
assert.equal(Object.hasOwn(staticJob, "concurrency"), false);
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
}

const staticText = JSON.stringify(staticJob);
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
const finalizeStep = staticJob.steps.find(
  (step) => step.name === "Finalize static cleanup, lease, and immutable evidence",
);
const quarantineStep = staticJob.steps.find(
  (step) => step.name === "Quarantine unclean static backend",
);
assert.ok(finalizeStep, "static transition lane must define controller finalization");
assert.ok(quarantineStep, "static transition lane must define fail-closed host quarantine");
assert.ok(
  finalizeStep.run.indexOf('[[ "$cleanup_clean" == "true" ]]') <
    finalizeStep.run.indexOf("macincloud-host-lease.sh release"),
  "unclean cleanup must fail before owner-token release so recovery retains an occupied lease",
);
assert.match(
  finalizeStep.run,
  /macincloud-host-lease\.sh release[\s\S]*host_clean=true/,
  "host-clean output must be emitted only after owner-token release succeeds",
);
assert.match(
  quarantineStep.if,
  /steps\.finalize\.outputs\.host_clean != 'true'/,
  "host quarantine must apply only while cleanup or lease ownership is unclean",
);
assert.doesNotMatch(
  staticText,
  /attempt-lifecycle\.ndjson|TERMINAL_COMPLETE|TERMINAL_FAILED/,
  "workflow must defer lifecycle ownership to Task 6's canonical attempt writer",
);
assert.match(
  finalizeStep.run,
  /cleanup-probe\.json/,
  "controller finalization must create a cleanup-probe attestation",
);
assert.match(
  finalizeStep.run,
  /ownershipMode.*controller-static[\s\S]*startedAt[\s\S]*completedAt[\s\S]*ownedPaths[\s\S]*processInstances[\s\S]*lifecycle/,
  "controller cleanup must implement Task 6's complete canonical cleanup schema",
);
assert.match(
  finalizeStep.run,
  /controller-process-handoff\.json[\s\S]*processInstances/,
  "controller cleanup must use exact runner process identities instead of placeholder status",
);
assert.doesNotMatch(
  finalizeStep.run,
  /role:"(?:target|daemon)",status:"not_started"/,
  "controller must not fabricate not-started process identities after a real run",
);
assert.match(
  finalizeStep.run,
  /waitReason/,
  "controller lease proof must preserve the trusted metadata CLI's wait-reason contract",
);
assert.match(
  finalizeStep.run,
  /repo[\s\S]*jobId[\s\S]*attempt[\s\S]*host[\s\S]*acquiredOwnerTokenHash[\s\S]*releasedOwnerTokenHash/,
  "host lease must bind Task 6's exact run identity and owner-matched hashes",
);
assert.match(
  finalizeStep.run,
  /acquired:true,[\s\S]*released:true/,
  "host lease must attest owner-matched acquisition and release",
);
assert.match(
  finalizeStep.run,
  /createControllerCleanupProbe/,
  "controller must call Task 6's canonical cleanup-probe API instead of reimplementing it",
);
assert.match(
  finalizeStep.run,
  /NIXMAC_E2E_HOST_LEASE_OWNER_TOKEN/,
  "trusted owner token must reach Task 6 finalization only through the environment",
);
assert.match(
  finalizeStep.run,
  /--cleanup-probe-file/,
  "controller finalization must supply the cleanup probe to the trusted metadata CLI",
);

const publishText = JSON.stringify(publish);
assert.match(publishText, /computer-use-e2e-gh-pages-publish/);
assert.match(
  publishText,
  /computer-use-e2e\/jobs\/\$\{\{ needs\.preflight\.outputs\.job_key \}\}\/attempt-\$\{\{ inputs\.attempt \}\}/,
);
assert.match(publishText, /evidence-manifest\.mjs verify/);
assert.match(publishText, /actions\/download-artifact@v7/);

const resultText = JSON.stringify(result);
assert.match(resultText, /BUILD_UNAVAILABLE/);
assert.match(resultText, /artifact-id/);
assert.match(resultText, /artifact-digest/);
assert.match(resultText, /retention-days.*90/);

assert.doesNotMatch(
  source,
  /pull_request_target|issue_comment|pull-requests:\s*write|issues:\s*write/,
);
assert.doesNotMatch(source, /buzz|slack|create-or-update-comment|gh pr comment/i);

console.log("Centaur workflow contract self-test passed.");
