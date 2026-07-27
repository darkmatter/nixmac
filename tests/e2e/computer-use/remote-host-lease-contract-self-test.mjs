#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseWorkflowYaml } from "./workflow-concurrency-contract.mjs";

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), "../../..");
const helperPath = path.join(repoRoot, "ops/runner/macincloud-host-lease.sh");
const helper = readFileSync(helperPath, "utf8");
const HELPER_TIMEOUT_MS = 30_000;

execFileSync("bash", ["-n", helperPath]);
assert.match(helper, /mkdir "\$lease_dir"/, "lease acquisition must use atomic mkdir");
assert.match(helper, /owner_token_sha256/, "lease metadata must bind an owner-token digest");
assert.match(helper, /LEASE_BUSY/, "bounded live-owner wait must return LEASE_BUSY");
assert.match(helper, /LEASE_QUARANTINED/, "stale or ambiguous owners must quarantine");
assert.match(helper, /observed-lease-digest/, "recovery must require the observed lease digest");
assert.match(helper, /operator-reason/, "recovery must require an operator reason");
assert.match(helper, /actions\/runs/, "owner liveness must come from the owning GitHub run");
assert.match(helper, /\["pgrep", "-f", pattern\]/, "recovery must probe remote processes");
assert.match(helper, /nixmac.*CuaDriver/s, "recovery must refuse while nixmac is active");
assert.equal(
  [...helper.matchAll(/\b(?:ps_path|heartbeat_ps_path)\s*=\s*["']\/bin\/ps["']/g)].length,
  2,
  "both heartbeat process probes must default to the remote macOS /bin/ps",
);
assert.equal(
  [...helper.matchAll(/\/bin\/ps/g)].length,
  2,
  "all production /bin/ps references must flow through the two audited probe paths",
);
assert.match(
  helper,
  /NIXMAC_E2E_LEASE_TEST_MODE[\s\S]*NIXMAC_E2E_LEASE_PS_PATH/,
  "process-probe injection must be isolated behind lease test mode",
);
assert.match(
  helper,
  /process\.returncode == 1[\s\S]*process probe failed with status/,
  "the status path must distinguish a missing PID from a broken process probe",
);
assert.match(
  helper,
  /heartbeat process probe (?:is unavailable|failed) during release/,
  "release must fail closed when the heartbeat process probe is unavailable",
);
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
  assert.match(
    text,
    /owner_token.*attempt|owner_token.*GITHUB_RUN_ATTEMPT|GITHUB_RUN_ATTEMPT.*nonce|inputs\.attempt.*attestation_nonce/i,
    `${workflowName} owner tokens must bind the attempt and nonce`,
  );
}

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "nixmac-host-lease-contract-"));
let uncooperativeHeartbeat;
try {
  const fakeBin = path.join(fixtureRoot, "bin");
  execFileSync("mkdir", ["-p", fakeBin]);
  const fakeSsh = path.join(fakeBin, "ssh");
  const fakeSshKeygen = path.join(fakeBin, "ssh-keygen");
  const fakeGh = path.join(fakeBin, "gh");
  const fakePgrep = path.join(fakeBin, "pgrep");
  const fakePs = path.join(fakeBin, "ps");
  const failingPs = path.join(fakeBin, "ps-fail");
  writeFileSync(
    fakeSsh,
    `#!/usr/bin/env bash
set -euo pipefail
count_file="\${NIXMAC_E2E_FAKE_SSH_COUNT_FILE:-}"
fail_until="\${NIXMAC_E2E_FAKE_SSH_FAIL_UNTIL:-0}"
fail_on="\${NIXMAC_E2E_FAKE_SSH_FAIL_ON:-0}"
if [[ -n "$count_file" ]]; then
  count="$(cat "$count_file" 2>/dev/null || printf '0')"
  count=$((count + 1))
  printf '%s\\n' "$count" > "$count_file"
  if ((count <= fail_until || count == fail_on)); then
    exit 255
  fi
fi
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
  writeFileSync(
    fakePs,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ -x /bin/ps ]] && /bin/ps -ww -p "$$" -o command= >/dev/null 2>&1; then
  exec /bin/ps "$@"
fi
pid=""
while (($#)); do
  case "$1" in
    -p) pid="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[[ "$pid" =~ ^[0-9]+$ ]] || exit 2
[[ -r "/proc/$pid/cmdline" ]] || exit 1
tr '\\0' ' ' < "/proc/$pid/cmdline"
printf '\\n'
`,
  );
  writeFileSync(failingPs, "#!/usr/bin/env bash\nexit 127\n");
  chmodSync(fakeSsh, 0o700);
  chmodSync(fakeSshKeygen, 0o700);
  chmodSync(fakeGh, 0o700);
  chmodSync(fakePgrep, 0o700);
  chmodSync(fakePs, 0o700);
  chmodSync(failingPs, 0o700);
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
    NIXMAC_E2E_LEASE_PS_PATH: fakePs,
    NIXMAC_E2E_LEASE_ROOT: leaseRoot,
    NIXMAC_E2E_LEASE_LIVENESS_RETRY_DELAY_SECONDS: "0",
  };
  const invoke = (command, ownerToken, extra = [], env = fixtureEnv) =>
    spawnSync("bash", [helperPath, command, ...commonArgs, "--owner-token", ownerToken, ...extra], {
      encoding: "utf8",
      env,
      timeout: HELPER_TIMEOUT_MS,
    });
  const invokeWithOwnership = (command, ownerToken, ownershipArgs, extra = [], env = fixtureEnv) =>
    spawnSync(
      "bash",
      [helperPath, command, ...ownershipArgs, "--owner-token", ownerToken, ...extra],
      {
        encoding: "utf8",
        env,
        timeout: HELPER_TIMEOUT_MS,
      },
    );
  const invokeAsync = (command, ownerToken, extra = [], env = fixtureEnv) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "bash",
        [helperPath, command, ...commonArgs, "--owner-token", ownerToken, ...extra],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`lease helper timed out after ${HELPER_TIMEOUT_MS} ms`));
      }, HELPER_TIMEOUT_MS);
      child.once("error", reject);
      child.once("close", (status, signal) => {
        clearTimeout(timeout);
        resolve({ status, signal, stdout, stderr });
      });
    });

  const unrelatedTarget = path.join(fixtureRoot, "unrelated-target");
  const unrelatedSentinel = path.join(unrelatedTarget, "sentinel");
  mkdirSync(unrelatedTarget);
  writeFileSync(unrelatedSentinel, "must remain untouched\n");
  symlinkSync(unrelatedTarget, leaseRoot);
  const symlinkRootStatus = invoke("status", "owner-a");
  assert.notEqual(symlinkRootStatus.status, 0, "status must reject a symlink lease root");
  const symlinkRootAcquire = invoke("acquire", "owner-a", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(symlinkRootAcquire.status, 73, symlinkRootAcquire.stderr);
  assert.equal(readFileSync(unrelatedSentinel, "utf8"), "must remain untouched\n");
  unlinkSync(leaseRoot);

  writeFileSync(leaseRoot, "not a directory\n");
  const fileRootStatus = invoke("status", "owner-a");
  assert.notEqual(fileRootStatus.status, 0, "status must reject a non-directory lease root");
  rmSync(leaseRoot);

  mkdirSync(leaseRoot);
  symlinkSync(unrelatedTarget, path.join(leaseRoot, "owner"));
  const symlinkOwnerStatus = invoke("status", "owner-a");
  assert.notEqual(symlinkOwnerStatus.status, 0, "status must reject a symlink owner directory");
  const symlinkOwnerAcquire = invoke("acquire", "owner-a", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(symlinkOwnerAcquire.status, 73, symlinkOwnerAcquire.stderr);
  assert.equal(readFileSync(unrelatedSentinel, "utf8"), "must remain untouched\n");
  unlinkSync(path.join(leaseRoot, "owner"));
  writeFileSync(path.join(leaseRoot, "owner"), "not a directory\n");
  const fileOwnerStatus = invoke("status", "owner-a");
  assert.notEqual(fileOwnerStatus.status, 0, "status must reject a non-directory owner");
  rmSync(leaseRoot, { recursive: true });

  const rootCreationHook = path.join(fixtureRoot, "create-lease-root-during-acquire");
  writeFileSync(rootCreationHook, '#!/usr/bin/env bash\nset -euo pipefail\nmkdir "$1"\n');
  chmodSync(rootCreationHook, 0o700);
  const racedRootAcquire = invoke(
    "acquire",
    "owner-a",
    ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
    {
      ...fixtureEnv,
      NIXMAC_E2E_LEASE_ROOT_CREATION_TEST_HOOK: rootCreationHook,
    },
  );
  assert.equal(
    racedRootAcquire.status,
    0,
    `acquire must tolerate a safe concurrent lease-root creator: ${racedRootAcquire.stderr}`,
  );
  assert.match(racedRootAcquire.stdout, /^LEASE_ACQUIRED\t/m);
  const releasedAfterRootRace = invoke("release", "owner-a");
  assert.equal(releasedAfterRootRace.status, 0, releasedAfterRootRace.stderr);
  rmSync(leaseRoot, { recursive: true });

  const ownerInitHook = path.join(fixtureRoot, "pause-owner-initialization");
  writeFileSync(ownerInitHook, "#!/usr/bin/env bash\nset -euo pipefail\nsleep 0.5\n");
  chmodSync(ownerInitHook, 0o700);
  const hostileStatBin = path.join(fixtureRoot, "hostile-stat-bin");
  mkdirSync(hostileStatBin);
  const hostileStat = path.join(hostileStatBin, "stat");
  writeFileSync(
    hostileStat,
    "#!/usr/bin/env bash\ndate +%s%N\nprintf 'changing failed probe output\\n'\nexit 1\n",
  );
  chmodSync(hostileStat, 0o700);
  const concurrentAcquireEnv = {
    ...fixtureEnv,
    PATH: `${hostileStatBin}:${fixtureEnv.PATH}`,
    NIXMAC_E2E_LEASE_OWNER_INIT_TEST_HOOK: ownerInitHook,
  };
  const concurrentResults = await Promise.all([
    invokeAsync(
      "acquire",
      "owner-a",
      ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
      concurrentAcquireEnv,
    ),
    invokeAsync(
      "acquire",
      "owner-b",
      ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
      concurrentAcquireEnv,
    ),
  ]);
  const acquiredResults = concurrentResults.filter((result) => result.status === 0);
  const busyResults = concurrentResults.filter((result) => result.status === 75);
  assert.equal(
    acquiredResults.length,
    1,
    `exactly one simultaneous cold acquire must win: ${JSON.stringify(concurrentResults)}`,
  );
  assert.equal(
    busyResults.length,
    1,
    `the losing simultaneous cold acquire must be busy, not quarantined: ${JSON.stringify(concurrentResults)}`,
  );
  assert.match(busyResults[0].stderr, /LEASE_BUSY/);
  assert.equal(
    existsSync(path.join(leaseRoot, "QUARANTINED.json")),
    false,
    "normal concurrent cold acquisition must not quarantine the host",
  );
  const winningToken = concurrentResults[0].status === 0 ? "owner-a" : "owner-b";
  const releasedConcurrentWinner = invoke("release", winningToken);
  assert.equal(releasedConcurrentWinner.status, 0, releasedConcurrentWinner.stderr);

  const handoverOwner = invoke("acquire", "owner-a", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(handoverOwner.status, 0, handoverOwner.stderr);
  const handoverReady = path.join(fixtureRoot, "handover-loser-ready");
  const handoverHook = path.join(fixtureRoot, "pause-after-failed-owner-mkdir");
  writeFileSync(
    handoverHook,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'ready\\n' > "${handoverReady}"
sleep 0.5
`,
  );
  chmodSync(handoverHook, 0o700);
  const handoverContenderPromise = invokeAsync(
    "acquire",
    "owner-b",
    ["--wait-seconds", "3", "--poll-seconds", "1", "--max-hold-seconds", "60"],
    {
      ...fixtureEnv,
      NIXMAC_E2E_LEASE_POST_MKDIR_FAILURE_TEST_HOOK: handoverHook,
    },
  );
  for (let attempt = 0; attempt < 100 && !existsSync(handoverReady); attempt += 1) {
    spawnSync("sleep", ["0.02"]);
  }
  assert.equal(existsSync(handoverReady), true, "handover contender must reach the race hook");
  const handoverRelease = invoke("release", "owner-a");
  assert.equal(handoverRelease.status, 0, handoverRelease.stderr);
  const handoverContender = await handoverContenderPromise;
  assert.equal(
    handoverContender.status,
    0,
    `benign release during a failed mkdir probe must retry, not quarantine: ${JSON.stringify(
      handoverContender,
    )}`,
  );
  assert.match(handoverContender.stdout, /^LEASE_ACQUIRED\t/m);
  assert.equal(
    existsSync(path.join(leaseRoot, "QUARANTINED.json")),
    false,
    "a benign release/acquire handover must not quarantine the host",
  );
  const handoverContenderRelease = invoke("release", "owner-b");
  assert.equal(handoverContenderRelease.status, 0, handoverContenderRelease.stderr);

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

  const transientTransportCounter = path.join(fixtureRoot, "transient-ssh-count");
  const transientTransport = invoke(
    "acquire",
    "owner-b",
    ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
    {
      ...fixtureEnv,
      NIXMAC_E2E_FAKE_SSH_COUNT_FILE: transientTransportCounter,
      NIXMAC_E2E_FAKE_SSH_FAIL_UNTIL: "1",
    },
  );
  assert.equal(
    transientTransport.status,
    75,
    `one transient SSH failure must be retried before reporting the live owner: ${transientTransport.stderr}`,
  );
  assert.match(transientTransport.stderr, /LEASE_BUSY/);
  assert.equal(
    Number.parseInt(readFileSync(transientTransportCounter, "utf8"), 10),
    2,
    "transient SSH recovery must perform one later successful probe",
  );
  assert.equal(
    existsSync(path.join(leaseRoot, "QUARANTINED.json")),
    false,
    "a transient SSH failure must not quarantine the host",
  );
  const lateTransportCounter = path.join(fixtureRoot, "late-transient-ssh-count");
  const lateTransport = invoke(
    "acquire",
    "owner-b",
    ["--wait-seconds", "7", "--poll-seconds", "6", "--max-hold-seconds", "60"],
    {
      ...fixtureEnv,
      NIXMAC_E2E_FAKE_SSH_COUNT_FILE: lateTransportCounter,
      NIXMAC_E2E_FAKE_SSH_FAIL_ON: "2",
    },
  );
  assert.equal(
    lateTransport.status,
    75,
    `a late transient SSH failure must receive a fresh bounded retry window: ${lateTransport.stderr}`,
  );
  assert.match(lateTransport.stderr, /LEASE_BUSY/);
  assert.equal(
    Number.parseInt(readFileSync(lateTransportCounter, "utf8"), 10),
    3,
    "a late transient SSH failure must be followed by a successful owner probe",
  );
  assert.equal(
    existsSync(path.join(leaseRoot, "QUARANTINED.json")),
    false,
    "a late transient SSH failure must not quarantine the host",
  );

  const rerunArgs = commonArgs.map((value, index, values) => {
    if (values[index - 1] === "--attempt") return "2";
    if (values[index - 1] === "--nonce") {
      return "fixture-rerun-nonce-012345678901234567890123456789";
    }
    return value;
  });
  const rerun = invokeWithOwnership("acquire", "owner-a", rerunArgs, [
    "--wait-seconds",
    "3600",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(rerun.status, 73, rerun.stderr);
  assert.match(
    rerun.stderr,
    /stale attempt retained for audited recovery/i,
    "a new attempt of the same logical run must quarantine immediately instead of inheriting or waiting",
  );
  const rerunStatus = invokeWithOwnership("status", "owner-a", rerunArgs);
  assert.equal(rerunStatus.status, 0, rerunStatus.stderr);
  assert.match(rerunStatus.stdout, /^OCCUPIED\t[0-9a-f]{64}\t/);
  const [, rerunDigest] = rerunStatus.stdout.trim().split("\t");
  const recoveredRerun = invokeWithOwnership("recover", "owner-a", rerunArgs, [
    "--observed-lease-digest",
    rerunDigest,
    "--operator-reason",
    "same-run attempt rollover",
  ]);
  assert.equal(
    recoveredRerun.status,
    0,
    `stale-attempt recovery must not treat the shared GitHub run as a live prior attempt:
status=${rerunStatus.stdout}
stderr=${recoveredRerun.stderr}`,
  );
  assert.match(recoveredRerun.stdout, /LEASE_RECOVERED/);
  const reacquiredAfterRerun = invoke("acquire", "owner-a", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(reacquiredAfterRerun.status, 0, reacquiredAfterRerun.stderr);

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
  const releaseTempHook = path.join(fixtureRoot, "write-heartbeat-temp-before-stop");
  writeFileSync(
    releaseTempHook,
    "#!/usr/bin/env bash\nset -euo pipefail\nprintf '1700000000\\n' > \"$1/heartbeat.tmp.$2\"\nprintf '1700000000\\n' > \"$1/heartbeat.tmp.424242\"\n",
  );
  chmodSync(releaseTempHook, 0o700);
  const released = invoke("release", "owner-a", [], {
    ...fixtureEnv,
    NIXMAC_E2E_LEASE_RELEASE_BEFORE_STOP_TEST_HOOK: releaseTempHook,
  });
  assert.equal(released.status, 0, released.stderr);
  assert.match(
    released.stdout,
    /^LEASE_RELEASED\t\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\t\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m,
    "owner-matched release must return the final heartbeat and remote release time",
  );

  const acquiredForFailedProbe = invoke("acquire", "owner-a", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(acquiredForFailedProbe.status, 0, acquiredForFailedProbe.stderr);
  const refusedWithoutProcessProbe = invoke("release", "owner-a", [], {
    ...fixtureEnv,
    NIXMAC_E2E_LEASE_PS_PATH: failingPs,
  });
  assert.equal(
    refusedWithoutProcessProbe.status,
    73,
    "release must quarantine instead of succeeding when heartbeat liveness cannot be probed",
  );
  assert.match(refusedWithoutProcessProbe.stderr, /heartbeat process probe failed during release/);
  const releasedAfterProbeRecovery = invoke("release", "owner-a");
  assert.equal(releasedAfterProbeRecovery.status, 0, releasedAfterProbeRecovery.stderr);

  let releaseResidueScenarioIndex = 0;
  const releaseWithAdversarialResidue = (hookBody, expectedError) => {
    releaseResidueScenarioIndex += 1;
    const scenarioLeaseRoot = path.join(
      fixtureRoot,
      `long-heartbeat-command-${"x".repeat(180)}`,
      `nixmac-host-lease-contract-release-residue-${releaseResidueScenarioIndex}`,
      "remote-lease",
    );
    mkdirSync(scenarioLeaseRoot, { recursive: true });
    const scenarioEnv = {
      ...fixtureEnv,
      NIXMAC_E2E_LEASE_ROOT: scenarioLeaseRoot,
    };
    const scenarioAcquire = invoke(
      "acquire",
      "owner-a",
      ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
      scenarioEnv,
    );
    assert.equal(
      scenarioAcquire.status,
      0,
      `release residue scenario ${releaseResidueScenarioIndex} acquisition failed: ${scenarioAcquire.stderr}`,
    );
    const scenarioHook = path.join(
      fixtureRoot,
      `write-adversarial-release-residue-${releaseResidueScenarioIndex}`,
    );
    writeFileSync(scenarioHook, `#!/usr/bin/env bash\nset -euo pipefail\n${hookBody}\n`);
    chmodSync(scenarioHook, 0o700);
    const scenarioRelease = invoke("release", "owner-a", [], {
      ...scenarioEnv,
      NIXMAC_E2E_LEASE_RELEASE_BEFORE_STOP_TEST_HOOK: scenarioHook,
    });
    assert.equal(
      scenarioRelease.status,
      73,
      `release residue scenario ${releaseResidueScenarioIndex} must quarantine: ${scenarioRelease.stderr}`,
    );
    assert.match(scenarioRelease.stderr, expectedError);
  };

  releaseWithAdversarialResidue(
    `printf 'invalid\n' > "$1/heartbeat.tmp.not-a-pid"`,
    /invalid heartbeat temporary file name/,
  );
  const heartbeatSymlinkTarget = path.join(fixtureRoot, "heartbeat-symlink-target");
  writeFileSync(heartbeatSymlinkTarget, "must remain untouched\n");
  releaseWithAdversarialResidue(
    `ln -s ${JSON.stringify(heartbeatSymlinkTarget)} "$1/heartbeat.tmp.777"`,
    /unsafe heartbeat temporary file/,
  );
  assert.equal(
    readFileSync(heartbeatSymlinkTarget, "utf8"),
    "must remain untouched\n",
    "release quarantine must not follow or alter a heartbeat residue symlink target",
  );
  releaseWithAdversarialResidue(
    `head -c 64 /dev/zero > "$1/heartbeat.tmp.888"`,
    /invalid heartbeat temporary file/,
  );
  releaseWithAdversarialResidue(`mkdir "$1/heartbeat.tmp.999"`, /unsafe heartbeat temporary file/);

  const acquiredForUnavailableLiveness = invoke("acquire", "owner-a", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(acquiredForUnavailableLiveness.status, 0, acquiredForUnavailableLiveness.stderr);
  const unavailableLivenessCounter = path.join(fixtureRoot, "unavailable-liveness-count");
  const unavailableLiveness = invoke(
    "acquire",
    "owner-b",
    ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
    {
      ...fixtureEnv,
      NIXMAC_E2E_FAKE_GH_COUNT_FILE: unavailableLivenessCounter,
      NIXMAC_E2E_FAKE_GH_FAIL_UNTIL: "3",
    },
  );
  assert.equal(unavailableLiveness.status, 73, unavailableLiveness.stderr);
  assert.match(unavailableLiveness.stderr, /owner liveness unavailable after bounded retries/i);
  assert.equal(readFileSync(unavailableLivenessCounter, "utf8").trim(), "3");
  const refusedByLivenessMarker = invoke("acquire", "owner-b", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(refusedByLivenessMarker.status, 73, refusedByLivenessMarker.stderr);
  assert.match(refusedByLivenessMarker.stderr, /host is quarantined/i);
  const releasedUnavailableLivenessOwner = invoke("release", "owner-a");
  assert.equal(releasedUnavailableLivenessOwner.status, 0, releasedUnavailableLivenessOwner.stderr);
  const unavailableLivenessStatus = invoke("status", "owner-b");
  assert.equal(unavailableLivenessStatus.status, 0, unavailableLivenessStatus.stderr);
  assert.match(unavailableLivenessStatus.stdout, /^QUARANTINED\t[0-9a-f]{64}\t/m);
  const [, unavailableLivenessDigest] = unavailableLivenessStatus.stdout.trim().split("\t");
  const recoveredUnavailableLiveness = invoke("recover", "owner-b", [
    "--observed-lease-digest",
    unavailableLivenessDigest,
    "--operator-reason",
    "bounded liveness outage fixture recovery",
  ]);
  assert.equal(recoveredUnavailableLiveness.status, 0, recoveredUnavailableLiveness.stderr);
  assert.match(recoveredUnavailableLiveness.stdout, /LEASE_RECOVERED/);

  const invalidOwnerLeaseRoot = path.join(
    fixtureRoot,
    "nixmac-host-lease-contract-invalid-owner",
    "remote-lease",
  );
  mkdirSync(path.join(invalidOwnerLeaseRoot, "owner"), { recursive: true });
  writeFileSync(path.join(invalidOwnerLeaseRoot, "owner", "owner.json"), "{}\n");
  const invalidOwnerEnv = {
    ...fixtureEnv,
    NIXMAC_E2E_LEASE_ROOT: invalidOwnerLeaseRoot,
  };
  const invalidOwnerAcquire = invoke(
    "acquire",
    "owner-b",
    ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
    invalidOwnerEnv,
  );
  assert.equal(invalidOwnerAcquire.status, 73, invalidOwnerAcquire.stderr);
  assert.match(invalidOwnerAcquire.stderr, /unverifiable owner/i);
  assert.equal(
    JSON.parse(readFileSync(path.join(invalidOwnerLeaseRoot, "QUARANTINED.json"), "utf8")).reason,
    "unverifiable-lease-owner",
  );
  const invalidOwnerMarkerRefusal = invoke(
    "acquire",
    "owner-b",
    ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
    invalidOwnerEnv,
  );
  assert.equal(invalidOwnerMarkerRefusal.status, 73, invalidOwnerMarkerRefusal.stderr);
  assert.match(invalidOwnerMarkerRefusal.stderr, /host is quarantined/i);
  rmSync(invalidOwnerLeaseRoot, { recursive: true });

  const bindingMismatchLeaseRoot = path.join(
    fixtureRoot,
    "nixmac-host-lease-contract-binding-mismatch",
    "remote-lease",
  );
  mkdirSync(path.join(bindingMismatchLeaseRoot, "owner"), { recursive: true });
  writeFileSync(
    path.join(bindingMismatchLeaseRoot, "owner", "owner.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      owner_token_sha256: createHash("sha256").update("owner-a").digest("hex"),
      repository: "darkmatter/nixmac",
      run_id: "123",
      logical_job: "different-job",
      attempt: "1",
      nonce: "fixture-nonce-012345678901234567890123456789",
      created_at: "2026-07-26T00:00:00Z",
    })}\n`,
  );
  const bindingMismatchEnv = {
    ...fixtureEnv,
    NIXMAC_E2E_LEASE_ROOT: bindingMismatchLeaseRoot,
  };
  const bindingMismatchAcquire = invoke(
    "acquire",
    "owner-a",
    ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
    bindingMismatchEnv,
  );
  assert.equal(bindingMismatchAcquire.status, 73, bindingMismatchAcquire.stderr);
  assert.match(bindingMismatchAcquire.stderr, /owner token metadata binding mismatch/i);
  assert.equal(
    JSON.parse(readFileSync(path.join(bindingMismatchLeaseRoot, "QUARANTINED.json"), "utf8"))
      .reason,
    "owner-binding-mismatch",
  );
  rmSync(bindingMismatchLeaseRoot, { recursive: true });

  const ambiguousAcquireLeaseRoot = path.join(
    fixtureRoot,
    "nixmac-host-lease-contract-ambiguous-acquire",
    "remote-lease",
  );
  mkdirSync(path.join(ambiguousAcquireLeaseRoot, "owner"), { recursive: true });
  const ambiguousAcquireEnv = {
    ...fixtureEnv,
    NIXMAC_E2E_LEASE_ROOT: ambiguousAcquireLeaseRoot,
  };
  const ambiguousAcquire = invoke(
    "acquire",
    "owner-b",
    ["--wait-seconds", "0", "--poll-seconds", "1", "--max-hold-seconds", "60"],
    ambiguousAcquireEnv,
  );
  assert.equal(ambiguousAcquire.status, 73, ambiguousAcquire.stderr);
  assert.match(ambiguousAcquire.stderr, /ambiguous owner metadata/i);
  assert.equal(
    JSON.parse(readFileSync(path.join(ambiguousAcquireLeaseRoot, "QUARANTINED.json"), "utf8"))
      .reason,
    "ambiguous-lease-owner",
  );
  rmSync(ambiguousAcquireLeaseRoot, { recursive: true });

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

  const acquiredForReleaseHeartbeat = invoke("acquire", "owner-c", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(acquiredForReleaseHeartbeat.status, 0, acquiredForReleaseHeartbeat.stderr);
  const releaseHeartbeatDir = path.join(leaseRoot, "owner");
  const originalHeartbeatPid = Number.parseInt(
    readFileSync(path.join(releaseHeartbeatDir, "heartbeat.pid"), "utf8"),
    10,
  );
  process.kill(originalHeartbeatPid, "SIGTERM");
  const releaseHeartbeatPath = path.join(releaseHeartbeatDir, "heartbeat.sh");
  const releaseHeartbeatReady = path.join(fixtureRoot, "release-heartbeat-ready");
  writeFileSync(
    releaseHeartbeatPath,
    "#!/usr/bin/env bash\nset -euo pipefail\ntrap '' TERM\nprintf 'ready\\n' > \"$1\"\nwhile true; do sleep 1; done\n",
  );
  chmodSync(releaseHeartbeatPath, 0o700);
  uncooperativeHeartbeat = spawn("bash", [releaseHeartbeatPath, releaseHeartbeatReady], {
    stdio: "ignore",
  });
  assert.ok(uncooperativeHeartbeat.pid > 1);
  writeFileSync(path.join(releaseHeartbeatDir, "heartbeat.pid"), `${uncooperativeHeartbeat.pid}\n`);
  for (let attempt = 0; attempt < 100 && !existsSync(releaseHeartbeatReady); attempt += 1) {
    spawnSync("sleep", ["0.02"]);
  }
  assert.equal(
    existsSync(releaseHeartbeatReady),
    true,
    "release heartbeat fixture must install its TERM trap before release",
  );
  const refusedUncooperativeRelease = invoke("release", "owner-c");
  assert.equal(refusedUncooperativeRelease.status, 73, refusedUncooperativeRelease.stderr);
  assert.match(refusedUncooperativeRelease.stderr, /heartbeat did not stop during release/i);
  assert.equal(
    existsSync(path.join(releaseHeartbeatDir, "owner.json")),
    true,
    "release must retain ownership evidence while the heartbeat is still alive",
  );
  const releaseHeartbeatExit = new Promise((resolve) => {
    uncooperativeHeartbeat.once("close", resolve);
  });
  uncooperativeHeartbeat.kill("SIGKILL");
  await releaseHeartbeatExit;
  uncooperativeHeartbeat = undefined;
  const releasedAfterHeartbeatStop = invoke("release", "owner-c");
  assert.equal(releasedAfterHeartbeatStop.status, 0, releasedAfterHeartbeatStop.stderr);
  assert.match(releasedAfterHeartbeatStop.stdout, /^LEASE_RELEASED\t/m);

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
  const inodeSwapHook = path.join(fixtureRoot, "swap-owner-inode");
  writeFileSync(
    inodeSwapHook,
    `#!/usr/bin/env bash
set -euo pipefail
lease_root="$1"
mv "$lease_root/owner" "$lease_root/owner.original"
cp -R "$lease_root/owner.original" "$lease_root/owner"
`,
  );
  chmodSync(inodeSwapHook, 0o700);
  const refusedInodeSwap = invoke(
    "recover",
    "owner-c",
    ["--observed-lease-digest", changedOccupiedDigest, "--operator-reason", "inode swap must fail"],
    {
      ...terminalEnv,
      NIXMAC_E2E_LEASE_RECOVERY_TEST_HOOK: inodeSwapHook,
    },
  );
  assert.equal(refusedInodeSwap.status, 65, refusedInodeSwap.stderr);
  assert.match(refusedInodeSwap.stderr, /identity changed during recovery/i);
  assert.equal(
    readFileSync(path.join(leaseRoot, "owner", "unexpected-metadata"), "utf8"),
    "mutated after observed digest\n",
    "recovery must not erase an inode-swapped replacement",
  );
  assert.equal(
    readFileSync(path.join(leaseRoot, "owner.original", "unexpected-metadata"), "utf8"),
    "mutated after observed digest\n",
    "recovery must retain the originally opened owner directory",
  );
  rmSync(path.join(leaseRoot, "owner"), { recursive: true });
  renameSync(path.join(leaseRoot, "owner.original"), path.join(leaseRoot, "owner"));
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

  const ambiguousOwner = path.join(leaseRoot, "owner");
  mkdirSync(ambiguousOwner);
  const uncooperativeHeartbeatPath = path.join(ambiguousOwner, "heartbeat.sh");
  const uncooperativeReadyPath = path.join(fixtureRoot, "uncooperative-heartbeat-ready");
  writeFileSync(
    uncooperativeHeartbeatPath,
    "#!/usr/bin/env bash\nset -euo pipefail\ntrap '' TERM\nprintf 'ready\\n' > \"$1\"\nwhile true; do sleep 1; done\n",
  );
  chmodSync(uncooperativeHeartbeatPath, 0o700);
  writeFileSync(path.join(ambiguousOwner, "heartbeat"), "1700000000\n");
  writeFileSync(path.join(ambiguousOwner, "heartbeat.log"), "");
  uncooperativeHeartbeat = spawn("bash", [uncooperativeHeartbeatPath, uncooperativeReadyPath], {
    stdio: "ignore",
  });
  assert.ok(uncooperativeHeartbeat.pid > 1);
  writeFileSync(path.join(ambiguousOwner, "heartbeat.pid"), `${uncooperativeHeartbeat.pid}\n`);
  for (let attempt = 0; attempt < 100 && !existsSync(uncooperativeReadyPath); attempt += 1) {
    spawnSync("sleep", ["0.02"]);
  }
  assert.equal(
    existsSync(uncooperativeReadyPath),
    true,
    "uncooperative heartbeat fixture must install its TERM trap before status",
  );
  const refusedAmbiguous = invoke("status", "owner-d", [], terminalEnv);
  assert.notEqual(
    refusedAmbiguous.status,
    0,
    "status must fail closed when a validated orphan heartbeat ignores SIGTERM",
  );
  assert.doesNotMatch(
    refusedAmbiguous.stdout,
    /^AMBIGUOUS\t/m,
    "status must not report a recoverable ambiguous lease while its heartbeat is alive",
  );
  assert.match(refusedAmbiguous.stderr, /orphan heartbeat did not stop/i);
  const uncooperativeExit = new Promise((resolve) => {
    uncooperativeHeartbeat.once("close", resolve);
  });
  uncooperativeHeartbeat.kill("SIGKILL");
  await uncooperativeExit;
  uncooperativeHeartbeat = undefined;

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
  const reacquiredAfterAmbiguous = invoke("acquire", "owner-d", [
    "--wait-seconds",
    "0",
    "--poll-seconds",
    "1",
    "--max-hold-seconds",
    "60",
  ]);
  assert.equal(reacquiredAfterAmbiguous.status, 0, reacquiredAfterAmbiguous.stderr);
  const releasedAfterAmbiguous = invoke("release", "owner-d");
  assert.equal(releasedAfterAmbiguous.status, 0, releasedAfterAmbiguous.stderr);
} finally {
  if (uncooperativeHeartbeat) {
    uncooperativeHeartbeat.kill("SIGKILL");
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("Remote host lease contract self-test passed.");
