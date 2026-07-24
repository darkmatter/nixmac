#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
const workflowPath = path.join(repoRoot, ".github/workflows/computer-use-e2e.yml");
const workflow = readFileSync(workflowPath, "utf8");

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

assert.equal(
  /^concurrency:/m.test(workflow),
  false,
  "workflow must not serialize prepare under top-level concurrency",
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
  remote,
  /concurrency:\n\s+group: nixmac-macincloud-e2e-remote\n\s+cancel-in-progress: false/,
  "remote job must keep the singleton DXU lock",
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
const recordingStartIndex = remote.indexOf("Start continuous remote screen recording");
const computerUseRunIndex = remote.indexOf("Run Computer Use E2E");
const recordingStopIndex = remote.indexOf("Stop, collect, and attach continuous screen recording");
const restoreRemoteIndex = remote.indexOf("Restore remote app support");
const remotePreflightIndex = remote.indexOf("Preflight remote Mac");
const remoteStagingIndex = remote.indexOf("Start remote Codex app-server and nixmac");
assert.ok(
  remotePreflightIndex >= 0 && remotePreflightIndex < remoteStagingIndex,
  "remote readiness must run before app staging mutates remote state",
);
assert.match(
  remote,
  /name: Preflight remote Mac[\s\S]*--check-recording-tools[\s\S]*name: Start remote Codex app-server and nixmac/,
  "remote readiness must require continuous-recording dependencies before app staging",
);
assert.ok(recordingStartIndex >= 0, "remote job must start continuous screen recording");
assert.ok(recordingStopIndex >= 0, "remote job must collect continuous screen recording");
assert.ok(
  recordingStartIndex < computerUseRunIndex,
  "continuous recording must start before Computer Use interaction",
);
assert.ok(
  computerUseRunIndex < recordingStopIndex,
  "continuous recording must stop only after the Computer Use run",
);
assert.ok(
  recordingStopIndex < restoreRemoteIndex,
  "continuous recording must be collected before remote cleanup removes its staging directory",
);
assert.match(
  remote,
  /source "\$REMOTE_RECORDING_DIR\/recording\.sh"[\s\S]*start_recording/,
  "continuous recording must reuse the proven Terminal/ffmpeg AVFoundation recorder",
);
assert.match(
  remote,
  /if: always\(\) && steps\.stale-run\.outputs\.stale != 'true'[\s\S]*attach-recording[\s\S]*--video "video\/continuous-screen-recording\.mp4"/,
  "recording collection must run on failure and attach the continuous artifact to the report",
);
assert.match(
  remote,
  /name: Restore remote app support[\s\S]*pkill -INT -f 'ffmpeg\.\*continuous-screen-recording\\\.mp4'/,
  "remote cleanup must stop a stranded continuous recorder before deleting its staging directory",
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
