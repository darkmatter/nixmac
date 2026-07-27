import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export const REMOTE_MAC_CONCURRENCY_GROUP = "nixmac-macincloud-e2e-remote";

export const AUTOMATIC_CONTRACT_COMMANDS = Object.freeze([
  "node tests/e2e/computer-use/workflow-concurrency-contract-self-test.mjs",
  "node tests/e2e/computer-use/workflow-contract-self-test.mjs",
  "node tests/e2e/computer-use/peekaboo-workflow-contract-self-test.mjs",
  "node tests/e2e/computer-use/centaur-workflow-contract-self-test.mjs",
  "node tests/e2e/computer-use/private-evidence-storage-self-test.mjs",
  "node tests/e2e/computer-use/remote-host-lease-contract-self-test.mjs",
  "node tests/e2e/computer-use/drivers/driver-self-test.mjs",
  "node tests/e2e/computer-use/verification-contract-self-test.mjs",
  "node tests/e2e/computer-use/evidence-manifest-self-test.mjs",
  "node tests/e2e/computer-use/run-cua-driver.mjs self-test",
  "node tests/e2e/computer-use/run-remote-cua.mjs self-test",
  "node tests/e2e/computer-use/coverage-manifest.test.mjs",
  "node tests/e2e/computer-use/report.test.mjs",
]);

const AUTOMATIC_CONTRACT_ENVIRONMENT = {
  BASH_ENV: "",
  ENV: "",
  NIXPKGS_ALLOW_UNFREE: 1,
  NODE_OPTIONS: "",
};
const AUTOMATIC_CONTRACT_RUN =
  '"$RUNNER_TEMP/devenv-cli/bin/devenv" shell --impure -- bash -euo pipefail tests/e2e/computer-use/run-workflow-contracts.sh';

function normalizeStaticConcurrencyGroup(group) {
  return typeof group === "string" ? group.toLowerCase() : undefined;
}

function extractConcurrencyGroup(concurrency) {
  if (typeof concurrency === "string") return concurrency;
  if (concurrency && typeof concurrency === "object" && !Array.isArray(concurrency)) {
    return concurrency.group;
  }
  return undefined;
}

function referencesRemoteMacConcurrencyGroup(group) {
  const normalized = normalizeStaticConcurrencyGroup(group);
  if (!normalized) return false;
  if (normalized === REMOTE_MAC_CONCURRENCY_GROUP) return true;
  return group.includes("${{") && normalized.includes(REMOTE_MAC_CONCURRENCY_GROUP);
}

export function parseWorkflowYaml({ workflowName, source }) {
  assert.equal(typeof workflowName, "string", "workflowName must be a string");
  assert.ok(workflowName.trim(), "workflowName must not be blank");
  assert.equal(typeof source, "string", `${workflowName} source must be a string`);
  assert.ok(source.trim(), `${workflowName} source must not be blank`);

  const parsed = spawnSync("yq", ["."], {
    encoding: "utf8",
    input: source,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (parsed.error) {
    assert.fail(`${workflowName} structural YAML parsing failed: ${parsed.error.message}`);
  }
  assert.equal(
    parsed.status,
    0,
    `${workflowName} must be valid YAML: ${parsed.stderr.trim() || "yq exited unsuccessfully"}`,
  );

  let workflow;
  try {
    workflow = JSON.parse(parsed.stdout);
  } catch (error) {
    assert.fail(`${workflowName} YAML parser returned invalid JSON: ${error.message}`);
  }
  assert.ok(
    workflow && typeof workflow === "object" && !Array.isArray(workflow),
    `${workflowName} must parse to a mapping`,
  );
  return workflow;
}

export function assertAutomaticConcurrencyValidationContract({
  workflowName,
  source,
  jobId,
  stepName,
}) {
  const workflow = parseWorkflowYaml({ workflowName, source });
  const triggers = workflow.on;
  assert.ok(
    triggers && typeof triggers === "object" && !Array.isArray(triggers),
    `${workflowName} on must be a mapping`,
  );
  assert.deepEqual(
    triggers.pull_request,
    { branches: ["main"] },
    `${workflowName} pull_request trigger must target main without path filters`,
  );
  assert.equal(
    Object.hasOwn(triggers, "merge_group"),
    true,
    `${workflowName} must run automatically on merge_group`,
  );

  const jobs = workflow.jobs;
  assert.ok(
    jobs && typeof jobs === "object" && !Array.isArray(jobs),
    `${workflowName} jobs must be a mapping`,
  );
  const job = jobs[jobId];
  assert.ok(
    job && typeof job === "object" && !Array.isArray(job),
    `${workflowName} must define automatic validation job ${jobId}`,
  );
  assert.equal(job["runs-on"], "arc", `${workflowName} job ${jobId} must run on arc`);
  assert.equal(
    Object.hasOwn(job, "if"),
    false,
    `${workflowName} job ${jobId} must not conditionally skip E2E contracts`,
  );
  assert.equal(
    Object.hasOwn(job, "continue-on-error"),
    false,
    `${workflowName} job ${jobId} must fail closed`,
  );
  assert.ok(Array.isArray(job.steps), `${workflowName} job ${jobId} steps must be an array`);

  const installIndex = job.steps.findIndex((step) => step?.name === "Install devenv");
  const contractSteps = job.steps.filter((step) => step?.name === stepName);
  const gitHooksIndex = job.steps.findIndex(
    (step) => step?.name === "Run git hooks on all files",
  );
  assert.notEqual(
    installIndex,
    -1,
    `${workflowName} job ${jobId} must install devenv before E2E contracts`,
  );
  assert.equal(
    contractSteps.length,
    1,
    `${workflowName} job ${jobId} must define exactly one ${stepName} step`,
  );
  assert.notEqual(
    gitHooksIndex,
    -1,
    `${workflowName} job ${jobId} must preserve the existing git-hooks step`,
  );

  const contractStep = contractSteps[0];
  const contractIndex = job.steps.indexOf(contractStep);
  assert.ok(
    installIndex < contractIndex && contractIndex < gitHooksIndex,
    `${workflowName} job ${jobId} must run E2E contracts after devenv setup and before git hooks`,
  );
  for (const control of ["if", "continue-on-error"]) {
    assert.equal(
      Object.hasOwn(contractStep, control),
      false,
      `${workflowName} job ${jobId} step ${stepName} must not declare ${control}`,
    );
  }
  assert.deepEqual(
    contractStep.env,
    AUTOMATIC_CONTRACT_ENVIRONMENT,
    `${workflowName} job ${jobId} step ${stepName} environment must stay fail closed`,
  );
  assert.equal(
    contractStep.shell,
    "bash",
    `${workflowName} job ${jobId} step ${stepName} must use Bash`,
  );
  assert.equal(
    contractStep.run,
    AUTOMATIC_CONTRACT_RUN,
    `${workflowName} job ${jobId} step ${stepName} must invoke the checked-in contract runner through pinned devenv`,
  );
}

export function assertAutomaticContractScript({ scriptName, source }) {
  assert.equal(typeof source, "string", `${scriptName} source must be a string`);
  const lines = source.split(/\r?\n/u);
  assert.deepEqual(
    lines.slice(0, 3),
    ["#!/usr/bin/env bash", "set -euo pipefail", ""],
    `${scriptName} must start with a fail-fast Bash contract`,
  );
  assert.deepEqual(
    lines.slice(3).filter(Boolean),
    AUTOMATIC_CONTRACT_COMMANDS,
    `${scriptName} must contain exactly the automatic contract commands`,
  );
}

export function assertRemoteMacConcurrencyContract({
  workflowName,
  source,
  remoteJobId,
  forbidWorkflowLevelConcurrency = false,
}) {
  assert.equal(typeof remoteJobId, "string", `${workflowName} remoteJobId must be a string`);
  assert.ok(remoteJobId.trim(), `${workflowName} remoteJobId must not be blank`);

  const workflow = parseWorkflowYaml({ workflowName, source });
  const workflowConcurrencyGroup = extractConcurrencyGroup(workflow.concurrency);
  assert.equal(
    referencesRemoteMacConcurrencyGroup(workflowConcurrencyGroup),
    false,
    `${workflowName} must not reuse ${REMOTE_MAC_CONCURRENCY_GROUP} at workflow level`,
  );
  if (forbidWorkflowLevelConcurrency) {
    assert.equal(
      Object.hasOwn(workflow, "concurrency"),
      false,
      `${workflowName} must not define workflow-level concurrency`,
    );
  }

  const jobs = workflow.jobs;
  assert.ok(
    jobs && typeof jobs === "object" && !Array.isArray(jobs),
    `${workflowName} jobs must be a mapping`,
  );
  const remoteJob = jobs[remoteJobId];
  assert.ok(
    remoteJob && typeof remoteJob === "object" && !Array.isArray(remoteJob),
    `${workflowName} must define remote Mac job ${remoteJobId}`,
  );
  const concurrency = remoteJob.concurrency;
  assert.ok(
    concurrency && typeof concurrency === "object" && !Array.isArray(concurrency),
    `${workflowName} job ${remoteJobId} must define job-level concurrency`,
  );
  assert.equal(
    concurrency.group,
    REMOTE_MAC_CONCURRENCY_GROUP,
    `${workflowName} job ${remoteJobId} concurrency.group must equal ${REMOTE_MAC_CONCURRENCY_GROUP}`,
  );
  assert.equal(
    concurrency["cancel-in-progress"],
    false,
    `${workflowName} job ${remoteJobId} concurrency.cancel-in-progress must be boolean false`,
  );

  const lockJobIds = Object.entries(jobs)
    .filter(
      ([, job]) =>
        job &&
        typeof job === "object" &&
        !Array.isArray(job) &&
        referencesRemoteMacConcurrencyGroup(extractConcurrencyGroup(job.concurrency)),
    )
    .map(([jobId]) => jobId);
  assert.deepEqual(
    lockJobIds,
    [remoteJobId],
    `${workflowName} must acquire ${REMOTE_MAC_CONCURRENCY_GROUP} exactly once in job ${remoteJobId}`,
  );
}

export function assertRemoteMacConcurrencyContracts(contracts) {
  assert.ok(
    Array.isArray(contracts) && contracts.length > 0,
    "contracts must be a non-empty array",
  );
  for (const contract of contracts) {
    assertRemoteMacConcurrencyContract(contract);
  }
}
