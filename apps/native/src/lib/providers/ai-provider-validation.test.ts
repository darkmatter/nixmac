import { describe, expect, it } from "vitest";

import {
  getProviderConfigInvalidReason,
  isInferenceConfigured,
  resolveOpenAiCompatibleProvider,
} from "./ai-provider-validation";

const EMPTY_PREFS = {
  openrouterApiKey: "",
  openaiApiKey: "",
  openaiCompatibleApiBaseUrl: "",
};

const NO_CLI_TOOLS = { claude: false, codex: false, opencode: false };

describe("isInferenceConfigured", () => {
  it("accepts CLI providers without a model (empty means CLI default)", () => {
    expect(isInferenceConfigured("codex", "")).toBe(true);
    expect(isInferenceConfigured("claude", null)).toBe(true);
    expect(isInferenceConfigured("opencode", undefined)).toBe(true);
  });

  it("requires a model for non-CLI providers", () => {
    expect(isInferenceConfigured("openrouter", "")).toBe(false);
    expect(isInferenceConfigured("openrouter", "   ")).toBe(false);
    expect(isInferenceConfigured("openrouter", "openai/gpt-4o-mini")).toBe(true);
    expect(isInferenceConfigured("nixmac", "openai/gpt-4o-mini")).toBe(true);
  });

  it("requires a provider", () => {
    expect(isInferenceConfigured(null, "openai/gpt-4o-mini")).toBe(false);
    expect(isInferenceConfigured(undefined, undefined)).toBe(false);
  });
});

describe("getProviderConfigInvalidReason", () => {
  it("accepts nixmac hosted inference without BYOK credentials", () => {
    expect(
      getProviderConfigInvalidReason("nixmac", EMPTY_PREFS, NO_CLI_TOOLS, "openai/gpt-4o-mini"),
    ).toBeNull();
  });

  it("resolves an unconfigured provider to OpenAI only when only an OpenAI key exists", () => {
    expect(
      resolveOpenAiCompatibleProvider(null, {
        ...EMPTY_PREFS,
        openaiApiKey: "sk-openai-key",
      }),
    ).toBe("openai");

    expect(
      resolveOpenAiCompatibleProvider(undefined, {
        ...EMPTY_PREFS,
        openrouterApiKey: "sk-or-key",
        openaiApiKey: "sk-openai-key",
      }),
    ).toBe("openrouter");

    expect(resolveOpenAiCompatibleProvider("openai", EMPTY_PREFS)).toBe("openai");
  });

  it("validates an unconfigured provider against the resolved credential default", () => {
    expect(
      getProviderConfigInvalidReason(
        null,
        { ...EMPTY_PREFS, openaiApiKey: "sk-openai-key" },
        NO_CLI_TOOLS,
      ),
    ).toBeNull();
    expect(
      getProviderConfigInvalidReason(
        null,
        {
          ...EMPTY_PREFS,
          openrouterApiKey: "sk-or-key",
          openaiApiKey: "sk-openai-key",
        },
        NO_CLI_TOOLS,
      ),
    ).toBeNull();
    expect(
      getProviderConfigInvalidReason(
        undefined,
        { ...EMPTY_PREFS, openaiApiKey: "sk-openai-key" },
        NO_CLI_TOOLS,
      ),
    ).toBeNull();
  });

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
        "openai_compatible",
        { ...EMPTY_PREFS, openaiCompatibleApiBaseUrl: "http://localhost:8000" },
        NO_CLI_TOOLS,
        "   ",
      ),
    ).toBe("No model set");
  });
});
