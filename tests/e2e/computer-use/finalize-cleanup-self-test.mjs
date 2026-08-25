import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "../../..");
const fixtureDir = path.join(toolDir, "fixtures/preservation");
const runner = path.join(toolDir, "run-remote-cua.mjs");
const system = `/nix/store/${"a".repeat(32)}-darwin-system-test`;

function buildRun() {
  const runDir = mkdtempSync(path.join(os.tmpdir(), "nixmac-finalize-cleanup-"));
  const state = JSON.parse(readFileSync(path.join(fixtureDir, "state.seed.json"), "utf8"));
  state.runDir = runDir;
  state.scenarios.hostRestoration.status = "inconclusive";
  state.scenarios.hostRestoration.notes = [];
  state.cleanup = { attempted: false, restored: false, note: "Cleanup pending." };
  mkdirSync(path.join(runDir, "texts"), { recursive: true });
  cpSync(path.join(fixtureDir, "screenshots"), path.join(runDir, "screenshots"), {
    recursive: true,
  });
  for (const artifact of state.textSnapshots) {
    const artifactPath = path.join(runDir, artifact.path);
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `Fixture text: ${artifact.label}\n`, "utf8");
  }
  writeFileSync(path.join(runDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return runDir;
}

const evidence = {
  version: 1,
  status: "pass",
  planOnly: false,
  runId: "self-test-1",
  marker: {
    path: "/Users/admin/.nixmac-e2e/system-restore-marker.json",
    loaded: true,
    retained: false,
  },
  system: {
    original: system,
    activeAfter: system,
    profileAfter: system,
    restored: true,
  },
  formula: {
    name: "hello",
    installedBefore: false,
    restored: true,
    installedAfter: false,
    executableAfter: false,
  },
  errors: [],
};
const evidencePath = path.join(os.tmpdir(), `nixmac-cleanup-evidence-${process.pid}.json`);
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

const passingRun = buildRun();
execFileSync(
  process.execPath,
  [runner, "finalize-cleanup", "--run-dir", passingRun, "--evidence", evidencePath],
  {
    cwd: repoRoot,
    stdio: "pipe",
  },
);
const passingState = JSON.parse(readFileSync(path.join(passingRun, "state.json"), "utf8"));
assert.equal(passingState.verdict, "pass");
assert.equal(passingState.scenarios.hostRestoration.status, "pass");
assert.equal(passingState.cleanup.restored, true);
assert.equal(
  passingState.textSnapshots.some((artifact) => artifact.label === "host-restoration"),
  true,
);

const failingRun = buildRun();
const failed = spawnSync(
  process.execPath,
  [runner, "finalize-cleanup", "--run-dir", failingRun, "--evidence", `${evidencePath}.missing`],
  { cwd: repoRoot, encoding: "utf8" },
);
assert.equal(failed.status, 1);
const failingState = JSON.parse(readFileSync(path.join(failingRun, "state.json"), "utf8"));
assert.equal(failingState.verdict, "fail");
assert.equal(failingState.scenarios.hostRestoration.status, "fail");
assert.equal(failingState.cleanup.restored, false);
assert.match(failingState.failures.join(" "), /Host restoration evidence/i);

console.log("finalize cleanup self-test passed");
