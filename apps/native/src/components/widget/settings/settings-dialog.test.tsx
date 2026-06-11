import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelemetryEvent } from "@/lib/telemetry/types";
import { SettingsDialog } from "./settings-dialog";

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn<(event: TelemetryEvent) => void>(),
  getPrefs: vi.fn<() => Promise<Record<string, unknown>>>(),
  saveHost: vi.fn<() => Promise<void>>(),
  setHosts: vi.fn<(hosts: string[]) => void>(),
  setSettingsOpen: vi.fn<(open: boolean) => void>(),
  widgetState: {
    configDir: "/Users/demo/.nixmac",
    developerMode: false,
    host: "demo",
    hosts: ["demo"],
    settingsActiveTab: null,
    settingsOpen: true,
  },
}));

vi.mock("@/components/widget/settings/account-tab", () => ({
  AccountTab: () => <div data-testid="account-tab" />,
}));

vi.mock("@/components/widget/settings/ai-models-tab", () => ({
  AiModelsTab: () => <div data-testid="ai-models-tab" />,
}));

vi.mock("@/components/widget/settings/api-keys-tab", () => ({
  ApiKeysTab: () => <div data-testid="api-keys-tab" />,
}));

vi.mock("@/components/widget/settings/developer-tab", () => ({
  DeveloperTab: () => <div data-testid="developer-tab" />,
}));

vi.mock("@/components/widget/settings/general-tab", () => ({
  GeneralTab: () => <div data-testid="general-tab" />,
}));

vi.mock("@/components/widget/settings/preferences-tab", () => ({
  PreferencesTab: () => <div data-testid="preferences-tab" />,
}));

vi.mock("@/components/widget/settings/tuning-tab", () => ({
  TuningTab: () => <div data-testid="tuning-tab" />,
}));

vi.mock("@/hooks/use-darwin-config", () => ({
  useDarwinConfig: () => ({
    saveHost: mocks.saveHost,
  }),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    flake: {
      listHosts: vi.fn<() => Promise<string[]>>(),
    },
    models: {
      clearCached: vi.fn<() => Promise<void>>(),
    },
    ui: {
      getPrefs: mocks.getPrefs,
      setPrefs: vi.fn<(prefs: Record<string, unknown>) => Promise<void>>(),
    },
  },
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mocks.captureEvent,
  }),
}));

vi.mock("@/stores/widget-store", () => ({
  useWidgetStore: () => ({
    ...mocks.widgetState,
    setHosts: mocks.setHosts,
    setSettingsOpen: mocks.setSettingsOpen,
  }),
}));

describe("<SettingsDialog> telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrefs.mockResolvedValue({});
    mocks.widgetState.settingsOpen = true;
  });

  it("emits settings_opened when the dialog opens", () => {
    render(<SettingsDialog />);

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "settings_opened",
      props: { surface: "gui" },
    });
  });
});
