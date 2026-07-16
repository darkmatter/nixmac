import type { ProviderIconId } from "@/components/widget/controls/provider-icons/provider-icon";
import {
	type AiProviderId,
	providerModelDefaults,
} from "@/lib/providers/ai-defaults";
import { providerRequiresModel } from "@/lib/providers/ai-provider-validation";

const NIXMAC_PROVIDER = "nixmac";

type AiModelProviderId = AiProviderId;

type ApiKeyPrefsField = "openrouterApiKey" | "openaiApiKey";

interface AiModelProvider {
	id: AiModelProviderId;
	name: string;
	icon: ProviderIconId;
	defaultEvolveModel: string;
	defaultSummaryModel: string;
	/** Hidden from provider pickers unless the `cli-providers` flag enables them. */
	developerOnly?: boolean;
	setup:
		| { kind: "hosted" }
		| {
				kind: "apiKey";
				prefsKeyField: ApiKeyPrefsField;
				keyPrefix?: string;
				keyPlaceholder: string;
				docsHint: string;
		  }
		| {
				kind: "baseUrl";
				prefsBaseUrlField: "openaiCompatibleApiBaseUrl";
				prefsKeyField?: "openaiCompatibleApiKey";
				baseUrlPlaceholder: string;
				keyPlaceholder?: string;
				docsHint: string;
		  }
		| { kind: "local" }
		| { kind: "cli"; plainModelInput: boolean };
}

function modelDefaults(id: AiModelProviderId): {
	defaultEvolveModel: string;
	defaultSummaryModel: string;
} {
	const defaults = providerModelDefaults(id);
	return {
		defaultEvolveModel: defaults.evolveModel,
		defaultSummaryModel: defaults.summaryModel,
	};
}

export const AI_MODEL_PROVIDERS: readonly AiModelProvider[] = [
	{
		id: NIXMAC_PROVIDER,
		name: "nixmac hosted",
		icon: "nixmac",
		...modelDefaults(NIXMAC_PROVIDER),
		setup: { kind: "hosted" },
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		icon: "openrouter",
		...modelDefaults("openrouter"),
		setup: {
			kind: "apiKey",
			prefsKeyField: "openrouterApiKey",
			keyPrefix: "sk-or-",
			keyPlaceholder: "sk-or-v1-...",
			docsHint: "openrouter.ai -> Keys",
		},
	},
	{
		id: "openai",
		name: "OpenAI",
		icon: "openai",
		...modelDefaults("openai"),
		setup: {
			kind: "apiKey",
			prefsKeyField: "openaiApiKey",
			keyPrefix: "sk-",
			keyPlaceholder: "sk-...",
			docsHint: "platform.openai.com -> API Keys",
		},
	},
	{
		id: "ollama",
		name: "Ollama",
		icon: "ollama",
		...modelDefaults("ollama"),
		setup: { kind: "local" },
	},
	{
		id: "openai_compatible",
		name: "OpenAI Compatible",
		icon: "openai_compatible",
		...modelDefaults("openai_compatible"),
		setup: {
			kind: "baseUrl",
			prefsBaseUrlField: "openaiCompatibleApiBaseUrl",
			prefsKeyField: "openaiCompatibleApiKey",
			baseUrlPlaceholder: "http://localhost:8000/v1",
			keyPlaceholder: "Optional bearer token",
			docsHint: "Your OpenAI-compatible /v1 endpoint.",
		},
	},
	// CLI providers don't currently work; hidden unless the `cli-providers` flag enables them.
	{
		id: "claude",
		name: "Claude CLI",
		icon: "claude",
		...modelDefaults("claude"),
		setup: { kind: "cli", plainModelInput: true },
		developerOnly: true,
	},
	{
		id: "codex",
		name: "Codex CLI",
		icon: "codex",
		...modelDefaults("codex"),
		setup: { kind: "cli", plainModelInput: true },
		developerOnly: true,
	},
	{
		id: "opencode",
		name: "OpenCode CLI",
		icon: "opencode",
		...modelDefaults("opencode"),
		setup: { kind: "cli", plainModelInput: false },
		developerOnly: true,
	},
];

/**
 * Providers to show in a picker: developer-only providers are hidden unless
 * the `cli-providers` feature flag enables them (see useCliProvidersVisible)
 * or one is already selected (so the picker stays valid).
 */
export function visibleModelProviders(
	showDeveloperOnly: boolean,
	selectedId?: string,
	providers: readonly AiModelProvider[] = AI_MODEL_PROVIDERS,
): readonly AiModelProvider[] {
	return providers.filter(
		(provider) =>
			!provider.developerOnly ||
			showDeveloperOnly ||
			provider.id === selectedId,
	);
}

export const BYOK_MODEL_PROVIDERS = AI_MODEL_PROVIDERS.filter(
	(provider) => provider.setup.kind !== "hosted",
);

export function getAiModelProvider(id: string): AiModelProvider {
	return (
		AI_MODEL_PROVIDERS.find((provider) => provider.id === id) ??
		AI_MODEL_PROVIDERS[0]
	);
}

export function isPlainInputCliProvider(provider: string): boolean {
	const setup = getAiModelProvider(provider).setup;
	return setup.kind === "cli" && setup.plainModelInput;
}

// Remembered model for a provider from the per-provider prefs map; "" means
// "track the provider default".
export function modelForProvider(
	models: Partial<Record<string, string>>,
	provider: string | null | undefined,
): string {
	return (provider && models[provider]) || "";
}

// The placeholder describes what an empty field means at runtime: providers
// with a fallback name it explicitly; providers that require a model get a
// plain prompt.
export function modelPlaceholder(
	provider: string,
	kind: "evolve" | "summary",
): string {
	const config = getAiModelProvider(provider);
	if (config.setup.kind === "cli") {
		return "Leave empty for CLI default";
	}
	if (providerRequiresModel(provider)) {
		return "Select model...";
	}
	const defaultModel =
		kind === "evolve" ? config.defaultEvolveModel : config.defaultSummaryModel;
	return defaultModel ? `Default: ${defaultModel}` : "Select model...";
}
