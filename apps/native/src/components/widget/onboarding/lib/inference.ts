export type { InferenceConfig, InferenceMode } from "@nixmac/state";

export interface HostedPlan {
  id: string;
  name: string;
  price: string;
  blurb: string;
  recommended?: boolean;
}

export const HOSTED_PLANS: HostedPlan[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$0 + usage",
    blurb: "Pay only for what you use. Great for occasional config edits.",
    recommended: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$20/mo",
    blurb: "Higher rate limits and priority models for daily driving.",
  },
];

/** API-key fields on the app's UiPrefs that an onboarding provider maps to. */
export type PrefsKeyField = "openrouterApiKey" | "openaiApiKey";

export interface InferenceProvider {
  /** Matches the app's evolveProvider value (model-combobox ModelProvider). */
  id: "openrouter" | "openai";
  name: string;
  models: string[];
  /** Default evolve model persisted with this provider. */
  defaultModel: string;
  /** UiPrefs field the API key is written to. */
  prefsKeyField: PrefsKeyField;
  keyPrefix?: string;
  keyPlaceholder: string;
  docsHint: string;
}

/**
 * Bring-your-own-key providers, aligned to what the native backend actually
 * supports (OpenRouter + OpenAI direct). Keys persist to UiPrefs and the
 * selection is written to evolveProvider/evolveModel — exactly like the
 * Settings → AI Models tab. Local providers (Ollama/vLLM) are configured in
 * Settings instead.
 */
export const BYOK_PROVIDERS: InferenceProvider[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    models: [
      "anthropic/claude-sonnet-4",
      "anthropic/claude-opus-4",
      "openai/gpt-4o",
      "google/gemini-2.5-pro",
    ],
    defaultModel: "anthropic/claude-sonnet-4",
    prefsKeyField: "openrouterApiKey",
    keyPrefix: "sk-or-",
    keyPlaceholder: "sk-or-v1-…",
    docsHint: "openrouter.ai → Keys",
  },
  {
    id: "openai",
    name: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "o4-mini"],
    defaultModel: "gpt-4o",
    prefsKeyField: "openaiApiKey",
    keyPrefix: "sk-",
    keyPlaceholder: "sk-…",
    docsHint: "platform.openai.com → API Keys",
  },
];

export interface KeyValidation {
  valid: boolean;
  hint: string;
}

/** Lightweight client-side sanity check before the live provider check. */
export function validateKeyFormat(provider: InferenceProvider, key: string): KeyValidation {
  const trimmed = key.trim();
  if (!trimmed) {
    return { valid: false, hint: `Paste your ${provider.name} API key to continue.` };
  }
  if (provider.keyPrefix && !trimmed.startsWith(provider.keyPrefix)) {
    return { valid: false, hint: `${provider.name} keys start with “${provider.keyPrefix}”.` };
  }
  if (trimmed.length < 20) {
    return { valid: false, hint: "That key looks too short — double-check it." };
  }
  return { valid: true, hint: "Looks well-formed. We'll verify it with the provider." };
}
