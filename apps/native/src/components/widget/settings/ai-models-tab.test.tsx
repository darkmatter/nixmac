import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiModelsTab } from "./ai-models-tab";

vi.mock("@/components/ui/input", () => ({
	Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
	SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock("@/components/widget/controls/model-combobox", () => ({
	ModelCombobox: () => <div>Model combobox</div>,
}));

vi.mock("@/components/widget/controls/provider-icons/provider-icon", () => ({
	ProviderIcon: () => null,
}));

vi.mock("@/ipc/api", () => ({
	tauriAPI: {
		cli: {
			checkTools: vi.fn(() => new Promise(() => {})),
		},
		models: {
			clearCached: vi.fn().mockResolvedValue(undefined),
		},
		ui: {
			setPrefs: vi.fn().mockResolvedValue(undefined),
		},
	},
}));

function field(value: string) {
	return {
		handleBlur: vi.fn(),
		handleChange: vi.fn(),
		state: { value },
	};
}

describe("AiModelsTab OpenAI-compatible subscriptions", () => {
	it("subscribes model comboboxes to the OpenAI-compatible base URL field", () => {
		const selectedValues: unknown[][] = [];
		const values = {
			evolveProvider: "openai_compatible",
			openaiApiKey: "",
			openaiCompatibleApiBaseUrl: "http://localhost:8000/v1",
			summaryProvider: "openai_compatible",
		};
		const form = {
			store: {
				state: { values },
				subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
			},
			Subscribe: ({
				children,
				selector,
			}: {
				children: (selection: unknown[]) => React.ReactNode;
				selector: (state: { values: Record<string, unknown> }) => unknown[];
			}) => {
				const selection = selector({ values });
				selectedValues.push(selection);
				return <>{children(selection)}</>;
			},
		};

		render(
			<AiModelsTab
				evolveModelField={field("gpt-oss-120b") as never}
				evolveProviderField={field("openai_compatible") as never}
				form={form as never}
				summaryModelField={field("gpt-oss-120b") as never}
				summaryProviderField={field("openai_compatible") as never}
			/>,
		);

		expect(selectedValues.length).toBeGreaterThanOrEqual(2);
		for (const selection of selectedValues) {
			expect(selection).toEqual(["openai_compatible", "", "http://localhost:8000/v1"]);
		}
	});
});
