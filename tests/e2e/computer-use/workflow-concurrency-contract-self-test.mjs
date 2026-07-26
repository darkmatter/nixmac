#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  REMOTE_MAC_CONCURRENCY_GROUP,
  assertAutomaticConcurrencyValidationContract,
  assertRemoteMacConcurrencyContract,
  assertRemoteMacConcurrencyContracts,
} from "./workflow-concurrency-contract.mjs";

const MIXED_CASE_REMOTE_MAC_CONCURRENCY_GROUP = "NixMac-MacInCloud-E2E-Remote";
const MIXED_CASE_REMOTE_MAC_CONCURRENCY_EXPRESSION = "${{ 'NixMac-MacInCloud-E2E-Remote' }}";

function workflowYaml({
  remoteGroup = REMOTE_MAC_CONCURRENCY_GROUP,
  cancelInProgress = false,
  companionConcurrency = "",
  decoy = "",
  workflowConcurrency = "",
} = {}) {
  return `
name: Synthetic workflow
"on": workflow_dispatch
${workflowConcurrency}
jobs:
  remote-mac:
    runs-on: arc
    concurrency:
      group: ${remoteGroup}
      cancel-in-progress: ${cancelInProgress}
    steps:
      - run: echo remote
  companion:
    runs-on: arc
${companionConcurrency}
    steps:
      - run: |
          echo companion
          ${decoy}
`;
}

function automaticWorkflowYaml({
  triggers = `  pull_request:
  merge_group:`,
  validationCommands = `          node tests/e2e/computer-use/workflow-concurrency-contract-self-test.mjs
          node tests/e2e/computer-use/workflow-contract-self-test.mjs`,
} = {}) {
  return `
name: Automatic validation
"on":
${triggers}
jobs:
  git-hooks:
    runs-on: arc
    steps:
      - name: Run git hooks and Computer Use workflow contracts
        run: |
          set -euo pipefail
${validationCommands}
          prek run --all-files --show-diff-on-failure
  build:
    runs-on: [self-hosted, macOS]
    steps:
      - run: echo build
`;
}

assert.doesNotThrow(() =>
  assertRemoteMacConcurrencyContract({
    workflowName: "valid.yml",
    source: workflowYaml(),
    remoteJobId: "remote-mac",
  }),
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "wrong-job-with-decoy.yml",
      source: workflowYaml({
        remoteGroup: "wrong-remote-group",
        decoy: `echo "group: ${REMOTE_MAC_CONCURRENCY_GROUP}"`,
      }),
      remoteJobId: "remote-mac",
    }),
  /wrong-job-with-decoy\.yml job remote-mac concurrency\.group must equal nixmac-macincloud-e2e-remote/,
  "a decoy string outside job concurrency must not satisfy the contract",
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "mixed-case-remote-job.yml",
      source: workflowYaml({ remoteGroup: MIXED_CASE_REMOTE_MAC_CONCURRENCY_GROUP }),
      remoteJobId: "remote-mac",
    }),
  /mixed-case-remote-job\.yml job remote-mac concurrency\.group must equal nixmac-macincloud-e2e-remote/,
  "the intended remote job must declare the exact canonical lowercase group",
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "duplicate-lock.yml",
      source: workflowYaml({
        companionConcurrency: `    concurrency: ${MIXED_CASE_REMOTE_MAC_CONCURRENCY_GROUP}`,
      }),
      remoteJobId: "remote-mac",
    }),
  /duplicate-lock\.yml must acquire nixmac-macincloud-e2e-remote exactly once in job remote-mac/,
  "a companion job must not acquire the shared remote lock",
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "companion-object-expression.yml",
      source: workflowYaml({
        companionConcurrency: `    concurrency:
      group: ${MIXED_CASE_REMOTE_MAC_CONCURRENCY_EXPRESSION}
      cancel-in-progress: false`,
      }),
      remoteJobId: "remote-mac",
    }),
  /companion-object-expression\.yml must acquire nixmac-macincloud-e2e-remote exactly once in job remote-mac/,
  "an object-form companion expression containing the canonical literal must fail closed",
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "companion-scalar-expression.yml",
      source: workflowYaml({
        companionConcurrency: `    concurrency: ${MIXED_CASE_REMOTE_MAC_CONCURRENCY_EXPRESSION}`,
      }),
      remoteJobId: "remote-mac",
    }),
  /companion-scalar-expression\.yml must acquire nixmac-macincloud-e2e-remote exactly once in job remote-mac/,
  "a scalar companion expression containing the canonical literal must fail closed",
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "string-false.yml",
      source: workflowYaml({ cancelInProgress: '"false"' }),
      remoteJobId: "remote-mac",
    }),
  /string-false\.yml job remote-mac concurrency\.cancel-in-progress must be boolean false/,
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "top-level-lock.yml",
      source: workflowYaml({
        workflowConcurrency: `concurrency:
  group: workflow-wide-lock
  cancel-in-progress: true`,
      }),
      remoteJobId: "remote-mac",
      forbidWorkflowLevelConcurrency: true,
    }),
  /top-level-lock\.yml must not define workflow-level concurrency/,
  "the split Computer Use workflow must not serialize prepare behind the remote host lock",
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "workflow-level-shared-lock.yml",
      source: workflowYaml({
        workflowConcurrency: `concurrency:
  group: ${MIXED_CASE_REMOTE_MAC_CONCURRENCY_GROUP}
  cancel-in-progress: false`,
      }),
      remoteJobId: "remote-mac",
    }),
  /workflow-level-shared-lock\.yml must not reuse nixmac-macincloud-e2e-remote at workflow level/,
  "workflow-level concurrency must not duplicate or self-conflict with the remote job lock",
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "workflow-level-scalar-lock.yml",
      source: workflowYaml({
        workflowConcurrency: `concurrency: ${MIXED_CASE_REMOTE_MAC_CONCURRENCY_GROUP}`,
      }),
      remoteJobId: "remote-mac",
    }),
  /workflow-level-scalar-lock\.yml must not reuse nixmac-macincloud-e2e-remote at workflow level/,
  "scalar workflow concurrency must not duplicate the remote job lock",
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "workflow-object-expression.yml",
      source: workflowYaml({
        workflowConcurrency: `concurrency:
  group: ${MIXED_CASE_REMOTE_MAC_CONCURRENCY_EXPRESSION}
  cancel-in-progress: false`,
      }),
      remoteJobId: "remote-mac",
    }),
  /workflow-object-expression\.yml must not reuse nixmac-macincloud-e2e-remote at workflow level/,
  "an object-form workflow expression containing the canonical literal must fail closed",
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContract({
      workflowName: "workflow-scalar-expression.yml",
      source: workflowYaml({
        workflowConcurrency: `concurrency: ${MIXED_CASE_REMOTE_MAC_CONCURRENCY_EXPRESSION}`,
      }),
      remoteJobId: "remote-mac",
    }),
  /workflow-scalar-expression\.yml must not reuse nixmac-macincloud-e2e-remote at workflow level/,
  "a scalar workflow expression containing the canonical literal must fail closed",
);

assert.throws(
  () =>
    assertRemoteMacConcurrencyContracts([
      {
        workflowName: "computer-use-e2e.yml",
        source: workflowYaml(),
        remoteJobId: "remote-mac",
      },
      {
        workflowName: "peekaboo-e2e.yml",
        source: workflowYaml(),
        remoteJobId: "remote-mac",
      },
      {
        workflowName: "e2e.yml",
        source: workflowYaml({ remoteGroup: "diverged-remote-group" }),
        remoteJobId: "remote-mac",
      },
    ]),
  /e2e\.yml job remote-mac concurrency\.group must equal nixmac-macincloud-e2e-remote/,
  "one workflow diverging from the shared lock must fail the suite",
);

assert.doesNotThrow(() =>
  assertAutomaticConcurrencyValidationContract({
    workflowName: "build.yaml",
    source: automaticWorkflowYaml(),
    jobId: "git-hooks",
    stepName: "Run git hooks and Computer Use workflow contracts",
  }),
);

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "missing-merge-group.yaml",
      source: automaticWorkflowYaml({ triggers: "  pull_request:" }),
      jobId: "git-hooks",
      stepName: "Run git hooks and Computer Use workflow contracts",
    }),
  /missing-merge-group\.yaml must run automatically on merge_group/,
);

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "drifted-wiring.yaml",
      source: automaticWorkflowYaml({
        validationCommands:
          "          node tests/e2e/computer-use/workflow-concurrency-contract-self-test.mjs",
      }),
      jobId: "git-hooks",
      stepName: "Run git hooks and Computer Use workflow contracts",
    }),
  /drifted-wiring\.yaml job git-hooks step Run git hooks and Computer Use workflow contracts must run node tests\/e2e\/computer-use\/workflow-contract-self-test\.mjs/,
  "removing the real-workflow contract from automatic CI must fail",
);

console.log("Computer Use workflow concurrency contract self-test passed.");
