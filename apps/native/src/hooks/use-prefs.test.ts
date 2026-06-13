import { describe, expect, it } from "vitest";

import type { UiPrefs } from "@/ipc/types";

import { hasConfiguredAiProvider } from "./use-prefs";

const basePrefs = {
  openrouterApiKey: "",
  openaiApiKey: "",
  vllmApiBaseUrl: "",
  evolveProvider: "openrouter",
  evolveModel: "anthropic/claude-sonnet-4",
  summaryProvider: "openrouter",
  summaryModel: "openai/gpt-4o-mini",
} as UiPrefs;

describe("hasConfiguredAiProvider", () => {
  it("requires both evolution and summary providers to be configured", () => {
    expect(
      hasConfiguredAiProvider({
        ...basePrefs,
        evolveProvider: "ollama",
        evolveModel: "llama3.1",
      }),
    ).toBe(false);

    expect(
      hasConfiguredAiProvider({
        ...basePrefs,
        openrouterApiKey: "sk-or-valid",
        evolveProvider: "ollama",
        evolveModel: "llama3.1",
      }),
    ).toBe(true);
  });

  it("requires role-specific models for local providers", () => {
    expect(
      hasConfiguredAiProvider({
        ...basePrefs,
        evolveProvider: "vllm",
        evolveModel: "gpt-oss-120b",
        summaryProvider: "vllm",
        summaryModel: "",
        vllmApiBaseUrl: "http://localhost:8000/v1",
      }),
    ).toBe(false);

    expect(
      hasConfiguredAiProvider({
        ...basePrefs,
        evolveProvider: "vllm",
        evolveModel: "gpt-oss-120b",
        summaryProvider: "vllm",
        summaryModel: "gpt-oss-120b",
        vllmApiBaseUrl: "http://localhost:8000/v1",
      }),
    ).toBe(true);
  });
});
