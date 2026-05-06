import { describe, expect, it } from "vitest";

import { getProviderConfigInvalidReason } from "./ai-provider-validation";

const EMPTY_PREFS = {
  openrouterApiKey: "",
  openaiApiKey: "",
  vllmApiBaseUrl: "",
};

const NO_CLI_TOOLS = { claude: false, codex: false, opencode: false };

describe("getProviderConfigInvalidReason", () => {
  it("requires an API key for the OpenRouter provider", () => {
    expect(getProviderConfigInvalidReason("openrouter", EMPTY_PREFS, NO_CLI_TOOLS)).toBe(
      "No API key set",
    );
  });

  it("accepts either OpenRouter or OpenAI keys for OpenRouter-compatible providers", () => {
    expect(
      getProviderConfigInvalidReason(
        "openrouter",
        { ...EMPTY_PREFS, openrouterApiKey: "sk-or-key" },
        NO_CLI_TOOLS,
      ),
    ).toBeNull();
    expect(
      getProviderConfigInvalidReason(
        "openrouter",
        { ...EMPTY_PREFS, openaiApiKey: "sk-openai-key" },
        NO_CLI_TOOLS,
      ),
    ).toBeNull();
  });
});
