#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  AUTOMATIC_CONTRACT_COMMANDS,
  REMOTE_MAC_CONCURRENCY_GROUP,
  assertAutomaticContractScript,
  assertAutomaticConcurrencyValidationContract,
  assertRemoteMacConcurrencyContract,
  assertRemoteMacConcurrencyContracts,
} from "./workflow-concurrency-contract.mjs";

function remoteWorkflowYaml({
  group = REMOTE_MAC_CONCURRENCY_GROUP,
  cancelInProgress = false,
  extraLock = "",
  workflowConcurrency = "",
} = {}) {
  return `
name: Synthetic remote workflow
"on": workflow_dispatch
${workflowConcurrency}
jobs:
  remote-mac:
    runs-on: arc
    concurrency:
      group: ${group}
      cancel-in-progress: ${cancelInProgress}
    steps:
      - run: echo remote
  companion:
    runs-on: arc
${extraLock}
    steps:
      - run: echo companion
`;
}

function automaticWorkflowYaml({
  triggers = `  pull_request:
    branches: [main]
  merge_group:`,
  jobControl = "",
  stepControl = "",
} = {}) {
  return `
name: Build macOS App
"on":
${triggers}
jobs:
  git-hooks:
${jobControl}    runs-on: arc
    steps:
      - name: Install devenv
        run: nix build github:cachix/devenv/v2.1.2 --out-link "$RUNNER_TEMP/devenv-cli"
      - name: Run Computer Use workflow contracts
${stepControl}        env:
          BASH_ENV: ""
          ENV: ""
          NIXPKGS_ALLOW_UNFREE: 1
          NODE_OPTIONS: ""
        shell: bash
        run: >-
          "$RUNNER_TEMP/devenv-cli/bin/devenv" shell --impure --
          bash -euo pipefail tests/e2e/computer-use/run-workflow-contracts.sh
      - name: Run git hooks on all files
        run: prek run --all-files --show-diff-on-failure
`;
}

assert.doesNotThrow(() =>
  assertRemoteMacConcurrencyContract({
    workflowName: "valid.yml",
    source: remoteWorkflowYaml(),
    remoteJobId: "remote-mac",
  }),
);
assert.doesNotThrow(() =>
  assertAutomaticContractScript({
    scriptName: "run-workflow-contracts.sh",
    source: `#!/usr/bin/env bash
set -euo pipefail

${AUTOMATIC_CONTRACT_COMMANDS.join("\n")}
`,
  }),
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "wrong-group.yml",
      source: remoteWorkflowYaml({ group: "different-lock" }),
      remoteJobId: "remote-mac",
    }),
  /concurrency\.group must equal nixmac-macincloud-e2e-remote/,
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "cancel.yml",
      source: remoteWorkflowYaml({ cancelInProgress: true }),
      remoteJobId: "remote-mac",
    }),
  /cancel-in-progress must be boolean false/,
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "duplicate.yml",
      source: remoteWorkflowYaml({
        extraLock: `    concurrency:
      group: ${REMOTE_MAC_CONCURRENCY_GROUP}
      cancel-in-progress: false`,
      }),
      remoteJobId: "remote-mac",
    }),
  /must acquire nixmac-macincloud-e2e-remote exactly once/,
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "workflow-lock.yml",
      source: remoteWorkflowYaml({
        workflowConcurrency: `concurrency:
  group: unrelated`,
      }),
      remoteJobId: "remote-mac",
      forbidWorkflowLevelConcurrency: true,
    }),
  /must not define workflow-level concurrency/,
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContracts([
      {
        workflowName: "valid.yml",
        source: remoteWorkflowYaml(),
        remoteJobId: "remote-mac",
      },
      {
        workflowName: "invalid.yml",
        source: remoteWorkflowYaml({ group: "different-lock" }),
        remoteJobId: "remote-mac",
      },
    ]),
  /invalid\.yml job remote-mac concurrency\.group/,
);

assert.doesNotThrow(() =>
  assertAutomaticConcurrencyValidationContract({
    workflowName: "build.yaml",
    source: automaticWorkflowYaml(),
    jobId: "git-hooks",
    stepName: "Run Computer Use workflow contracts",
  }),
);

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "missing-merge-group.yaml",
      source: automaticWorkflowYaml({
        triggers: `  pull_request:
    branches: [main]`,
      }),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /must run automatically on merge_group/,
);

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "filtered-pr.yaml",
      source: automaticWorkflowYaml({
        triggers: `  pull_request:
    branches: [main]
    paths-ignore: ["**"]
  merge_group:`,
      }),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /pull_request trigger must target main without path filters/,
);

assert.throws(
  () =>
    assertAutomaticContractScript({
      scriptName: "missing-command.sh",
      source: `#!/usr/bin/env bash
set -euo pipefail

${AUTOMATIC_CONTRACT_COMMANDS.slice(0, -1).join("\n")}
`,
    }),
  /must contain exactly the automatic contract commands/,
);

for (const [name, jobControl, stepControl, expected] of [
  ["skipped-job", "    if: false\n", "", /must not conditionally skip/],
  ["soft-job", "    continue-on-error: true\n", "", /must fail closed/],
  ["skipped-step", "", "        if: false\n", /must not declare if/],
  ["soft-step", "", "        continue-on-error: true\n", /must not declare continue-on-error/],
]) {
  assert.throws(
    () =>
      assertAutomaticConcurrencyValidationContract({
        workflowName: `${name}.yaml`,
        source: automaticWorkflowYaml({ jobControl, stepControl }),
        jobId: "git-hooks",
        stepName: "Run Computer Use workflow contracts",
      }),
    expected,
  );
}

console.log("Computer Use workflow concurrency contract self-test passed.");
