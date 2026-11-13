import type { HistoryItem } from "@/ipc/types";
import { initialUiState, initialViewModelState, uiActions, viewModelActions } from "@nixmac/state";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoryRestore } from "./use-history-restore";

const mocks = vi.hoisted(() => ({
  abortRestore: vi.fn<() => Promise<void>>(),
  captureEvent: vi.fn<() => void>(),
  clearRebuildRetry: vi.fn<() => void>(),
  finalizeRestore: vi.fn<() => Promise<void>>(),
  invalidateHistory: vi.fn<() => void>(),
  prepareRestore: vi.fn<() => Promise<void>>(),
  triggerRebuild: vi.fn(),
}));

vi.mock("@/hooks/use-rebuild-stream", () => ({
  clearRebuildRetry: mocks.clearRebuildRetry,
  useRebuildStream: () => ({
    triggerRebuild: mocks.triggerRebuild,
  }),
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    darwin: {
      abortRestore: mocks.abortRestore,
      finalizeRestore: mocks.finalizeRestore,
      prepareRestore: mocks.prepareRestore,
    },
  },
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({ captureEvent: mocks.captureEvent }),
}));

vi.mock("@/viewmodel/history", () => ({
  invalidateHistory: mocks.invalidateHistory,
}));

const target: HistoryItem = {
  hash: "target-hash",
  message: "Install vim",
  createdAt: 1_700_000_000,
  isBuilt: false,
  isBase: false,
  isExternal: false,
  fileCount: 0,
  changeMap: null,
  unsummarizedHashes: [],
  rawChanges: [],
  originMessage: null,
  originHash: null,
  isOrphanedRestore: false,
  isUndone: false,
};

describe("useHistoryRestore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.abortRestore.mockResolvedValue(undefined);
    mocks.finalizeRestore.mockResolvedValue(undefined);
    mocks.prepareRestore.mockResolvedValue(undefined);
    mocks.triggerRebuild.mockResolvedValue(undefined);
    uiActions.setState({ ...initialUiState });
    viewModelActions.setState({
      ...initialViewModelState,
      git: {
        files: [],
        branch: "main",
        diff: "",
        additions: 0,
        deletions: 0,
        headCommitHash: "head-hash",
        cleanHead: true,
        changes: [],
      },
    });
  });

  it("re-prepares the target before retrying a failed history restore", async () => {
    const { result } = renderHook(() => useHistoryRestore([target], vi.fn()));

    act(() => {
      result.current.handleRequestRestore(target.hash);
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.handleConfirmRestore();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.prepareRestore).toHaveBeenCalledTimes(1);
    expect(mocks.triggerRebuild).toHaveBeenCalledTimes(1);

    const firstOptions = mocks.triggerRebuild.mock.calls[0][0];
    await act(async () => {
      await firstOptions.retry();
    });

    expect(mocks.prepareRestore).toHaveBeenCalledTimes(2);
    expect(mocks.prepareRestore).toHaveBeenLastCalledWith({ targetHash: target.hash });
    expect(mocks.triggerRebuild).toHaveBeenCalledTimes(2);

    const retryOptions = mocks.triggerRebuild.mock.calls[1][0];
    expect(retryOptions.onSuccess).toBeTypeOf("function");
    expect(retryOptions.onFailure).toBeTypeOf("function");

    await act(async () => {
      await retryOptions.onSuccess();
    });

    expect(mocks.finalizeRestore).toHaveBeenCalledWith({ targetHash: target.hash });
    expect(mocks.invalidateHistory).toHaveBeenCalledTimes(1);
  });
});
