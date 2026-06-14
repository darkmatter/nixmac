import type { SemanticChangeMap } from "@/ipc/types";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateCommitMessage } = vi.hoisted(() => ({
  mockGenerateCommitMessage: vi.fn<
    () => Promise<
      | { status: "pending" }
      | { status: "ready"; message: string }
      | { status: "error" }
    >
  >(),
}));

vi.mock("@/hooks/use-summary", () => ({
  useSummary: () => ({
    generateCommitMessage: mockGenerateCommitMessage,
  }),
}));

import { useCommitMessageDraft } from "./use-commit-message-draft";

const changeMapFor = (
  filename: string,
  hash = "hash-1",
): SemanticChangeMap => ({
  groups: [],
  singles: [
    {
      id: 1,
      hash,
      filename,
      diff: "",
      lineCount: 8,
      createdAt: 1,
      ownSummaryId: null,
      title: "Update shell packages",
      description: "Adds a package to the nix-darwin configuration.",
    },
  ],
  unsummarizedHashes: [],
});

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("useCommitMessageDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGenerateCommitMessage.mockReset();
    mockGenerateCommitMessage.mockResolvedValue({ status: "pending" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not let an older pending fallback overwrite a later ready message for the same change map", async () => {
    mockGenerateCommitMessage
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({
        status: "ready",
        message: "feat(nix): generated subject\n\nGenerated body.",
      });

    const { result, rerender } = renderHook(
      ({ changeMap }) => useCommitMessageDraft(changeMap),
      { initialProps: { changeMap: changeMapFor("flake.nix") } },
    );
    await flushPromises();

    expect(result.current.status).toBe("loading");
    expect(result.current.subject).toBe("");

    rerender({ changeMap: changeMapFor("flake.nix") });
    await flushPromises();

    expect(result.current.status).toBe("ready");
    expect(result.current.subject).toBe("feat(nix): generated subject");
    expect(result.current.body).toBe("Generated body.");

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.subject).toBe("feat(nix): generated subject");
    expect(result.current.body).toBe("Generated body.");
  });

  it("shows a file-specific fallback when lookup stays pending", async () => {
    const changeMap = changeMapFor("flake.nix");
    const { result } = renderHook(() => useCommitMessageDraft(changeMap));
    await flushPromises();

    expect(result.current.status).toBe("loading");
    expect(result.current.subject).toBe("");

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.status).toBe("fallback");
    expect(result.current.subject).toBe("chore(nix): update flake.nix");
    expect(result.current.body).toBe("");
  });

  it("uses a ready generated message as subject and body", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): generated subject\n\nGenerated body.",
    });

    const changeMap = changeMapFor("flake.nix");
    const { result } = renderHook(() => useCommitMessageDraft(changeMap));
    await flushPromises();

    expect(result.current.status).toBe("ready");
    expect(result.current.subject).toBe("feat(nix): generated subject");
    expect(result.current.body).toBe("Generated body.");
  });

  it("does not append suggestion body that arrives after the user edits", async () => {
    let resolveMessage: (
      value: { status: "ready"; message: string },
    ) => void = () => {};
    mockGenerateCommitMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMessage = resolve;
      }),
    );

    const changeMap = changeMapFor("flake.nix");
    const { result } = renderHook(() => useCommitMessageDraft(changeMap));
    await flushPromises();

    act(() => {
      result.current.setSubject("custom commit subject");
    });

    await act(async () => {
      resolveMessage({
        status: "ready",
        message: "feat(nix): generated subject\n\nGenerated body.",
      });
    });
    await flushPromises();

    expect(result.current.status).toBe("ready");
    expect(result.current.subject).toBe("custom commit subject");
    expect(result.current.body).toBe("");
  });

  it("keeps a generated body that arrived before the user edits the subject", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): generated subject\n\nGenerated body.",
    });

    const { result } = renderHook(() =>
      useCommitMessageDraft(changeMapFor("flake.nix")),
    );
    await flushPromises();

    act(() => {
      result.current.setSubject("custom commit subject");
    });

    expect(result.current.subject).toBe("custom commit subject");
    expect(result.current.body).toBe("Generated body.");
  });

  it("shows an editable fallback when lookup errors", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({ status: "error" });

    const { result } = renderHook(() =>
      useCommitMessageDraft(changeMapFor("flake.nix")),
    );
    await flushPromises();

    expect(result.current.status).toBe("error");
    expect(result.current.subject).toBe("chore(nix): update flake.nix");
    expect(result.current.body).toBe("");
  });

  it("resets the draft when the change map fingerprint changes", async () => {
    mockGenerateCommitMessage
      .mockResolvedValueOnce({
        status: "ready",
        message: "feat(nix): generated subject\n\nGenerated body.",
      })
      .mockResolvedValueOnce({ status: "pending" });

    const { result, rerender } = renderHook(
      ({ changeMap }) => useCommitMessageDraft(changeMap),
      { initialProps: { changeMap: changeMapFor("flake.nix") } },
    );
    await flushPromises();

    expect(result.current.subject).toBe("feat(nix): generated subject");
    expect(result.current.body).toBe("Generated body.");

    rerender({ changeMap: changeMapFor("home.nix", "hash-2") });
    await flushPromises();

    expect(result.current.status).toBe("loading");
    expect(result.current.subject).toBe("");
    expect(result.current.body).toBe("");

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.status).toBe("fallback");
    expect(result.current.subject).toBe("chore(nix): update home.nix");
  });

  it("does not downgrade a ready message when a same-fingerprint refresh is pending", async () => {
    mockGenerateCommitMessage
      .mockResolvedValueOnce({
        status: "ready",
        message: "feat(nix): generated subject\n\nGenerated body.",
      })
      .mockResolvedValueOnce({ status: "pending" });

    const { result, rerender } = renderHook(
      ({ changeMap }) => useCommitMessageDraft(changeMap),
      { initialProps: { changeMap: changeMapFor("flake.nix") } },
    );
    await flushPromises();

    rerender({ changeMap: changeMapFor("flake.nix") });
    await flushPromises();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.subject).toBe("feat(nix): generated subject");
    expect(result.current.body).toBe("Generated body.");
  });

  it("does not refetch a generated message for same-fingerprint churn after ready", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): generated subject\n\nGenerated body.",
    });

    const { rerender } = renderHook(
      ({ changeMap }) => useCommitMessageDraft(changeMap),
      { initialProps: { changeMap: changeMapFor("flake.nix") } },
    );
    await flushPromises();

    rerender({ changeMap: changeMapFor("flake.nix") });
    await flushPromises();

    expect(mockGenerateCommitMessage).toHaveBeenCalledTimes(1);
  });

  it("clears the draft when reset is called", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): generated subject\n\nGenerated body.",
    });

    const { result } = renderHook(() =>
      useCommitMessageDraft(changeMapFor("flake.nix")),
    );
    await flushPromises();

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("loading");
    expect(result.current.subject).toBe("");
    expect(result.current.body).toBe("");
  });
});
