import assert from "node:assert/strict";
import { evaluateSystemLifecycle } from "./system-lifecycle.mjs";

const pathFor = (letter, suffix) => `/nix/store/${letter.repeat(32)}-darwin-system-${suffix}`;
const brewfileFor = (letter) => `/nix/store/${letter.repeat(32)}-Brewfile`;
const snapshot = (
  activeSystem,
  { installed = false, declared = installed, brewfileHash = "0".repeat(64) } = {},
) => ({
  version: 2,
  formula: "hello",
  brewPath: "/opt/homebrew/bin/brew",
  formulaExecutable: "/opt/homebrew/bin/hello",
  formulaInstalled: installed,
  formulaVersion: installed ? "hello 2.12.3" : "",
  formulaExecutablePresent: installed,
  formulaExecutableVersion: installed ? "hello (GNU Hello) 2.12.3" : "",
  activeBrewfile: brewfileFor(declared ? "c" : "b"),
  activeBrewfileSha256: brewfileHash,
  activeBrewfileDeclaresFormula: declared,
  activeSystem,
  profileStore: activeSystem,
  profilePath: "/nix/var/nix/profiles/system",
  nixEnvPath: "/nix/var/nix/profiles/default/bin/nix-env",
});

const original = snapshot(pathFor("a", "original"));
const baseline = snapshot(pathFor("b", "baseline"));
const feature = snapshot(pathFor("c", "feature"), {
  installed: true,
  brewfileHash: "1".repeat(64),
});
const history = snapshot(pathFor("d", "history"), { installed: true, declared: false });

assert.equal(
  evaluateSystemLifecycle({
    hostOriginal: original,
    scenarioBaseline: baseline,
    featureApplied: feature,
    historyRestored: history,
    configRestored: true,
  }).status,
  "pass",
);
assert.equal(
  evaluateSystemLifecycle({
    hostOriginal: original,
    scenarioBaseline: baseline,
    featureApplied: feature,
    historyRestored: snapshot(baseline.activeSystem, { installed: true, declared: false }),
    configRestored: true,
  }).status,
  "pass",
  "a deterministic History rebuild may reuse the baseline system path when plan and config proof match",
);
assert.equal(
  evaluateSystemLifecycle({
    hostOriginal: original,
    scenarioBaseline: baseline,
    featureApplied: snapshot(pathFor("c", "feature"), {
      installed: true,
      declared: false,
    }),
    historyRestored: history,
    configRestored: true,
  }).status,
  "fail",
);
assert.equal(
  evaluateSystemLifecycle({
    hostOriginal: original,
    scenarioBaseline: baseline,
    featureApplied: feature,
    historyRestored: snapshot(pathFor("a", "wrong"), {
      installed: true,
      declared: false,
      brewfileHash: "2".repeat(64),
    }),
    configRestored: true,
  }).status,
  "fail",
);
const sameFeatureSystem = evaluateSystemLifecycle({
  hostOriginal: original,
  scenarioBaseline: baseline,
  featureApplied: feature,
  historyRestored: snapshot(feature.activeSystem, { installed: true }),
  configRestored: true,
});
assert.equal(sameFeatureSystem.status, "fail");
assert.equal(
  sameFeatureSystem.errors.includes(
    "History restore did not activate a new nix-darwin system after the feature system",
  ),
  true,
  "the realistic same-feature snapshot must exercise the specific non-transition assertion",
);
assert.equal(
  evaluateSystemLifecycle({
    hostOriginal: original,
    scenarioBaseline: baseline,
    featureApplied: feature,
    historyRestored: snapshot(pathFor("a", "wrong-plan"), {
      installed: true,
      declared: true,
      brewfileHash: "1".repeat(64),
    }),
    configRestored: true,
  }).status,
  "fail",
);
assert.equal(
  evaluateSystemLifecycle({
    hostOriginal: original,
    scenarioBaseline: baseline,
    featureApplied: feature,
    historyRestored: history,
    configRestored: false,
  }).status,
  "fail",
);

console.log("system lifecycle self-test passed");
