import { PROVIDER_MODEL_DEFAULTS } from "@/lib/providers/ai-defaults";
import { AI_MODEL_PROVIDERS } from "@/lib/providers/ai-models";
import { describe, expect, it } from "vitest";

describe("AI_MODEL_PROVIDERS", () => {
	it("covers every provider declared in shared/ai-defaults.json", () => {
		// The other direction (an AI_MODEL_PROVIDERS id missing from the JSON)
		// is a compile error: AiModelProviderId is derived from the JSON keys.
		const uiProviderIds = AI_MODEL_PROVIDERS.map((provider) => provider.id);

		expect(uiProviderIds.sort()).toEqual(
			Object.keys(PROVIDER_MODEL_DEFAULTS).sort(),
		);
	});
});
