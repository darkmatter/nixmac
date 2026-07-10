import aiDefaults from "../../../shared/ai-defaults.json";

/** Derived from the JSON keys, so provider renames there surface as type errors here. */
export type AiProviderId = keyof typeof aiDefaults.providers;

export interface ProviderModelDefaults {
	evolveModel: string;
	summaryModel: string;
	/** Static picker suggestions; providers without this fetch their list dynamically. */
	suggestedModels?: string[];
}

/** Per-provider default models, loaded from shared/ai-defaults.json (also embedded by the Rust backend). */
export const PROVIDER_MODEL_DEFAULTS: Record<string, ProviderModelDefaults> =
	aiDefaults.providers;

const EMPTY_DEFAULTS: ProviderModelDefaults = {
	evolveModel: "",
	summaryModel: "",
};

export function providerModelDefaults(
	providerId: string,
): ProviderModelDefaults {
	return PROVIDER_MODEL_DEFAULTS[providerId] ?? EMPTY_DEFAULTS;
}

export function suggestedModels(providerId: string): string[] {
	return providerModelDefaults(providerId).suggestedModels ?? [];
}
