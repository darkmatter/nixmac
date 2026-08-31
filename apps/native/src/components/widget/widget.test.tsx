import { RouterProvider, nav, router } from "@/router";
import type { EtcClobberCheckResult } from "@/ipc/types";
import { FeedbackType } from "@/types/feedback";
import { makeGlobalPreferences as makePrefs, makeRebuildStatus } from "@/utils/test-fixtures";
import { ESCAPE_OWNER_PRIORITY, registerEscapeOwner } from "@/lib/escape-owner";
import {
  initialUiState,
  uiActions,
  useUiState,
  useViewModel,
  viewModelActions,
} from "@nixmac/state";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mainWindowMocks = vi.hoisted(() => ({
  dismissMainWindowPopover: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  isMainWindowPopover: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  acknowledgeMainWindowClose: vi.fn<(token: number) => Promise<boolean>>().mockResolvedValue(true),
}));

const feedbackClientMocks = vi.hoisted(() => ({
  isAvailable: vi.fn<() => Promise<boolean>>().mockImplementation(() => new Promise(() => {})),
}));

vi.mock("@/lib/orpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orpc")>();
  return {
    ...actual,
    client: new Proxy(actual.client, {
      get(target, property, receiver) {
        if (property === "feedback") {
          return { isAvailable: feedbackClientMocks.isAvailable };
        }
        return Reflect.get(target, property, receiver);
      },
    }),
  };
});

const ipcMocks = vi.hoisted(() => {
  type NativeEventListener = (event: unknown) => void;
  const listeners = new Map<string, NativeEventListener>();
  const on = vi
    .fn<(channel: string, listener: NativeEventListener) => Promise<() => void>>()
    .mockImplementation((channel, listener) => {
      listeners.set(channel, listener);
      return Promise.resolve(() => {
        listeners.delete(channel);
      });
    });

  return { listeners, on };
});

// DarwinWidget now reads router state (useIsOverlayActive), so tests must wrap
// it in the router provider. The router's root layout renders DarwinWidget
// itself, so we just render the provider.
function withRouter() {
  return <RouterProvider router={router} />;
}

// Mock Tauri API
vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    git: {
      status: vi.fn().mockResolvedValue({ hasChanges: false, files: [] }),
    },
    debug: {
      logBreadcrumb: vi.fn().mockResolvedValue(undefined),
      markBootStage: vi.fn().mockResolvedValue(undefined),
    },
    config: {
      read: vi.fn().mockResolvedValue({ configDir: "/Users/test/nixmac" }),
      listHosts: vi.fn().mockResolvedValue(["Test-MacBook"]),
    },
    evolveMascot: {
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue(undefined),
    },
    nix: {
      check: vi.fn().mockResolvedValue(undefined),
      installState: vi.fn().mockResolvedValue(undefined),
    },
  },
  ipcRenderer: {
    on: ipcMocks.on,
  },
}));

vi.mock("@/lib/main-window", () => mainWindowMocks);

vi.mock("@/components/editor-panel", () => ({
  EditorPanel: () => null,
}));
vi.mock("@/components/widget/overlays/editor-panel", () => ({
  EditorPanel: () => null,
}));

vi.mock("@/components/widget/overlays/evolve-overlay-panel", () => ({
  EvolveOverlayPanel: () => null,
}));

vi.mock("@/components/widget/overlays/rebuild-overlay-panel", () => ({
  RebuildOverlayPanel: () => null,
}));

vi.mock("@/components/widget/overlays/config-edit-overlay-panel", () => ({
  ConfigEditOverlayPanel: () => null,
}));

vi.mock("@/components/widget/settings/settings-dialog", () => ({
  SettingsDialog: () => null,
}));

vi.mock("@/components/widget/summaries/diff-section", () => ({
  DiffSection: () => null,
}));

// Mock hooks
vi.mock("@/hooks/use-widget-initialization", () => ({
  loadEvolveState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/use-git-operations", () => ({
  useGitOperations: () => ({
    getInitialStatus: async () => null,
  }),
}));

vi.mock("@/hooks/use-nix-install", () => ({
  useNixInstall: () => ({ checkNix: async () => undefined }),
}));

vi.mock("@/hooks/use-hosted-model-auth-guard", () => ({
  useHostedModelAuthGuard: () => undefined,
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ checkPermissions: async () => undefined }),
}));

vi.mock("@/hooks/use-preview-indicator", () => ({
  usePreviewIndicator: () => ({
    updatePreviewIndicator: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-summary", () => ({
  useSummary: () => ({
    fetchSummary: vi.fn(),
  }),
}));

async function renderWidget(popoverMode: boolean) {
  mainWindowMocks.isMainWindowPopover.mockResolvedValue(popoverMode);
  const result = render(withRouter());

  await waitFor(() => {
    expect(mainWindowMocks.isMainWindowPopover).toHaveBeenCalledTimes(1);
    expect(ipcMocks.listeners.has("window:escape")).toBe(true);
    expect(ipcMocks.listeners.has("window:close-requested")).toBe(true);
  });
  await act(async () => Promise.resolve());

  return result;
}

function dispatchEscape(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(window, event);
  return event;
}

function dispatchCmdW() {
  const event = new KeyboardEvent("keydown", {
    key: "w",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  fireEvent(window, event);
  return event;
}

async function emitNativeEscape() {
  await waitFor(() => expect(ipcMocks.listeners.has("window:escape")).toBe(true));
  await act(async () => {
    ipcMocks.listeners.get("window:escape")?.({});
    await Promise.resolve();
  });
}

async function emitNativeCloseRequested(token: number) {
  await waitFor(() => expect(ipcMocks.listeners.has("window:close-requested")).toBe(true));
  await act(async () => {
    ipcMocks.listeners.get("window:close-requested")?.({ payload: { token } });
    await Promise.resolve();
  });
}

function makeEtcClobberResult(): EtcClobberCheckResult {
  return {
    ok: false,
    checked: 1,
    conflicts: [
      {
        path: "/etc/nix/example.conf",
        target: "nix/example.conf",
        expectedStaticPath: "/etc/static/nix/example.conf",
        currentLinkTarget: null,
        knownSha256Hashes: [],
        kind: "unrecognized_content",
      },
    ],
    warnings: [],
  };
}

describe("DarwinWidget", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ipcMocks.listeners.clear();

    // Reset store to initial state before each test
    viewModelActions.reset();
    viewModelActions.setState({
      git: null,
      preferences: makePrefs({
        configDir: "/Users/test/nixmac",
        hostAttr: "Test-MacBook",
      }),
      hosts: ["Test-MacBook"],
      evolveEvents: [],
      hydrated: true,
    });
    uiActions.setState({ ...initialUiState });
    // Reset router to the index route so no overlay is active
    await nav.goHome();
  });

  it("renders without crashing", () => {
    const { container } = render(withRouter());
    expect(container).toBeTruthy();
  });

  it("renders setup step when no config", () => {
    viewModelActions.setState({
      preferences: makePrefs({ configDir: null, hostAttr: null }),
      hosts: [],
    });

    const { container } = render(withRouter());
    expect(container).toBeTruthy();
  });

  it("renders evolving step with git changes", () => {
    viewModelActions.setState({
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

    const { container } = render(withRouter());
    expect(container).toBeTruthy();
  });

  it("closes Settings before lower overlays", async () => {
    uiActions.setShowHistory(true);
    await renderWidget(true);
    await act(async () => nav.openSettings());
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings"));

    await emitNativeEscape();

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(uiActions.getState().showHistory).toBe(true);
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });

  it("routes popover Cmd+W through Escape so Settings closes before the window", async () => {
    await renderWidget(true);
    await act(async () => nav.openSettings());
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings"));

    const event = dispatchCmdW();

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });

  it("routes popover Cmd+W through higher-priority Escape owners", async () => {
    const higherOwner = vi.fn<() => void>();
    const unregister = registerEscapeOwner({
      name: "test-higher-owner",
      priority: ESCAPE_OWNER_PRIORITY.celebration,
      handle: () => {
        higherOwner();
        return true;
      },
    });
    await renderWidget(true);

    const event = dispatchCmdW();

    unregister();
    expect(event.defaultPrevented).toBe(true);
    expect(higherOwner).toHaveBeenCalledOnce();
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });

  it("lets the panic feedback Dialog close before handling a native close request", async () => {
    uiActions.setState({
      feedbackOpen: true,
      feedbackTypeOverride: FeedbackType.Error,
      feedbackInitialText: "panic details",
      panicDetails: {
        message: "unexpected panic",
        timestamp: "2026-08-28T00:00:00.000Z",
      },
    });
    await renderWidget(true);
    await waitFor(() => expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull());

    await emitNativeCloseRequested(19);

    await waitFor(() => expect(useUiState.getState().feedbackOpen).toBe(false));
    expect(useUiState.getState().panicDetails).toBeNull();
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
    expect(mainWindowMocks.acknowledgeMainWindowClose).toHaveBeenCalledWith(19);
  });

  it("lets the /etc warning Dialog close before dismissing the popover", async () => {
    uiActions.setEtcClobber(makeEtcClobberResult());
    uiActions.setEtcClobberDialogOpen(true);
    await renderWidget(true);
    await waitFor(() => expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull());

    await emitNativeEscape();

    await waitFor(() => expect(useUiState.getState().etcClobberDialogOpen).toBe(false));
    expect(useUiState.getState().etcClobber).toBeNull();
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });

  it("lets an AlertDialog handle native close Escape before the popover", async () => {
    feedbackClientMocks.isAvailable.mockResolvedValueOnce(false);
    uiActions.setFeedbackOpen(true);
    await renderWidget(true);
    await waitFor(() => {
      expect(useUiState.getState().feedbackOpen).toBe(false);
      expect(document.querySelector('[data-slot="alert-dialog-content"]')).not.toBeNull();
    });

    await emitNativeCloseRequested(23);

    await waitFor(() =>
      expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeNull(),
    );
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
    expect(mainWindowMocks.acknowledgeMainWindowClose).toHaveBeenCalledWith(23);
  });

  it("closes an eligible store-backed overlay without dismissing the window", async () => {
    uiActions.setShowHistory(true);
    await renderWidget(true);

    const event = dispatchEscape();

    expect(event.defaultPrevented).toBe(true);
    expect(uiActions.getState().showHistory).toBe(false);
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });

  it("preserves control-mode overlay behavior while a rebuild is running", async () => {
    uiActions.setShowHistory(true);
    viewModelActions.setState({
      rebuildStatus: makeRebuildStatus({ isRunning: true }),
    });
    await renderWidget(false);

    const event = dispatchEscape();

    expect(event.defaultPrevented).toBe(true);
    expect(uiActions.getState().showHistory).toBe(false);
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });

  it("hides a rebuilding popover without clearing its mounted overlay", async () => {
    uiActions.setShowHistory(true);
    viewModelActions.setState({
      rebuildStatus: makeRebuildStatus({ isRunning: true }),
    });
    await renderWidget(true);

    const event = dispatchEscape();

    expect(event.defaultPrevented).toBe(true);
    expect(uiActions.getState().showHistory).toBe(true);
    await waitFor(() => expect(mainWindowMocks.dismissMainWindowPopover).toHaveBeenCalledOnce());
  });

  it.each([
    ["evolve", () => uiActions.setGenerating(true)],
    ["config apply", () => uiActions.setProcessing(true, "apply")],
    ["another in-progress action", () => uiActions.setProcessing(true, "merge")],
    [
      "rebuild",
      () =>
        viewModelActions.setState({
          rebuildStatus: makeRebuildStatus({ isRunning: true }),
        }),
    ],
  ])("dismisses the popover without cancelling %s", async (_name, activate) => {
    activate();
    await renderWidget(true);

    const event = dispatchEscape();

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(mainWindowMocks.dismissMainWindowPopover).toHaveBeenCalledOnce());
    expect(
      useUiState.getState().isGenerating ||
        useUiState.getState().isProcessing ||
        Boolean(useViewModel.getState().rebuildStatus?.isRunning),
    ).toBe(true);
  });

  it("leaves control-mode Cmd+W to the native window while work is active", async () => {
    uiActions.setProcessing(true, "apply");
    await renderWidget(false);

    const event = dispatchCmdW();

    expect(event.defaultPrevented).toBe(false);
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });

  it("leaves control-mode Cmd+W untouched when nothing is open", async () => {
    await renderWidget(false);

    const event = dispatchCmdW();

    expect(event.defaultPrevented).toBe(false);
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });

  it("dismisses popover mode on Cmd+W without cancelling active work", async () => {
    uiActions.setProcessing(true, "apply");
    await renderWidget(true);

    const event = dispatchCmdW();

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(mainWindowMocks.dismissMainWindowPopover).toHaveBeenCalledOnce());
    expect(useUiState.getState().isProcessing).toBe(true);
  });

  it("dismisses popover mode on Cmd+W when no overlay is open", async () => {
    await renderWidget(true);

    const event = dispatchCmdW();

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(mainWindowMocks.dismissMainWindowPopover).toHaveBeenCalledOnce());
  });

  it("dismisses popover mode when Escape has no overlay to close", async () => {
    await renderWidget(true);

    const event = dispatchEscape();

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(mainWindowMocks.dismissMainWindowPopover).toHaveBeenCalledOnce());
  });

  it("leaves control mode Escape untouched when no overlay is open", async () => {
    await renderWidget(false);

    const event = dispatchEscape();

    expect(event.defaultPrevented).toBe(false);
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });

  it("routes the native Escape bridge through the same popover owner", async () => {
    await renderWidget(true);

    await emitNativeEscape();

    expect(ipcMocks.on).toHaveBeenCalledWith("window:escape", expect.any(Function));
    expect(mainWindowMocks.isMainWindowPopover).toHaveBeenCalledOnce();
    expect(mainWindowMocks.dismissMainWindowPopover).toHaveBeenCalledOnce();
  });

  it("honors the native Escape bridge when the launch-mode probe fails", async () => {
    mainWindowMocks.isMainWindowPopover.mockRejectedValueOnce(new Error("probe unavailable"));
    render(withRouter());

    await emitNativeEscape();

    expect(mainWindowMocks.dismissMainWindowPopover).toHaveBeenCalledOnce();
  });

  it("keeps a native event authoritative over a later stale control-mode probe", async () => {
    let resolveProbe: (enabled: boolean) => void = () => {};
    mainWindowMocks.isMainWindowPopover.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );
    render(withRouter());

    await emitNativeEscape();
    await waitFor(() => expect(mainWindowMocks.dismissMainWindowPopover).toHaveBeenCalledOnce());
    mainWindowMocks.dismissMainWindowPopover.mockClear();
    await act(async () => {
      resolveProbe(false);
      await Promise.resolve();
    });

    const event = dispatchCmdW();

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(mainWindowMocks.dismissMainWindowPopover).toHaveBeenCalledOnce());
  });

  it("honors and acknowledges a native close request when the mode probe fails", async () => {
    mainWindowMocks.isMainWindowPopover.mockRejectedValueOnce(new Error("probe unavailable"));
    render(withRouter());

    await emitNativeCloseRequested(41);

    expect(mainWindowMocks.dismissMainWindowPopover).toHaveBeenCalledOnce();
    expect(mainWindowMocks.acknowledgeMainWindowClose).toHaveBeenCalledWith(41);
  });

  it("routes native close through higher-priority Escape owners before acknowledging", async () => {
    const order: string[] = [];
    const unregister = registerEscapeOwner({
      name: "test-higher-owner",
      priority: ESCAPE_OWNER_PRIORITY.celebration,
      handle: () => {
        order.push("higher-owner");
        return true;
      },
    });
    mainWindowMocks.acknowledgeMainWindowClose.mockImplementation(async () => {
      order.push("acknowledge");
      return true;
    });
    await renderWidget(true);

    await emitNativeCloseRequested(59);

    unregister();
    expect(order).toEqual(["higher-owner", "acknowledge"]);
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });

  it("acknowledges a native close request after synchronous Escape dispatch", async () => {
    const order: string[] = [];
    const observeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") order.push("escape");
    };
    document.addEventListener("keydown", observeEscape);
    mainWindowMocks.acknowledgeMainWindowClose.mockImplementation(async () => {
      order.push("acknowledge");
      return true;
    });
    await renderWidget(true);

    await emitNativeCloseRequested(73);

    document.removeEventListener("keydown", observeEscape);
    expect(order).toEqual(["escape", "acknowledge"]);
    expect(mainWindowMocks.acknowledgeMainWindowClose).toHaveBeenCalledWith(73);
  });

  it("preserves editor state when native close dismisses the popover", async () => {
    uiActions.setState({ editingFile: "/tmp/settings.nix" });
    await renderWidget(true);

    await emitNativeCloseRequested(91);

    expect(useUiState.getState().editingFile).toBe("/tmp/settings.nix");
    expect(mainWindowMocks.dismissMainWindowPopover).toHaveBeenCalledOnce();
    expect(mainWindowMocks.acknowledgeMainWindowClose).toHaveBeenCalledWith(91);
  });

  it("respects a Radix-owned/default-prevented event", async () => {
    uiActions.setShowHistory(true);
    await renderWidget(true);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    fireEvent(window, event);

    expect(uiActions.getState().showHistory).toBe(true);
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });

  it("respects IME composition", async () => {
    uiActions.setShowHistory(true);
    await renderWidget(true);

    dispatchEscape({ isComposing: true });

    expect(uiActions.getState().showHistory).toBe(true);
    expect(mainWindowMocks.dismissMainWindowPopover).not.toHaveBeenCalled();
  });
});
