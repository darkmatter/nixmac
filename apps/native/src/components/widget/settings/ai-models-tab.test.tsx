import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelemetryEvent } from "@/lib/telemetry/types";
import { AiModelsTab } from "./ai-models-tab";

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn<(event: TelemetryEvent) => void>(),
  clearCached: vi.fn<() => Promise<void>>(),
  setPrefs: vi.fn<(prefs: Record<string, unknown>) => Promise<void>>(),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    id,
    onBlur,
    onChange,
    value,
  }: {
    id?: string;
    onBlur?: () => void;
    onChange?: (event: { target: { value: string } }) => void;
    value?: string;
  }) => (
    <input
      data-testid={`input-${id}`}
      onBlur={onBlur}
      onChange={(event) =>
        onChange?.({
          target: {
            value:
              (event.target as HTMLInputElement).value ||
              "sensitive-model-name",
          },
        })
      }
      value={value}
      readOnly
    />
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: React.ReactNode;
    onValueChange?: (value: string) => void;
    value?: string;
  }) => (
    <div>
      <button
        data-testid={`select-${value}`}
        onClick={() => onValueChange?.("codex")}
        type="button"
      >
        choose
      </button>
      {children}
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

vi.mock("@/components/widget/controls/model-combobox", () => ({
  ModelCombobox: ({
    onBlur,
    onChange,
  }: {
    onBlur?: () => void;
    onChange?: (value: string) => void;
  }) => (
    <div>
      <button
        data-testid="model-combobox"
        onClick={() => {
          onChange?.("sensitive-provider-model");
          onBlur?.();
        }}
        type="button"
      >
        model
      </button>
    </div>
  ),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    cli: {
      checkTools: vi.fn<() => Promise<{
        claude: boolean;
        codex: boolean;
        opencode: boolean;
      }>>().mockResolvedValue({
        claude: true,
        codex: true,
        opencode: true,
      }),
    },
    models: {
      clearCached: mocks.clearCached,
    },
    ui: {
      setPrefs: mocks.setPrefs,
    },
  },
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mocks.captureEvent,
  }),
}));

const field = (value: string) => ({
  handleBlur: vi.fn<() => void>(),
  handleChange: vi.fn<(value: string) => void>(),
  state: { value },
});

const createForm = (values?: Partial<Record<string, string>>) => ({
  Subscribe: ({
    children,
    selector,
  }: {
    children: (value: unknown) => React.ReactNode;
    selector: (state: { values: Record<string, string> }) => unknown;
  }) =>
    children(
      selector({
        values: {
          evolveModel: "anthropic/claude-sonnet-4",
          evolveProvider: "openrouter",
          openaiApiKey: "",
          openrouterApiKey: "",
          summaryModel: "llama3.1",
          summaryProvider: "ollama",
          vllmApiBaseUrl: "",
          ...values,
        },
      }),
    ),
  store: {
    state: {
      values: {
        openaiApiKey: "",
        openrouterApiKey: "",
        vllmApiBaseUrl: "",
        ...values,
      },
    },
    subscribe: () => ({
      unsubscribe: vi.fn<() => void>(),
    }),
  },
});

describe("<AiModelsTab> telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearCached.mockResolvedValue(undefined);
    mocks.setPrefs.mockResolvedValue(undefined);
  });

  it("emits settings_changed with setting enum names only", async () => {
    render(
      <AiModelsTab
        evolveModelField={field("anthropic/claude-sonnet-4") as never}
        evolveProviderField={field("openrouter") as never}
        form={createForm() as never}
        summaryModelField={field("llama3.1") as never}
        summaryProviderField={field("ollama") as never}
      />,
    );

    fireEvent.click(screen.getByTestId("select-openrouter"));
    fireEvent.click(screen.getAllByTestId("model-combobox")[0]);

    await waitFor(() =>
      expect(mocks.captureEvent).toHaveBeenCalledWith({
        name: "settings_changed",
        props: { setting: "evolve_provider", surface: "gui" },
      }),
    );
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "settings_changed",
      props: { setting: "evolve_model", surface: "gui" },
    });
    expect(JSON.stringify(mocks.captureEvent.mock.calls)).not.toContain(
      "sensitive-provider-model",
    );
  });

  it("emits plain-input model settings once on blur instead of per keystroke", async () => {
    render(
      <AiModelsTab
        evolveModelField={field("") as never}
        evolveProviderField={field("claude") as never}
        form={createForm({
          evolveProvider: "claude",
          summaryProvider: "codex",
        }) as never}
        summaryModelField={field("") as never}
        summaryProviderField={field("codex") as never}
      />,
    );

    const evolveInput = screen.getByTestId("input-evolveModel");
    fireEvent.change(evolveInput, { target: { value: "a" } });
    fireEvent.change(evolveInput, { target: { value: "ab" } });

    await waitFor(() => expect(mocks.setPrefs).toHaveBeenCalledTimes(2));
    expect(mocks.captureEvent).not.toHaveBeenCalledWith({
      name: "settings_changed",
      props: { setting: "evolve_model", surface: "gui" },
    });

    fireEvent.blur(evolveInput);

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "settings_changed",
      props: { setting: "evolve_model", surface: "gui" },
    });
    expect(
      mocks.captureEvent.mock.calls.filter(
        ([event]) =>
          event.name === "settings_changed" &&
          event.props.setting === "evolve_model",
      ),
    ).toHaveLength(1);
  });

  it("does not emit plain-input model settings when blurred without a change", () => {
    render(
      <AiModelsTab
        evolveModelField={field("") as never}
        evolveProviderField={field("claude") as never}
        form={createForm({
          evolveProvider: "claude",
          summaryProvider: "codex",
        }) as never}
        summaryModelField={field("") as never}
        summaryProviderField={field("codex") as never}
      />,
    );

    fireEvent.blur(screen.getByTestId("input-evolveModel"));

    expect(mocks.captureEvent).not.toHaveBeenCalledWith({
      name: "settings_changed",
      props: { setting: "evolve_model", surface: "gui" },
    });
  });

});
