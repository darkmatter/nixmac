export type { InferenceConfig, InferenceMode } from "@nixmac/state";

export const NIXMAC_PROVIDER = "nixmac";
export const DEFAULT_NIXMAC_MODEL = "auto";
export const DEFAULT_NIXMAC_SUMMARY_MODEL = "flash";

/** Checkout product identifiers exposed by the billing API. */
export type CheckoutProduct = "pro" | "credits";

interface ApiKeyProviderLike {
	name: string;
	setup: {
		kind: string;
		keyPrefix?: string;
	};
}

interface InferenceProvider {
	id: string;
	name: string;
	defaultModel: string;
	prefsKeyField: "openrouterApiKey" | "openaiApiKey";
	keyPrefix: string;
	keyPlaceholder: string;
	docsHint: string;
}

/**
 * Bring-your-own-key providers, aligned to what the native backend actually
 * supports (OpenRouter + OpenAI direct). Keys persist to UiPrefs and the
 * selection is written to evolveProvider/evolveModel — exactly like the
 * Settings → AI Models tab. Local providers (Ollama/OpenAI-compatible) are configured in
 * Settings instead.
 */
export const BYOK_PROVIDERS: InferenceProvider[] = [
	{
		id: "openrouter",
		name: "OpenRouter",
		defaultModel: "anthropic/claude-sonnet-4",
		prefsKeyField: "openrouterApiKey",
		keyPrefix: "sk-or-",
		keyPlaceholder: "sk-or-v1-…",
		docsHint: "openrouter.ai → Keys",
	},
	{
		id: "openai",
		name: "OpenAI",
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
export function validateKeyFormat(
	provider: ApiKeyProviderLike,
	key: string,
): KeyValidation {
	const trimmed = key.trim();
	const keyPrefix =
		provider.setup.kind === "apiKey" ? provider.setup.keyPrefix : undefined;
	if (!trimmed) {
		return {
			valid: false,
			hint: `Paste your ${provider.name} API key to continue.`,
		};
	}
	if (keyPrefix && !trimmed.startsWith(keyPrefix)) {
		return {
			valid: false,
			hint: `${provider.name} keys start with "${keyPrefix}".`,
		};
	}
	if (trimmed.length < 20) {
		return {
			valid: false,
			hint: "That key looks too short - double-check it.",
		};
	}
	return {
		valid: true,
		hint: "Looks well-formed. We'll verify it with the provider.",
	};
}
