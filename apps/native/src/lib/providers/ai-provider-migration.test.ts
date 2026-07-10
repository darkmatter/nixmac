import type { UiPrefs } from "@/ipc/types";
import { migrateLegacyOpenaiProviderPrefs } from "@/lib/providers/ai-provider-migration";
import { describe, expect, it } from "vitest";

const PREFS: UiPrefs = {
	openrouterApiKey: "",
	openaiApiKey: "",
	ollamaApiBaseUrl: "",
	openaiCompatibleApiBaseUrl: "",
	openaiCompatibleApiKey: "",
	summaryProvider: "openrouter",
	summaryModel: "openai/gpt-oss-120b",
	evolveProvider: "openrouter",
	evolveModel: "~anthropic/claude-sonnet-latest",
	maxIterations: null,
	maxTokenBudget: null,
	maxBuildAttempts: null,
	maxOutputTokens: null,
	sendDiagnostics: false,
	confirmBuild: false,
	confirmClear: false,
	confirmRollback: false,
	autoSummarizeOnFocus: false,
	scanHomebrewOnStartup: false,
	defaultToDiffTab: false,
	developerMode: false,
	experimentalSpinningMascot: false,
	pinnedVersion: null,
	updateChannel: "stable",
	featureFlagOverrides: null,
	autoFormatNixFiles: false,
};

describe("migrateLegacyOpenaiProviderPrefs", () => {
	it("preserves OpenRouter model slugs when migrating legacy openai provider prefs", () => {
		const result = migrateLegacyOpenaiProviderPrefs({
			...PREFS,
			openrouterApiKey: "sk-or-key",
			openaiApiKey: "",
			evolveProvider: "openai",
			evolveModel: "google/gemini-2.5-pro",
			summaryProvider: "openai",
			summaryModel: "anthropic/claude-3.5-haiku",
		});

		expect(result.values).toEqual({
			evolveProvider: "openrouter",
			evolveModel: "google/gemini-2.5-pro",
			summaryProvider: "openrouter",
			summaryModel: "anthropic/claude-3.5-haiku",
		});
		expect(result.update).toEqual({
			evolveProvider: "openrouter",
			summaryProvider: "openrouter",
		});
	});

	it("uses OpenRouter defaults when migrated legacy openai models are bare or missing", () => {
		const result = migrateLegacyOpenaiProviderPrefs({
			...PREFS,
			openrouterApiKey: "sk-or-key",
			openaiApiKey: "",
			evolveProvider: "openai",
			evolveModel: "gpt-4o",
			summaryProvider: "openai",
			summaryModel: " ",
		});

		expect(result.values).toEqual({
			evolveProvider: "openrouter",
			evolveModel: "~anthropic/claude-sonnet-latest",
			summaryProvider: "openrouter",
			summaryModel: "openai/gpt-oss-120b",
		});
		expect(result.update).toEqual(result.values);
	});

	it("preserves legacy OpenRouter slugs when both OpenRouter and OpenAI keys exist", () => {
		const result = migrateLegacyOpenaiProviderPrefs({
			...PREFS,
			openrouterApiKey: "sk-or-key",
			openaiApiKey: "sk-openai-key",
			evolveProvider: "openai",
			evolveModel: "~anthropic/claude-sonnet-latest",
			summaryProvider: "openai",
			summaryModel: "gpt-4o-mini",
		});

		expect(result.values).toEqual({
			evolveProvider: "openrouter",
			evolveModel: "~anthropic/claude-sonnet-latest",
			summaryProvider: "openai",
			summaryModel: "gpt-4o-mini",
		});
		expect(result.update).toEqual({
			evolveProvider: "openrouter",
		});
	});

	it("keeps direct openai prefs when both keys exist with a bare OpenAI model", () => {
		const result = migrateLegacyOpenaiProviderPrefs({
			...PREFS,
			openrouterApiKey: "sk-or-key",
			openaiApiKey: "sk-openai-key",
			evolveProvider: "openai",
			evolveModel: "gpt-4o",
		});

		expect(result.values.evolveProvider).toBe("openai");
		expect(result.values.evolveModel).toBe("gpt-4o");
		expect(result.update).toBeNull();
	});

	it("keeps direct openai prefs when both keys exist without a model", () => {
		const result = migrateLegacyOpenaiProviderPrefs({
			...PREFS,
			openrouterApiKey: "sk-or-key",
			openaiApiKey: "sk-openai-key",
			summaryProvider: "openai",
			summaryModel: "",
		});

		expect(result.values.summaryProvider).toBe("openai");
		expect(result.values.summaryModel).toBe("");
		expect(result.update).toBeNull();
	});
});
