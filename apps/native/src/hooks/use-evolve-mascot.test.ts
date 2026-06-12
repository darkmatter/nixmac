import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";
import { initialRebuildState } from "@/types/rebuild";
import { useEvolveMascot } from "./use-evolve-mascot";
import { makeGlobalPreferences as makePrefs } from "@/utils/test-fixtures";


function setSpinningMascot(enabled: boolean) {
  useViewModel.setState({
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
    useWidgetStore.setState({
      rebuild: initialRebuildState,
    });
    useUiState.setState({ isGenerating: false });
  });

  it("shows the mascot only when the experimental flag and active evolve state are both enabled", async () => {
    renderHook(() => useEvolveMascot());

    await waitFor(() => expect(mocks.hide).toHaveBeenCalledTimes(1));
    expect(mocks.show).not.toHaveBeenCalled();

    act(() => {
      setSpinningMascot(true);
      useUiState.getState().setGenerating(true);
    });

    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));

    act(() => {
      useUiState.getState().setGenerating(false);
    });

    await waitFor(() => expect(mocks.hide).toHaveBeenCalledTimes(2));
  });

  it("shows during rebuilds and hides on teardown", async () => {
    const { unmount } = renderHook(() => useEvolveMascot());

    act(() => {
      setSpinningMascot(true);
      useWidgetStore.getState().startRebuild("apply");
    });

    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));

    unmount();

    await waitFor(() => expect(mocks.hide).toHaveBeenCalledTimes(2));
  });
});
