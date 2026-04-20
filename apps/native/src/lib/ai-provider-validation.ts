import type { DarwinPrefs } from "@/tauri-api";

const CLI_PROVIDER_VALUES = ["claude", "codex", "opencode"] as const;

export function isCliProvider(provider: string): boolean {
  return CLI_PROVIDER_VALUES.includes(provider as (typeof CLI_PROVIDER_VALUES)[number]);
}

export function getProviderConfigInvalidReason(
  provider: string,
  prefs: Pick<DarwinPrefs, "openrouterApiKey" | "openaiApiKey" | "vllmApiBaseUrl">,
  cliStatus: Record<string, boolean>,
): string | null {
  if (isCliProvider(provider) && cliStatus[provider] === false) {
    return "CLI tool not found in PATH";
  }

  if (provider === "openai") {
    const hasOpenrouterKey = !!prefs.openrouterApiKey?.trim();
    const hasOpenaiKey = !!prefs.openaiApiKey?.trim();
    return hasOpenrouterKey || hasOpenaiKey ? null : "No API key set";
  }

  if (provider === "vllm") {
    return prefs.vllmApiBaseUrl?.trim() ? null : "No base URL set";
  }

  return null;
}