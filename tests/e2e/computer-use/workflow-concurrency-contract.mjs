import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export const REMOTE_MAC_CONCURRENCY_GROUP = "nixmac-macincloud-e2e-remote";
const AUTOMATIC_CONTRACT_COMMANDS = [
  "node tests/e2e/computer-use/workflow-concurrency-contract-self-test.mjs",
  "node tests/e2e/computer-use/workflow-contract-self-test.mjs",
  "node tests/e2e/computer-use/peekaboo-workflow-contract-self-test.mjs",
];

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

  // yq is pinned by nix/dev.nix and setup-devenv puts it on PATH before CI validation.
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
  assert.equal(
    Object.hasOwn(triggers, "pull_request"),
    true,
    `${workflowName} must run automatically on pull_request`,
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
  assert.ok(Array.isArray(job.steps), `${workflowName} job ${jobId} steps must be an array`);

  const matchingSteps = job.steps.filter((step) => step?.name === stepName);
  assert.equal(
    matchingSteps.length,
    1,
    `${workflowName} job ${jobId} must define exactly one ${stepName} step`,
  );
  const run = matchingSteps[0].run;
  assert.equal(typeof run, "string", `${workflowName} job ${jobId} step ${stepName} must use run`);
  const commandLines = run.split(/\r?\n/u).map((line) => line.trim());
  for (const command of AUTOMATIC_CONTRACT_COMMANDS) {
    assert.equal(
      commandLines.includes(command),
      true,
      `${workflowName} job ${jobId} step ${stepName} must run ${command}`,
    );
  }
}

export function assertRemoteMacConcurrencyContract({
  workflowName,
  source,
  remoteJobId,
  forbidWorkflowLevelConcurrency = false,
}) {
  assert.equal(typeof remoteJobId, "string", `${workflowName} remoteJobId must be a string`);
  assert.ok(remoteJobId.trim(), `${workflowName} remoteJobId must not be blank`);
  assert.equal(
    typeof forbidWorkflowLevelConcurrency,
    "boolean",
    `${workflowName} forbidWorkflowLevelConcurrency must be a boolean`,
  );

  const workflow = parseWorkflowYaml({ workflowName, source });
  const workflowConcurrency = workflow.concurrency;
  const workflowConcurrencyGroup = extractConcurrencyGroup(workflowConcurrency);
  assert.equal(
    referencesRemoteMacConcurrencyGroup(workflowConcurrencyGroup),
    false,
    `${workflowName} must not reuse ${REMOTE_MAC_CONCURRENCY_GROUP} at workflow level; declared ${JSON.stringify(workflowConcurrencyGroup)}`,
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
  const remoteConcurrencyGroup = extractConcurrencyGroup(concurrency);
  assert.equal(
    remoteConcurrencyGroup,
    REMOTE_MAC_CONCURRENCY_GROUP,
    `${workflowName} job ${remoteJobId} concurrency.group must equal ${REMOTE_MAC_CONCURRENCY_GROUP}`,
  );
  assert.ok(
    concurrency && typeof concurrency === "object" && !Array.isArray(concurrency),
    `${workflowName} job ${remoteJobId} must define job-level concurrency`,
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
  assert.equal(
    lockJobIds.length,
    1,
    `${workflowName} must acquire ${REMOTE_MAC_CONCURRENCY_GROUP} exactly once in job ${remoteJobId}`,
  );
  assert.equal(
    lockJobIds[0],
    remoteJobId,
    `${workflowName} must acquire ${REMOTE_MAC_CONCURRENCY_GROUP} only in job ${remoteJobId}`,
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
