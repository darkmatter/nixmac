import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRollback } from "@/hooks/use-rollback";
import type { EvolveState, GitStatus } from "@/ipc/types";
import { useWidgetStore } from "@/stores/widget-store";

const mocks = vi.hoisted(() => ({
  triggerRebuild: vi.fn(),
  findChangeMap: vi.fn<() => Promise<void>>(),
  rollbackErase: vi.fn(),
  finalizeRollback: vi.fn(),
}));

vi.mock("@/hooks/use-rebuild-stream", () => ({
  useRebuildStream: () => ({
    triggerRebuild: mocks.triggerRebuild,
  }),
}));

vi.mock("@/hooks/use-summary", () => ({
  useSummary: () => ({
    findChangeMap: mocks.findChangeMap,
  }),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    darwin: {
      rollbackErase: mocks.rollbackErase,
      finalizeRollback: mocks.finalizeRollback,
    },
  },
}));

const gitStatus: GitStatus = {
  files: [],
  branch: "main",
  diff: "",
  additions: 0,
  deletions: 0,
  headCommitHash: "abc123",
  cleanHead: true,
  changes: [],
};

const committableState: EvolveState = {
  evolutionId: 1,
  currentChangesetId: 2,
  committable: true,
  backupBranch: "backup",
  rollbackBranch: "rollback",
  rollbackStorePath: "/nix/store/old-system",
  rollbackChangesetId: 3,
  step: "commit",
  lastEvolutionState: null,
};

const rolledBackState: EvolveState = {
  ...committableState,
  currentChangesetId: 3,
  committable: false,
  step: "begin",
};

function resetStore() {
  const store = useWidgetStore.getState();
  store.setEvolveState(null);
  store.setGitStatus(null);
  store.setEvolvePrompt("");
  store.setProcessing(false);
  store.clearLogs();
}

describe("useRollback", () => {
  beforeEach(() => {
    resetStore();
    mocks.triggerRebuild.mockReset();
    mocks.findChangeMap.mockReset();
    mocks.rollbackErase.mockReset();
    mocks.finalizeRollback.mockReset();

    mocks.findChangeMap.mockResolvedValue();
    mocks.rollbackErase.mockResolvedValue({
      gitStatus,
      evolveState: rolledBackState,
      rollbackStorePath: "/nix/store/old-system",
      rollbackChangesetId: 3,
    });
    mocks.finalizeRollback.mockResolvedValue({
      gitStatus,
      evolveState: rolledBackState,
    });
  });

  afterEach(() => {
    resetStore();
  });

  it("waits for rebuild success before finalizing and refreshing rollback summaries", async () => {
    useWidgetStore.getState().setEvolveState(committableState);
    let onSuccess: (() => Promise<void>) | undefined;
    mocks.triggerRebuild.mockImplementation(async (options: { onSuccess?: () => Promise<void> }) => {
      onSuccess = options.onSuccess;
    });

    const { result } = renderHook(() => useRollback());

    await act(async () => {
      await result.current.handleRollback();
    });

    expect(mocks.triggerRebuild).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "rollback",
        storePath: "/nix/store/old-system",
      }),
    );
    expect(mocks.finalizeRollback).not.toHaveBeenCalled();
    expect(mocks.findChangeMap).not.toHaveBeenCalled();
    expect(useWidgetStore.getState().isProcessing).toBe(true);

    await act(async () => {
      await onSuccess?.();
    });

    expect(mocks.finalizeRollback).toHaveBeenCalledWith("/nix/store/old-system", 3);
    expect(mocks.findChangeMap).toHaveBeenCalledTimes(1);
  });
});
