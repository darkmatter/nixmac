import { initialUiState, uiActions, useUiState } from "@nixmac/state";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSummary } from "./use-summary";

const mocks = vi.hoisted(() => ({
  generateCommitMessage: vi.fn<() => Promise<string>>(),
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    summarizedChanges: {
      generateCommitMessage: mocks.generateCommitMessage,
    },
  },
}));

describe("useSummary generateCommitMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uiActions.setState({ ...initialUiState });
  });

  it("clears the suggestion synchronously and stores the resolved message", async () => {
    uiActions.setCommitMessageSuggestion("stale suggestion");
    let resolve: (message: string) => void = () => {};
    mocks.generateCommitMessage.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useSummary());

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.generateCommitMessage();
    });
    // Default clear runs before the IPC resolves.
    expect(useUiState.getState().commitMessageSuggestion).toBeNull();

    await act(async () => {
      resolve("feat: fresh\n\nbody");
      await pending;
    });
    expect(useUiState.getState().commitMessageSuggestion).toBe("feat: fresh\n\nbody");
  });

  it("joins concurrent callers onto a single in-flight IPC call", async () => {
    let resolve: (message: string) => void = () => {};
    mocks.generateCommitMessage.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useSummary());

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.generateCommitMessage();
    });
    act(() => {
      second = result.current.generateCommitMessage();
    });
    expect(mocks.generateCommitMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve("feat: joined");
      await first;
      await second;
    });
    expect(useUiState.getState().commitMessageSuggestion).toBe("feat: joined");
  });

  it("a clear during flight prevents the resolve from resurrecting the suggestion", async () => {
    let resolve: (message: string) => void = () => {};
    mocks.generateCommitMessage.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useSummary());

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.generateCommitMessage();
    });
    act(() => {
      result.current.clearCommitMessageSuggestion();
    });
    expect(useUiState.getState().commitMessageSuggestion).toBeNull();

    await act(async () => {
      resolve("feat: stale diff");
      await pending;
    });
    // The generation started before the clear; its late resolve must not
    // repopulate the field for a diff the user has moved past.
    expect(useUiState.getState().commitMessageSuggestion).toBeNull();
  });

  it("force supersedes an in-flight generation and drops its stale resolve", async () => {
    let resolveFirst: (message: string) => void = () => {};
    let resolveSecond: (message: string) => void = () => {};
    mocks.generateCommitMessage
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveFirst = r;
        }),
      )
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveSecond = r;
        }),
      );
    const { result } = renderHook(() => useSummary());

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.generateCommitMessage();
    });
    act(() => {
      second = result.current.generateCommitMessage({ force: true });
    });
    expect(mocks.generateCommitMessage).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecond("feat: new diff");
      await second;
    });
    expect(useUiState.getState().commitMessageSuggestion).toBe("feat: new diff");

    await act(async () => {
      resolveFirst("feat: old diff");
      await first;
    });
    expect(useUiState.getState().commitMessageSuggestion).toBe("feat: new diff");
  });

  it("keeps the existing suggestion when inference fails", async () => {
    mocks.generateCommitMessage.mockRejectedValue(new Error("inference failed"));
    uiActions.setCommitMessageSuggestion("manual draft");
    const { result } = renderHook(() => useSummary());

    await act(async () => {
      await result.current.generateCommitMessage({ clear: false });
    });
    expect(useUiState.getState().commitMessageSuggestion).toBe("manual draft");
  });
});
