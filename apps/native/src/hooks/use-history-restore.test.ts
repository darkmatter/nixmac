import type { GitStatus, HistoryItem } from "@/ipc/types";
import type { TelemetryEvent } from "@/lib/telemetry/types";
import { mirrorGitState } from "@/viewmodel/git";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoryRestore } from "./use-history-restore";

const mocks = vi.hoisted(() => ({
  abortRestore: vi.fn<() => Promise<void>>(),
  captureEvent: vi.fn<(event: TelemetryEvent) => void>(),
  finalizeRestore: vi.fn<() => Promise<GitStatus>>(),
  loadHistory: vi.fn<() => Promise<void>>(),
  prepareRestore: vi.fn<() => Promise<void>>(),
  triggerRebuild: vi.fn<
    (options: {
      onFailure?: (errorType?: string | null) => Promise<void>;
      onSuccess?: () => Promise<void>;
    }) => Promise<void>
  >(),
}));

vi.mock("@/hooks/use-history", () => ({
  useHistory: () => ({
    loadHistory: mocks.loadHistory,
  }),
}));

vi.mock("@/hooks/use-rebuild-stream", () => ({
  useRebuildStream: () => ({
    triggerRebuild: mocks.triggerRebuild,
  }),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    darwin: {
      abortRestore: mocks.abortRestore,
      finalizeRestore: mocks.finalizeRestore,
      prepareRestore: mocks.prepareRestore,
    },
  },
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mocks.captureEvent,
  }),
}));

const cleanGitStatus: GitStatus = {
  additions: 0,
  branch: "main",
  changes: [],
  cleanHead: true,
  deletions: 0,
  diff: "",
  files: [],
  headCommitHash: "abc123",
};

const historyItem: HistoryItem = {
  changeMap: null,
  commit: null,
  createdAt: 1_700_000_000,
  fileCount: 4,
  hash: "target-secret-hash",
  isBase: false,
  isBuilt: true,
  isExternal: false,
  isOrphanedRestore: false,
  isUndone: false,
  message: "Restore target",
  originHash: null,
  originMessage: null,
  rawChanges: [],
  unsummarizedHashes: [],
};

describe("useHistoryRestore telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.abortRestore.mockResolvedValue(undefined);
    mocks.finalizeRestore.mockResolvedValue(cleanGitStatus);
    mocks.loadHistory.mockResolvedValue(undefined);
    mocks.prepareRestore.mockResolvedValue(undefined);
    mocks.triggerRebuild.mockResolvedValue(undefined);
    mirrorGitState({ ...cleanGitStatus, files: [] });
  });

  it("emits history restore start and success without commit hashes or paths", async () => {
    const { result } = renderHook(() =>
      useHistoryRestore([historyItem], vi.fn()),
    );

    act(() => {
      result.current.handleRequestRestore(historyItem.hash);
    });
    await waitFor(() =>
      expect(result.current.previewTargetHash).toBe(historyItem.hash),
    );

    act(() => {
      result.current.handleConfirmRestore();
    });

    await waitFor(() => expect(mocks.prepareRestore).toHaveBeenCalledWith(historyItem.hash));
    const onSuccess = mocks.triggerRebuild.mock.calls[0][0]
      .onSuccess as () => Promise<void>;

    await act(async () => {
      await onSuccess();
    });

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "history_restore_started",
      props: { changed_file_count: 4, surface: "gui" },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "history_restore_completed",
      props: { changed_file_count: 4, surface: "gui" },
    });
    expect(JSON.stringify(mocks.captureEvent.mock.calls)).not.toContain(
      historyItem.hash,
    );
  });

  it("emits history restore failure from the rebuild error category only", async () => {
    const { result } = renderHook(() =>
      useHistoryRestore([historyItem], vi.fn()),
    );

    act(() => {
      result.current.handleRequestRestore(historyItem.hash);
    });
    await waitFor(() =>
      expect(result.current.previewTargetHash).toBe(historyItem.hash),
    );

    act(() => {
      result.current.handleConfirmRestore();
    });

    await waitFor(() => expect(mocks.prepareRestore).toHaveBeenCalledWith(historyItem.hash));
    const onFailure = mocks.triggerRebuild.mock.calls[0][0]
      .onFailure as (errorType?: string | null) => Promise<void>;

    await act(async () => {
      await onFailure("full_disk_access");
    });

    expect(mocks.abortRestore).toHaveBeenCalledTimes(1);
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "history_restore_failed",
      props: {
        category: "full_disk_access",
        changed_file_count: 4,
        surface: "gui",
      },
    });
    expect(JSON.stringify(mocks.captureEvent.mock.calls)).not.toContain(
      historyItem.hash,
    );
  });

  it("emits exactly one failed terminal event when finalize restore throws", async () => {
    mocks.finalizeRestore.mockRejectedValue(new Error("finalize failed"));

    const { result } = renderHook(() =>
      useHistoryRestore([historyItem], vi.fn()),
    );

    act(() => {
      result.current.handleRequestRestore(historyItem.hash);
    });
    await waitFor(() =>
      expect(result.current.previewTargetHash).toBe(historyItem.hash),
    );

    act(() => {
      result.current.handleConfirmRestore();
    });

    await waitFor(() => expect(mocks.prepareRestore).toHaveBeenCalledWith(historyItem.hash));
    const onSuccess = mocks.triggerRebuild.mock.calls[0][0]
      .onSuccess as () => Promise<void>;

    await act(async () => {
      await expect(onSuccess()).rejects.toThrow("finalize failed");
    });

    expect(
      mocks.captureEvent.mock.calls.filter(([event]) =>
        event.name.startsWith("history_restore_"),
      ),
    ).toEqual([
      [
        {
          name: "history_restore_started",
          props: { changed_file_count: 4, surface: "gui" },
        },
      ],
      [
        {
          name: "history_restore_failed",
          props: {
            category: "generic_error",
            changed_file_count: 4,
            surface: "gui",
          },
        },
      ],
    ]);
  });

  it("keeps completed as the terminal event when history refresh throws", async () => {
    mocks.loadHistory.mockRejectedValue(new Error("refresh failed"));

    const { result } = renderHook(() =>
      useHistoryRestore([historyItem], vi.fn()),
    );

    act(() => {
      result.current.handleRequestRestore(historyItem.hash);
    });
    await waitFor(() =>
      expect(result.current.previewTargetHash).toBe(historyItem.hash),
    );

    act(() => {
      result.current.handleConfirmRestore();
    });

    await waitFor(() => expect(mocks.prepareRestore).toHaveBeenCalledWith(historyItem.hash));
    const onSuccess = mocks.triggerRebuild.mock.calls[0][0]
      .onSuccess as () => Promise<void>;

    await act(async () => {
      await expect(onSuccess()).rejects.toThrow("refresh failed");
    });

    expect(
      mocks.captureEvent.mock.calls.filter(([event]) =>
        event.name.startsWith("history_restore_"),
      ),
    ).toEqual([
      [
        {
          name: "history_restore_started",
          props: { changed_file_count: 4, surface: "gui" },
        },
      ],
      [
        {
          name: "history_restore_completed",
          props: { changed_file_count: 4, surface: "gui" },
        },
      ],
    ]);
  });

  it("emits failed terminal telemetry before swallowing abort restore cleanup failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.abortRestore.mockRejectedValue(new Error("abort failed"));

    const { result } = renderHook(() =>
      useHistoryRestore([historyItem], vi.fn()),
    );

    act(() => {
      result.current.handleRequestRestore(historyItem.hash);
    });
    await waitFor(() =>
      expect(result.current.previewTargetHash).toBe(historyItem.hash),
    );

    act(() => {
      result.current.handleConfirmRestore();
    });

    await waitFor(() => expect(mocks.prepareRestore).toHaveBeenCalledWith(historyItem.hash));
    const onFailure = mocks.triggerRebuild.mock.calls[0][0]
      .onFailure as (errorType?: string | null) => Promise<void>;

    await expect(onFailure("full_disk_access")).resolves.toBeUndefined();

    expect(mocks.abortRestore).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to abort history restore:",
      expect.any(Error),
    );
    expect(
      mocks.captureEvent.mock.calls.filter(([event]) =>
        event.name.startsWith("history_restore_"),
      ),
    ).toEqual([
      [
        {
          name: "history_restore_started",
          props: { changed_file_count: 4, surface: "gui" },
        },
      ],
      [
        {
          name: "history_restore_failed",
          props: {
            category: "full_disk_access",
            changed_file_count: 4,
            surface: "gui",
          },
        },
      ],
    ]);
    consoleError.mockRestore();
  });
});
