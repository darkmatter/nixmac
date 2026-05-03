import { describe, expect, it } from "vitest";

import { getProviderConfigInvalidReason } from "./ai-provider-validation";

const EMPTY_PREFS = {
  openrouterApiKey: "",
  openaiApiKey: "",
  vllmApiBaseUrl: "",
};

describe("getProviderConfigInvalidReason", () => {
  it("requires an API key for the OpenRouter provider", () => {
    expect(getProviderConfigInvalidReason("openrouter", EMPTY_PREFS, {})).toBe(
      "No API key set",
    );
  });

  it("accepts either OpenRouter or OpenAI keys for OpenRouter-compatible providers", () => {
    expect(
      getProviderConfigInvalidReason(
        "openrouter",
        { ...EMPTY_PREFS, openrouterApiKey: "sk-or-key" },
        {},
      ),
    ).toBeNull();
    expect(
      getProviderConfigInvalidReason(
        "openrouter",
        { ...EMPTY_PREFS, openaiApiKey: "sk-openai-key" },
        {},
      ),
    ).toBeNull();
    expect(
      getProviderConfigInvalidReason(
        "openai",
        { ...EMPTY_PREFS, openaiApiKey: "sk-openai-key" },
        {},
      ),
    ).toBeNull();
  });
});
