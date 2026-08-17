import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./settings-dialog";

const mocks = vi.hoisted(() => ({
	clearCached: vi.fn<(_provider: string) => Promise<void>>(),
	getPrefs: vi.fn<() => Promise<null>>(),
	setPrefs: vi.fn<(_prefs: Record<string, unknown>) => Promise<void>>(),
}));

vi.mock("@/components/widget/settings/account-tab", () => ({
	AccountTab: () => null,
}));

vi.mock("@/components/widget/settings/ai-models-tab", () => ({
	AiModelsTab: () => null,
}));

vi.mock("@/components/widget/settings/api-keys-tab", () => ({
	ApiKeysTab: ({
		onSaveOpenaiCompatibleKey,
		onSaveOpenaiCompatibleUrl,
	}: {
		onSaveOpenaiCompatibleKey: (key: string) => Promise<void>;
		onSaveOpenaiCompatibleUrl: (url: string) => Promise<void>;
	}) => (
		<div>
			<button
				type="button"
				onClick={() => void onSaveOpenaiCompatibleUrl("http://localhost:8000/v1")}
			>
				Save OpenAI-compatible URL
			</button>
			<button
				type="button"
				onClick={() => void onSaveOpenaiCompatibleKey("test-token")}
			>
				Save OpenAI-compatible key
			</button>
		</div>
	),
}));

vi.mock("@/components/widget/settings/developer-tab", () => ({
	DeveloperTab: () => null,
}));

vi.mock("@/components/widget/settings/general-tab", () => ({
	GeneralTab: () => null,
}));

vi.mock("@/components/widget/settings/preferences-tab", () => ({
	PreferencesTab: () => null,
}));

vi.mock("@/components/widget/settings/tuning-tab", () => ({
	TuningTab: () => null,
}));

vi.mock("@/hooks/use-darwin-config", () => ({
	useDarwinConfig: () => ({ saveHost: vi.fn() }),
}));

vi.mock("@/ipc/api", () => ({
	tauriAPI: {
		models: {
			clearCached: mocks.clearCached,
		},
		ui: {
			getPrefs: mocks.getPrefs,
			setPrefs: mocks.setPrefs,
		},
	},
}));

vi.mock("@/router", () => ({
	nav: {
		closeSettings: vi.fn(),
	},
}));

vi.mock("@/viewmodel/preferences", () => ({
	refreshHostsSnapshot: vi.fn(),
}));

vi.mock("@nixmac/state", () => ({
	useViewModel: (selector: (state: unknown) => unknown) =>
		selector({
			hosts: [],
			preferences: {
				configDir: "/Users/test/.darwin",
				developerMode: false,
				hostAttr: "test-host",
			},
		}),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useSearch: () => ({ tab: "api-keys" }),
}));

describe("SettingsDialog OpenAI-compatible model cache invalidation", () => {
	it("clears the OpenAI-compatible model cache when endpoint settings change", async () => {
		mocks.clearCached.mockResolvedValue(undefined);
		mocks.getPrefs.mockResolvedValue(null);
		mocks.setPrefs.mockResolvedValue(undefined);

		render(<SettingsDialog />);

		fireEvent.click(screen.getByRole("button", { name: "Save OpenAI-compatible URL" }));
		fireEvent.click(screen.getByRole("button", { name: "Save OpenAI-compatible key" }));

		await waitFor(() => {
			expect(mocks.clearCached).toHaveBeenCalledWith("openai_compatible");
			expect(mocks.clearCached).toHaveBeenCalledTimes(2);
		});
		expect(mocks.clearCached).not.toHaveBeenCalledWith("vllm");
	});
});
