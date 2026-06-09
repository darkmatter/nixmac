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
  it("migrates legacy openai provider prefs to OpenRouter when only an OpenRouter key exists", () => {
    const result = migrateLegacyOpenaiProviderPrefs({
      ...PREFS,
      openrouterApiKey: "sk-or-key",
      openaiApiKey: "",
      evolveProvider: "openai",
      evolveModel: "gpt-4o",
      summaryProvider: "openai",
      summaryModel: "gpt-4o-mini",
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
