import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWidgetStore } from "@/stores/widget-store";
import { initialRebuildState } from "@/types/rebuild";
import { useEvolveMascot } from "./use-evolve-mascot";

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
    useWidgetStore.setState({
      experimentalSpinningMascot: false,
      isGenerating: false,
      rebuild: initialRebuildState,
    });
  });

  it("shows the mascot only when the experimental flag and active evolve state are both enabled", async () => {
    renderHook(() => useEvolveMascot());

    await waitFor(() => expect(mocks.hide).toHaveBeenCalledTimes(1));
    expect(mocks.show).not.toHaveBeenCalled();

    act(() => {
      useWidgetStore.getState().setBoolPref("experimentalSpinningMascot", true);
      useWidgetStore.getState().setGenerating(true);
    });

    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));

    act(() => {
      useWidgetStore.getState().setGenerating(false);
    });

    await waitFor(() => expect(mocks.hide).toHaveBeenCalledTimes(2));
  });

  it("shows during rebuilds and hides on teardown", async () => {
    const { unmount } = renderHook(() => useEvolveMascot());

    act(() => {
      useWidgetStore.getState().setBoolPref("experimentalSpinningMascot", true);
      useWidgetStore.getState().startRebuild("apply");
    });

    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));

    unmount();

    await waitFor(() => expect(mocks.hide).toHaveBeenCalledTimes(2));
  });
});
