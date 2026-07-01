import type { EtcClobberCheckResult } from "@/ipc/types";
import { initialUiState, uiActions, useUiState } from "@nixmac/state";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApply } from "./use-apply";

const mocks = vi.hoisted(() => ({
  checkEtcClobber: vi.fn(),
  finalizeApply: vi.fn(),
  triggerRebuild: vi.fn(),
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    darwin: {
      checkEtcClobber: mocks.checkEtcClobber,
      finalizeApply: mocks.finalizeApply,
    },
  },
}));

vi.mock("@/hooks/use-rebuild-stream", () => ({
  useRebuildStream: () => ({
    triggerRebuild: mocks.triggerRebuild,
  }),
}));

function makeEtcClobberResult(overrides: Partial<EtcClobberCheckResult> = {}): EtcClobberCheckResult {
  return {
    ok: false,
    checked: 1,
    conflicts: [
      {
        path: "/etc/nix/github-token.conf",
        target: "nix/github-token.conf",
        expectedStaticPath: "/etc/static/nix/github-token.conf",
        currentLinkTarget: null,
        knownSha256Hashes: [],
        kind: "unrecognized_content",
      },
    ],
    warnings: [],
    ...overrides,
  };
}

describe("useApply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uiActions.setState({ ...initialUiState });
    mocks.checkEtcClobber.mockResolvedValue(makeEtcClobberResult({ ok: true, conflicts: [] }));
    mocks.finalizeApply.mockResolvedValue(undefined);
    mocks.triggerRebuild.mockResolvedValue(undefined);
  });

  it("stops before starting a rebuild when proactive /etc clobber conflicts are found", async () => {
    const etcClobber = makeEtcClobberResult();
    mocks.checkEtcClobber.mockResolvedValue(etcClobber);
    const { result } = renderHook(() => useApply());

    await act(async () => {
      await result.current.handleApply();
    });

    expect(mocks.triggerRebuild).not.toHaveBeenCalled();
    expect(useUiState.getState().etcClobber).toBe(etcClobber);
    expect(useUiState.getState().etcClobberDialogOpen).toBe(true);
    expect(useUiState.getState().isProcessing).toBe(false);
  });

  it("continues into the rebuild stream when only managed-file backup warnings are found", async () => {
    const resultWithWarnings = makeEtcClobberResult({
      ok: true,
      conflicts: [],
      warnings: [
        {
          path: "/Users/alice/.config/git/message",
          target: "git/message",
          managedRoot: "xdg_config",
          user: "alice",
          currentLinkTarget: null,
          expectedLinkTarget: "/nix/store/example-home-files/git/message",
          backupExtension: "backup",
        },
      ],
    });
    mocks.checkEtcClobber.mockResolvedValue(resultWithWarnings);
    const { result } = renderHook(() => useApply());

    await act(async () => {
      await result.current.handleApply();
    });

    expect(mocks.triggerRebuild).toHaveBeenCalledTimes(1);
    expect(useUiState.getState().etcClobber).toBe(resultWithWarnings);
    expect(useUiState.getState().etcClobberDialogOpen).toBe(true);
  });

  it("continues into the rebuild stream when the proactive /etc check is clear", async () => {
    const { result } = renderHook(() => useApply());

    await act(async () => {
      await result.current.handleApply();
    });

    expect(mocks.triggerRebuild).toHaveBeenCalledTimes(1);
    expect(mocks.triggerRebuild).toHaveBeenCalledWith(expect.objectContaining({ context: "apply" }));
  });
});
