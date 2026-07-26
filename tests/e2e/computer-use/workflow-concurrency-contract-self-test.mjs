#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  REMOTE_MAC_CONCURRENCY_GROUP,
  assertRemoteMacConcurrencyContract,
  assertRemoteMacConcurrencyContracts,
} from "./workflow-concurrency-contract.mjs";

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
      workflowName: "duplicate-lock.yml",
      source: workflowYaml({
        companionConcurrency: `    concurrency:
      group: ${REMOTE_MAC_CONCURRENCY_GROUP}
      cancel-in-progress: false`,
      }),
      remoteJobId: "remote-mac",
    }),
  /duplicate-lock\.yml must acquire nixmac-macincloud-e2e-remote exactly once in job remote-mac/,
  "a companion job must not acquire the shared remote lock",
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

console.log("Computer Use workflow concurrency contract self-test passed.");
