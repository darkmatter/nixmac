import type {
  EvolveState,
  GitState,
  GitStatus,
  GlobalPreferences,
  PermissionsState,
  SemanticChangeMap,
} from "@/ipc/types";
import { useUiState, initialUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { makeGlobalPreferences } from "@/utils/test-fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startChangeMapSync } from "./change-map";
import { startEvolveSync } from "./evolve";
import { startGitSync } from "./git";
import { startPermissionsSync } from "./permissions";
import { startPreferencesSync } from "./preferences";
import { startPromptHistorySync } from "./prompt-history";

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
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    darwin: {
      evolve: vi.fn(),
      evolveAnswer: vi.fn(),
      evolveCancel: vi.fn(),
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
