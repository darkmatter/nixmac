import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewIndicatorState } from "@/ipc/orpc-bindings";

const hiddenState: PreviewIndicatorState = {
  visible: false,
  summary: null,
  filesChanged: 0,
  additions: null,
  deletions: null,
  isLoading: false,
};

const visibleState: PreviewIndicatorState = {
  ...hiddenState,
  visible: true,
  filesChanged: 1,
  additions: 1,
  deletions: 0,
};

const mocks = vi.hoisted(() => ({
  getState: vi.fn<() => Promise<PreviewIndicatorState>>(),
  listen: vi.fn(),
  onUpdate: undefined as ((event: { payload: PreviewIndicatorState }) => void) | undefined,
  unlisten: vi.fn(),
}));

vi.mock("@/lib/orpc", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryKey = ["preview-indicator", "get-state"];

  return {
    orpc: {
      previewIndicator: {
        getState: {
          key: () => queryKey,
          queryOptions: () => ({ queryKey, queryFn: mocks.getState }),
        },
      },
    },
    queryClient,
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

describe("PreviewIndicatorWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getState.mockResolvedValue(hiddenState);
    mocks.listen.mockImplementation((_eventName, listener) => {
      mocks.onUpdate = listener as (event: { payload: PreviewIndicatorState }) => void;
      return Promise.resolve(mocks.unlisten);
    });
  });

  it("renders only after the native visible-state update arrives", async () => {
    const { PreviewIndicatorWindow } = await import("./preview-indicator-window");
    const { queryClient } = await import("@/lib/orpc");

    render(
      <QueryClientProvider client={queryClient}>
        <PreviewIndicatorWindow />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocks.onUpdate).toBeTypeOf("function"));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    act(() => {
      mocks.onUpdate?.({ payload: visibleState });
    });

    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
  });
});
