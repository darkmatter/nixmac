import type { CliToolsState, UiPrefs as DarwinPrefs } from "@/ipc/types";

const CLI_PROVIDER_VALUES = ["claude", "codex", "opencode"] as const;

type OpenAiCompatibleProvider = "openrouter" | "openai";

function hasValue(value?: string | null): boolean {
  return Boolean(value?.trim());
}

export function isCliProvider(provider: string): boolean {
  return CLI_PROVIDER_VALUES.includes(provider as (typeof CLI_PROVIDER_VALUES)[number]);
}

/**
 * Whether persisted prefs describe a usable inference setup. CLI providers
 * (claude/codex/opencode) accept an optional model — an empty model means
 * "use the CLI's own default" — so only non-CLI providers require a model.
 */
export function isInferenceConfigured(
  provider: string | null | undefined,
  model: string | null | undefined,
): boolean {
  if (!provider) return false;
  return isCliProvider(provider) || hasValue(model);
}

export function resolveOpenAiCompatibleProvider(
  provider: string | null | undefined,
  prefs: Pick<DarwinPrefs, "openrouterApiKey" | "openaiApiKey">,
): string {
  if (provider != null) {
    return provider;
  }

  if (hasValue(prefs.openaiApiKey) && !hasValue(prefs.openrouterApiKey)) {
    return "openai" satisfies OpenAiCompatibleProvider;
  }

  return "openrouter" satisfies OpenAiCompatibleProvider;
}

export function getProviderConfigInvalidReason(
  provider: string | null | undefined,
  prefs: Pick<DarwinPrefs, "openrouterApiKey" | "openaiApiKey" | "openaiCompatibleApiBaseUrl">,
  cliStatus: CliToolsState | null | undefined,
  model?: string | null,
): string | null {
  provider = resolveOpenAiCompatibleProvider(provider, prefs);

  if (isCliProvider(provider) && cliStatus != null) {
    const key = provider as keyof CliToolsState;
    if (cliStatus[key] === false) {
      return "CLI tool not found in PATH";
    }
  }

  if (provider === "nixmac") {
    return null;
  }

  if (provider === "openrouter") {
    return prefs.openrouterApiKey?.trim() ? null : "No OpenRouter API key set";
  }

  if (provider === "openai") {
    return prefs.openaiApiKey?.trim() ? null : "No OpenAI API key set";
  }

  if (provider === "openai_compatible") {
    if (!prefs.openaiCompatibleApiBaseUrl?.trim()) {
      return "No base URL set";
    }
    return model?.trim() ? null : "No model set";
  }

  if (provider === "ollama") {
    return model?.trim() ? null : "No model set";
  }

  return null;
}
