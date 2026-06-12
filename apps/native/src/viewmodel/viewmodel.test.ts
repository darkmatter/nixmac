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
import { useUiState, initialUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import {
  makeGlobalPreferences,
  makeNixInstallState,
  makeRebuildStatus,
} from "@/utils/test-fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startChangeMapSync } from "./change-map";
import { startEvolutionSync } from "./evolution";
import { startEvolveSync } from "./evolve";
import { startGitSync } from "./git";
import { startNixInstallSync } from "./nix-install";
import { startPermissionsSync } from "./permissions";
import { startPreferencesSync } from "./preferences";
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
    history: {
      get: vi.fn(() => Promise.resolve([])),
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

    useViewModel.setState({
      evolve: null,
      git: null,
      build: { externalBuildDetected: false },
      changeMap: null,
      preferences: null,
      hosts: [],
      permissions: null,
      permissionsHydrated: false,
      promptHistory: [],
      nixInstall: null,
      nixDownloadProgress: null,
      rebuildStatus: null,
      rebuildLog: { lines: [], rawLines: [] },
      evolveEvents: [],
    });
    useUiState.setState({ ...initialUiState });
  });

  it("hydrates and mirrors the evolve slice", async () => {
    const stop = await startEvolveSync();

    expect(useViewModel.getState().evolve).toBe(apiMocks.evolveState);

    const next = { step: "commit" } as unknown as EvolveState;
    apiMocks.listeners.get("evolve_state_changed")?.({ payload: next });

    expect(useViewModel.getState().evolve).toBe(next);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("hydrates git from get_git_state and mirrors git slice events", async () => {
    const stop = await startGitSync();

    expect(useViewModel.getState().git).toBe(apiMocks.gitState.gitStatus);
    expect(useViewModel.getState().build.externalBuildDetected).toBe(false);

    const gitStatus = { hasChanges: true, files: [] } as unknown as GitStatus;
    const event: GitState = {
      gitStatus,
      externalBuildDetected: true,
    };

    apiMocks.listeners.get("git_state_changed")?.({ payload: event });

    expect(useViewModel.getState().git).toBe(gitStatus);
    expect(useViewModel.getState().build.externalBuildDetected).toBe(true);

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

    expect(useViewModel.getState().changeMap).toBe(apiMocks.changeMap);

    const changeMap = { groups: [{}], singles: [] } as unknown as SemanticChangeMap;
    apiMocks.listeners.get("change_map_changed")?.({ payload: changeMap });

    expect(useViewModel.getState().changeMap).toBe(changeMap);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("hydrates and mirrors the preferences slice", async () => {
    apiMocks.preferences = makeGlobalPreferences({ developerMode: true });
    const stop = await startPreferencesSync();

    expect(useViewModel.getState().preferences).toBe(apiMocks.preferences);

    const next = makeGlobalPreferences({ confirmBuild: false });
    apiMocks.listeners.get("global_preferences_changed")?.({ payload: next });

    expect(useViewModel.getState().preferences).toBe(next);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("refreshes hosts when preferences carry a configDir", async () => {
    apiMocks.preferences = makeGlobalPreferences({ configDir: "/Users/me/.darwin" });
    apiMocks.hosts = ["mbp"];
    const stop = await startPreferencesSync();

    expect(useViewModel.getState().hosts).toEqual(["mbp"]);

    apiMocks.hosts = ["mbp", "workbook"];
    apiMocks.listeners.get("global_preferences_changed")?.({
      payload: makeGlobalPreferences({ configDir: "/Users/me/.darwin" }),
    });
    await vi.waitFor(() => {
      expect(useViewModel.getState().hosts).toEqual(["mbp", "workbook"]);
    });

    stop();
  });

  it("keeps previous hosts when listing fails or configDir is unset", async () => {
    // No configDir -> listHosts is never queried.
    const stop = await startPreferencesSync();
    expect(apiMocks.listHosts).not.toHaveBeenCalled();
    expect(useViewModel.getState().hosts).toEqual([]);

    // configDir set but listing fails -> hosts unchanged, error logged.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    useViewModel.setState({ hosts: ["existing"] });
    apiMocks.listHosts.mockRejectedValue(new Error("nix missing"));
    apiMocks.listeners.get("global_preferences_changed")?.({
      payload: makeGlobalPreferences({ configDir: "/Users/me/.darwin" }),
    });
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });
    expect(useViewModel.getState().hosts).toEqual(["existing"]);
    consoleError.mockRestore();

    stop();
  });

  it("hydrates and mirrors the permissions slice, flagging hydration", async () => {
    const stop = await startPermissionsSync();

    // Hydrated to null (never probed) still counts as hydrated.
    expect(useViewModel.getState().permissions).toBeNull();
    expect(useViewModel.getState().permissionsHydrated).toBe(true);

    const next: PermissionsState = {
      permissions: [],
      allRequiredGranted: true,
      checkedAt: 123,
    };
    apiMocks.listeners.get("permissions_changed")?.({ payload: next });

    expect(useViewModel.getState().permissions).toBe(next);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("hydrates and mirrors the nix-install slice, folding download progress", async () => {
    const stop = await startNixInstallSync();

    expect(useViewModel.getState().nixInstall).toBe(apiMocks.nixInstallState);

    const installing = makeNixInstallState({
      installed: false,
      installing: true,
      installPhase: "downloading",
    });
    apiMocks.listeners.get("nix_install_state_changed")?.({ payload: installing });
    expect(useViewModel.getState().nixInstall).toBe(installing);

    // Progress events with both fields fold into nixDownloadProgress.
    apiMocks.listeners.get("nix:install:progress")?.({
      payload: { phase: "downloading", downloaded: 10, total: 100 },
    });
    expect(useViewModel.getState().nixDownloadProgress).toEqual({ downloaded: 10, total: 100 });

    // Events missing a field are ignored.
    apiMocks.listeners.get("nix:install:progress")?.({
      payload: { phase: "waiting-for-installer", downloaded: null, total: null },
    });
    expect(useViewModel.getState().nixDownloadProgress).toEqual({ downloaded: 10, total: 100 });

    // Install finishing clears the progress; a recorded error surfaces in UI state.
    const failed = makeNixInstallState({
      installed: false,
      installing: false,
      lastError: "boom",
    });
    apiMocks.listeners.get("nix_install_state_changed")?.({ payload: failed });
    expect(useViewModel.getState().nixDownloadProgress).toBeNull();
    expect(useUiState.getState().error).toBe("boom");

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(2);
  });

  it("hydrates and mirrors the rebuild slice, resetting the log on new runs", async () => {
    const stop = await startRebuildSync();

    expect(useViewModel.getState().rebuildStatus).toBe(apiMocks.rebuildStatus);

    // A new run resets the fold and seeds the preparing line.
    useViewModel.setState({
      rebuildLog: { lines: [{ id: 7, text: "stale", type: "info" }], rawLines: ["stale"] },
    });
    useUiState.getState().setRebuildPanelDismissed(true);
    const running = makeRebuildStatus({ isRunning: true });
    apiMocks.listeners.get("rebuild_status_changed")?.({ payload: running });

    expect(useViewModel.getState().rebuildStatus).toBe(running);
    expect(useViewModel.getState().rebuildLog.lines).toEqual([
      { id: 0, text: "Preparing rebuild...", type: "info" },
    ]);
    expect(useViewModel.getState().rebuildLog.rawLines).toEqual([]);
    expect(useUiState.getState().rebuildPanelDismissed).toBe(false);

    // Output streams fold into the log.
    apiMocks.listeners.get("darwin:apply:data")?.({ payload: { chunk: "raw a\nraw b\n" } });
    expect(useViewModel.getState().rebuildLog.rawLines).toEqual(["raw a", "raw b"]);

    apiMocks.listeners.get("darwin:apply:summary")?.({ payload: { text: "Building..." } });
    apiMocks.listeners.get("darwin:apply:summary")?.({
      payload: { text: "It broke", error: true, error_type: "build_error" },
    });
    expect(useViewModel.getState().rebuildLog.lines).toEqual([
      { id: 0, text: "Preparing rebuild...", type: "info" },
      { id: 1, text: "Building...", type: "info" },
      { id: 2, text: "It broke", type: "stderr" },
    ]);

    // Run ending releases the processing flag.
    useUiState.getState().setProcessing(true, "apply");
    const done = makeRebuildStatus({ success: true, exitCode: 0 });
    apiMocks.listeners.get("rebuild_status_changed")?.({ payload: done });
    expect(useViewModel.getState().rebuildStatus).toBe(done);
    expect(useUiState.getState().isProcessing).toBe(false);
    expect(apiMocks.refreshPermissions).not.toHaveBeenCalled();

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(3);
  });

  it("re-probes permissions when a rebuild fails with full_disk_access", async () => {
    const stop = await startRebuildSync();

    apiMocks.listeners.get("rebuild_status_changed")?.({
      payload: makeRebuildStatus({ isRunning: true }),
    });
    apiMocks.listeners.get("rebuild_status_changed")?.({
      payload: makeRebuildStatus({
        success: false,
        errorType: "full_disk_access",
        errorMessage: "needs FDA",
      }),
    });

    expect(apiMocks.refreshPermissions).toHaveBeenCalledTimes(1);

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

    useViewModel.setState({ evolveEvents: [thinking] });
    apiMocks.listeners.get("darwin:evolve:event")?.({ payload: start });
    expect(useViewModel.getState().evolveEvents).toEqual([start]);

    apiMocks.listeners.get("darwin:evolve:event")?.({ payload: thinking });
    expect(useViewModel.getState().evolveEvents).toEqual([start, thinking]);

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

  it("hydrates and mirrors the prompt-history slice", async () => {
    apiMocks.promptHistory = ["first prompt"];
    const stop = await startPromptHistorySync();

    expect(useViewModel.getState().promptHistory).toEqual(["first prompt"]);

    apiMocks.listeners.get("prompt_history_changed")?.({
      payload: ["second prompt", "first prompt"],
    });

    expect(useViewModel.getState().promptHistory).toEqual(["second prompt", "first prompt"]);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });
});
