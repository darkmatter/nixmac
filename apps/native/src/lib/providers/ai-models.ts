import type { ProviderIconId } from "@/components/widget/controls/provider-icons/provider-icon";

export const NIXMAC_PROVIDER = "nixmac";
export const DEFAULT_NIXMAC_MODEL = "openai/gpt-4o-mini";

export type AiModelProviderId =
	| "nixmac"
	| "openrouter"
	| "openai"
	| "ollama"
	| "openai_compatible"
	| "claude"
	| "codex"
	| "opencode";

export type ApiKeyPrefsField = "openrouterApiKey" | "openaiApiKey";

export interface AiModelProvider {
	id: AiModelProviderId;
	name: string;
	icon: ProviderIconId;
	defaultEvolveModel: string;
	defaultSummaryModel: string;
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

export const AI_MODEL_PROVIDERS: readonly AiModelProvider[] = [
	{
		id: NIXMAC_PROVIDER,
		name: "nixmac hosted",
		icon: "nixmac",
		defaultEvolveModel: DEFAULT_NIXMAC_MODEL,
		defaultSummaryModel: DEFAULT_NIXMAC_MODEL,
		setup: { kind: "hosted" },
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		icon: "openrouter",
		defaultEvolveModel: "anthropic/claude-sonnet-4",
		defaultSummaryModel: "openai/gpt-4o-mini",
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
		defaultEvolveModel: "gpt-4o",
		defaultSummaryModel: "gpt-4o-mini",
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
		defaultEvolveModel: "",
		defaultSummaryModel: "llama3.1",
		setup: { kind: "local" },
	},
	{
		id: "openai_compatible",
		name: "OpenAI Compatible",
		icon: "openai_compatible",
		defaultEvolveModel: "gpt-oss-120b",
		defaultSummaryModel: "gpt-oss-120b",
		setup: {
			kind: "baseUrl",
			prefsBaseUrlField: "openaiCompatibleApiBaseUrl",
			prefsKeyField: "openaiCompatibleApiKey",
			baseUrlPlaceholder: "http://localhost:8000/v1",
			keyPlaceholder: "Optional bearer token",
			docsHint: "Your OpenAI-compatible /v1 endpoint.",
		},
	},
	{
		id: "claude",
		name: "Claude CLI",
		icon: "claude",
		defaultEvolveModel: "",
		defaultSummaryModel: "",
		setup: { kind: "cli", plainModelInput: true },
	},
	{
		id: "codex",
		name: "Codex CLI",
		icon: "codex",
		defaultEvolveModel: "",
		defaultSummaryModel: "",
		setup: { kind: "cli", plainModelInput: true },
	},
	{
		id: "opencode",
		name: "OpenCode CLI",
		icon: "opencode",
		defaultEvolveModel: "",
		defaultSummaryModel: "",
		setup: { kind: "cli", plainModelInput: false },
	},
];

export const BYOK_MODEL_PROVIDERS = AI_MODEL_PROVIDERS.filter(
	(provider) => provider.setup.kind !== "hosted",
);

export const DEFAULT_EVOLVE_MODEL: Record<string, string> = Object.fromEntries(
	AI_MODEL_PROVIDERS.map((provider) => [
		provider.id,
		provider.defaultEvolveModel,
	]),
);

export const DEFAULT_SUMMARY_MODEL: Record<string, string> = Object.fromEntries(
	AI_MODEL_PROVIDERS.map((provider) => [
		provider.id,
		provider.defaultSummaryModel,
	]),
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

export function modelPlaceholder(provider: string, fallback: string): string {
	const config = getAiModelProvider(provider);
	if (config.id === NIXMAC_PROVIDER) {
		return DEFAULT_NIXMAC_MODEL;
	}
	if (config.id === "openai") {
		return fallback;
	}
	if (config.id === "ollama") {
		return fallback === "gpt-4o" ? "" : "llama3.1";
	}
	if (config.id === "openai_compatible") {
		return "gpt-oss-120b";
	}
	if (config.id === "opencode" || config.setup.kind === "cli") {
		return "Leave empty for CLI default";
	}
	return fallback === "gpt-4o"
		? "anthropic/claude-sonnet-4"
		: "openai/gpt-4o-mini";
}
