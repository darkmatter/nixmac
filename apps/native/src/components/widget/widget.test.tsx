import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";
import type { TelemetryEvent } from "@/lib/telemetry/types";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetOnboardingStartedTelemetryForTests,
  DarwinWidget,
} from "./widget";

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn<(event: TelemetryEvent) => void>(),
  checkNix: vi.fn<() => Promise<void>>(),
  checkPermissions: vi.fn<() => Promise<void>>(),
  findChangeMap: vi.fn<() => Promise<void>>(),
  getInitialStatus: vi.fn<() => Promise<void>>(),
  loadConfig: vi.fn<() => Promise<void>>(),
  loadEvolveState: vi.fn<() => Promise<void>>(),
  loadHosts: vi.fn<() => Promise<void>>(),
  loadPrefs: vi.fn<() => Promise<void>>(),
  refreshPromptHistory: vi.fn<() => Promise<void>>(),
  startViewModelSync: vi.fn<() => Promise<() => void>>(),
}));

// Mock Tauri API
vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    git: {
      status: vi.fn<() => Promise<{ files: never[]; hasChanges: boolean }>>()
        .mockResolvedValue({ files: [], hasChanges: false }),
    },
    debug: {
      logBreadcrumb: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      markBootStage: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    },
    config: {
      read: vi.fn<() => Promise<{ configDir: string }>>().mockResolvedValue({
        configDir: "/Users/test/nixmac",
      }),
      listHosts: vi.fn<() => Promise<string[]>>().mockResolvedValue(["Test-MacBook"]),
    },
    evolveMascot: {
      show: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      hide: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    },
    scanner: {
      getRecommendedPrompt: vi.fn<() => Promise<null>>().mockResolvedValue(null),
    },
  },
  ipcRenderer: {
    on: vi.fn<() => Promise<() => void>>().mockResolvedValue(() => {}),
  },
}));

vi.mock("@/components/editor-panel", () => ({
  EditorPanel: () => null,
}));

vi.mock("@/components/widget/summaries/diff-section", () => ({
  DiffSection: () => null,
}));

vi.mock("@/components/widget/settings/settings-dialog", () => ({
  SettingsDialog: () => null,
}));

vi.mock("@/components/widget/promptinput/mac-recommendation-chip", () => ({
  MacRecommendationChip: () => null,
}));

vi.mock("@/components/widget/promptinput/system-defaults-cta", () => ({
  SystemDefaultsCTA: () => null,
}));

// Mock hooks
vi.mock("@/hooks/use-widget-initialization", () => ({
  loadConfig: mocks.loadConfig,
  loadEvolveState: mocks.loadEvolveState,
  loadHosts: mocks.loadHosts,
}));

vi.mock("@/hooks/use-git-operations", () => ({
  useGitOperations: () => ({
    getInitialStatus: mocks.getInitialStatus,
    refreshGitStatus: vi.fn<() => Promise<null>>().mockResolvedValue(null),
  }),
}));

vi.mock("@/hooks/use-preview-indicator", () => ({
  usePreviewIndicator: () => ({
    updatePreviewIndicator: vi.fn<() => void>(),
  }),
}));

vi.mock("@/hooks/use-summary", () => ({
  useSummary: () => ({
    findChangeMap: mocks.findChangeMap,
  }),
}));

vi.mock("@/hooks/use-nix-install", () => ({
  useNixInstall: () => ({
    checkNix: mocks.checkNix,
  }),
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({
    checkPermissions: mocks.checkPermissions,
  }),
}));

vi.mock("@/hooks/use-prefs", () => ({
  usePrefs: () => ({
    loadPrefs: mocks.loadPrefs,
  }),
}));

vi.mock("@/hooks/use-prompt-history", () => ({
  usePromptHistory: () => ({
    refreshPromptHistory: mocks.refreshPromptHistory,
  }),
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mocks.captureEvent,
  }),
}));

vi.mock("@/viewmodel", () => ({
  startViewModelSync: mocks.startViewModelSync,
}));

describe("DarwinWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetOnboardingStartedTelemetryForTests();
    mocks.checkNix.mockImplementation(async () => {
      useWidgetStore.getState().setNixInstalled(true);
      useWidgetStore.getState().setDarwinRebuildAvailable(true);
    });
    mocks.checkPermissions.mockImplementation(async () => {
      useWidgetStore.getState().setPermissionsChecked(true);
      useWidgetStore.getState().setPermissionsState({
        allRequiredGranted: true,
        checkedAt: 0,
        permissions: [],
      });
    });
    mocks.findChangeMap.mockResolvedValue(undefined);
    mocks.getInitialStatus.mockResolvedValue(undefined);
    mocks.loadConfig.mockResolvedValue(undefined);
    mocks.loadEvolveState.mockResolvedValue(undefined);
    mocks.loadHosts.mockResolvedValue(undefined);
    mocks.loadPrefs.mockResolvedValue(undefined);
    mocks.startViewModelSync.mockResolvedValue(() => {});

    // Reset store to initial state before each test
    const store = useWidgetStore.getState();
    store.setConfigDir("/Users/test/nixmac");
    store.setHosts(["Test-MacBook"]);
    store.setHost("Test-MacBook");
    useViewModel.setState({ git: null });
    store.setEvolvePrompt("");
    store.setProcessing(false);
    store.setGenerating(false);
    store.setError(null);
    store.setBootstrapping(false);
    store.setNixInstalled(true);
    store.setDarwinRebuildAvailable(true);
    store.clearEvolveEvents();
    store.clearLogs();
  });

  it("renders without crashing", async () => {
    const { container } = render(<DarwinWidget />);
    await waitFor(() => expect(mocks.startViewModelSync).toHaveBeenCalled());
    expect(container).toBeTruthy();
  });

  it("renders setup step when no config", async () => {
    const store = useWidgetStore.getState();
    store.setConfigDir("");
    store.setHost("");

    const { container } = render(<DarwinWidget />);
    await waitFor(() => expect(mocks.startViewModelSync).toHaveBeenCalled());
    expect(container).toBeTruthy();
  });

  it("renders evolving step with git changes", async () => {
    useViewModel.setState({
      git: {
        files: [{ path: "test.nix", changeType: "edited" }],
        branch: null,
        diff: "",
        additions: 0,
        deletions: 0,
        headCommitHash: null,
        cleanHead: false,
        changes: [],
      },
    });

    const { container } = render(<DarwinWidget />);
    await waitFor(() => expect(mocks.startViewModelSync).toHaveBeenCalled());
    expect(container).toBeTruthy();
  });

  it("renders with error message", async () => {
    const store = useWidgetStore.getState();
    store.setError("Test error message");

    const { container } = render(<DarwinWidget />);
    await waitFor(() => expect(mocks.startViewModelSync).toHaveBeenCalled());
    expect(container).toBeTruthy();
  });

  it("does not emit onboarding_started for an already-onboarded startup while hosts are loading", async () => {
    const store = useWidgetStore.getState();
    store.setConfigDir("");
    store.setHost("");
    store.setHosts([]);
    mocks.loadConfig.mockImplementation(async () => {
      store.setConfigDir("/Users/test/nixmac");
      store.setHost("Test-MacBook");
    });
    mocks.loadHosts.mockImplementation(async () => {
      store.setHosts(["Test-MacBook"]);
    });

    render(<DarwinWidget />);

    await waitFor(() => expect(mocks.loadHosts).toHaveBeenCalledTimes(1));
    expect(mocks.captureEvent).not.toHaveBeenCalledWith({
      name: "onboarding_started",
      props: { surface: "gui" },
    });
  });

  it("emits onboarding_started once after startup confirms setup is really needed", async () => {
    const store = useWidgetStore.getState();
    store.setConfigDir("");
    store.setHost("");
    store.setHosts([]);

    render(<DarwinWidget />);

    await waitFor(() =>
      expect(mocks.captureEvent).toHaveBeenCalledWith({
        name: "onboarding_started",
        props: { surface: "gui" },
      }),
    );
    expect(
      mocks.captureEvent.mock.calls.filter(
        ([event]) => event.name === "onboarding_started",
      ),
    ).toHaveLength(1);
  });

  it("keeps onboarding_started armed until a fresh user reaches setup", async () => {
    const store = useWidgetStore.getState();
    store.setConfigDir("");
    store.setHost("");
    store.setHosts([]);
    store.setNixInstalled(false);
    store.setDarwinRebuildAvailable(false);
    mocks.checkNix.mockImplementation(async () => {
      store.setNixInstalled(false);
      store.setDarwinRebuildAvailable(false);
    });

    render(<DarwinWidget />);

    await waitFor(() => expect(mocks.loadHosts).toHaveBeenCalledTimes(1));
    expect(mocks.captureEvent).not.toHaveBeenCalledWith({
      name: "onboarding_started",
      props: { surface: "gui" },
    });

    await act(async () => {
      useWidgetStore.getState().setNixInstalled(true);
      useWidgetStore.getState().setDarwinRebuildAvailable(true);
    });

    await waitFor(() =>
      expect(mocks.captureEvent).toHaveBeenCalledWith({
        name: "onboarding_started",
        props: { surface: "gui" },
      }),
    );
    expect(
      mocks.captureEvent.mock.calls.filter(
        ([event]) => event.name === "onboarding_started",
      ),
    ).toHaveLength(1);
  });
});
