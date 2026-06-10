import type { EvolveState, GitStatus } from "@/ipc/types";
import type { TelemetryEvent } from "@/lib/telemetry/types";
import { useWidgetStore } from "@/stores/widget-store";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApply } from "./use-apply";

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn<(event: TelemetryEvent) => void>(),
  consoleError: vi.fn<typeof console.error>(),
  finalizeApply: vi.fn<
    () => Promise<{ evolveState: EvolveState; gitStatus: GitStatus }>
  >(),
  triggerRebuild: vi.fn<
    (options: {
      onFailure?: () => Promise<void>;
      onSuccess?: () => Promise<void>;
    }) => Promise<void>
  >(),
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mocks.captureEvent,
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
      finalizeApply: mocks.finalizeApply,
    },
  },
}));

const gitStatus: GitStatus = {
  additions: 0,
  branch: "main",
  changes: [],
  cleanHead: true,
  deletions: 0,
  diff: "",
  files: [],
  headCommitHash: "abc123",
};

const evolveState: EvolveState = {
  backupBranch: null,
  committable: false,
  currentChangesetId: 1,
  evolutionId: 1,
  rollbackBranch: null,
  rollbackChangesetId: null,
  rollbackStorePath: null,
  step: "commit",
};

describe("useApply telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(mocks.consoleError);
    mocks.finalizeApply.mockResolvedValue({ evolveState, gitStatus });
    mocks.triggerRebuild.mockResolvedValue(undefined);
    useWidgetStore.getState().setProcessing(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits apply start and completion for the normal rebuild flow", async () => {
    const { result } = renderHook(() => useApply());

    await result.current.handleApply();
    const onSuccess = mocks.triggerRebuild.mock.calls[0][0]
      .onSuccess as () => Promise<void>;
    await onSuccess();

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "apply_started",
      props: { source: "changes" },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "apply_completed",
      props: { result: "success", source: "changes" },
    });
  });

  it("emits apply failure exactly once when finalizeApply fails after rebuild", async () => {
    mocks.finalizeApply.mockRejectedValue(new Error("finalize failed"));
    const { result } = renderHook(() => useApply());

    await result.current.handleApply();
    const onSuccess = mocks.triggerRebuild.mock.calls[0][0]
      .onSuccess as () => Promise<void>;
    await expect(onSuccess()).rejects.toThrow("finalize failed");

    expect(
      mocks.captureEvent.mock.calls.filter(
        ([event]) => event.name === "apply_completed",
      ),
    ).toEqual([
      [
        {
          name: "apply_completed",
          props: { result: "failure", source: "changes" },
        },
      ],
    ]);
  });

  it("emits apply failure when the rebuild stream reports failure", async () => {
    const { result } = renderHook(() => useApply());

    await result.current.handleApply();
    const onFailure = mocks.triggerRebuild.mock.calls[0][0]
      .onFailure as () => Promise<void>;
    await onFailure();

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "apply_completed",
      props: { result: "failure", source: "changes" },
    });
    expect(mocks.finalizeApply).not.toHaveBeenCalled();
  });

  it("covers history rebuild and manual confirm apply paths", async () => {
    const { result } = renderHook(() => useApply());

    await result.current.handleHistoryBuild();
    const historyOnSuccess = mocks.triggerRebuild.mock.calls[0][0]
      .onSuccess as () => Promise<void>;
    await historyOnSuccess();
    await result.current.handleManualBuildConfirm();

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "apply_started",
      props: { source: "history" },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "apply_completed",
      props: { result: "success", source: "history" },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "apply_started",
      props: { source: "manual_confirm" },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "apply_completed",
      props: { result: "success", source: "manual_confirm" },
    });
  });

  it("propagates history finalize failures after emitting terminal telemetry", async () => {
    mocks.finalizeApply.mockRejectedValue(new Error("history finalize failed"));
    const { result } = renderHook(() => useApply());

    await result.current.handleHistoryBuild();
    const onSuccess = mocks.triggerRebuild.mock.calls[0][0]
      .onSuccess as () => Promise<void>;
    await expect(onSuccess()).rejects.toThrow("history finalize failed");

    expect(
      mocks.captureEvent.mock.calls.filter(
        ([event]) => event.name === "apply_completed",
      ),
    ).toEqual([
      [
        {
          name: "apply_completed",
          props: { result: "failure", source: "history" },
        },
      ],
    ]);
  });
});
