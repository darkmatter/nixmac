import type { EvolveState, GitStatus, WatcherEvent } from "@/ipc/types";
import { useWidgetStore } from "@/stores/widget-store";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWatcher } from "./use-watcher";

const { ipcOn, listeners, loadHistory } = vi.hoisted(() => {
  const listeners: Array<(event: { payload: WatcherEvent }) => void> = [];
  return {
    listeners,
    loadHistory: vi.fn<() => Promise<void>>(),
    ipcOn: vi.fn<
      (channel: string, listener: (event: { payload: WatcherEvent }) => void) => Promise<() => void>
    >((_channel, listener) => {
      listeners.push(listener);
      return Promise.resolve(() => {});
    }),
  };
});

vi.mock("@/ipc/api", () => ({
  ipcRenderer: {
    on: ipcOn,
  },
}));

vi.mock("@/hooks/use-history", () => ({
  useHistory: () => ({ loadHistory }),
}));

const dirtyStatus: GitStatus = {
  files: [{ path: ".nixmac/README.md", changeType: "new" }],
  branch: "main",
  diff: "diff --git a/.nixmac/README.md b/.nixmac/README.md",
  additions: 1,
  deletions: 0,
  headCommitHash: "before",
  cleanHead: false,
  changes: [],
};

const cleanStatus: GitStatus = {
  files: [],
  branch: "main",
  diff: "",
  additions: 0,
  deletions: 0,
  headCommitHash: "after",
  cleanHead: true,
  changes: [],
};

const commitState: EvolveState = {
  evolutionId: 1,
  currentChangesetId: 2,
  committable: true,
  backupBranch: null,
  rollbackBranch: null,
  rollbackStorePath: null,
  rollbackChangesetId: null,
  step: "commit",
  lastEvolutionState: null,
};

const beginState: EvolveState = {
  evolutionId: null,
  currentChangesetId: null,
  committable: false,
  backupBranch: null,
  rollbackBranch: null,
  rollbackStorePath: null,
  rollbackChangesetId: null,
  step: "begin",
  lastEvolutionState: null,
};

const emptyChangeMap = { groups: [], singles: [], unsummarizedHashes: [] };

function emitWatcherEvent(event: WatcherEvent) {
  act(() => {
    listeners[listeners.length - 1]?.({ payload: event });
  });
}

describe("useWatcher", () => {
  beforeEach(() => {
    listeners.length = 0;
    ipcOn.mockClear();
    loadHistory.mockClear();

    const store = useWidgetStore.getState();
    store.setGitStatus(null);
    store.setChangeMap(null);
    store.setEvolveState(null);
    store.setExternalBuildDetected(false);
    store.setProcessing(false);
    store.setGenerating(false);
    store.setShowHistory(false);
    store.setError(null);
  });

  it("applies watcher events immediately when the widget is idle", () => {
    const { result } = renderHook(() => useWatcher());

    act(() => {
      result.current.startWatching();
    });

    emitWatcherEvent({
      error: null,
      gitStatus: dirtyStatus,
      changeMap: emptyChangeMap,
      evolveState: commitState,
      externalBuildDetected: false,
    });

    const store = useWidgetStore.getState();
    expect(store.gitStatus).toBe(dirtyStatus);
    expect(store.evolveState).toBe(commitState);
    expect(store.changeMap).toBe(emptyChangeMap);
  });

  it("flushes the latest watcher event after processing finishes", () => {
    const store = useWidgetStore.getState();
    store.setGitStatus(dirtyStatus);
    store.setEvolveState(commitState);
    store.setProcessing(true, "merge");

    const { result } = renderHook(() => useWatcher());

    act(() => {
      result.current.startWatching();
    });

    emitWatcherEvent({
      error: null,
      gitStatus: cleanStatus,
      changeMap: emptyChangeMap,
      evolveState: beginState,
      externalBuildDetected: false,
    });

    expect(useWidgetStore.getState().gitStatus).toBe(dirtyStatus);
    expect(useWidgetStore.getState().evolveState).toBe(commitState);

    act(() => {
      useWidgetStore.getState().setProcessing(false);
    });

    expect(useWidgetStore.getState().gitStatus).toBe(cleanStatus);
    expect(useWidgetStore.getState().evolveState).toBe(beginState);
    expect(useWidgetStore.getState().changeMap).toBe(emptyChangeMap);
  });

  it("flushes the latest watcher event after generation finishes", () => {
    const store = useWidgetStore.getState();
    store.setGitStatus(dirtyStatus);
    store.setEvolveState(commitState);
    store.setGenerating(true);

    const { result } = renderHook(() => useWatcher());

    act(() => {
      result.current.startWatching();
    });

    emitWatcherEvent({
      error: null,
      gitStatus: cleanStatus,
      changeMap: emptyChangeMap,
      evolveState: beginState,
      externalBuildDetected: false,
    });

    expect(useWidgetStore.getState().gitStatus).toBe(dirtyStatus);
    expect(useWidgetStore.getState().evolveState).toBe(commitState);

    act(() => {
      useWidgetStore.getState().setGenerating(false);
    });

    expect(useWidgetStore.getState().gitStatus).toBe(cleanStatus);
    expect(useWidgetStore.getState().evolveState).toBe(beginState);
    expect(useWidgetStore.getState().changeMap).toBe(emptyChangeMap);
  });
});
