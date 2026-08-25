import assert from "node:assert/strict";
import { prepareSystemMarker } from "./prepare-system-marker.mjs";

const activeSystem = `/nix/store/${"a".repeat(32)}-darwin-system-test`;
const snapshot = {
  version: 2,
  formula: "hello",
  brewPath: "/opt/homebrew/bin/brew",
  formulaExecutable: "/opt/homebrew/bin/hello",
  formulaInstalled: false,
  formulaVersion: "",
  formulaExecutablePresent: false,
  formulaExecutableVersion: "",
  activeBrewfile: `/nix/store/${"b".repeat(32)}-Brewfile`,
  activeBrewfileSha256: "0".repeat(64),
  activeBrewfileDeclaresFormula: false,
  activeSystem,
  profileStore: activeSystem,
  profilePath: "/nix/var/nix/profiles/system",
  nixEnvPath: "/nix/var/nix/profiles/default/bin/nix-env",
};
let written = "";
const result = await prepareSystemMarker({
  runId: "123-1",
  remoteHome: "/Users/admin",
  outputPath: "/tmp/marker.json",
  capture: ({ requireFormulaAbsent }) => {
    assert.equal(requireFormulaAbsent, true);
    return { snapshot, error: "" };
  },
  execute: (command) => {
    assert.match(command, /sudo -n -l/);
    assert.match(command, /darwin-rebuild/);
    return { ok: true, stdout: "", stderr: "" };
  },
  now: () => "2026-08-25T00:00:00.000Z",
  write: async (_path, contents) => {
    written = contents;
  },
});
assert.equal(result.marker.originalSystem, activeSystem);
assert.equal(result.marker.formula.installedBefore, false);
assert.equal(result.markerPath, "/Users/admin/.nixmac-e2e/system-restore-marker.json");
assert.equal(result.resultPath, "/Users/admin/.nixmac-e2e/system-restore-result.json");
assert.equal(JSON.parse(written).runId, "123-1");
await assert.rejects(
  () =>
    prepareSystemMarker({
      runId: "123-1",
      remoteHome: "/Users/admin",
      outputPath: "/tmp/marker.json",
      capture: () => ({ snapshot, error: "" }),
      execute: () => ({ ok: false, stdout: "", stderr: "sudo denied" }),
      write: async () => {},
    }),
  /sudo denied/,
);

console.log("prepare system marker self-test passed");
