import type {
  EvolveState,
  GitState,
  GitStatus,
  SemanticChangeMap,
} from "@/ipc/types";
import { useUiState, initialUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startChangeMapSync } from "./change-map";
import { startEvolveSync } from "./evolve";
import { startGitSync } from "./git";

const apiMocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
  evolveState: {} as EvolveState,
  gitStatus: {} as GitStatus,
  changeMap: {} as SemanticChangeMap,
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
      status: vi.fn(() => Promise.resolve(apiMocks.gitStatus)),
    },
    summarizedChanges: {
      findChangeMap: vi.fn(() => Promise.resolve(apiMocks.changeMap)),
    },
    history: {
      get: vi.fn(() => Promise.resolve([])),
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
    apiMocks.evolveState = { step: "begin" } as unknown as EvolveState;
    apiMocks.gitStatus = { hasChanges: false, files: [] } as unknown as GitStatus;
    apiMocks.changeMap = { groups: [], singles: [] } as unknown as SemanticChangeMap;

    useViewModel.setState({
      evolve: null,
      git: null,
      build: { externalBuildDetected: false },
      changeMap: null,
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

  it("hydrates git and mirrors git slice events", async () => {
    const stop = await startGitSync();

    expect(useViewModel.getState().git).toBe(apiMocks.gitStatus);

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

  it("hydrates and mirrors the change-map slice", async () => {
    const stop = await startChangeMapSync();

    expect(useViewModel.getState().changeMap).toBe(apiMocks.changeMap);

    const changeMap = { groups: [{}], singles: [] } as unknown as SemanticChangeMap;
    apiMocks.listeners.get("change_map_changed")?.({ payload: changeMap });

    expect(useViewModel.getState().changeMap).toBe(changeMap);

    stop();
    expect(apiMocks.unlisten).toHaveBeenCalledTimes(1);
  });
});
