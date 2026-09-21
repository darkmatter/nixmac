import { describe, expect, it } from "vitest";

import {
	computeOnboardingStep,
	hasOnboardingInferenceConfig,
} from "./onboarding";

describe("hasOnboardingInferenceConfig", () => {
	it("treats CLI providers as configured when the model is left empty for the CLI default", () => {
		expect(hasOnboardingInferenceConfig("claude", "")).toBe(true);
		expect(hasOnboardingInferenceConfig("codex", null)).toBe(true);
	});

	it("requires a non-empty model for non-CLI providers", () => {
		expect(hasOnboardingInferenceConfig("openrouter", "")).toBe(false);
		expect(hasOnboardingInferenceConfig("openrouter", "anthropic/claude-sonnet-4")).toBe(
			true,
		);
	});
});

describe("computeOnboardingStep", () => {
	it("completes onboarding when a CLI provider is selected with its default model", () => {
		expect(
			computeOnboardingStep({
				permissionsReady: true,
				nixReady: true,
				configDirReady: true,
				flakeReady: true,
				macScanned: true,
				loginDecided: true,
				hasInference: hasOnboardingInferenceConfig("claude", ""),
				buildComplete: true,
				inferenceDeferred: false,
			}),
		).toBeNull();
	});
});
