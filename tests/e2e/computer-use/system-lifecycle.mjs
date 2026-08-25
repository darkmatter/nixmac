import { e2eHomebrewFormula, validateRemoteSystemSnapshot } from "./remote-stage.mjs";

export function evaluateSystemLifecycle({
  hostOriginal,
  scenarioBaseline,
  featureApplied,
  historyRestored,
  configRestored,
}) {
  try {
    const original = validateRemoteSystemSnapshot(hostOriginal, { requireFormulaAbsent: true });
    const baseline = validateRemoteSystemSnapshot(scenarioBaseline, {
      requireFormulaAbsent: true,
    });
    const feature = validateRemoteSystemSnapshot(featureApplied);
    const restored = validateRemoteSystemSnapshot(historyRestored);
    const errors = [];

    if (!feature.formulaInstalled || !feature.formulaExecutablePresent) {
      errors.push(`${e2eHomebrewFormula.name} was not installed and executable after Build & Test`);
    }
    if (!feature.activeBrewfileDeclaresFormula) {
      errors.push(`The activated Homebrew plan did not declare ${e2eHomebrewFormula.name}`);
    }
    if (!feature.formulaExecutableVersion.startsWith(e2eHomebrewFormula.versionPrefix)) {
      errors.push(`${e2eHomebrewFormula.name} returned an unexpected version`);
    }
    if (feature.activeSystem === baseline.activeSystem) {
      errors.push(
        "Build & Test did not move the active nix-darwin system off the scenario baseline",
      );
    }
    if (feature.activeBrewfileSha256 === baseline.activeBrewfileSha256) {
      errors.push("Build & Test did not change the active Homebrew plan");
    }
    if (restored.activeSystem === feature.activeSystem) {
      errors.push(
        "History restore did not activate a new nix-darwin system after the feature system",
      );
    }
    if (restored.activeBrewfileDeclaresFormula) {
      errors.push(`History restore left ${e2eHomebrewFormula.name} in the active Homebrew plan`);
    }
    if (restored.activeBrewfileSha256 !== baseline.activeBrewfileSha256) {
      errors.push(
        "History restore did not return the active Homebrew plan to the scenario baseline",
      );
    }
    if (configRestored !== true) {
      errors.push("History restore did not return the disposable config to its baseline");
    }

    return {
      status: errors.length ? "fail" : "pass",
      note: errors.length
        ? `System lifecycle proof failed: ${errors.join("; ")}.`
        : `Independent probes proved ${e2eHomebrewFormula.name} absent before Build & Test, declared by the activated Homebrew plan and installed/executable after activation, then removed from the active plan with the config and Brewfile fingerprint returned to the scenario baseline through History. Physical Homebrew cleanup remains the trusted host teardown's responsibility.`,
      checkpoints: {
        hostOriginal: original,
        scenarioBaseline: baseline,
        featureApplied: feature,
        historyRestored: restored,
      },
      configRestored,
      errors,
    };
  } catch (error) {
    return {
      status: "fail",
      note: `System lifecycle proof was invalid: ${error instanceof Error ? error.message : String(error)}`,
      checkpoints: { hostOriginal, scenarioBaseline, featureApplied, historyRestored },
      configRestored,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}
