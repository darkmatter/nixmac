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
    branches: [main]
  merge_group:`,
  installCommand = "        run: nix build github:cachix/devenv/v2.1.2 --out-link /tmp/nixmac-devenv-cli",
  validationCommands = `          node tests/e2e/computer-use/workflow-concurrency-contract-self-test.mjs
          node tests/e2e/computer-use/workflow-contract-self-test.mjs
          node tests/e2e/computer-use/peekaboo-workflow-contract-self-test.mjs
          node tests/e2e/computer-use/centaur-workflow-contract-self-test.mjs
          node tests/e2e/computer-use/remote-host-lease-contract-self-test.mjs
          node tests/e2e/computer-use/drivers/driver-self-test.mjs
          node tests/e2e/computer-use/verification-contract-self-test.mjs
          node tests/e2e/computer-use/evidence-manifest-self-test.mjs
          node tests/e2e/computer-use/run-cua-driver.mjs self-test
          node tests/e2e/computer-use/run-remote-cua.mjs self-test`,
} = {}) {
  return `
name: Automatic validation
"on":
${triggers}
env:
  CARGO_TERM_COLOR: always
  SOPS_AGE_KEY: \${{ secrets.SOPS_AGE_KEY }}
jobs:
  git-hooks:
    runs-on: arc
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
      - name: Setup Nix and caches
        uses: ./.github/actions/setup-nix
        with:
          darkmatter-cachix-auth-token: \${{ secrets.DARKMATTER_CACHIX_AUTH_TOKEN }}
      - name: Install devenv
${installCommand}
      - name: Run Computer Use workflow contracts
        env:
          BASH_ENV: ""
          ENV: ""
          NIXPKGS_ALLOW_UNFREE: 1
          NODE_OPTIONS: ""
        shell: /tmp/nixmac-devenv-cli/bin/devenv shell --impure -- bash -euo pipefail {0}
        run: |
${validationCommands}
      - name: Run git hooks
        env:
          BASH_ENV: ""
          ENV: ""
          NIXPKGS_ALLOW_UNFREE: 1
          NODE_OPTIONS: ""
        shell: /tmp/nixmac-devenv-cli/bin/devenv shell --impure -- bash -euo pipefail {0}
        run: prek run --all-files --show-diff-on-failure
  build:
    runs-on: [self-hosted, macOS]
    steps:
      - run: echo build
`;
}

function replaceLast(source, search, replacement) {
  const index = source.lastIndexOf(search);
  assert.notEqual(index, -1, `expected fixture to contain ${JSON.stringify(search)}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
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
    stepName: "Run Computer Use workflow contracts",
  }),
);

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "missing-merge-group.yaml",
      source: automaticWorkflowYaml({
        triggers: "  pull_request:\n    branches: [main]",
      }),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /missing-merge-group\.yaml must run automatically on merge_group/,
);

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "filtered-pull-request.yaml",
      source: automaticWorkflowYaml({
        triggers: `  pull_request:
    branches: [main]
    paths-ignore: ["**"]
  merge_group:`,
      }),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /filtered-pull-request\.yaml pull_request trigger must target main without path filters/,
  "automatic contract validation must reject pull-request filters that suppress the required check",
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
      stepName: "Run Computer Use workflow contracts",
    }),
  /drifted-wiring\.yaml job git-hooks step Run Computer Use workflow contracts must contain exactly the automatic contract commands/,
  "removing the real-workflow contract from automatic CI must fail",
);

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "comment-only-peekaboo-wiring.yaml",
      source: automaticWorkflowYaml({
        validationCommands: `          node tests/e2e/computer-use/workflow-concurrency-contract-self-test.mjs
          node tests/e2e/computer-use/workflow-contract-self-test.mjs
          # node tests/e2e/computer-use/peekaboo-workflow-contract-self-test.mjs`,
      }),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /comment-only-peekaboo-wiring\.yaml job git-hooks step Run Computer Use workflow contracts must contain exactly the automatic contract commands/,
  "a commented Peekaboo contract command must not satisfy the automatic CI wiring contract",
);

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "unreachable-contract-commands.yaml",
      source: automaticWorkflowYaml({
        validationCommands: `          if false; then
          node tests/e2e/computer-use/workflow-concurrency-contract-self-test.mjs
          node tests/e2e/computer-use/workflow-contract-self-test.mjs
          node tests/e2e/computer-use/peekaboo-workflow-contract-self-test.mjs
          fi`,
      }),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /unreachable-contract-commands\.yaml job git-hooks step Run Computer Use workflow contracts must contain exactly the automatic contract commands/,
  "shell control flow must not make the required automatic contract commands unreachable",
);

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "unpinned-devenv-installer.yaml",
      source: automaticWorkflowYaml({
        installCommand:
          "        run: nix build github:cachix/devenv/latest --out-link /tmp/nixmac-devenv-cli",
      }),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /unpinned-devenv-installer\.yaml job git-hooks must install the pinned devenv CLI before running the contracts/,
  "automatic contract validation must bind the devenv installer version",
);

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "disabled-devenv-installer.yaml",
      source: automaticWorkflowYaml().replace(
        "      - name: Install devenv",
        "      - name: Install devenv\n        if: false",
      ),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /disabled-devenv-installer\.yaml job git-hooks must install the pinned devenv CLI before running the contracts/,
  "automatic contract validation must reject a disabled devenv installer",
);

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "custom-shell-devenv-installer.yaml",
      source: automaticWorkflowYaml().replace(
        "      - name: Install devenv",
        "      - name: Install devenv\n        shell: bash -c 'exit 0' -- {0}",
      ),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /custom-shell-devenv-installer\.yaml job git-hooks must install the pinned devenv CLI before running the contracts/,
  "automatic contract validation must reject an installer shell that can skip the pinned command",
);

for (const [scope, original, mutation] of [
  ["workflow-defaults", "jobs:", "defaults:\n  run:\n    shell: bash -c 'exit 0' -- {0}\njobs:"],
  [
    "job-defaults",
    "  git-hooks:",
    "  git-hooks:\n    defaults:\n      run:\n        shell: bash -c 'exit 0' -- {0}",
  ],
]) {
  assert.throws(
    () =>
      assertAutomaticConcurrencyValidationContract({
        workflowName: `${scope}-bypass.yaml`,
        source: automaticWorkflowYaml().replace(original, mutation),
        jobId: "git-hooks",
        stepName: "Run Computer Use workflow contracts",
      }),
    new RegExp(`${scope}-bypass\\.yaml .*must not declare defaults`),
    `automatic contract validation must reject ${scope}`,
  );
}

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "git-hooks-step-env-bypass.yaml",
      source: replaceLast(
        automaticWorkflowYaml(),
        '          NODE_OPTIONS: ""',
        "          NODE_OPTIONS: --require /tmp/exit0.js",
      ),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /git-hooks-step-env-bypass\.yaml job git-hooks must preserve the fail-fast git-hooks step/,
  "automatic contract validation must reject git-hooks step environment injection",
);

assert.throws(
  () => {
    const source = automaticWorkflowYaml();
    const installStep = `      - name: Install devenv
        run: nix build github:cachix/devenv/v2.1.2 --out-link /tmp/nixmac-devenv-cli
`;
    assertAutomaticConcurrencyValidationContract({
      workflowName: "late-devenv-installer.yaml",
      source: source.replace(installStep, "").replace("  build:", `${installStep}  build:`),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    });
  },
  /late-devenv-installer\.yaml job git-hooks must install the pinned devenv CLI before running the contracts/,
  "automatic contract validation must require the installer before the contract step",
);

for (const [scope, original, mutation] of [
  [
    "workflow-env",
    "env:\n  CARGO_TERM_COLOR: always",
    "env:\n  NODE_OPTIONS: --require /tmp/exit0.js\n  CARGO_TERM_COLOR: always",
  ],
  [
    "job-env",
    "  git-hooks:",
    "  git-hooks:\n    env:\n      NODE_OPTIONS: --require /tmp/exit0.js",
  ],
  ["step-env", '          NODE_OPTIONS: ""', "          NODE_OPTIONS: --require /tmp/exit0.js"],
]) {
  assert.throws(
    () =>
      assertAutomaticConcurrencyValidationContract({
        workflowName: `${scope}-bypass.yaml`,
        source: automaticWorkflowYaml().replace(original, mutation),
        jobId: "git-hooks",
        stepName: "Run Computer Use workflow contracts",
      }),
    new RegExp(`${scope}-bypass\\.yaml .*environment`),
    `automatic contract validation must reject ${scope} command injection`,
  );
}

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "job-strategy-bypass.yaml",
      source: automaticWorkflowYaml().replace(
        "  git-hooks:",
        "  git-hooks:\n    strategy:\n      matrix:\n        include: []",
      ),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /job-strategy-bypass\.yaml job git-hooks must not declare strategy/,
  "automatic contract validation must reject a strategy that can expand to no contract jobs",
);

for (const [control, declaration] of [
  ["container", "    container: ghcr.io/example/fake-devenv:latest"],
  [
    "services",
    `    services:
      fake:
        image: ghcr.io/example/fake-devenv:latest`,
  ],
]) {
  assert.throws(
    () =>
      assertAutomaticConcurrencyValidationContract({
        workflowName: `job-${control}-bypass.yaml`,
        source: automaticWorkflowYaml().replace("  git-hooks:", `  git-hooks:\n${declaration}`),
        jobId: "git-hooks",
        stepName: "Run Computer Use workflow contracts",
      }),
    new RegExp(`job-${control}-bypass\\.yaml job git-hooks must not declare ${control}`),
    `automatic contract validation must reject job ${control}`,
  );
}

assert.throws(
  () =>
    assertAutomaticConcurrencyValidationContract({
      workflowName: "persisted-environment-bypass.yaml",
      source: automaticWorkflowYaml().replace(
        "      - name: Install devenv",
        `      - name: Persist hostile environment
        run: echo 'BASH_ENV=/tmp/exit-zero.sh' >> "$GITHUB_ENV"
      - name: Install devenv`,
      ),
      jobId: "git-hooks",
      stepName: "Run Computer Use workflow contracts",
    }),
  /persisted-environment-bypass\.yaml job git-hooks must preserve the exact trusted step sequence/,
  "automatic contract validation must reject pre-gate environment persistence",
);

for (const [name, source] of [
  [
    "missing-prek-step",
    automaticWorkflowYaml().replace(
      `      - name: Run git hooks
        env:
          BASH_ENV: ""
          ENV: ""
          NIXPKGS_ALLOW_UNFREE: 1
          NODE_OPTIONS: ""
        shell: /tmp/nixmac-devenv-cli/bin/devenv shell --impure -- bash -euo pipefail {0}
        run: prek run --all-files --show-diff-on-failure
`,
      "",
    ),
  ],
  [
    "drifted-prek-command",
    automaticWorkflowYaml().replace(
      "        run: prek run --all-files --show-diff-on-failure",
      "        run: prek run",
    ),
  ],
]) {
  assert.throws(
    () =>
      assertAutomaticConcurrencyValidationContract({
        workflowName: `${name}.yaml`,
        source,
        jobId: "git-hooks",
        stepName: "Run Computer Use workflow contracts",
      }),
    new RegExp(`${name}\\.yaml job git-hooks must preserve the fail-fast git-hooks step`),
    `automatic contract validation must reject ${name}`,
  );
}

for (const [control, mutation] of [
  ["if", "    if: false\n    runs-on: arc"],
  ["continue-on-error", "    continue-on-error: true\n    runs-on: arc"],
  ["needs", "    needs: build\n    runs-on: arc"],
]) {
  assert.throws(
    () =>
      assertAutomaticConcurrencyValidationContract({
        workflowName: `job-${control}-bypass.yaml`,
        source: automaticWorkflowYaml().replace("    runs-on: arc", mutation),
        jobId: "git-hooks",
        stepName: "Run Computer Use workflow contracts",
      }),
    new RegExp(`job-${control}-bypass\\.yaml job git-hooks must not declare ${control}`),
    `automatic contract job must reject ${control}`,
  );
}

for (const [control, declaration] of [
  ["if", "        if: false"],
  ["continue-on-error", "        continue-on-error: true"],
]) {
  assert.throws(
    () =>
      assertAutomaticConcurrencyValidationContract({
        workflowName: `step-${control}-bypass.yaml`,
        source: automaticWorkflowYaml().replace("        run: |", `${declaration}\n        run: |`),
        jobId: "git-hooks",
        stepName: "Run Computer Use workflow contracts",
      }),
    new RegExp(
      `step-${control}-bypass\\.yaml job git-hooks step Run Computer Use workflow contracts must not declare ${control}`,
    ),
    `automatic contract step must reject ${control}`,
  );
}

console.log("Computer Use workflow concurrency contract self-test passed.");
