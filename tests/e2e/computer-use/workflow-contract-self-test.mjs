#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
const workflowPath = path.join(repoRoot, ".github/workflows/computer-use-e2e.yml");
const workflow = readFileSync(workflowPath, "utf8");
const terminalWorkflowPath = path.join(
  repoRoot,
  ".github/workflows/publish-computer-use-e2e-report.yml",
);
const terminalWorkflow = readFileSync(terminalWorkflowPath, "utf8");
const publisherScript = readFileSync(
  path.join(repoRoot, "ops/scripts/e2e/publish-report.sh"),
  "utf8",
);
const runtimeAttestationScript = readFileSync(
  path.join(repoRoot, "ops/scripts/e2e/capture-runtime-attestation.sh"),
  "utf8",
);
const trustedVideoAuditScript = readFileSync(
  path.join(repoRoot, "ops/scripts/e2e/trusted-video-audit.mjs"),
  "utf8",
);
const canonicalAppDigestPath = path.join(
  repoRoot,
  "ops/scripts/e2e/canonical-app-digest.py",
);
const canonicalAppDigestScript = readFileSync(canonicalAppDigestPath, "utf8");
execFileSync("python3", [canonicalAppDigestPath, "--self-test"], { stdio: "pipe" });
execFileSync(
  "python3",
  [path.join(repoRoot, "ops/scripts/e2e/bounded-stream-copy.py"), "--self-test"],
  { stdio: "pipe" },
);
execFileSync(
  "python3",
  [path.join(repoRoot, "ops/scripts/e2e/safe-extract-zip.py"), "--self-test"],
  { stdio: "pipe" },
);
execFileSync(
  "node",
  [path.join(repoRoot, "ops/scripts/e2e/trusted-video-audit.mjs"), "--self-test"],
  { stdio: "pipe" },
);

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

for (const [jobName, job] of [
  ["prepare", prepare],
  ["remote-computer-use", remote],
]) {
  assert.match(
    job,
    /name: Install media dependencies[\s\S]*apt-get install -y ffmpeg[\s\S]*LD_LIBRARY_PATH=/,
    `${jobName} must clear the Nix LD_LIBRARY_PATH before invoking Ubuntu media tools`,
  );
}

assert.equal(
  /^concurrency:/m.test(workflow),
  false,
  "workflow must not serialize prepare under top-level concurrency",
);
assert.match(
  terminalWorkflow,
  /permissions:\n\s+actions: read\n\s+contents: read\n\s+pull-requests: read/,
  "terminal renderer must not receive a write-capable repository token",
);
assert.doesNotMatch(
  terminalWorkflow,
  /ref: \$\{\{ inputs\.report_tool_sha \}\}/,
  "terminal workflow must not directly checkout caller-controlled executable code",
);
assert.match(
  terminalWorkflow,
  /name: Checkout protected report tool[\s\S]*ref: main[\s\S]*fetch-depth: 0[\s\S]*persist-credentials: false/,
  "terminal renderer must start from protected main without persisted credentials",
);
assert.match(
  terminalWorkflow,
  /actions\/runs\/\$\{actions_run_id\}[\s\S]*actions\/artifacts\/\$\{artifact_id\}[\s\S]*actions\/artifacts\/\$\{artifact_id\}\/zip[\s\S]*expected_archive_sha[\s\S]*expected_app_sha/,
  "terminal renderer must independently verify the declared run, artifact, archive, and app",
);
assert.match(
  terminalWorkflow,
  /\.size_in_bytes[\s\S]*artifact_archive_limit[\s\S]*safe-extract-zip\.py[\s\S]*artifact_expansion_limit[\s\S]*20000[\s\S]*536870912/,
  "terminal renderer must bound the official artifact archive and safe extraction",
);
assert.match(
  terminalWorkflow,
  /CFBundleShortVersionString[\s\S]*--verified-app-version "\$verified_app_version"/,
  "terminal renderer must bind the displayed app version to the downloaded app bundle",
);
assert.match(
  terminalWorkflow,
  /pulls\/\$\{PR_NUMBER\}[\s\S]*pulls\/\$\{PR_NUMBER\}\/commits\?per_page=100[\s\S]*commits\/\$\{EXPECTED_SHA\}\/pulls\?per_page=100[\s\S]*expected_sha is not associated with the declared pull request/,
  "terminal renderer must bind the tested SHA to the declared pull request while allowing stale PR commits",
);
assert.match(
  terminalWorkflow,
  /capture-runtime-attestation\.sh[\s\S]*"-"[\s\S]*< "\$attestation_tools_tar" \|[\s\S]*bounded-stream-copy\.py[\s\S]*runtime_attestation_size/,
  "terminal renderer must capture the trusted runtime attestation directly from SSH stdout",
);
assert.match(
  runtimeAttestationScript,
  /proc_pidpath[\s\S]*\/usr\/sbin\/lsof[\s\S]*"-F", "fDin"[\s\S]*record\.get\("path"[\s\S]*record\.get\("device"\)[\s\S]*record\.get\("inode"\)[\s\S]*loaded image does not match the staged executable vnode[\s\S]*executable hash does not match the official artifact[\s\S]*canonical_digest\.app_digest[\s\S]*bundle digest does not match the official artifact[\s\S]*codesign[\s\S]*captureToolSha/,
  "runtime attestation must atomically bind the live vnode, executable, complete bundle, and signing seal",
);
assert.match(
  canonicalAppDigestScript,
  /nixmac\.app\.canonical\.v2[\s\S]*executable\.chmod\(0o644\)[\s\S]*app_digest\(root\) != original[\s\S]*ignore transport-lost file modes/,
  "canonical app digest must ignore permission bits lost by Actions artifact transport",
);
assert.match(
  terminalWorkflow,
  /canonical-app-digest\.py "\$app_bundle_dir"[\s\S]*tar -cf "\$attestation_tools_tar"[\s\S]*canonical-app-digest\.py[\s\S]*capture-runtime-attestation\.sh[\s\S]*< "\$attestation_tools_tar" \|[\s\S]*\.testedArtifact\.appBundleSha256 = \$bundle_sha/,
  "protected publisher must stream both trusted attestation tools and inject the verified bundle digest",
);
assert.match(
  terminalWorkflow,
  /bounded_remote_copy\(\)[\s\S]*bounded-stream-copy\.py[\s\S]*bounded_remote_copy[\s\S]*remote_manifest[\s\S]*evidence_specs[\s\S]*remote_evidence_size[\s\S]*total_evidence_bytes <= 31457280[\s\S]*bounded_remote_copy/,
  "terminal publisher must cap bytes received for each remote file and the aggregate evidence set",
);
assert.doesNotMatch(
  terminalWorkflow,
  /\n\s+scp\s/,
  "terminal publisher must not use unbounded scp for remote evidence",
);
assert.match(
  terminalWorkflow,
  /OPENROUTER_API_KEY[\s\S]*OPENROUTER_MODEL[\s\S]*trusted-video-audit\.mjs[\s\S]*--slurpfile audit[\s\S]*\.presentation\.semanticAudit =/,
  "protected publisher must run trusted vision review and inject its final semantic audit",
);
assert.match(
  trustedVideoAuditScript,
  /MAX_REVIEW_VIDEO_SECONDS = 120[\s\S]*TIMELINE_SAMPLE_RATE = 2[\s\S]*fps=.*TIMELINE_SAMPLE_RATE[\s\S]*tile=.*CONTACT_SHEET_COLUMNS[\s\S]*image_url[\s\S]*openrouter\.ai/,
  "trusted video audit must densely inspect the bounded full timeline and fail closed on semantic uncertainty",
);
assert.match(
  trustedVideoAuditScript,
  /changedBehaviorVisible[\s\S]*timelineCoherent[\s\S]*terminalStateVisible/,
  "trusted video audit must require changed behavior, timeline coherence, and terminal state",
);
assert.match(
  trustedVideoAuditScript,
  /decision\.sensitiveContentVisible !== false[\s\S]*passwords, API keys, tokens/,
  "trusted video audit must fail closed on credential-like content",
);
assert.match(
  terminalWorkflow,
  /apt-get install -y ffmpeg tesseract-ocr[\s\S]*command_name in[\s\S]*tesseract/,
  "protected publisher must install the local OCR scanner",
);
assert.match(
  trustedVideoAuditScript,
  /await locallyScanSensitiveMedia\(locallyScannedImages\)[\s\S]*await requestDecision/,
  "trusted video audit must scan media locally before any vision-provider request",
);
assert.match(
  trustedVideoAuditScript,
  /role: "system"[\s\S]*content: policy[\s\S]*role: "user"[\s\S]*evidenceDescription/,
  "trusted video audit must isolate immutable policy from untrusted producer evidence",
);
assert.match(
  terminalWorkflow,
  /publisher-reviewed-video\.mp4[\s\S]*trusted-video-audit\.mjs[\s\S]*public_video_sha[\s\S]*\.evidence\.video\.path = \$video_path[\s\S]*sensitiveContentVisible/,
  "terminal publisher must embed only the exact sensitivity-reviewed public video",
);
assert.match(
  trustedVideoAuditScript,
  /stripPngAncillaryMetadata[\s\S]*createReviewedScreenshot[\s\S]*reviewedScreenshots/,
  "trusted video audit must strip screenshot metadata before review",
);
assert.match(
  trustedVideoAuditScript,
  /createReviewedScreenshot[\s\S]*validatePng\(sourceBuffer[\s\S]*execFileAsync\("ffmpeg"/,
  "trusted video audit must bound PNG decoding before invoking ffmpeg",
);
assert.match(
  terminalWorkflow,
  /publisher-reviewed-screenshot-[\s\S]*\.evidence\.screenshots = \[[\s\S]*reviewedScreenshots/,
  "terminal publisher must embed only sanitized reviewed screenshots",
);
assert.match(
  trustedVideoAuditScript,
  /github-actions-protected-vision-review/,
  "trusted video audit must identify the protected vision reviewer",
);
assert.match(
  terminalWorkflow,
  /\[\[ "\$REPORT_TOOL_SHA" == "\$trusted_main_sha" \]\]/,
  "terminal renderer must execute only the current protected main revision",
);
assert.match(
  terminalWorkflow,
  /\.path == "\.github\/workflows\/build\.yaml"[\s\S]*\.conclusion == "success"/,
  "terminal renderer must require the successful official build workflow",
);
assert.match(
  terminalWorkflow,
  /publish:[\s\S]*permissions:\n\s+actions: read\n\s+contents: write\n\s+pull-requests: read[\s\S]*name: Checkout protected publisher[\s\S]*ref: main[\s\S]*persist-credentials: false/,
  "only the protected publisher job may receive contents write",
);
assert.match(
  terminalWorkflow,
  /LATEST_ORDER: \$\{\{ github\.run_id \}\}:\$\{\{ github\.run_attempt \}\}[\s\S]*LATEST_GUARD_EXPECTED_SHA: \$\{\{ inputs\.expected_sha \}\}/,
  "terminal publisher must order latest updates and recheck the live PR reference inside retries",
);
assert.match(
  publisherScript,
  /--jq 'if \.merged then \.merge_commit_sha else \.head\.sha end'/,
  "publisher retries must select the live merged or open PR reference on every attempt",
);
assert.match(
  publisherScript,
  /local current_report="\$site_dir\/\$\{PUBLISH_PATH:\?\}"[\s\S]*\[\[ "\$candidate_report" == "\$current_report" \]\] && continue[\s\S]*sort -Vr[\s\S]*tail -n \+"\$retention_keep_runs"/,
  "report retention must preserve the current immutable report and naturally order numeric run and attempt IDs",
);

assert.match(remote, /\n    needs: prepare\n/, "remote job must depend on prepare");
assert.match(
  remote,
  /NIXMAC_COMPUTER_USE_APP: \$\{\{ steps\.remote-start\.outputs\.remote_app_path \}\}/,
  "remote Computer Use must bind state and actions to the exact staged app path",
);
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
assert.doesNotMatch(
  publish,
  /concurrency:\n\s+group: computer-use-e2e-gh-pages-publish\n\s+cancel-in-progress: false/,
  "publish job must not use lossy Actions concurrency for report publication",
);
assert.match(
  publish,
  /run: ops\/scripts\/e2e\/publish-report\.sh/,
  "publish job must use the retrying shared GitHub Pages publisher",
);
assert.match(
  publish,
  /LATEST_ORDER: \$\{\{ github\.run_id \}\}:\$\{\{ github\.run_attempt \}\}[\s\S]*LATEST_GUARD_EXPECTED_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/,
  "full publisher must order latest updates and recheck the PR head inside retries",
);
assert.match(
  publish,
  /name: Comment evidence report on pull request\n\s+if: [^\n]*steps\.publish-report\.outputs\.latest_updated == 'true'/,
  "only the run that owns latest may update the shared PR report comment",
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

assert.doesNotMatch(
  publish,
  /git -C "\$site_dir" fetch --depth=1 origin gh-pages/,
  "publish job must not duplicate GitHub Pages fetch logic",
);
assert.doesNotMatch(
  publish,
  /git -C "\$site_dir" push -q origin gh-pages/,
  "publish job must not duplicate GitHub Pages push logic",
);

console.log("Computer Use workflow contract self-test passed.");
