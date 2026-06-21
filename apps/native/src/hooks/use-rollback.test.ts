import type { EvolveState, GitStatus } from "@/ipc/types";
import { initialUiState, useUiState } from "@nixmac/state";
import { useViewModel } from "@nixmac/state";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRollback } from "./use-rollback";

const mocks = vi.hoisted(() => ({
  finalizeRollback: vi.fn(),
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

describe("useRollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.finalizeRollback.mockResolvedValue(undefined);
    mocks.rollbackErase.mockResolvedValue({
      rollbackChangesetId: 1,
      rollbackStorePath: "/nix/store/old-system",
    });
    mocks.triggerRebuild.mockResolvedValue(undefined);

    useUiState.setState({ ...initialUiState });
    useUiState.getState().setEvolvePrompt("Install vim");
    useViewModel.setState({
      evolve: committableEvolveState,
      git: cleanGitStatus,
      build: { externalBuildDetected: false },
    });
  });

  it("keeps processing locked while a committable rollback rebuild is still running", async () => {
    const { result } = renderHook(() => useRollback());

    await act(async () => {
      await result.current.handleRollback();
    });

    expect(mocks.triggerRebuild).toHaveBeenCalledTimes(1);
    expect(useUiState.getState().isProcessing).toBe(true);
  });

  it("finalizes the rollback with the erased run's target after the rebuild succeeds", async () => {
    const { result } = renderHook(() => useRollback());

    await act(async () => {
      await result.current.handleRollback();
    });

    const onSuccess = mocks.triggerRebuild.mock.calls[0][0].onSuccess as () => Promise<void>;
    await act(async () => {
      await onSuccess();
    });

    expect(mocks.finalizeRollback).toHaveBeenCalledWith("/nix/store/old-system", 1);
  });

  it("releases processing immediately when there is nothing to rebuild", async () => {
    useViewModel.setState({
      evolve: { ...committableEvolveState, committable: false },
    });

    const { result } = renderHook(() => useRollback());

    await act(async () => {
      await result.current.handleRollback();
    });

    expect(mocks.triggerRebuild).not.toHaveBeenCalled();
    expect(useUiState.getState().isProcessing).toBe(false);
    expect(useUiState.getState().evolvePrompt).toBe("");
  });
});
