import type {
  EvolveEvent,
  EvolveState,
  GitState,
  GitStatus,
  GlobalPreferences,
  NixInstallState,
  PermissionsState,
  RebuildStatus,
  SemanticChangeMap,
} from "@/ipc/types";
import { REBUILD_ERROR_CODES } from "@/lib/errors";
import {
  makeGlobalPreferences,
  makeNixInstallState,
  makeRebuildStatus,
} from "@/utils/test-fixtures";
import { initialUiState, uiActions, useUiState, viewModelActions } from "@nixmac/state";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startChangeMapSync } from "./change-map";
import { startEvolutionSync } from "./evolution";
import { startEvolveSync } from "./evolve";
import { startGitSync } from "./git";
import { startNixInstallSync } from "./nix-install";
import { startPermissionsSync } from "./permissions";
import { refreshHostsSnapshot, startPreferencesSync } from "./preferences";
import { startPromptHistorySync } from "./prompt-history";
import { startRebuildSync } from "./rebuild";

const apiMocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
  evolveState: {} as EvolveState,
  gitState: {} as GitState,
  changeMap: {} as SemanticChangeMap,
  preferences: {} as GlobalPreferences,
  permissions: null as PermissionsState | null,
  promptHistory: [] as string[],
  hosts: [] as string[],
  listHosts: vi.fn(),
  nixInstallState: null as NixInstallState | null,
  rebuildStatus: null as RebuildStatus | null,
  refreshPermissions: vi.fn<() => Promise<null>>(),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    darwin: {
      evolve: vi.fn(),
      evolveAnswer: vi.fn(),
      evolveCancel: vi.fn(),
      rebuildStatus: vi.fn<() => Promise<RebuildStatus | null>>(() =>
        Promise.resolve(apiMocks.rebuildStatus),
      ),
    },
    nix: {
      installState: vi.fn<() => Promise<NixInstallState | null>>(() =>
        Promise.resolve(apiMocks.nixInstallState),
      ),
    },
    evolveState: {
      get: vi.fn(() => Promise.resolve(apiMocks.evolveState)),
    },
    git: {
      state: vi.fn(() => Promise.resolve(apiMocks.gitState)),
    },
    summarizedChanges: {
      getChangeMap: vi.fn(() => Promise.resolve(apiMocks.changeMap)),
    },
    preferences: {
      get: vi.fn(() => Promise.resolve(apiMocks.preferences)),
    },
    permissions: {
      get: vi.fn(() => Promise.resolve(apiMocks.permissions)),
      refresh: () => apiMocks.refreshPermissions(),
    },
    promptHistory: {
      get: vi.fn(() => Promise.resolve(apiMocks.promptHistory)),
    },
    flake: {
      listHosts: (...args: unknown[]) => apiMocks.listHosts(...args),
    },
  },
  ipcRenderer: {
    on: vi.fn((channel: string, listener: (event: { payload: unknown }) => void) => {
      apiMocks.listeners.set(channel, listener);
      return Promise.resolve(apiMocks.unlisten);
    }),
  },
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    darwin: {
      rebuildStatus: vi.fn<() => Promise<RebuildStatus | null>>(() =>
        Promise.resolve(apiMocks.rebuildStatus),
      ),
    },
    evolveState: {
      get: vi.fn<() => Promise<EvolveState>>(() => Promise.resolve(apiMocks.evolveState)),
    },
    summarizedChanges: {
      getChangeMap: vi.fn<() => Promise<SemanticChangeMap>>(() =>
        Promise.resolve(apiMocks.changeMap),
      ),
    },
  },
  orpc: {
    history: {
      key: vi.fn(() => ["history"]),
    },
  },
  queryClient: {
    invalidateQueries: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  },
}));

describe("view model sync", () => {
  beforeEach(() => {
    apiMocks.listeners.clear();
    apiMocks.unlisten.mockClear();
    apiMocks.listHosts.mockReset();
    apiMocks.listHosts.mockImplementation(() => Promise.resolve(apiMocks.hosts));
    apiMocks.evolveState = { step: "begin" } as unknown as EvolveState;
    apiMocks.gitState = {
      gitStatus: { hasChanges: false, files: [] } as unknown as GitStatus,
      externalBuildDetected: false,
      upstreamUpdateAvailable: false,
      rebuildNeeded: false,
    };
    apiMocks.changeMap = { groups: [], singles: [] } as unknown as SemanticChangeMap;
    apiMocks.preferences = makeGlobalPreferences();
    apiMocks.permissions = null;
    apiMocks.promptHistory = [];
    apiMocks.hosts = [];
    apiMocks.nixInstallState = makeNixInstallState({
      installed: null,
      darwinRebuildAvailable: null,
    });
    apiMocks.rebuildStatus = makeRebuildStatus();
    apiMocks.refreshPermissions.mockReset();
    apiMocks.refreshPermissions.mockResolvedValue(null);

    viewModelActions.setState({
      evolve: null,
      git: null,
      build: {
        externalBuildDetected: false,
        upstreamUpdateAvailable: false,
        rebuildNeeded: false,
      },
      changeMap: null,
      preferences: null,
      hosts: [],
      permissions: null,
      permissionsHydrated: false,
      promptHistory: [],
      nixInstall: null,
      rebuildStatus: null,
      rebuildLog: { lines: [], rawLines: [], notices: [] },
      evolveEvents: [],
    });
    uiActions.setState({ ...initialUiState });
  });

  it("hydrates and mirrors the evolve slice", async () => {
    const stop = await startEvolveSync();

    expect(viewModelActions.getState().evolve).toBe(apiMocks.evolveState);

    const next = { step: "commit" } as unknown as EvolveState;
    apiMocks.listeners.get("evolve_state_changed")?.({ payload: next });

    expect(viewModelActions.getState().evolve).toBe(next);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("hydrates git from get_git_state and mirrors git slice events", async () => {
    const stop = await startGitSync();

    expect(viewModelActions.getState().git).toBe(apiMocks.gitState.gitStatus);
    expect(viewModelActions.getState().build.externalBuildDetected).toBe(false);

    const gitStatus = { hasChanges: true, files: [] } as unknown as GitStatus;
    const event: GitState = {
      gitStatus,
      externalBuildDetected: true,
      upstreamUpdateAvailable: true,
      rebuildNeeded: true,
    };

    apiMocks.listeners.get("git_state_changed")?.({ payload: event });

    expect(viewModelActions.getState().git).toBe(gitStatus);
    expect(viewModelActions.getState().build.externalBuildDetected).toBe(true);
    expect(viewModelActions.getState().build.upstreamUpdateAvailable).toBe(true);
    expect(viewModelActions.getState().build.rebuildNeeded).toBe(true);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(2);
  });

  it("hydrates and mirrors git errors into UI state", async () => {
    const stop = await startGitSync();

    apiMocks.listeners.get("git_state_error")?.({ payload: "not a git repository" });

    expect(useUiState.getState().error).toBe("not a git repository");

    stop();
  });

  it("hydrates the change-map slice from get_change_map and mirrors events", async () => {
    const stop = await startChangeMapSync();

    expect(viewModelActions.getState().changeMap).toBe(apiMocks.changeMap);

    const changeMap = { groups: [{}], singles: [] } as unknown as SemanticChangeMap;
    apiMocks.listeners.get("change_map_changed")?.({ payload: changeMap });

    expect(viewModelActions.getState().changeMap).toBe(changeMap);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("hydrates and mirrors the preferences slice", async () => {
    apiMocks.preferences = makeGlobalPreferences({ developerMode: true });
    const stop = await startPreferencesSync();

    expect(viewModelActions.getState().preferences).toBe(apiMocks.preferences);

    const next = makeGlobalPreferences({ confirmBuild: false });
    apiMocks.listeners.get("global_preferences_changed")?.({ payload: next });

    expect(viewModelActions.getState().preferences).toBe(next);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("refreshes hosts when preferences carry a configDir", async () => {
    apiMocks.preferences = makeGlobalPreferences({ configDir: "/Users/me/.darwin" });
    apiMocks.hosts = ["mbp"];
    const stop = await startPreferencesSync();

    expect(viewModelActions.getState().hosts).toEqual(["mbp"]);

    apiMocks.hosts = ["mbp", "workbook"];
    apiMocks.listeners.get("global_preferences_changed")?.({
      payload: makeGlobalPreferences({ configDir: "/Users/me/.darwin" }),
    });
    await vi.waitFor(() => {
      expect(viewModelActions.getState().hosts).toEqual(["mbp", "workbook"]);
    });

    stop();
  });

  it("can force a hosts refresh before mirrored preferences include a configDir", async () => {
    apiMocks.hosts = ["mbp"];
    await refreshHostsSnapshot({ force: true });

    expect(apiMocks.listHosts).toHaveBeenCalledTimes(1);
    expect(viewModelActions.getState().hosts).toEqual(["mbp"]);
  });

  it("keeps previous hosts when listing fails or configDir is unset", async () => {
    // No configDir -> listHosts is never queried.
    const stop = await startPreferencesSync();
    expect(apiMocks.listHosts).not.toHaveBeenCalled();
    expect(viewModelActions.getState().hosts).toEqual([]);

    // configDir set but listing fails -> hosts unchanged, error logged.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => { });
    viewModelActions.setState({ hosts: ["existing"] });
    apiMocks.listHosts.mockRejectedValue(new Error("nix missing"));
    apiMocks.listeners.get("global_preferences_changed")?.({
      payload: makeGlobalPreferences({ configDir: "/Users/me/.darwin" }),
    });
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });
    expect(viewModelActions.getState().hosts).toEqual(["existing"]);
    consoleError.mockRestore();

    stop();
  });

  it("hydrates and mirrors the permissions slice, flagging hydration", async () => {
    const stop = await startPermissionsSync();

    // Hydrated to null (never probed) still counts as hydrated.
    expect(viewModelActions.getState().permissions).toBeNull();
    expect(viewModelActions.getState().permissionsHydrated).toBe(true);

    const next: PermissionsState = {
      permissions: [],
      allRequiredGranted: true,
      checkedAt: 123,
    };
    apiMocks.listeners.get("permissions_changed")?.({ payload: next });

    expect(viewModelActions.getState().permissions).toBe(next);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("hydrates and mirrors the nix-install slice, surfacing errors", async () => {
    const stop = await startNixInstallSync();

    expect(viewModelActions.getState().nixInstall).toBe(apiMocks.nixInstallState);

    const installed = makeNixInstallState({
      installed: true,
      darwinRebuildAvailable: true,
    });
    apiMocks.listeners.get("nix_install_state_changed")?.({ payload: installed });
    expect(viewModelActions.getState().nixInstall).toBe(installed);

    // A freshly recorded error surfaces in UI state.
    const failed = makeNixInstallState({
      installed: false,
      lastError: "boom",
    });
    apiMocks.listeners.get("nix_install_state_changed")?.({ payload: failed });
    expect(useUiState.getState().error).toBe("boom");

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("hydrates and mirrors the rebuild slice, resetting the log at lifecycle boundaries", async () => {
    const stop = await startRebuildSync();

    expect(viewModelActions.getState().rebuildStatus).toBe(apiMocks.rebuildStatus);

    // A new run resets the fold and seeds the preparing line.
    viewModelActions.setState({
      rebuildLog: {
        lines: [{ id: 7, text: "stale", type: "info" }],
        rawLines: ["stale"],
        notices: [
          {
            id: "stale-notice",
            title: "Stale notice",
            body: "This should be cleared when a new run starts.",
          },
        ],
      },
    });
    uiActions.setRebuildPanelDismissed(true);
    const running = makeRebuildStatus({ isRunning: true });
    apiMocks.listeners.get("rebuild_status_changed")?.({ payload: running });

    expect(viewModelActions.getState().rebuildStatus).toBe(running);
    expect(viewModelActions.getState().rebuildLog.lines).toEqual([
      { id: 0, text: "Preparing rebuild...", type: "info" },
    ]);
    expect(viewModelActions.getState().rebuildLog.rawLines).toEqual([]);
    expect(viewModelActions.getState().rebuildLog.notices).toEqual([]);
    expect(useUiState.getState().rebuildPanelDismissed).toBe(false);

    // Output streams fold into the log.
    apiMocks.listeners.get("darwin:apply:data")?.({ payload: { chunk: "raw a\nraw b\n" } });
    expect(viewModelActions.getState().rebuildLog.rawLines).toEqual(["raw a", "raw b"]);

    apiMocks.listeners.get("darwin:apply:data")?.({
      payload: { chunk: "`darwin-rebuild` requires permission to update your apps\n" },
    });
    expect(viewModelActions.getState().rebuildLog.notices).toEqual([
      expect.objectContaining({ id: "app-management-permission" }),
    ]);

    apiMocks.listeners.get("darwin:apply:summary")?.({ payload: { text: "Building..." } });
    apiMocks.listeners.get("darwin:apply:summary")?.({
      payload: { text: "It broke", error: true, error_type: REBUILD_ERROR_CODES.BUILD_ERROR },
    });
    expect(viewModelActions.getState().rebuildLog.lines).toEqual([
      { id: 0, text: "Preparing rebuild...", type: "info" },
      { id: 1, text: "Building...", type: "info" },
      { id: 2, text: "It broke", type: "stderr" },
    ]);

    // Run ending releases the processing flag.
    uiActions.setProcessing(true, "apply");
    const done = makeRebuildStatus({ success: true, exitCode: 0 });
    apiMocks.listeners.get("rebuild_status_changed")?.({ payload: done });
    expect(viewModelActions.getState().rebuildStatus).toBe(done);
    expect(viewModelActions.getState().rebuildLog.lines).toHaveLength(3);
    expect(useUiState.getState().isProcessing).toBe(false);
    expect(apiMocks.refreshPermissions).not.toHaveBeenCalled();

    // A backend reset, such as onboarding.reset, clears the stale finished
    // result through the normal observable mirror path.
    const reset = makeRebuildStatus();
    apiMocks.listeners.get("rebuild_status_changed")?.({ payload: reset });
    expect(viewModelActions.getState().rebuildStatus).toBe(reset);
    expect(viewModelActions.getState().rebuildLog).toEqual({
      lines: [],
      rawLines: [],
      notices: [],
    });

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(3);
  });

  it("keeps the rebuild panel dismissed when hydrating a finished run from a prior UI session", async () => {
    // The rebuild-status cell lives on the long-lived backend process; a
    // reopened webview must not resurrect the previous run's panel.
    apiMocks.rebuildStatus = makeRebuildStatus({ success: true, exitCode: 0 });
    uiActions.setRebuildPanelDismissed(false);

    const stop = await startRebuildSync();

    expect(viewModelActions.getState().rebuildStatus).toBe(apiMocks.rebuildStatus);
    expect(useUiState.getState().rebuildPanelDismissed).toBe(true);
    // No log lines are seeded for a stale finished run (nothing to show).
    expect(viewModelActions.getState().rebuildLog.lines).toEqual([]);

    stop();
  });

  it("opens the rebuild panel when hydrating a run that is still in flight", async () => {
    apiMocks.rebuildStatus = makeRebuildStatus({ isRunning: true });
    uiActions.setRebuildPanelDismissed(true);

    const stop = await startRebuildSync();

    expect(useUiState.getState().rebuildPanelDismissed).toBe(false);
    expect(viewModelActions.getState().rebuildLog.lines).toEqual([
      { id: 0, text: "Preparing rebuild...", type: "info" },
    ]);

    stop();
  });

  it("re-probes permissions when a rebuild fails with full_disk_access", async () => {
    const stop = await startRebuildSync();

    apiMocks.listeners.get("rebuild_status_changed")?.({
      payload: makeRebuildStatus({ isRunning: true }),
    });
    apiMocks.listeners.get("rebuild_status_changed")?.({
      payload: makeRebuildStatus({
        success: false,
        errorType: REBUILD_ERROR_CODES.FULL_DISK_ACCESS,
        errorMessage: "needs FDA",
      }),
    });

    expect(apiMocks.refreshPermissions).toHaveBeenCalledTimes(1);

    stop();
  });

  it("keeps App Management failures in the rebuild error panel instead of re-probing permissions", async () => {
    const stop = await startRebuildSync();

    apiMocks.listeners.get("rebuild_status_changed")?.({
      payload: makeRebuildStatus({ isRunning: true }),
    });
    apiMocks.listeners.get("rebuild_status_changed")?.({
      payload: makeRebuildStatus({
        success: false,
        errorType: REBUILD_ERROR_CODES.APP_MANAGEMENT,
        errorMessage: "needs App Management",
      }),
    });

    expect(apiMocks.refreshPermissions).not.toHaveBeenCalled();

    stop();
  });

  it("folds the evolve event stream, resetting on start events", async () => {
    const stop = await startEvolutionSync();

    const start: EvolveEvent = {
      raw: "Starting evolution...",
      summary: "Starting evolution",
      eventType: "start",
      iteration: null,
      timestampMs: 0,
    };
    const thinking: EvolveEvent = {
      raw: "",
      summary: "Thinking",
      eventType: "thinking",
      iteration: 1,
      timestampMs: 100,
    };

    viewModelActions.setState({ evolveEvents: [thinking] });
    apiMocks.listeners.get("darwin:evolve:event")?.({ payload: start });
    expect(viewModelActions.getState().evolveEvents).toEqual([start]);

    apiMocks.listeners.get("darwin:evolve:event")?.({ payload: thinking });
    expect(viewModelActions.getState().evolveEvents).toEqual([start, thinking]);

    // Raw payloads append to the console log; empty ones do not.
    expect(useUiState.getState().consoleLogs).toBe("Starting evolution...\n");

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("mirrors terminal complete data into UI state and logs the completion", async () => {
    const stop = await startEvolutionSync();

    const complete: EvolveEvent = {
      raw: "Evolution complete: installed vim",
      summary: "Evolution complete!",
      eventType: "complete",
      iteration: 3,
      timestampMs: 4200,
      telemetry: {
        state: "generated",
        iterations: 3,
        buildAttempts: 1,
        totalTokens: 10,
        editsCount: 1,
        thinkingCount: 0,
        toolCallsCount: 2,
        durationMs: 61000,
      },
      conversationalResponse: "No file changes needed.",
    };
    apiMocks.listeners.get("darwin:evolve:event")?.({ payload: complete });

    expect(useUiState.getState().evolutionTelemetry).toBe(complete.telemetry);
    expect(useUiState.getState().conversationalResponse).toBe("No file changes needed.");
    expect(useUiState.getState().consoleLogs).toContain(
      "✓ Evolution complete in 1m 1s and 3 iterations",
    );

    stop();
  });

  it("logs a stopped message on a limit-reached terminal event", async () => {
    const stop = await startEvolutionSync();

    const limitReached: EvolveEvent = {
      raw: "",
      summary: "Stopped at safety limit",
      eventType: "complete",
      iteration: 25,
      timestampMs: 9000,
      telemetry: {
        state: "limitReached",
        iterations: 25,
        buildAttempts: 0,
        totalTokens: 50_000,
        editsCount: 0,
        thinkingCount: 0,
        toolCallsCount: 0,
        durationMs: 12_345,
      },
    };
    apiMocks.listeners.get("darwin:evolve:event")?.({ payload: limitReached });

    const logs = useUiState.getState().consoleLogs;
    expect(logs).toContain("Evolution stopped (safety limit reached)");
    expect(logs).not.toContain("✓ Evolution complete");

    stop();
  });

  it("hydrates and mirrors the prompt-history slice", async () => {
    apiMocks.promptHistory = ["first prompt"];
    const stop = await startPromptHistorySync();

    expect(viewModelActions.getState().promptHistory).toEqual(["first prompt"]);

    apiMocks.listeners.get("prompt_history_changed")?.({
      payload: ["second prompt", "first prompt"],
    });

    expect(viewModelActions.getState().promptHistory).toEqual(["second prompt", "first prompt"]);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });
});
