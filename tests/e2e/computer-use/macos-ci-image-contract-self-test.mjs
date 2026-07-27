#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  IMAGE_BUILDER_MODE_SUPPRESSION,
  parseWorkflowYaml,
} from "./workflow-concurrency-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workflow = readFileSync(path.join(repoRoot, ".github/workflows/macos-ci-image.yaml"), "utf8");
const buildWorkflow = readFileSync(path.join(repoRoot, ".github/workflows/build.yaml"), "utf8");
const parsedBuildWorkflow = parseWorkflowYaml({
  workflowName: ".github/workflows/build.yaml",
  source: buildWorkflow,
});
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
const configureNetworkScript = readFileSync(
  path.join(repoRoot, "ops/images/configure-image-builder-network.sh"),
  "utf8",
);
const connectivityScript = readFileSync(
  path.join(repoRoot, "ops/images/check-base-image-connectivity.sh"),
  "utf8",
);
const sshVmScript = readFileSync(path.join(repoRoot, "ops/images/ssh-vm.sh"), "utf8");
const sudoersPolicy = readFileSync(
  path.join(repoRoot, "ops/images/sudoers.d/nixmac-image-builder-network"),
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
  ["image-builder network configuration", configureNetworkScript],
  ["base-image connectivity", connectivityScript],
  ["VM SSH helper", sshVmScript],
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
  buildWorkflow,
  /name: Install devenv[\s\S]*--out-link \/tmp\/nixmac-devenv-cli[\s\S]*name: Run Computer Use workflow contracts[\s\S]*shell: \/tmp\/nixmac-devenv-cli\/bin\/devenv shell --impure -- bash -euo pipefail \{0\}[\s\S]*node tests\/e2e\/computer-use\/macos-ci-image-contract-self-test\.mjs[\s\S]*name: Run git hooks[\s\S]*shell: \/tmp\/nixmac-devenv-cli\/bin\/devenv shell --impure -- bash -euo pipefail \{0\}[\s\S]*run: prek run --all-files --show-diff-on-failure/,
  "workflow contracts and git hooks must both execute inside the pinned devenv shell",
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
  ["builder host workflow", hostWorkflow],
]) {
  assert.doesNotMatch(
    artifact,
    /\b(?:sudo|brew)\b/,
    `${label} must not require administrator access or a package manager`,
  );
}
const preflightSudoLines = preflightScript
  .split("\n")
  .filter((line) => /\bsudo\s+-n\b/.test(line))
  .map((line) => line.trim());
assert.deepEqual(
  preflightSudoLines,
  ["if ! sudo -n /usr/bin/defaults export com.apple.network.local-network - |"],
  "preflight may use only the one argv-fixed read-only Local Network policy export",
);
assert.doesNotMatch(
  preflightScript,
  /\bdefaults\s+write\b|\/sbin\/shutdown/,
  "preflight must never mutate preferences or schedule a reboot",
);
assert.doesNotMatch(
  configureNetworkScript,
  /\bsudo\b(?!\s+-n\b)/,
  "network configuration must use noninteractive sudo only",
);
assert.doesNotMatch(
  configureNetworkScript,
  /sudo\s+-n\s+(?:\/bin\/)?(?:ba)?sh\b|NOPASSWD:\s*ALL\s*$/m,
  "network configuration must neither open a root shell nor accept blanket passwordless sudo",
);
assert.equal(
  [...configureNetworkScript.matchAll(/^require_sudo_command /gm)].length,
  6,
  "network configuration must preflight exactly the six argv-scoped privileged commands",
);
assert.match(
  sudoersPolicy,
  /User_Alias NIXMAC_IMAGE_BUILDER = __RUNNER_USER__[\s\S]*\/usr\/bin\/defaults export com\.apple\.network\.local-network -[\s\S]*\/usr\/bin\/defaults read \/Library\/Preferences\/com\.apple\.loginwindow autoLoginUser[\s\S]*\/usr\/bin\/fdesetup status[\s\S]*AllowedEthernetLocalNetworkAddresses -array 10\.0\.0\.0\/8 172\.16\.0\.0\/12 192\.168\.0\.0\/16[\s\S]*AllowedWiFiLocalNetworkAddresses -array 10\.0\.0\.0\/8 172\.16\.0\.0\/12 192\.168\.0\.0\/16[\s\S]*\/sbin\/shutdown -r \+2/,
  "sudoers template must enumerate only the fixed policy read, recovery checks, exact writes, and delayed reboot",
);
assert.doesNotMatch(
  sudoersPolicy,
  /NOPASSWD:\s*ALL(?:\s|$)/,
  "sudoers template must never grant blanket passwordless root",
);
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
  /image-builder-provision:[\s\S]*mode: provision[\s\S]*image-builder-network-config:[\s\S]*mode: configure-network[\s\S]*image-builder-preflight:[\s\S]*mode: preflight/,
  "registered build workflow must expose secret-capped provision, network configuration, and preflight modes",
);
assert.match(
  hostWorkflow,
  /workflow_call:[\s\S]*runs-on: \[self-hosted, macOS, nixmac-image-builder\][\s\S]*provision\|configure-network\|preflight[\s\S]*provision-image-builder\.sh[\s\S]*configure-image-builder-network\.sh[\s\S]*preflight-image-builder\.sh/,
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
assert.doesNotMatch(
  `${workflow}\n${provisionScript}\n${preflightScript}`,
  /configure-image-builder-network\.sh/,
  "the privileged network configuration script must be reachable only through the explicit host-maintenance mode",
);
assert.match(
  configureNetworkScript,
  /actions\.runner\.\*\.plist[\s\S]*launchctl print "gui\/\$RUNNER_UID\/\$runner_label"[\s\S]*autoLoginUser[\s\S]*FileVault is Off\.[\s\S]*persist_pending_marker[\s\S]*defaults write "\$POLICY_DOMAIN" "\$ETHERNET_KEY"[\s\S]*defaults write "\$POLICY_DOMAIN" "\$WIFI_KEY"[\s\S]*shutdown -r \+2/,
  "network mutation must follow loaded-runner, auto-login, FileVault, persistent marker, exact writes, and delayed-reboot ordering",
);
assert.ok(
  configureNetworkScript.indexOf("persist_pending_marker\nsudo -n /usr/bin/defaults write") >= 0,
  "a durable pending marker must be persisted before the first privileged policy write",
);
assert.match(
  configureNetworkScript,
  /policy_is_exact "\$before_plist"[\s\S]*observed_marker[\s\S]*Already configured exactly with an observed activation reboot; no reboot scheduled\.[\s\S]*exit 0/,
  "an exact policy may skip reboot only when prior activation-reboot evidence exists",
);
assert.match(
  configureNetworkScript,
  /policy_is_exact "\$before_plist"[\s\S]*pending_marker[\s\S]*boot_epoch" -le "\$previous_boot_epoch"[\s\S]*shutdown -r \+2/,
  "an exact policy with an unobserved pending reboot must reschedule that reboot safely",
);
assert.match(
  configureNetworkScript,
  /if \[ -f "\$observed_marker" \][\s\S]*exit 0[\s\S]*persist_pending_marker[\s\S]*no activation-reboot evidence exists[\s\S]*shutdown -r \+2/,
  "an exact markerless policy must create evidence and schedule an activation reboot",
);
assert.match(
  configureNetworkScript,
  /observed_boot_epoch -integer 0[\s\S]*observed_at_utc -string pending/,
  "pending markers must contain replaceable observation placeholders",
);
for (const [label, script] of [
  ["network configuration", configureNetworkScript],
  ["preflight", preflightScript],
]) {
  assert.ok(
    script.includes("sed -E 's/^\\{ sec = ([0-9]+).*/\\1/'"),
    `${label} must parse kern.boottime from the anchored sec field`,
  );
  assert.doesNotMatch(
    script,
    /sed -E 's\/\.\*sec = /,
    `${label} must not greedily capture the usec field`,
  );
}
const bootEpochParse = spawnSync("sed", ["-E", "s/^\\{ sec = ([0-9]+).*/\\1/"], {
  input: "{ sec = 1784165738, usec = 675906 } Mon Jul 27\n",
  encoding: "utf8",
});
assert.equal(bootEpochParse.status, 0, "boot epoch canary must execute");
assert.equal(
  bootEpochParse.stdout.trim(),
  "1784165738",
  "boot epoch canary must select sec rather than usec",
);
assert.match(
  configureNetworkScript,
  /tart stop nixmac-runner-tahoe[\s\S]*tart delete nixmac-runner-tahoe/,
  "the maintenance summary must include stranded-VM recovery",
);
assert.match(
  preflightScript,
  /RUNNER_TOOL_CACHE[\s\S]*export PATH="\$bin_dir:\$PATH"[\s\S]*kern\.boottime[\s\S]*case "\$boot_epoch" in[\s\S]*Could not resolve current kern\.boottime epoch[\s\S]*hw\.ncpu[\s\S]*hw\.memsize/,
  "builder preflight must recover tools and log host capacity plus boot identity",
);
assert.match(
  preflightScript,
  /sysctl -n kern\.hv_support[\s\S]*Apple virtualization support is unavailable[\s\S]*uname -m[\s\S]*Apple Silicon image builder/,
  "builder preflight must fail closed when the host cannot support Tart",
);
assert.match(
  preflightScript,
  /defaults export com\.apple\.network\.local-network -[\s\S]*AllowedEthernetLocalNetworkAddresses[\s\S]*AllowedWiFiLocalNetworkAddresses[\s\S]*image-builder-network-config/,
  "preflight must validate the exact Local Network policy and prove a pending maintenance reboot occurred",
);
assert.match(
  preflightScript,
  /network-config-reboot-pending\.json[\s\S]*network-config-reboot-observed\.json[\s\S]*previous_boot_epoch[\s\S]*boot_epoch" -le "\$previous_boot_epoch"[\s\S]*mv "\$pending_marker" "\$observed_marker"/,
  "preflight must bind a pending network change to a later observed boot",
);
assert.match(
  preflightScript,
  /plutil -replace observed_boot_epoch[\s\S]*plutil -replace observed_at_utc/,
  "preflight marker observation must be idempotently recoverable after interruption",
);
assert.match(
  preflightScript,
  /elif \[ -f "\$observed_marker" \][\s\S]*observed_boot_epoch[\s\S]*-le "\$observed_previous_epoch"[\s\S]*no activation-reboot evidence/,
  "preflight must reject missing or invalid activation-reboot evidence",
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
  /group: build-\$\{\{ inputs\.e2e_merge_sha \|\| github\.event\.pull_request\.number \|\| github\.ref \}\}-\$\{\{ inputs\.runner_pool == 'image-builder-network-config' && 'image-network-config' \|\| inputs\.runner_pool == 'image-builder-provision' && 'image-provision' \|\| inputs\.runner_pool == 'image-builder-preflight' && 'image-preflight' \|\| inputs\.runner_pool == 'image-builder' && 'image-build' \|\| 'product' \}\}/,
  "exact-SHA backfills, network maintenance, provision, preflight, image builds, and product builds must use separate concurrency groups",
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
for (const jobId of ["git-hooks", "resolve-e2e-backfill", "rust-tests"]) {
  assert.equal(
    parsedBuildWorkflow.jobs[jobId].if,
    IMAGE_BUILDER_MODE_SUPPRESSION,
    `${jobId} must use the exact image-builder mode suppression`,
  );
}
assert.equal(
  parsedBuildWorkflow.jobs["pick-mac-runner"].if,
  `${IMAGE_BUILDER_MODE_SUPPRESSION} && needs.rust-tests.result == 'success' && needs.resolve-e2e-backfill.outputs.build_needed == 'true'`,
  "pick-mac-runner must combine the exact image-builder suppression with its prerequisite gates",
);
assert.equal(
  [...workflow.matchAll(/tart run --no-graphics "\$VM_NAME"/g)].length,
  2,
  "both image verification VMs must boot headlessly",
);
assert.equal(
  [...connectivityScript.matchAll(/tart run --no-graphics "\$VM_NAME"/g)].length,
  1,
  "the pre-Packer base connectivity VM must boot headlessly",
);
assert.match(
  connectivityScript,
  /tart exec "\$VM_NAME" \/usr\/bin\/true[\s\S]*tart ip "\$VM_NAME"[\s\S]*tart ip --resolver=arp "\$VM_NAME"/,
  "base connectivity gate must discriminate guest-agent, DHCP, and ARP readiness",
);
assert.match(
  connectivityScript,
  /\/usr\/bin\/nc -v -G 2 -z "\$vm_ip" 22/,
  "TCP diagnostics must request verbose netcat output before classifying the failure",
);
for (const classification of [
  "connection-refused",
  "timeout-or-no-route",
  "authentication-failed",
  "log show --last 5m",
]) {
  assert.ok(
    connectivityScript.includes(classification),
    `base connectivity diagnostics must include ${classification}`,
  );
}
assert.match(
  connectivityScript,
  /Process ancestry:[\s\S]*actions\.runner\.\*\.plist[\s\S]*bridge100[\s\S]*ARP table/,
  "base connectivity failure must capture bounded host runner and network context",
);
assert.match(
  connectivityScript,
  /cleanup\(\)[\s\S]*tart stop "\$VM_NAME"[\s\S]*kill "\$vm_pid"[\s\S]*tart delete "\$VM_NAME"[\s\S]*trap cleanup EXIT/,
  "base connectivity gate must always stop its process and delete its dedicated VM",
);
assert.ok(
  workflow.indexOf("Qualify base-image connectivity") >= 0 &&
    workflow.indexOf("Qualify base-image connectivity") < workflow.indexOf("- name: Build image"),
  "base connectivity must be proven before Packer is allowed to build",
);
assert.match(
  sshVmScript,
  /SSH_PASSWORD is required[\s\S]*SSH_ASKPASS_REQUIRE=force[\s\S]*PreferredAuthentications=password[\s\S]*PubkeyAuthentication=no/,
  "one tracked password-only SSH_ASKPASS helper must serve every VM qualification path",
);
assert.doesNotMatch(
  workflow,
  /\/tmp\/ssh-vm\.sh|cat > .*ssh-vm/,
  "workflow must not synthesize or depend on an untracked SSH helper",
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
  connectivityScript,
  /BASE_IMAGE_DIGEST must be an immutable sha256 digest[\s\S]*ghcr\.io\/cirruslabs\/macos-tahoe-base@\$BASE_IMAGE_DIGEST/,
  "the pre-Packer gate must clone the same immutable base digest supplied to Packer",
);
assert.match(
  packerTemplate,
  /variable "base_image_digest"[\s\S]*default\s*=\s*""[\s\S]*sha256:\[0-9a-f\]\{64\}/,
  "Packer must require an explicit validated base-image digest",
);

console.log("macOS CI image contract self-test passed.");
