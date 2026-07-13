import type { CliToolsState, UiPrefs as DarwinPrefs } from "@/ipc/types";
import { providerModelDefaults } from "@/lib/providers/ai-defaults";

type OpenAiCompatibleProvider = "openrouter" | "openai";

function hasValue(value?: string | null): boolean {
  return Boolean(value?.trim());
}

/**
 * Providers where the backend has no runtime fallback for an empty model.
 * Everyone else falls back to a default when the model is empty: CLI
 * providers to the CLI tool's own default, the rest to their default from
 * shared/ai-defaults.json.
 */
export function providerRequiresModel(provider: string): boolean {
  return providerModelDefaults(provider).requiresModel ?? false;
}

/**
 * Whether persisted prefs describe a usable inference setup. An empty model
 * means "use the runtime default", so only providers without one require it.
 */
export function isInferenceConfigured(
  provider: string | null | undefined,
  model: string | null | undefined,
): boolean {
  if (!provider) return false;
  return !providerRequiresModel(provider) || hasValue(model);
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

  if (cliStatus != null && provider in cliStatus) {
    if (cliStatus[provider as keyof CliToolsState] === false) {
      return "CLI tool not found in PATH";
    }
  }

  if (provider === "openrouter" && !prefs.openrouterApiKey?.trim()) {
    return "No OpenRouter API key set";
  }

  if (provider === "openai" && !prefs.openaiApiKey?.trim()) {
    return "No OpenAI API key set";
  }

  if (provider === "openai_compatible" && !prefs.openaiCompatibleApiBaseUrl?.trim()) {
    return "No base URL set";
  }

  if (providerRequiresModel(provider) && !hasValue(model)) {
    return "No model set";
  }

  return null;
}
