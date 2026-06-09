import { describe, expect, it } from "vitest";
import type { UiPrefs } from "@/ipc/types";
import { migrateLegacyOpenaiProviderPrefs } from "@/lib/ai-provider-migration";

const PREFS: UiPrefs = {
  openrouterApiKey: "",
  openaiApiKey: "",
  ollamaApiBaseUrl: "",
  vllmApiBaseUrl: "",
  vllmApiKey: "",
  summaryProvider: "openrouter",
  summaryModel: "openai/gpt-4o-mini",
  evolveProvider: "openrouter",
  evolveModel: "anthropic/claude-sonnet-4",
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
  pinnedVersion: null,
  updateChannel: "stable",
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
      evolveModel: "anthropic/claude-sonnet-4",
      summaryProvider: "openrouter",
      summaryModel: "openai/gpt-4o-mini",
    });
    expect(result.update).toEqual(result.values);
  });

  it("keeps direct openai prefs when an OpenAI key exists", () => {
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
});
