import type { SemanticChangeMap } from "@/ipc/types";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateCommitMessage, mockHandleCommit } = vi.hoisted(() => ({
  mockGenerateCommitMessage: vi.fn<
    () => Promise<{ status: "pending" } | { status: "ready"; message: string } | { status: "error" }>
  >(),
  mockHandleCommit: vi.fn<(args: { message: string }) => Promise<boolean>>(),
}));

vi.mock("@/hooks/use-summary", () => ({
  useSummary: () => ({
    generateCommitMessage: mockGenerateCommitMessage,
  }),
}));

vi.mock("@/hooks/use-git-operations", () => ({
  useGitOperations: () => ({
    handleCommit: mockHandleCommit,
  }),
}));

vi.mock("@/components/widget/summaries/markdown-description", () => ({
  MarkdownDescription: ({ text }: { text: string }) => (
    <div data-testid="commit-body">{text}</div>
  ),
}));

import { MergeSection } from "./merge-section";

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

describe("<MergeSection>", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGenerateCommitMessage.mockReset();
    mockGenerateCommitMessage.mockResolvedValue({ status: "pending" });
    mockHandleCommit.mockReset();

    const store = useWidgetStore.getState();
    store.setCommitMessageSuggestion(null);
    store.setProcessing(false);
    store.setEvolvePrompt("");
    useViewModel.setState({ changeMap: changeMapFor("flake.nix") });
    mockHandleCommit.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps initial null as pending, then replaces stale loading with a fallback that a later generated message can replace", async () => {
    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });
    expect(input).toHaveAttribute("placeholder", "Loading...");
    expect(input).toHaveValue("");

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(input).toHaveValue("chore(nix): update flake.nix");

    act(() => {
      useWidgetStore
        .getState()
        .setCommitMessageSuggestion("feat(nix): add shell package\n\nUpdates the package list.");
    });

    expect(input).toHaveValue("feat(nix): add shell package");
    expect(screen.getByTestId("commit-body")).toHaveTextContent(
      "Updates the package list.",
    );
  });

  it("does not overwrite user input when the generated message arrives late", async () => {
    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    fireEvent.change(input, { target: { value: "custom commit subject" } });

    act(() => {
      useWidgetStore
        .getState()
        .setCommitMessageSuggestion("feat(nix): generated subject\n\nGenerated body.");
    });

    expect(input).toHaveValue("custom commit subject");
  });

  it("does not append a late generated body to a user-authored subject", async () => {
    let resolveMessage: (
      value: { status: "ready"; message: string },
    ) => void = () => {};
    mockGenerateCommitMessage.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMessage = resolve;
      }),
    );

    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });
    fireEvent.change(input, { target: { value: "custom commit subject" } });

    await act(async () => {
      resolveMessage({
        status: "ready",
        message: "feat(nix): generated subject\n\nGenerated body.",
      });
    });

    expect(input).toHaveValue("custom commit subject");
    expect(screen.queryByTestId("commit-body")).not.toBeInTheDocument();

    fireEvent.submit(screen.getByRole("button", { name: /commit/i }).closest("form")!);
    await flushPromises();

    expect(mockHandleCommit).toHaveBeenCalledWith({
      message: "custom commit subject",
    });
  });

  it("uses a directly returned generated message as the editable subject and body", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): generated subject\n\nGenerated body.",
    });

    render(<MergeSection />);
    await flushPromises();

    expect(screen.getByRole("textbox", { name: "" })).toHaveValue(
      "feat(nix): generated subject",
    );
    expect(screen.getByTestId("commit-body")).toHaveTextContent("Generated body.");
  });

  it("submits stale fallback without inventing a commit body", async () => {
    render(<MergeSection />);
    await flushPromises();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    fireEvent.submit(screen.getByRole("button", { name: /commit/i }).closest("form")!);
    await flushPromises();

    expect(mockHandleCommit).toHaveBeenCalledWith({
      message: "chore(nix): update flake.nix",
    });
  });

  it("does not allow committing an empty subject while the suggestion is still loading", async () => {
    render(<MergeSection />);
    await flushPromises();

    const button = screen.getByRole("button", { name: /commit/i });
    expect(button).toBeDisabled();

    fireEvent.submit(button.closest("form")!);
    await flushPromises();

    expect(mockHandleCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(button).toBeEnabled();
  });

  it("shows an editable fallback when commit message lookup errors", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({ status: "error" });

    render(<MergeSection />);
    await flushPromises();

    expect(screen.getByRole("textbox", { name: "" })).toHaveValue(
      "chore(nix): update flake.nix",
    );
    expect(screen.getByText(/suggestion unavailable/i)).toBeInTheDocument();
  });

  it("clears the displayed suggestion after a successful commit", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): add shell package\n\nUpdates package list.",
    });

    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });
    expect(input).toHaveValue("feat(nix): add shell package");

    fireEvent.submit(screen.getByRole("button", { name: /commit/i }).closest("form")!);
    await flushPromises();

    expect(useWidgetStore.getState().commitMessageSuggestion).toBeNull();
    expect(input).toHaveValue("");
    expect(screen.queryByTestId("commit-body")).not.toBeInTheDocument();
  });

  it("preserves the edited message after a failed commit", async () => {
    mockHandleCommit.mockResolvedValueOnce(false);
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): add shell package\n\nUpdates package list.",
    });

    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });
    fireEvent.change(input, { target: { value: "custom subject" } });
    fireEvent.submit(screen.getByRole("button", { name: /commit/i }).closest("form")!);
    await flushPromises();

    expect(mockHandleCommit).toHaveBeenCalledWith({
      message: "custom subject\n\nUpdates package list.",
    });
    expect(useWidgetStore.getState().commitMessageSuggestion).toBe(
      "feat(nix): add shell package\n\nUpdates package list.",
    );
    expect(input).toHaveValue("custom subject");
    expect(screen.getByTestId("commit-body")).toHaveTextContent("Updates package list.");
  });

  it("keeps an existing fallback visible across change-map churn", async () => {
    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(input).toHaveValue("chore(nix): update flake.nix");

    act(() => {
      useViewModel.setState({ changeMap: changeMapFor("flake.nix") });
    });
    await flushPromises();

    expect(input).toHaveValue("chore(nix): update flake.nix");
  });

  it("clears a generated suggestion when the change map changes and lookup is pending", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): generated subject\n\nGenerated body.",
    });

    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });
    expect(input).toHaveValue("feat(nix): generated subject");
    expect(screen.getByTestId("commit-body")).toHaveTextContent("Generated body.");

    act(() => {
      useViewModel.setState({ changeMap: changeMapFor("home.nix", "hash-2") });
    });
    await flushPromises();

    expect(useWidgetStore.getState().commitMessageSuggestion).toBeNull();
    expect(input).toHaveAttribute("placeholder", "Loading...");
    expect(input).toHaveValue("");
    expect(screen.queryByTestId("commit-body")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /commit/i })).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(input).toHaveValue("chore(nix): update home.nix");
  });

  it("does not trust a stored suggestion on mount until lookup validates it", async () => {
    useWidgetStore
      .getState()
      .setCommitMessageSuggestion("feat(nix): stale stored subject\n\nStale body.");

    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });
    expect(useWidgetStore.getState().commitMessageSuggestion).toBeNull();
    expect(input).toHaveAttribute("placeholder", "Loading...");
    expect(input).toHaveValue("");
    expect(screen.queryByTestId("commit-body")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(input).toHaveValue("chore(nix): update flake.nix");
  });

  it("does not carry a user-edited subject across a different change map", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): generated subject\n\nGenerated body.",
    });

    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });
    fireEvent.change(input, { target: { value: "custom old subject" } });

    act(() => {
      useViewModel.setState({ changeMap: changeMapFor("home.nix", "hash-2") });
    });
    await flushPromises();

    expect(input).toHaveValue("");

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(input).toHaveValue("chore(nix): update home.nix");
  });

  it("does not downgrade an existing generated message to fallback on a later pending refresh", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): generated subject\n\nGenerated body.",
    });

    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });
    expect(input).toHaveValue("feat(nix): generated subject");

    act(() => {
      useViewModel.setState({ changeMap: changeMapFor("flake.nix") });
    });
    await flushPromises();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(input).toHaveValue("feat(nix): generated subject");
    expect(screen.getByTestId("commit-body")).toHaveTextContent("Generated body.");
  });
});
