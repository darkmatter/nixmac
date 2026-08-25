#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "cua-default-recovery.sh");
const script = readFileSync(scriptPath, "utf8");

execFileSync("bash", ["-n", scriptPath], { stdio: "pipe" });

assert.match(
  script,
  /CUA_RECOVERY_MARKER="\$CUA_RECOVERY_DIR\/cua-default-recovery\.json"/,
  "recovery must use one stable marker that a later workflow can discover",
);
assert.match(
  script,
  /"defaultSocket": default_socket[\s\S]*"runSocket": run_socket[\s\S]*"defaultDaemonPid": int\(daemon_pid\)[\s\S]*"defaultDaemonCommand": daemon_command[\s\S]*"armedBeforeStop": True/,
  "the marker must bind both sockets and the exact default-daemon identity",
);

const armStart = script.indexOf("arm_and_stop_default() {");
const reconcileStart = script.indexOf("reconcile_recovery() {");
assert.notEqual(armStart, -1);
assert.notEqual(reconcileStart, -1);
const arm = script.slice(armStart, reconcileStart);
const markerWrite = arm.indexOf('write_recovery_marker "$run_id" "$daemon_pid"');
const daemonStop = arm.indexOf('"$CUA_CLI" stop >/dev/null');
assert(markerWrite >= 0 && daemonStop > markerWrite, "the durable marker must be armed before stop");
assert.match(
  arm.slice(markerWrite, daemonStop),
  /read_recovery_marker >\/dev\/null/,
  "the armed marker must be read back before the crash-window mutation",
);

const reconcile = script.slice(reconcileStart);
assert.match(
  reconcile,
  /if \[\[ ! -e "\$CUA_RECOVERY_MARKER" && ! -L "\$CUA_RECOVERY_MARKER" \]\]; then[\s\S]*"action":"none"/,
  "no marker must remain a no-op",
);
assert.match(
  reconcile,
  /stop_run_daemon "\$run_socket"[\s\S]*probe_default_daemon[\s\S]*remove_recovery_marker[\s\S]*open -n -g "\$CUA_APP" --args serve --no-permissions-gate --no-overlay/,
  "reconciliation must handle the marked run daemon and the pre-stop crash window before restoration",
);
assert.doesNotMatch(script, /kill -9|pkill|killall/, "recovery must never broadly kill CuaDriver");

console.log("CuaDriver default recovery self-test passed");
