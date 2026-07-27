#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workflow = readFileSync(path.join(repoRoot, ".github/workflows/macos-ci-image.yaml"), "utf8");
const buildWorkflow = readFileSync(path.join(repoRoot, ".github/workflows/build.yaml"), "utf8");
const hostWorkflow = readFileSync(
  path.join(repoRoot, ".github/workflows/macos-ci-image-builder-host.yaml"),
  "utf8",
);
const preflightScript = readFileSync(
  path.join(repoRoot, "ops/images/preflight-image-builder.sh"),
  "utf8",
);
const provisionScript = readFileSync(
  path.join(repoRoot, "ops/images/provision-image-builder.sh"),
  "utf8",
);
const packerTemplate = readFileSync(
  path.join(repoRoot, "ops/images/nixmac-runner-tahoe.pkr.hcl"),
  "utf8",
);

function assertWorkflowShellSyntax(label, contents) {
  const lines = contents.split("\n");
  let runBlockCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*\|\s*$/);
    if (!match) continue;

    const runIndent = match[1].length;
    const script = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() === "") {
        script.push("");
        continue;
      }

      const lineIndent = line.match(/^\s*/)[0].length;
      if (lineIndent <= runIndent) {
        index -= 1;
        break;
      }
      script.push(line.slice(runIndent + 2));
    }

    runBlockCount += 1;
    const result = spawnSync("bash", ["-n"], {
      input: script.join("\n"),
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `${label} run block ${runBlockCount} must pass bash -n:\n${result.stderr}`,
    );
  }

  return runBlockCount;
}

assert.ok(
  assertWorkflowShellSyntax("macOS image workflow", workflow) >= 9,
  "expected to syntax-check every macOS image workflow run block",
);
assert.ok(
  assertWorkflowShellSyntax("registered build workflow", buildWorkflow) >= 13,
  "expected to syntax-check every registered build workflow run block",
);
assert.ok(
  assertWorkflowShellSyntax("image-builder host workflow", hostWorkflow) >= 1,
  "expected to syntax-check every image-builder host workflow run block",
);
for (const [label, script] of [
  ["image-builder preflight", preflightScript],
  ["image-builder provision", provisionScript],
]) {
  const result = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
  assert.equal(result.status, 0, `${label} script must pass bash -n:\n${result.stderr}`);
}

assert.doesNotMatch(
  workflow,
  /then\s*\n\s*fi/,
  "workflow shell must not contain an empty then branch",
);
assert.match(
  workflow,
  /Provision image tooling[\s\S]*bash ops\/images\/provision-image-builder\.sh/,
  "image workflow must provision its host through the pinned shared script",
);
assert.match(
  provisionScript,
  /TART_VERSION="2\.32\.1"[\s\S]*TART_SHA256="[0-9a-f]{64}"[\s\S]*PACKER_VERSION="1\.15\.4"[\s\S]*PACKER_SHA256="[0-9a-f]{64}"[\s\S]*ORAS_VERSION="1\.3\.3"[\s\S]*ORAS_SHA256="[0-9a-f]{64}"[\s\S]*download_verified[\s\S]*actual_tart_version/,
  "builder provisioning must pin every user-space tool archive and fail closed on version drift",
);
assert.match(
  provisionScript,
  /tools_base="\$\{RUNNER_TOOL_CACHE[\s\S]*artifacts_dir="\/Users\/Shared\/nixmac-image-builder"[\s\S]*printf '%s\\n' "\$bin_dir" >> "\$GITHUB_PATH"/,
  "builder provisioning must use persistent tools, runner-independent artifact staging, and expose tools to later steps",
);
assert.match(
  provisionScript,
  /extract_tgz_atomically[\s\S]*mktemp -d[\s\S]*mv "\$partial_dir" "\$target"[\s\S]*extract_zip_atomically/,
  "builder provisioning must extract tools through same-volume temporary directories",
);
for (const [label, artifact] of [
  ["builder provision script", provisionScript],
  ["builder preflight script", preflightScript],
  ["builder host workflow", hostWorkflow],
]) {
  assert.doesNotMatch(
    artifact,
    /\b(?:sudo|brew)\b/,
    `${label} must not require administrator access or a package manager`,
  );
}
assert.match(
  workflow,
  /Validate Xcode artifact[\s\S]*shasum -a 256 "\$XCODE_ARTIFACT"[\s\S]*digest" != "\$EXPECTED_XCODE_ARTIFACT_SHA256"/,
  "image build must enforce the approved Xcode artifact SHA-256",
);
assert.match(
  workflow,
  /workflow_call:[\s\S]*xcode_artifact:[\s\S]*value: \$\{\{ jobs\.build\.outputs\.image \}\}/,
  "image workflow must be callable from an already-registered workflow before merge",
);
assert.match(
  buildWorkflow,
  /image-builder-provision:[\s\S]*uses: \.\/\.github\/workflows\/macos-ci-image-builder-host\.yaml[\s\S]*mode: provision[\s\S]*image-builder-preflight:[\s\S]*uses: \.\/\.github\/workflows\/macos-ci-image-builder-host\.yaml[\s\S]*mode: preflight/,
  "registered build workflow must expose secret-capped builder provision and preflight modes",
);
assert.match(
  hostWorkflow,
  /workflow_call:[\s\S]*runs-on: \[self-hosted, macOS, nixmac-image-builder\][\s\S]*provision-image-builder\.sh[\s\S]*preflight-image-builder\.sh/,
  "reusable host workflow must own all dedicated builder execution",
);
assert.doesNotMatch(
  buildWorkflow,
  /secrets:\s*inherit/,
  "dedicated builder reusable calls must never inherit repository secrets",
);
assert.doesNotMatch(
  hostWorkflow,
  /secrets\.|SOPS_AGE_KEY/,
  "dedicated builder host workflow must remain free of repository-secret references",
);
assert.match(
  preflightScript,
  /RUNNER_TOOL_CACHE[\s\S]*export PATH="\$bin_dir:\$PATH"[\s\S]*sysctl -n kern\.hv_support[\s\S]*Apple virtualization support is unavailable[\s\S]*uname -m[\s\S]*Apple Silicon image builder/,
  "builder preflight must recover pinned user-space tools and fail closed when the host cannot support Tart",
);
assert.match(
  preflightScript,
  /artifacts_dir="\/Users\/Shared\/nixmac-image-builder"[\s\S]*for candidate in[\s\S]*"\$artifacts_dir"\/Xcode\*\.xip[\s\S]*\/Users\/\*\/Xcode\*\.pkg[\s\S]*\/private\/var\/tmp\/Xcode\*\.pkg/,
  "builder preflight must use deterministic non-recursive artifact staging locations",
);
assert.doesNotMatch(
  preflightScript,
  /\/Users\/\*\/(?:Desktop|Downloads)\/Xcode/,
  "builder preflight must not enumerate TCC-protected user folders",
);
assert.doesNotMatch(
  preflightScript,
  /\b(?:find|mdfind)\b[\s\S]{0,300}?Xcode\*\.(?:xip|pkg)/,
  "builder preflight must not crawl or index-search mutable developer trees",
);
assert.match(
  preflightScript,
  /shasum -a 256 "\$candidate" \| tee -a "\$hashes_file"/,
  "builder preflight must stream slow artifact hashing into the operator log",
);
assert.match(
  buildWorkflow,
  /group: build-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}-\$\{\{ inputs\.runner_pool == 'image-builder-provision' && 'image-provision' \|\| inputs\.runner_pool == 'image-builder-preflight' && 'image-preflight' \|\| inputs\.runner_pool == 'image-builder' && 'image-build' \|\| 'product' \}\}/,
  "image provision, preflight, builds, and product builds must use separate concurrency groups",
);
assert.match(
  buildWorkflow,
  /build-macos-image:[\s\S]*packages: write[\s\S]*uses: \.\/\.github\/workflows\/macos-ci-image\.yaml/,
  "registered build workflow must invoke image build with package-write permission",
);
assert.match(
  buildWorkflow,
  /self_hosted='\["self-hosted","macOS","nixmac-mac","xcode-16\.1"\]'/,
  "self-hosted build routing must require the pinned Xcode capability label",
);
assert.match(
  buildWorkflow,
  /index\("nixmac-mac"\)[\s\S]*index\("xcode-16\.1"\)/,
  "availability query must verify both fleet and Xcode capability labels",
);
assert.equal(
  [
    ...buildWorkflow.matchAll(
      /if: inputs\.runner_pool != 'image-builder' && inputs\.runner_pool != 'image-builder-preflight' && inputs\.runner_pool != 'image-builder-provision'/g,
    ),
  ].length,
  3,
  "every normal prerequisite job must be suppressed in image-builder modes",
);
assert.equal(
  [...workflow.matchAll(/tart run --no-graphics "\$VM_NAME"/g)].length,
  2,
  "both image verification VMs must boot headlessly",
);
assert.match(
  workflow,
  /pkill -f "tart run\.\*nixmac-runner-tahoe"/,
  "scan cleanup must match the headless tart run command",
);
assert.match(
  workflow,
  /gh\[opsur\]_\[A-Za-z0-9\]\{36\}\|github_pat_\[A-Za-z0-9_\]\{22,\}/,
  "secret scan must recognize the full GitHub token family",
);
assert.match(
  workflow,
  /tart push nixmac-runner-tahoe[\s\S]*"\$IMAGE:\$TAG"[\s\S]*io\.darkmatter\.nixmac\.xcode-artifact-sha256=\$XCODE_ARTIFACT_SHA256/,
  "candidate image must bind the approved Xcode hash into its OCI configuration",
);
assert.match(
  workflow,
  /tart clone "\$PUBLISHED_IMAGE" "\$VM_NAME"[\s\S]*Published image failed its digest-qualified boot proof/,
  "published digest must be pulled, booted, and verified before qualification",
);
assert.match(
  workflow,
  /test -f \/Library\/LaunchDaemons\/org\.cirruslabs\.tart-guest-daemon\.plist[\s\S]*test -f \/Library\/LaunchAgents\/org\.cirruslabs\.tart-guest-agent\.plist/,
  "published image proof must verify the inherited guest-agent services",
);
assert.match(
  packerTemplate,
  /test -x \/opt\/homebrew\/bin\/tart-guest-agent[\s\S]*tart-guest-daemon\.plist[\s\S]*tart-guest-agent\.plist/,
  "Packer must fail closed when the pinned base loses its guest-agent contract",
);
assert.match(
  packerTemplate,
  /MACs hmac-sha2-256,hmac-sha2-512[\s\S]*99-cilicon-compat\.conf[\s\S]*sudo sshd -t/,
  "Packer must validate the Cilicon/OpenSSH compatibility configuration",
);
assert.match(
  workflow,
  /grep -Fx 'MACs hmac-sha2-256,hmac-sha2-512'[\s\S]*99-cilicon-compat\.conf/,
  "published image proof must verify the Cilicon/OpenSSH compatibility configuration",
);
assert.doesNotMatch(
  packerTemplate,
  /releases\/latest|guest-agent download failed|tart-guest-agent-macos\.tar\.gz/,
  "Packer must not use a floating, fail-open guest-agent download",
);
assert.match(
  workflow,
  /oras manifest fetch --descriptor "\$IMAGE:\$TAG"[\s\S]*\^sha256:\[0-9a-f\]\{64\}\$/,
  "workflow must resolve and validate the published OCI manifest digest",
);
assert.match(
  workflow,
  /oras tag "\$PUBLISHED_IMAGE" tahoe[\s\S]*promoted_digest[\s\S]*PUBLISHED_DIGEST/,
  "stable tag must be promoted only from the qualified digest",
);
assert.match(
  workflow,
  /echo "image=\$IMAGE@\$DIGEST" >> "\$GITHUB_OUTPUT"[\s\S]*echo "digest=\$DIGEST" >> "\$GITHUB_OUTPUT"/,
  "workflow must expose a digest-qualified image reference and digest",
);
assert.match(
  workflow,
  /image: \$\{\{ steps\.push\.outputs\.image \}\}[\s\S]*digest: \$\{\{ steps\.push\.outputs\.digest \}\}/,
  "job outputs must come from the push step",
);
assert.doesNotMatch(
  workflow,
  /steps\.meta\.outputs/,
  "workflow must not reference a nonexistent metadata step",
);
const candidatePushIndex = workflow.indexOf("tart push nixmac-runner-tahoe");
const registryBootIndex = workflow.indexOf('tart clone "$PUBLISHED_IMAGE" "$VM_NAME"');
const stablePromotionIndex = workflow.indexOf('oras tag "$PUBLISHED_IMAGE" tahoe');
assert.ok(
  candidatePushIndex >= 0 &&
    candidatePushIndex < registryBootIndex &&
    registryBootIndex < stablePromotionIndex,
  "candidate must be pushed and boot-qualified before the stable tag moves",
);
assert.match(
  workflow,
  /BASE_IMAGE_DIGEST: sha256:[0-9a-f]{64}[\s\S]*-var "base_image_digest=\$BASE_IMAGE_DIGEST"[\s\S]*macos-tahoe-base@\$BASE_IMAGE_DIGEST/,
  "one workflow value must drive Packer and the published base-image summary",
);
assert.match(
  packerTemplate,
  /variable "base_image_digest"[\s\S]*default\s*=\s*""[\s\S]*sha256:\[0-9a-f\]\{64\}/,
  "Packer must require an explicit validated base-image digest",
);

console.log("macOS CI image contract self-test passed.");
