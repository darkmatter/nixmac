import type { EvolveState, GitStatus } from "@/ipc/types";
import { useWidgetStore } from "@/stores/widget-store";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRollback } from "./use-rollback";

const mocks = vi.hoisted(() => ({
  finalizeRollback: vi.fn(),
  findChangeMap: vi.fn(),
  rollbackErase: vi.fn(),
  triggerRebuild: vi.fn(),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    darwin: {
      finalizeRollback: mocks.finalizeRollback,
      rollbackErase: mocks.rollbackErase,
    },
  },
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

vi.mock("@/lib/env", () => ({
  getWebSiteUrl: () => "http://localhost:3001",
  settings: {},
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

const committableEvolveState: EvolveState = {
  backupBranch: "backup",
  committable: true,
  currentChangesetId: 2,
  evolutionId: 1,
  rollbackBranch: "rollback",
  rollbackChangesetId: 1,
  rollbackStorePath: "/nix/store/old-system",
  step: "commit",
};

const rolledBackEvolveState: EvolveState = {
  ...committableEvolveState,
  committable: false,
  currentChangesetId: null,
  rollbackChangesetId: null,
  rollbackStorePath: null,
  step: "begin",
};

describe("useRollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findChangeMap.mockResolvedValue(undefined);
    mocks.finalizeRollback.mockResolvedValue({
      evolveState: rolledBackEvolveState,
      gitStatus: cleanGitStatus,
    });
    mocks.rollbackErase.mockResolvedValue({
      evolveState: rolledBackEvolveState,
      gitStatus: cleanGitStatus,
      rollbackChangesetId: 1,
      rollbackStorePath: "/nix/store/old-system",
    });
    mocks.triggerRebuild.mockResolvedValue(undefined);

    const store = useWidgetStore.getState();
    store.setEvolvePrompt("Install vim");
    mirrorEvolveState(committableEvolveState);
    mirrorGitState(cleanGitStatus);
    store.setProcessing(false);
    store.setGenerating(false);
    store.setError(null);
    store.clearLogs();
  });

  it("keeps processing locked while a committable rollback rebuild is still running", async () => {
    const { result } = renderHook(() => useRollback());

    await act(async () => {
      await result.current.handleRollback();
    });

    expect(mocks.triggerRebuild).toHaveBeenCalledTimes(1);
    expect(useWidgetStore.getState().isProcessing).toBe(true);
    expect(mocks.findChangeMap).not.toHaveBeenCalled();
  });

  it("refreshes the change map after rollback rebuild finalization succeeds", async () => {
    const { result } = renderHook(() => useRollback());

    await act(async () => {
      await result.current.handleRollback();
    });

    const onSuccess = mocks.triggerRebuild.mock.calls[0][0].onSuccess as () => Promise<void>;
    await act(async () => {
      await onSuccess();
    });

    expect(mocks.finalizeRollback).toHaveBeenCalledWith("/nix/store/old-system", 1);
    expect(mocks.findChangeMap).toHaveBeenCalledTimes(1);
  });
});
