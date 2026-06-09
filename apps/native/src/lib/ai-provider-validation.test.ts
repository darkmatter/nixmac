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
      "No OpenRouter API key set",
    );
  });

  it("requires an OpenRouter key for the OpenRouter provider", () => {
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
    ).toBe("No OpenRouter API key set");
  });

  it("requires an OpenAI key for the OpenAI provider", () => {
    expect(
      getProviderConfigInvalidReason(
        "openai",
        { ...EMPTY_PREFS, openrouterApiKey: "sk-or-key" },
        NO_CLI_TOOLS,
      ),
    ).toBe("No OpenAI API key set");
    expect(
      getProviderConfigInvalidReason(
        "openai",
        { ...EMPTY_PREFS, openaiApiKey: "sk-openai-key" },
        NO_CLI_TOOLS,
      ),
    ).toBeNull();
  });

  it("requires explicit local model names", () => {
    expect(getProviderConfigInvalidReason("ollama", EMPTY_PREFS, NO_CLI_TOOLS, "")).toBe(
      "No model set",
    );
    expect(
      getProviderConfigInvalidReason("ollama", EMPTY_PREFS, NO_CLI_TOOLS, " local "),
    ).toBeNull();
    expect(
      getProviderConfigInvalidReason(
        "vllm",
        { ...EMPTY_PREFS, vllmApiBaseUrl: "http://localhost:8000" },
        NO_CLI_TOOLS,
        "   ",
      ),
    ).toBe("No model set");
  });
});
