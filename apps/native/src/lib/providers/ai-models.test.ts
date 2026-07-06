import { describe, expect, it } from "vitest";

import { isInferenceConfigured } from "./ai-models";

describe("isInferenceConfigured", () => {
	it("treats CLI providers as configured without an explicit model", () => {
		expect(isInferenceConfigured("claude", "")).toBe(true);
		expect(isInferenceConfigured("codex", null)).toBe(true);
		expect(isInferenceConfigured("opencode", undefined)).toBe(true);
	});

	it("requires a non-empty model for non-CLI providers", () => {
		expect(isInferenceConfigured("openrouter", "")).toBe(false);
		expect(isInferenceConfigured("openai", "gpt-4o")).toBe(true);
	});
});
