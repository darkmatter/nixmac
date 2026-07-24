// Shared Product Proof schema constants.
// Keep this file side-effect free: no filesystem, network, or Computer Use calls.

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

export const scenarioContractVersion = 3;

export const v1GradeToEvidenceStrength = freezeDeep({
  "action-confirmed": "operational",
  "text-confirmed": "visual-supported",
  "guardrail-confirmed": "operational",
  "manifest-confirmed": "operational",
  calibration: "weak",
  "not-run": "not-proved",
  insufficient: "not-proved",
});

export const failureTaxonomy = freezeDeep({
  app: "The app UI/state did not behave as expected.",
  provider: "The real provider returned a billing, rate-limit, timeout, or model error.",
  credential:
    "A provider key was missing, invalid, unavailable, or not injected into the launched app process.",
  remote_infra:
    "DXU, SSH, launchd, app-server, macOS permissions, or remote activation infrastructure blocked the run.",
  harness:
    "Computer Use actions, artifact generation, report rendering, or runner bookkeeping failed.",
  coverage: "The suite lacks a scenario, manifest mapping, PR focus, or waiver for the behavior.",
  inconclusive: "The runner could not prove either pass or fail.",
});
