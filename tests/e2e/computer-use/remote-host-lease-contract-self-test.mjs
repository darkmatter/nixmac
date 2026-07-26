#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseWorkflowYaml } from "./workflow-concurrency-contract.mjs";

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
const helperPath = path.join(repoRoot, "ops/runner/macincloud-host-lease.sh");
const helper = readFileSync(helperPath, "utf8");

execFileSync("bash", ["-n", helperPath]);
assert.match(helper, /mkdir "\$lease_dir"/, "lease acquisition must use atomic mkdir");
assert.match(helper, /owner_token_sha256/, "lease metadata must bind an owner-token digest");
assert.match(helper, /LEASE_BUSY/, "bounded live-owner wait must return LEASE_BUSY");
assert.match(helper, /LEASE_QUARANTINED/, "stale or ambiguous owners must quarantine");
assert.match(helper, /observed-lease-digest/, "recovery must require the observed lease digest");
assert.match(helper, /operator-reason/, "recovery must require an operator reason");
assert.match(helper, /actions\/runs/, "owner liveness must come from the owning GitHub run");
assert.match(helper, /pgrep.*nixmac/, "recovery must refuse while nixmac is active");
assert.doesNotMatch(
  helper,
  /\brm\s+[^\n]*(?:-[A-Za-z]*[rR][A-Za-z]*|--recursive)(?:\s|$)/,
  "lease recovery must never recursively delete regardless of option ordering",
);
assert.match(
  helper,
  /NIXMAC_E2E_LEASE_TEST_MODE/,
  "lease helper must expose an isolated behavioral-test boundary",
);

const workflowContracts = [
  [".github/workflows/computer-use-e2e.yml", "remote-computer-use"],
  [".github/workflows/peekaboo-e2e.yml", "peekaboo-product-proof"],
  [".github/workflows/e2e.yml", "e2e-test"],
  [".github/workflows/computer-use-e2e-centaur.yml", "static_ssh"],
];
for (const [workflowName, jobId] of workflowContracts) {
  const source = readFileSync(path.join(repoRoot, workflowName), "utf8");
  const workflow = parseWorkflowYaml({ workflowName, source });
  assert.equal(
    workflow.permissions?.actions,
    "read",
    `${workflowName} must grant the lease liveness probe actions:read`,
  );
  const job = workflow.jobs[jobId];
  assert.ok(job, `${workflowName} must define ${jobId}`);
  const text = JSON.stringify(job);
  const acquire = text.indexOf("macincloud-host-lease.sh acquire");
  const release = text.lastIndexOf("macincloud-host-lease.sh release");
  const firstMacActionCandidates = [
    text.indexOf("check-remote.mjs"),
    text.indexOf("inventory-before.json"),
    text.indexOf("Checkout PR head and build debug app on MacInCloud"),
    text.indexOf("Run E2E:"),
  ].filter((index) => index >= 0);
  assert.ok(acquire >= 0, `${workflowName} must acquire the shared host lease`);
  assert.ok(release > acquire, `${workflowName} must release after acquisition`);
  assert.match(text, /if.*always\(\)/, `${workflowName} must release during finalization`);
  assert.ok(
    firstMacActionCandidates.length > 0,
    `${workflowName} must expose a recognized first Mac-side action marker`,
  );
  assert.ok(
    acquire < Math.min(...firstMacActionCandidates),
    `${workflowName} must acquire before any Mac-side inventory, process, or UI action`,
  );
}

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "nixmac-host-lease-contract-"));
try {
  const fakeBin = path.join(fixtureRoot, "bin");
  execFileSync("mkdir", ["-p", fakeBin]);
  const fakeSsh = path.join(fakeBin, "ssh");
  const fakeSshKeygen = path.join(fakeBin, "ssh-keygen");
  const fakeGh = path.join(fakeBin, "gh");
  const fakePgrep = path.join(fakeBin, "pgrep");
  writeFileSync(
    fakeSsh,
    `#!/usr/bin/env bash
set -euo pipefail
while (($#)); do
  case "$1" in
    -i|-o) shift 2 ;;
    bash) exec bash "\${@:2}" ;;
    *) shift ;;
  esac
done
exit 64
`,
  );
  writeFileSync(fakeSshKeygen, "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(
    fakeGh,
    `#!/usr/bin/env bash
set -euo pipefail
count_file="\${NIXMAC_E2E_FAKE_GH_COUNT_FILE:-}"
fail_until="\${NIXMAC_E2E_FAKE_GH_FAIL_UNTIL:-0}"
if [[ -n "$count_file" ]]; then
  count="$(cat "$count_file" 2>/dev/null || printf '0')"
  count=$((count + 1))
  printf '%s\\n' "$count" > "$count_file"
  if ((count <= fail_until)); then
    exit 1
  fi
fi
printf '%s\\n' "\${NIXMAC_E2E_FAKE_GH_STATUS:-in_progress}"
`,
  );
  writeFileSync(
    fakePgrep,
    '#!/usr/bin/env bash\n[[ "${NIXMAC_E2E_FAKE_PGREP_ACTIVE:-0}" == "1" ]]\n',
  );
  chmodSync(fakeSsh, 0o700);
  chmodSync(fakeSshKeygen, 0o700);
  chmodSync(fakeGh, 0o700);
  chmodSync(fakePgrep, 0o700);
  const sshKey = path.join(fixtureRoot, "key");
  const knownHosts = path.join(fixtureRoot, "known_hosts");
  writeFileSync(sshKey, "fixture-key\n");
  writeFileSync(knownHosts, "fixture.example ssh-ed25519 AAAAfixture\n");
  const leaseRoot = path.join(fixtureRoot, "remote-lease");
  const commonArgs = [
    "--ssh-dest",
    "runner@fixture.example",
    "--ssh-key",
    sshKey,
    "--known-hosts",
    knownHosts,
    "--repository",
    "darkmatter/nixmac",
    "--run-id",
    "123",
    "--logical-job",
    "fixture-job",
    "--attempt",
    "1",
    "--nonce",
    "fixture-nonce-012345678901234567890123456789",
  ];
  const fixtureEnv = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    NIXMAC_E2E_LEASE_TEST_MODE: "1",
    NIXMAC_E2E_LEASE_ROOT: leaseRoot,
    NIXMAC_E2E_LEASE_LIVENESS_RETRY_DELAY_SECONDS: "0",
  };
  const invoke = (command, ownerToken, extra = [], env = fixtureEnv) =>
    spawnSync("bash", [helperPath, command, ...commonArgs, "--owner-token", ownerToken, ...extra], {
      encoding: "utf8",
      env,
    });

  const acquired = invoke("acquire", "owner-a", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(acquired.status, 0, acquired.stderr);
  assert.match(
    acquired.stdout,
    /^LEASE_ACQUIRED\t\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\towner_token_sha256=[0-9a-f]{64}$/m,
    "acquire must return the authoritative post-acquisition host timestamp",
  );
  const idempotent = invoke("acquire", "owner-a", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(idempotent.status, 0, idempotent.stderr);

  const transientProbeCounter = path.join(fixtureRoot, "transient-probe-count");
  const transientProbe = invoke(
    "acquire",
    "owner-b",
    ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
    {
      ...fixtureEnv,
      NIXMAC_E2E_FAKE_GH_COUNT_FILE: transientProbeCounter,
      NIXMAC_E2E_FAKE_GH_FAIL_UNTIL: "2",
    },
  );
  assert.equal(transientProbe.status, 75, transientProbe.stderr);
  assert.match(transientProbe.stderr, /LEASE_BUSY/);
  assert.equal(readFileSync(transientProbeCounter, "utf8").trim(), "3");

  const busy = invoke("acquire", "owner-b", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(busy.status, 75, busy.stderr);
  assert.match(busy.stderr, /LEASE_BUSY/);

  const wrongRelease = invoke("release", "owner-b");
  assert.equal(wrongRelease.status, 73, wrongRelease.stderr);
  const released = invoke("release", "owner-a");
  assert.equal(released.status, 0, released.stderr);
  assert.match(
    released.stdout,
    /^LEASE_RELEASED\t\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\t\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m,
    "owner-matched release must return the final heartbeat and remote release time",
  );

  const reacquired = invoke("acquire", "owner-a", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(reacquired.status, 0, reacquired.stderr);
  const terminalEnv = {
    ...fixtureEnv,
    NIXMAC_E2E_FAKE_GH_STATUS: "completed",
  };
  const stale = invoke(
    "acquire",
    "owner-b",
    ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
    terminalEnv,
  );
  assert.equal(stale.status, 73, stale.stderr);
  assert.match(stale.stderr, /LEASE_QUARANTINED/);
  const releasedQuarantinedOwner = invoke("release", "owner-a", [], terminalEnv);
  assert.equal(releasedQuarantinedOwner.status, 0, releasedQuarantinedOwner.stderr);
  const markerOnly = invoke("status", "owner-b", [], terminalEnv);
  assert.equal(markerOnly.status, 0, markerOnly.stderr);
  const [, quarantineDigest] = markerOnly.stdout.trim().split("\t");
  assert.match(markerOnly.stdout, /^QUARANTINED\t/);
  assert.match(quarantineDigest, /^[0-9a-f]{64}$/);
  const refusedWhileActive = invoke(
    "recover",
    "owner-b",
    ["--observed-lease-digest", quarantineDigest, "--operator-reason", "active process refusal"],
    { ...terminalEnv, NIXMAC_E2E_FAKE_PGREP_ACTIVE: "1" },
  );
  assert.equal(refusedWhileActive.status, 73, refusedWhileActive.stderr);
  assert.match(refusedWhileActive.stderr, /process active/i);
  const recovered = invoke(
    "recover",
    "owner-b",
    [
      "--observed-lease-digest",
      quarantineDigest,
      "--operator-reason",
      "marker quarantine recovery",
    ],
    terminalEnv,
  );
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stdout, /LEASE_RECOVERED/);
  const free = invoke("status", "owner-b", [], terminalEnv);
  assert.equal(free.status, 0, free.stderr);
  assert.match(free.stdout, /^FREE$/m);

  const acquiredForUnexpectedEntry = invoke("acquire", "owner-c", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(acquiredForUnexpectedEntry.status, 0, acquiredForUnexpectedEntry.stderr);
  writeFileSync(path.join(leaseRoot, "owner", "unexpected-metadata"), "retain owner proof\n");
  const unsafeRelease = invoke("release", "owner-c");
  assert.equal(unsafeRelease.status, 73, unsafeRelease.stderr);
  const recoverableOccupied = invoke("status", "owner-c", [], terminalEnv);
  assert.match(
    recoverableOccupied.stdout,
    /^OCCUPIED\t[0-9a-f]{64}\t/,
    "a partial release must retain owner metadata for audited recovery",
  );
  const [, recoverableOccupiedDigest] = recoverableOccupied.stdout.trim().split("\t");
  writeFileSync(
    path.join(leaseRoot, "owner", "unexpected-metadata"),
    "mutated after observed digest\n",
  );
  const changedOccupied = invoke("status", "owner-c", [], terminalEnv);
  const [, changedOccupiedDigest] = changedOccupied.stdout.trim().split("\t");
  assert.notEqual(
    changedOccupiedDigest,
    recoverableOccupiedDigest,
    "occupied lease digest must bind every bounded direct lease file",
  );
  writeFileSync(path.join(leaseRoot, "owner", "heartbeat"), "1700000000\n");
  const heartbeatChanged = invoke("status", "owner-c", [], terminalEnv);
  const [, heartbeatChangedDigest] = heartbeatChanged.stdout.trim().split("\t");
  assert.equal(
    heartbeatChangedDigest,
    changedOccupiedDigest,
    "runtime heartbeat churn must not invalidate an otherwise unchanged recovery snapshot",
  );
  const refusedChangedSnapshot = invoke(
    "recover",
    "owner-c",
    [
      "--observed-lease-digest",
      recoverableOccupiedDigest,
      "--operator-reason",
      "changed snapshot must fail",
    ],
    terminalEnv,
  );
  assert.equal(refusedChangedSnapshot.status, 65, refusedChangedSnapshot.stderr);
  assert.match(refusedChangedSnapshot.stderr, /digest changed/i);
  const recoveredUnexpectedEntry = invoke(
    "recover",
    "owner-c",
    [
      "--observed-lease-digest",
      changedOccupiedDigest,
      "--operator-reason",
      "unexpected metadata recovery",
    ],
    terminalEnv,
  );
  assert.equal(recoveredUnexpectedEntry.status, 0, recoveredUnexpectedEntry.stderr);

  const acquiredForAmbiguousRecovery = invoke("acquire", "owner-d", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(acquiredForAmbiguousRecovery.status, 0, acquiredForAmbiguousRecovery.stderr);
  unlinkSync(path.join(leaseRoot, "owner", "owner.json"));
  const ambiguous = invoke("status", "owner-d", [], terminalEnv);
  assert.equal(ambiguous.status, 0, ambiguous.stderr);
  assert.match(
    ambiguous.stdout,
    /^AMBIGUOUS\t[0-9a-f]{64}\tmissing-owner-metadata$/m,
    "ambiguous leases must expose an exact snapshot digest",
  );
  const [, ambiguousDigest] = ambiguous.stdout.trim().split("\t");
  const recoveredAmbiguous = invoke(
    "recover",
    "owner-d",
    [
      "--observed-lease-digest",
      ambiguousDigest,
      "--operator-reason",
      "ambiguous metadata recovery",
    ],
    terminalEnv,
  );
  assert.equal(recoveredAmbiguous.status, 0, recoveredAmbiguous.stderr);
  assert.match(recoveredAmbiguous.stdout, /LEASE_RECOVERED/);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("Remote host lease contract self-test passed.");
