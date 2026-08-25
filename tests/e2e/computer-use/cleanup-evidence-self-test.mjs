import assert from "node:assert/strict";
import { cleanupScenarioResult, validateCleanupEvidence } from "./cleanup-evidence.mjs";

const system = `/nix/store/${"a".repeat(32)}-darwin-system-test`;
const passing = {
  version: 1,
  status: "pass",
  planOnly: false,
  runId: "123-1",
  marker: { path: "/tmp/recovery.json", loaded: true, retained: false },
  system: {
    original: system,
    profilePath: "/nix/var/nix/profiles/system",
    nixEnvPath: "/nix/var/nix/profiles/default/bin/nix-env",
    activeBefore: `${system}-changed`,
    activeAfter: system,
    profileBefore: `${system}-changed`,
    profileAfter: system,
    restoreRequired: true,
    restoreAttempted: true,
    restored: true,
    profileSetCommand: [],
    activateCommand: [],
  },
  formula: {
    name: "hello",
    brewPath: "/opt/homebrew/bin/brew",
    executablePath: "/opt/homebrew/bin/hello",
    installedBefore: false,
    versionBefore: null,
    executableVersionBefore: null,
    cleanupPlanned: true,
    cleanupAttempted: true,
    restored: true,
    installedAfter: false,
    versionAfter: null,
    executableAfter: false,
    executableVersionAfter: null,
    uninstallCommand: [],
  },
  errors: [],
};

assert.equal(validateCleanupEvidence(passing, { expectedRunId: "123-1" }).verified, true);
assert.equal(cleanupScenarioResult(passing, { expectedRunId: "123-1" }).status, "pass");
assert.equal(
  cleanupScenarioResult({ ...passing, marker: { ...passing.marker, retained: true } }).status,
  "fail",
);
assert.equal(
  cleanupScenarioResult({
    ...passing,
    system: { ...passing.system, activeAfter: `${system}-wrong` },
  }).status,
  "fail",
);
assert.equal(
  cleanupScenarioResult({ ...passing, formula: { ...passing.formula, installedAfter: true } })
    .status,
  "fail",
);
assert.equal(cleanupScenarioResult(passing, { expectedRunId: "different" }).status, "fail");
assert.equal(cleanupScenarioResult({ ...passing, planOnly: true }).status, "fail");
assert.equal(cleanupScenarioResult({ ...passing, status: "pass-legacy" }).status, "fail");
assert.equal(cleanupScenarioResult(null).status, "fail");

console.log("cleanup evidence self-test passed");
