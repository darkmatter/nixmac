#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertAutomaticConcurrencyValidationContract,
  assertRemoteMacConcurrencyContracts,
  parseWorkflowYaml,
} from "./workflow-concurrency-contract.mjs";

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
const workflowPath = path.join(repoRoot, ".github/workflows/computer-use-e2e.yml");
const workflow = readFileSync(workflowPath, "utf8");
const peekabooWorkflow = readFileSync(
  path.join(repoRoot, ".github/workflows/peekaboo-e2e.yml"),
  "utf8",
);
const legacyE2eWorkflow = readFileSync(path.join(repoRoot, ".github/workflows/e2e.yml"), "utf8");
const buildWorkflow = readFileSync(path.join(repoRoot, ".github/workflows/build.yaml"), "utf8");
const parsedBuildWorkflow = parseWorkflowYaml({
  workflowName: ".github/workflows/build.yaml",
  source: buildWorkflow,
});

function section(startPattern, endPattern = null) {
  const start = workflow.search(startPattern);
  assert.notEqual(start, -1, `missing section matching ${startPattern}`);
  if (!endPattern) return workflow.slice(start);
  const rest = workflow.slice(start + 1);
  const relativeEnd = rest.search(endPattern);
  assert.notEqual(relativeEnd, -1, `missing end section matching ${endPattern}`);
  return workflow.slice(start, start + 1 + relativeEnd);
}

const prepare = section(/^  prepare:$/m, /^  remote-computer-use:$/m);
const remote = section(/^  remote-computer-use:$/m, /^  publish-report:$/m);
const publish = section(/^  publish-report:$/m, /^  e2e-result:$/m);
const result = section(/^  e2e-result:$/m);

assertRemoteMacConcurrencyContracts([
  {
    workflowName: ".github/workflows/computer-use-e2e.yml",
    source: workflow,
    remoteJobId: "remote-computer-use",
    forbidWorkflowLevelConcurrency: true,
  },
  {
    workflowName: ".github/workflows/peekaboo-e2e.yml",
    source: peekabooWorkflow,
    remoteJobId: "peekaboo-product-proof",
  },
  {
    workflowName: ".github/workflows/e2e.yml",
    source: legacyE2eWorkflow,
    remoteJobId: "e2e-test",
  },
]);
assertAutomaticConcurrencyValidationContract({
  workflowName: ".github/workflows/build.yaml",
  source: buildWorkflow,
  jobId: "git-hooks",
  stepName: "Run Computer Use workflow contracts",
});

const buildDispatchInputs = parsedBuildWorkflow.on.workflow_dispatch.inputs;
assert.equal(
  buildDispatchInputs.e2e_backfill.type,
  "boolean",
  "build workflow must expose an explicit E2E backfill mode",
);
assert.equal(buildDispatchInputs.e2e_backfill.default, false);
assert.equal(
  buildDispatchInputs.e2e_merge_sha.type,
  "string",
  "build workflow must accept the exact merged SHA",
);
assert.match(
  buildDispatchInputs.e2e_merge_sha.description,
  /deterministic backfill branch pointing at this SHA/,
  "workflow dispatch must use a branch ref that resolves to the exact merged SHA",
);
assert.match(
  JSON.stringify(parsedBuildWorkflow.concurrency),
  /inputs\.e2e_merge_sha/,
  "exact-SHA backfills must serialize idempotently by merged SHA",
);
assert.match(
  JSON.stringify(parsedBuildWorkflow.jobs["resolve-e2e-backfill"]),
  /merge-base.*--is-ancestor/,
  "backfill must prove the exact SHA belongs to default-branch history",
);
assert.match(
  JSON.stringify(parsedBuildWorkflow.jobs["resolve-e2e-backfill"]),
  /nixmac-macos-app-e2e/,
  "backfill must reuse only the metadata-preserving exact-SHA E2E artifact",
);
assert.match(
  JSON.stringify(parsedBuildWorkflow.jobs["resolve-e2e-backfill"]),
  /build_needed/,
  "backfill resolver must expose the idempotent build decision",
);
assert.match(
  JSON.stringify(parsedBuildWorkflow.jobs.build),
  /needs\.resolve-e2e-backfill\.outputs\.build_needed/,
  "macOS build capacity must be skipped when an exact artifact already exists",
);
const reuseBackfillJob = parsedBuildWorkflow.jobs["reuse-e2e-backfill"];
assert.ok(
  reuseBackfillJob,
  "an idempotent exact-SHA backfill must materialize the reused artifact in the newer run",
);
const reuseBackfillText = JSON.stringify(reuseBackfillJob);
assert.match(
  reuseBackfillText,
  /needs\.resolve-e2e-backfill\.outputs\.build_needed == 'false'/,
  "artifact reuse must run only when the exact-SHA macOS build is skipped",
);
assert.match(
  reuseBackfillText,
  /actions\/download-artifact@v7[\s\S]*artifact-ids[\s\S]*existing_artifact_id/,
  "artifact reuse must download the resolver-selected artifact by immutable ID",
);
assert.match(
  reuseBackfillText,
  /run-id[\s\S]*existing_build_run_id/,
  "artifact reuse must stay bound to the resolver-selected source run",
);
assert.match(
  reuseBackfillText,
  /actions\/upload-artifact@v7[\s\S]*nixmac-macos-app-e2e/,
  "the newer successful backfill run must publish its own exact E2E artifact",
);
assert.match(
  JSON.stringify(parsedBuildWorkflow.jobs.build),
  /nixmac-macos-app-preserved\.zip/,
  "build artifact must include a macOS-preserving app archive for E2E transport",
);
assert.match(
  JSON.stringify(parsedBuildWorkflow.jobs.build),
  /name.*nixmac-macos-app-e2e/,
  "metadata-preserving app transport must use a distinct versioned artifact contract",
);
assert.match(
  JSON.stringify(parsedBuildWorkflow.jobs.build),
  /ditto -c -k --sequesterRsrc --keepParent/,
  "app archive must preserve macOS bundle metadata",
);

assert.match(remote, /\n    needs: prepare\n/, "remote job must depend on prepare");
assert.match(
  remote,
  /\n    if: needs\.prepare\.outputs\.remote_ready == 'true' && needs\.prepare\.outputs\.storybook_ui_only != 'true'\n/,
  "remote job must only acquire the DXU lane after prepare marks it ready and Storybook has not satisfied a UI-only PR",
);
assert.doesNotMatch(
  workflow,
  /storybook_plan_json: \$\{\{ steps\.storybook-preview\.outputs\.storybook_plan_json \}\}/,
  "prepare must not expose the Storybook plan through a large job output",
);
assert.doesNotMatch(
  remote,
  /NIXMAC_E2E_STORYBOOK_PREVIEW_JSON: \$\{\{ needs\.prepare\.outputs\.storybook_plan_json \}\}/,
  "remote job must not receive Storybook plan metadata through a large env JSON blob",
);
assert.match(
  prepare,
  /name: Upload Storybook plan artifact[\s\S]*name: computer-use-e2e-storybook-plan[\s\S]*path: artifacts\/computer-use-storybook\/storybook-preview\.json/,
  "prepare must upload the compact Storybook plan artifact for cross-job transport",
);
assert.match(
  remote,
  /name: Download Storybook plan[\s\S]*name: computer-use-e2e-storybook-plan[\s\S]*path: artifacts\/computer-use-storybook-plan/,
  "remote job must download the Storybook plan artifact",
);
assert.match(
  publish,
  /name: Download Storybook plan[\s\S]*name: computer-use-e2e-storybook-plan[\s\S]*path: artifacts\/computer-use-storybook-plan/,
  "publish job must download the Storybook plan artifact for PR comments",
);
assert.match(
  publish,
  /STORYBOOK_PLAN_PATH: artifacts\/computer-use-storybook-plan\/storybook-preview\.json/,
  "publish comment must read Storybook metadata from the downloaded plan artifact",
);
assert.match(
  publish,
  /concurrency:\n\s+group: computer-use-e2e-gh-pages-publish\n\s+cancel-in-progress: false/,
  "publish job must serialize gh-pages writes",
);

assert.equal(/Preflight remote Mac/.test(prepare), false, "prepare must not run remote readiness");
assert.equal(
  /--key ~\/\.ssh\/nixmac-e2e/.test(prepare),
  false,
  "prepare must not use the remote SSH key for readiness",
);
assert.equal(
  /--known-hosts ~\/\.ssh\/known_hosts/.test(prepare),
  false,
  "prepare must not use remote known_hosts for readiness",
);
assert.equal(/\n\s+ssh\s/.test(prepare), false, "prepare must not open SSH sessions");
assert.equal(/\n\s+scp\s/.test(prepare), false, "prepare must not copy to the remote Mac");
assert.match(
  prepare,
  /name: Validate runner syntax[\s\S]*cd "\$GITHUB_WORKSPACE"[\s\S]*node tests\/e2e\/computer-use\/drivers\/driver-self-test\.mjs[\s\S]*node tests\/e2e\/computer-use\/run-cua-driver\.mjs self-test[\s\S]*node tests\/e2e\/computer-use\/evidence-manifest-self-test\.mjs/,
  "the Linux prepare job must run driver, local runner, and evidence self-tests from the repository root",
);

const staleRecheckIndex = remote.indexOf("Check stale queued PR run before remote work");
const remotePrFocusIndex = remote.indexOf("Capture PR focus metadata for remote run");
const prepareSshIndex = remote.indexOf("Prepare SSH");
assert.ok(staleRecheckIndex >= 0, "remote job must recheck stale queued PR runs");
assert.ok(remotePrFocusIndex >= 0, "remote job must export PR focus metadata for run-remote-cua");
assert.ok(prepareSshIndex >= 0, "remote job must prepare SSH after stale recheck");
assert.ok(
  remotePrFocusIndex < staleRecheckIndex,
  "remote PR focus metadata must be available before remote work",
);
assert.ok(
  staleRecheckIndex < prepareSshIndex,
  "stale recheck must happen before SSH or remote work",
);
assert.match(
  remote,
  /append_multiline_env "NIXMAC_E2E_PR_CHANGED_FILES"/,
  "remote job must export multiline changed-file metadata into the Computer Use runner environment",
);
assert.match(
  remote,
  /printf '%s\\n' \/flake\.lock \/result > "\$config_tmp\/config\/\.gitignore"/,
  "remote disposable config must ignore generated flake.lock and result artifacts before launch",
);

assert.match(
  prepare,
  /Render app artifact setup failure report/,
  "prepare must render a setup-failure report when app artifact packaging fails",
);
assert.match(
  prepare,
  /Check remote Computer Use secrets[\s\S]*if: steps\.stale-run\.outputs\.stale != 'true' && steps\.storybook-preview\.outputs\.storybook_ui_only != 'true'/,
  "prepare must skip remote secret checks for UI-only PRs",
);
assert.match(
  prepare,
  /Render unavailable report[\s\S]*if: steps\.stale-run\.outputs\.stale != 'true' && steps\.storybook-preview\.outputs\.storybook_ui_only != 'true' && steps\.remote-secrets\.outputs\.available != 'true'/,
  "prepare must skip unavailable remote reports for UI-only PRs",
);
assert.match(
  prepare,
  /Download PR-built app artifact[\s\S]*if: steps\.stale-run\.outputs\.stale != 'true' && steps\.storybook-preview\.outputs\.storybook_ui_only != 'true' && steps\.remote-secrets\.outputs\.available == 'true'/,
  "prepare must skip PR app artifact lookup for UI-only PRs",
);
assert.match(
  prepare,
  /Render app artifact setup failure report[\s\S]*if: steps\.stale-run\.outputs\.stale != 'true' && steps\.storybook-preview\.outputs\.storybook_ui_only != 'true' && steps\.remote-secrets\.outputs\.available == 'true' && steps\.pr-app\.outcome == 'failure'/,
  "prepare must skip app artifact failure reports for UI-only PRs",
);
assert.match(
  prepare,
  /storybook-ui-only-unhealthy/,
  "UI-only reports must distinguish unhealthy Storybook metadata from a clean reviewer-ready skip",
);
assert.match(
  result,
  /setup_failed="\$\{\{ needs\.prepare\.outputs\.setup_failed \}\}"/,
  "final result job must observe prepare setup failures",
);
assert.match(
  result,
  /Prepare produced a setup-failure report; failing the result job/,
  "setup failures must keep the check result honest",
);
assert.match(
  result,
  /storybook_ui_only="\$\{\{ needs\.prepare\.outputs\.storybook_ui_only \}\}"/,
  "final result job must observe the UI-only Storybook skip policy",
);
assert.match(
  result,
  /Remote Computer Use skipped by UI-only Storybook policy with passing prepare report/,
  "UI-only remote skips must be accepted only after a passing prepare report",
);
assert.match(
  result,
  /Remote Computer Use skipped after prepare produced a non-remote report or no remote lane was required/,
  "non-UI skipped remote jobs must keep pass-with-report behavior for stale or unavailable prepare paths",
);
assert.doesNotMatch(
  result,
  /Remote Computer Use was skipped without the UI-only Storybook policy/,
  "non-UI skipped remote jobs must not hard fail solely because the remote lane did not run",
);

assert.match(
  publish,
  /git -C "\$site_dir" fetch --depth=1 origin gh-pages/,
  "publisher must fetch gh-pages under the serialized publish lane",
);
assert.match(
  publish,
  /git -C "\$site_dir" push -q origin gh-pages/,
  "publisher must push gh-pages only from the serialized publish lane",
);

console.log("Computer Use workflow contract self-test passed.");
