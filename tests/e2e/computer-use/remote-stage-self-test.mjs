import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  buildRemoteRestoreMarker,
  captureRemoteSystemSnapshot,
  e2eHomebrewFormula,
  parseRemoteSystemSnapshot,
  remoteRestoreMarkerPath,
  remoteRestoreResultPath,
  remoteSystemSnapshotCommand,
  serializeRemoteRestoreMarker,
  validateE2eHomebrewFormula,
  validateRemoteRestoreMarker,
  validateRemoteSystemSnapshot,
} from "./remote-stage.mjs";

const originalSystem = `/nix/store/${"a".repeat(32)}-darwin-system-26.11.test`;
const activeBrewfile = `/nix/store/${"b".repeat(32)}-Brewfile`;
const activeBrewfileSha256 = "0".repeat(64);
const encoded = (value) => Buffer.from(value).toString("base64");

function snapshotOutput({ installed = false, declared = installed } = {}) {
  return [
    "VERSION=2",
    "FORMULA=hello",
    `BREW_PATH_B64=${encoded("/opt/homebrew/bin/brew")}`,
    `FORMULA_EXECUTABLE_B64=${encoded("/opt/homebrew/bin/hello")}`,
    `FORMULA_INSTALLED=${installed}`,
    `FORMULA_VERSION_B64=${encoded(installed ? "hello 2.12.3" : "")}`,
    `FORMULA_EXECUTABLE_PRESENT=${installed}`,
    `FORMULA_EXECUTABLE_VERSION_B64=${encoded(installed ? "hello (GNU Hello) 2.12.3" : "")}`,
    `ACTIVE_BREWFILE_B64=${encoded(activeBrewfile)}`,
    `ACTIVE_BREWFILE_SHA256=${activeBrewfileSha256}`,
    `ACTIVE_BREWFILE_DECLARES_FORMULA=${declared}`,
    `ACTIVE_SYSTEM_B64=${encoded(originalSystem)}`,
    `PROFILE_STORE_B64=${encoded(originalSystem)}`,
    `PROFILE_PATH_B64=${encoded("/nix/var/nix/profiles/system")}`,
    `NIX_ENV_PATH_B64=${encoded("/nix/var/nix/profiles/default/bin/nix-env")}`,
  ].join("\n");
}

const command = remoteSystemSnapshotCommand();
assert.match(command, /Cellar\/hello/);
assert.match(command, /opt\/hello/);
assert.match(command, /formula_artifact_present|formula_installed=true/);
assert.doesNotMatch(command, /brew list/);
assert.match(command, /\/opt\/homebrew\/bin\/brew/);
assert.match(command, /\/run\/current-system/);
assert.match(command, /\/nix\/var\/nix\/profiles\/system/);
assert.match(command, /brew bundle --file/);
assert.match(command, /ACTIVE_BREWFILE_SHA256/);
assert.doesNotMatch(command, /\bbat\b/);
assert.equal(spawnSync("bash", ["-n"], { input: command }).status, 0);

assert.equal(validateE2eHomebrewFormula(), e2eHomebrewFormula);
assert.throws(
  () =>
    validateE2eHomebrewFormula({
      name: "bat",
      executable: "bat",
      versionPrefix: "bat ",
    }),
  /fixed to hello/,
);

const absentSnapshot = parseRemoteSystemSnapshot(snapshotOutput(), {
  requireFormulaAbsent: true,
});
assert.equal(absentSnapshot.formula, "hello");
assert.equal(absentSnapshot.formulaInstalled, false);
assert.equal(absentSnapshot.formulaExecutablePresent, false);
assert.equal(absentSnapshot.activeBrewfile, activeBrewfile);
assert.equal(absentSnapshot.activeBrewfileSha256, activeBrewfileSha256);
assert.equal(absentSnapshot.activeBrewfileDeclaresFormula, false);
assert.equal(absentSnapshot.activeSystem, originalSystem);
assert.equal(absentSnapshot.profileStore, originalSystem);

const installedSnapshot = parseRemoteSystemSnapshot(snapshotOutput({ installed: true }));
assert.equal(installedSnapshot.formulaVersion, "hello 2.12.3");
assert.equal(installedSnapshot.formulaExecutableVersion, "hello (GNU Hello) 2.12.3");
assert.equal(installedSnapshot.activeBrewfileDeclaresFormula, true);
const retainedSnapshot = parseRemoteSystemSnapshot(
  snapshotOutput({ installed: true, declared: false }),
);
assert.equal(retainedSnapshot.formulaInstalled, true);
assert.equal(
  retainedSnapshot.activeBrewfileDeclaresFormula,
  false,
  "physical Homebrew state may remain after the active plan removes the formula",
);
assert.throws(
  () =>
    parseRemoteSystemSnapshot(snapshotOutput({ installed: true }), {
      requireFormulaAbsent: true,
    }),
  /must be absent/,
);
assert.throws(
  () =>
    buildRemoteRestoreMarker(installedSnapshot, {
      runId: "32794906073-1",
      capturedAt: "2026-08-25T00:45:31.000Z",
      cleanup: {},
    }),
  /must be absent/,
);
assert.throws(
  () =>
    parseRemoteSystemSnapshot(
      snapshotOutput().replace("FORMULA_INSTALLED=false", "FORMULA_INSTALLED=no"),
    ),
  /must be true or false/,
);
assert.throws(
  () =>
    parseRemoteSystemSnapshot(
      snapshotOutput().replace(
        "ACTIVE_BREWFILE_DECLARES_FORMULA=false",
        "ACTIVE_BREWFILE_DECLARES_FORMULA=true",
      ),
      { requireFormulaAbsent: true },
    ),
  /active Homebrew plan must not declare hello/,
);
assert.throws(
  () => parseRemoteSystemSnapshot(`${snapshotOutput()}\nUNEXPECTED=value`),
  /unexpected field/,
);
assert.throws(
  () =>
    parseRemoteSystemSnapshot(
      snapshotOutput().replace("FORMULA=hello", "FORMULA=bat\nFORMULA=hello"),
    ),
  /duplicate field/,
);
assert.throws(
  () =>
    parseRemoteSystemSnapshot(
      snapshotOutput().replace(
        encoded("/opt/homebrew/bin/brew"),
        `!!!!${encoded("/opt/homebrew/bin/brew")}`,
      ),
    ),
  /canonical base64/,
);

assert.throws(
  () =>
    validateRemoteSystemSnapshot({
      ...absentSnapshot,
      profileStore: `/nix/store/${"b".repeat(32)}-darwin-system-other`,
    }),
  /must match/,
);

const captured = captureRemoteSystemSnapshot({
  requireFormulaAbsent: true,
  execute: (remoteCommand) => {
    assert.equal(remoteCommand, command);
    return { ok: true, stdout: snapshotOutput(), stderr: "" };
  },
});
assert.deepEqual(captured, { snapshot: absentSnapshot, error: "" });
assert.match(
  captureRemoteSystemSnapshot({ execute: () => ({ ok: false, stdout: "", stderr: "no host" }) })
    .error,
  /no host/,
);

const marker = buildRemoteRestoreMarker(absentSnapshot, {
  runId: "32794906073-1",
  capturedAt: "2026-08-25T00:45:31.000Z",
  cleanup: {
    appSupportBackup: "/tmp/nixmac-computer-use-e2e-backup-32794906073-1",
    appSupportState: "/tmp/nixmac-computer-use-e2e-backup-32794906073-1.state",
    configDir: "/tmp/nixmac-computer-use-e2e-config-32794906073-1",
    appStage: "/tmp/nixmac-computer-use-e2e-app-32794906073-1",
    keyFile: "/tmp/nixmac-openrouter-key-32794906073-1",
    authBackup: "/tmp/nixmac-computer-use-e2e-auth-system-privilege-admin-32794906073-1.plist",
  },
});
assert.equal(marker.originalSystem, originalSystem);
assert.equal(marker.formula.name, "hello");
assert.equal(marker.formula.installedBefore, false);
assert.equal(marker.formula.versionBefore, null);
assert.equal(
  remoteRestoreMarkerPath("/Users/admin"),
  "/Users/admin/.nixmac-e2e/system-restore-marker.json",
);
assert.equal(
  remoteRestoreResultPath("/Users/admin"),
  "/Users/admin/.nixmac-e2e/system-restore-result.json",
);
assert.throws(() => remoteRestoreMarkerPath("../../escape"), /normalized/);
assert.throws(() => remoteRestoreMarkerPath("//Users/admin"), /normalized/);
assert.throws(() => remoteRestoreMarkerPath("/Users/./admin"), /normalized/);
assert.deepEqual(validateRemoteRestoreMarker(marker), marker);
assert.deepEqual(JSON.parse(serializeRemoteRestoreMarker(marker)), marker);
assert.throws(
  () => validateRemoteRestoreMarker({ ...marker, unexpected: true }),
  /unexpected fields/,
);
assert.throws(
  () => validateRemoteSystemSnapshot({ ...absentSnapshot, unexpected: true }),
  /unexpected fields/,
);
assert.throws(
  () => validateRemoteRestoreMarker({ ...marker, capturedAt: "August 25, 2026" }),
  /ISO UTC timestamp/,
);
assert.throws(
  () => validateRemoteRestoreMarker({ ...marker, formula: { ...marker.formula, name: "bat" } }),
  /must be hello/,
);

console.log("remote-stage system snapshot self-test passed");
