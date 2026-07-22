import { describe, expect, it } from "vitest";
import {
  computeOnboardingStep,
  resolveOnboardingStep,
  type OnboardingStepInputs,
} from "./onboarding";

/** All gates satisfied; tests unset the one(s) under scrutiny. */
const complete: OnboardingStepInputs = {
  permissionsReady: true,
  nixReady: true,
  homebrewReady: true,
  homebrewSkipped: false,
  configDirReady: true,
  flakeReady: true,
  macScanned: true,
  loginDecided: true,
  hasInference: true,
  buildComplete: true,
  inferenceDeferred: false,
};

describe("computeOnboardingStep", () => {
  it("returns null when every gate is satisfied", () => {
    expect(computeOnboardingStep(complete)).toBeNull();
  });

  it("returns the first unsatisfied gate in step order", () => {
    expect(computeOnboardingStep({ ...complete, permissionsReady: false })).toBe("permissions");
    expect(computeOnboardingStep({ ...complete, nixReady: false })).toBe("nix-setup");
    expect(computeOnboardingStep({ ...complete, homebrewReady: false })).toBe("homebrew-setup");
    expect(computeOnboardingStep({ ...complete, configDirReady: false })).toBe("config-dir");
    expect(computeOnboardingStep({ ...complete, flakeReady: false })).toBe("setup");
    expect(computeOnboardingStep({ ...complete, macScanned: false })).toBe("customizations");
    expect(computeOnboardingStep({ ...complete, loginDecided: false })).toBe("inference");
    expect(computeOnboardingStep({ ...complete, buildComplete: false })).toBe("build");
  });

  it("an earlier unsatisfied gate wins over later ones", () => {
    expect(
      computeOnboardingStep({
        ...complete,
        configDirReady: false,
        macScanned: false,
        buildComplete: false,
      }),
    ).toBe("config-dir");
  });

  it("resetting the durable onboarding facts rewinds to config-dir", () => {
    // What onboarding.reset produces: system gates stay satisfied, everything
    // the backend clears derives unsatisfied.
    expect(
      computeOnboardingStep({
        ...complete,
        configDirReady: false,
        flakeReady: false,
        macScanned: false,
        loginDecided: false,
        buildComplete: false,
      }),
    ).toBe("config-dir");
  });

  it("requires both login decision and a resolved provider for inference", () => {
    expect(computeOnboardingStep({ ...complete, hasInference: false })).toBe("inference");
    expect(computeOnboardingStep({ ...complete, loginDecided: false, hasInference: false })).toBe(
      "inference",
    );
  });

  it("deferring inference moves it into the build step", () => {
    const deferred = {
      ...complete,
      loginDecided: false,
      hasInference: false,
      inferenceDeferred: true,
    };
    expect(computeOnboardingStep(deferred)).toBe("build");
    // The build gate stays unsatisfied until inference resolves, even after
    // a successful build.
    expect(computeOnboardingStep({ ...deferred, buildComplete: true })).toBe("build");
  });

  it("skipping the optional Homebrew step advances past it", () => {
    expect(
      computeOnboardingStep({
        ...complete,
        homebrewReady: false,
        homebrewSkipped: true,
        configDirReady: false,
      }),
    ).toBe("config-dir");
  });
});

describe("resolveOnboardingStep", () => {
  it("renders the furthest gate when not back-navigating", () => {
    expect(resolveOnboardingStep("customizations", null)).toBe("customizations");
  });

  it("renders an earlier step the user navigated back to", () => {
    expect(resolveOnboardingStep("customizations", "config-dir")).toBe("config-dir");
  });

  it("never renders past the furthest gate", () => {
    expect(resolveOnboardingStep("config-dir", "build")).toBe("config-dir");
  });
});
