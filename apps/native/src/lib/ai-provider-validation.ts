import type { CliToolsState, UiPrefs as DarwinPrefs } from "@/ipc/types";

const CLI_PROVIDER_VALUES = ["claude", "codex", "opencode"] as const;

export function isCliProvider(provider: string): boolean {
  return CLI_PROVIDER_VALUES.includes(provider as (typeof CLI_PROVIDER_VALUES)[number]);
}

export function getProviderConfigInvalidReason(
  provider: string,
  prefs: Pick<DarwinPrefs, "openrouterApiKey" | "openaiApiKey" | "vllmApiBaseUrl">,
  cliStatus: CliToolsState | null | undefined,
  model?: string | null,
): string | null {
  if (isCliProvider(provider) && cliStatus != null) {
    const key = provider as keyof CliToolsState;
    if (cliStatus[key] === false) {
      return "CLI tool not found in PATH";
    }
  }

  if (provider === "openrouter") {
    return prefs.openrouterApiKey?.trim() ? null : "No OpenRouter API key set";
  }

  if (provider === "openai") {
    return prefs.openaiApiKey?.trim() ? null : "No OpenAI API key set";
  }

  if (provider === "vllm") {
    if (!prefs.vllmApiBaseUrl?.trim()) {
      return "No base URL set";
    }
    return model?.trim() ? null : "No model set";
  }

  if (provider === "ollama") {
    return model?.trim() ? null : "No model set";
  }

  return null;
}
