import type { DarwinApplyEndEvent } from "@/ipc/types";
import { REBUILD_ERROR_CODES } from "@/lib/errors";
import { initialUiState, uiActions, useUiState } from "@nixmac/state";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRebuildRetry,
  hasRebuildRetry,
  retryLastRebuild,
  useRebuildStream,
} from "./use-rebuild-stream";

const mocks = vi.hoisted(() => ({
  applyStreamStart: vi.fn(),
  activateStorePath: vi.fn(),
  captureEvent: vi.fn(),
  refreshGitStatus: vi.fn(),
  on: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@/ipc/api", () => ({
  ipcRenderer: {
    on: mocks.on,
  },
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    darwin: {
      applyStreamStart: mocks.applyStreamStart,
      activateStorePath: mocks.activateStorePath,
    },
  },
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mocks.captureEvent,
  }),
}));

vi.mock("./use-git-operations", () => ({
  useGitOperations: () => ({
    refreshGitStatus: mocks.refreshGitStatus,
  }),
}));

function applyEndPayload(overrides: Partial<DarwinApplyEndEvent> = {}): DarwinApplyEndEvent {
  return {
    ok: false,
    code: 1,
    error_type: null,
    error: null,
    system_untouched: null,
    log_file: null,
    etc_clobber: null,
    app_management: null,
    ...overrides,
  };
}

describe("useRebuildStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRebuildRetry();
    uiActions.setState({ ...initialUiState, rebuildPanelDismissed: false });
    mocks.on.mockResolvedValue(mocks.unlisten);
    mocks.applyStreamStart.mockResolvedValue(undefined);
    mocks.activateStorePath.mockResolvedValue(undefined);
    mocks.refreshGitStatus.mockResolvedValue(null);
  });

  async function triggerAndFinish(payload: DarwinApplyEndEvent) {
    const { result } = renderHook(() => useRebuildStream());

    await act(async () => {
      await result.current.triggerRebuild({ context: "apply" });
    });

    const listener = mocks.on.mock.calls[0]?.[1] as
      | ((event: { payload: DarwinApplyEndEvent }) => Promise<void>)
      | undefined;
    expect(listener).toBeDefined();

    await act(async () => {
      await listener?.({ payload });
    });
  }

  it("dismisses the rebuild panel for probeable Full Disk Access failures", async () => {
    await triggerAndFinish(
      applyEndPayload({
        error_type: REBUILD_ERROR_CODES.FULL_DISK_ACCESS,
        error: "Full Disk Access required",
      }),
    );

    expect(useUiState.getState().rebuildPanelDismissed).toBe(true);
    expect(mocks.refreshGitStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps the rebuild panel visible for unprobeable App Management failures", async () => {
    await triggerAndFinish(
      applyEndPayload({
        error_type: REBUILD_ERROR_CODES.APP_MANAGEMENT,
        error: "App Management required",
      }),
    );

    expect(useUiState.getState().rebuildPanelDismissed).toBe(false);
    expect(mocks.refreshGitStatus).toHaveBeenCalledTimes(1);
  });

  it("replays the complete registered rollback operation", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useRebuildStream());

    await act(async () => {
      await result.current.triggerRebuild({
        context: "rollback",
        storePath: "/nix/store/old-system",
        retry,
      });
    });

    expect(hasRebuildRetry()).toBe(true);
    await act(async () => {
      await retryLastRebuild();
    });

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("clears an older rollback retry when a new apply starts", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useRebuildStream());

    await act(async () => {
      await result.current.triggerRebuild({ context: "rollback", retry });
      await result.current.triggerRebuild({ context: "apply" });
    });

    expect(hasRebuildRetry()).toBe(false);
  });

  it("withholds retry while failed-run cleanup is pending", async () => {
    let resolveCleanup!: () => void;
    const onFailure = vi
      .fn()
      .mockReturnValue(new Promise<void>((resolve) => (resolveCleanup = resolve)));
    const retry = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useRebuildStream());

    await act(async () => {
      await result.current.triggerRebuild({ context: "rollback", retry, onFailure });
    });
    expect(hasRebuildRetry()).toBe(true);

    const listener = mocks.on.mock.calls[0]?.[1] as
      | ((event: { payload: DarwinApplyEndEvent }) => Promise<void>)
      | undefined;
    let finished!: Promise<void>;
    await act(async () => {
      finished = listener!({ payload: applyEndPayload() });
    });

    // Cleanup still in flight: retry must stay disabled.
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(hasRebuildRetry()).toBe(false);

    resolveCleanup();
    await act(async () => {
      await finished;
    });

    expect(hasRebuildRetry()).toBe(true);
    expect(mocks.refreshGitStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps retry disabled and surfaces the error when cleanup rejects", async () => {
    const onFailure = vi.fn().mockRejectedValue(new Error("abort failed"));
    const retry = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useRebuildStream());

    await act(async () => {
      await result.current.triggerRebuild({ context: "rollback", retry, onFailure });
    });

    const listener = mocks.on.mock.calls[0]?.[1] as
      | ((event: { payload: DarwinApplyEndEvent }) => Promise<void>)
      | undefined;
    await act(async () => {
      await listener!({ payload: applyEndPayload() });
    });

    expect(hasRebuildRetry()).toBe(false);
    expect(useUiState.getState().error).toBe("abort failed");
    expect(mocks.refreshGitStatus).toHaveBeenCalledTimes(1);
  });

  it("does not let stale cleanup re-enable a superseded retry", async () => {
    let resolveCleanup!: () => void;
    const onFailure = vi
      .fn()
      .mockReturnValue(new Promise<void>((resolve) => (resolveCleanup = resolve)));
    const retryOld = vi.fn().mockResolvedValue(undefined);
    const retryNew = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useRebuildStream());

    await act(async () => {
      await result.current.triggerRebuild({ context: "rollback", retry: retryOld, onFailure });
    });

    const listener = mocks.on.mock.calls[0]?.[1] as
      | ((event: { payload: DarwinApplyEndEvent }) => Promise<void>)
      | undefined;
    let finished!: Promise<void>;
    await act(async () => {
      finished = listener!({ payload: applyEndPayload() });
    });

    // A newer operation supersedes the failed run while its cleanup pends.
    await act(async () => {
      await result.current.triggerRebuild({ context: "rollback", retry: retryNew });
    });
    expect(useUiState.getState().rebuildRetry).toBe(retryNew);

    resolveCleanup();
    await act(async () => {
      await finished;
    });

    expect(useUiState.getState().rebuildRetry).toBe(retryNew);
  });
});
