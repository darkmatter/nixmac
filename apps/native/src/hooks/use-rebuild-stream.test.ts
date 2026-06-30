import type { DarwinApplyEndEvent } from "@/ipc/types";
import { REBUILD_ERROR_CODES } from "@/lib/errors";
import { initialUiState, uiActions, useUiState } from "@nixmac/state";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRebuildStream } from "./use-rebuild-stream";

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
    ...overrides,
  };
}

describe("useRebuildStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
