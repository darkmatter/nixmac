import { shouldPromptForHostedModelAuth, useHostedModelAuthGuard } from "@/hooks/use-hosted-model-auth-guard";
import { makeCompletedOnboardingState, makeGlobalPreferences } from "@/utils/test-fixtures";
import { viewModelActions } from "@nixmac/state";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { accountStatus, openSettings } = vi.hoisted(() => ({
	accountStatus: vi.fn<() => Promise<{ signedIn: boolean }>>(),
	openSettings: vi.fn<(tab: string, prompt: string) => void>(),
}));

vi.mock("@/lib/orpc", () => ({
	client: {
		account: {
			status: accountStatus,
		},
	},
}));

vi.mock("@/router", () => ({
	nav: {
		openSettings,
	},
}));

describe("useHostedModelAuthGuard", () => {
	beforeEach(() => {
		accountStatus.mockReset();
		openSettings.mockReset();
		accountStatus.mockResolvedValue({ signedIn: false });
		viewModelActions.setState({
			hydrated: true,
			onboardingState: makeCompletedOnboardingState(),
			preferences: makeGlobalPreferences({ evolveProvider: "nixmac" }),
		});
	});

	it("prompts logged-out users with hosted inference selected", async () => {
		renderHook(() => useHostedModelAuthGuard());

		await waitFor(() => {
			expect(openSettings).toHaveBeenCalledWith("ai-models", "hosted-auth");
		});
	});

	it("does not prompt signed-in users", async () => {
		accountStatus.mockResolvedValue({ signedIn: true });
		renderHook(() => useHostedModelAuthGuard());

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(openSettings).not.toHaveBeenCalled();
	});

	it("only prompts when hosted inference is selected", () => {
		expect(
			shouldPromptForHostedModelAuth(
				{ evolveProvider: "openrouter", summaryProvider: "ollama" },
				{ signedIn: false },
			),
		).toBe(false);
	});
});
