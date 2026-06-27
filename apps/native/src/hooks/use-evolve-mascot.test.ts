import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uiActions, viewModelActions } from "@nixmac/state";
import { useEvolveMascot } from "./use-evolve-mascot";
import { makeGlobalPreferences as makePrefs, makeRebuildStatus } from "@/utils/test-fixtures";

function setSpinningMascot(enabled: boolean) {
  viewModelActions.setState({
    preferences: makePrefs({ experimentalSpinningMascot: enabled }),
  });
}

const mocks = vi.hoisted(() => ({
  show: vi.fn().mockResolvedValue(undefined),
  hide: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    evolveMascot: {
      show: mocks.show,
      hide: mocks.hide,
    },
  },
}));

describe("useEvolveMascot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSpinningMascot(false);
    viewModelActions.setState({ rebuildStatus: null });
    uiActions.setState({ isGenerating: false });
  });

  it("shows the mascot only when the experimental flag and active evolve state are both enabled", async () => {
    renderHook(() => useEvolveMascot());

    await waitFor(() => expect(mocks.hide).toHaveBeenCalledTimes(1));
    expect(mocks.show).not.toHaveBeenCalled();

    act(() => {
      setSpinningMascot(true);
      uiActions.setGenerating(true);
    });

    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));

    act(() => {
      uiActions.setGenerating(false);
    });

    await waitFor(() => expect(mocks.hide).toHaveBeenCalledTimes(2));
  });

  it("shows during rebuilds and hides on teardown", async () => {
    const { unmount } = renderHook(() => useEvolveMascot());

    act(() => {
      setSpinningMascot(true);
      viewModelActions.setState({ rebuildStatus: makeRebuildStatus({ isRunning: true }) });
    });

    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));

    unmount();

    await waitFor(() => expect(mocks.hide).toHaveBeenCalledTimes(2));
  });
});
