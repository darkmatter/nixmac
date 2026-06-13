import type { SemanticChangeMap } from "@/ipc/types";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateCommitMessage, mockHandleCommit } = vi.hoisted(() => ({
  mockGenerateCommitMessage: vi.fn<
    () => Promise<
      | { status: "pending" }
      | { status: "ready"; message: string }
      | { status: "error" }
    >
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

const commitForm = () =>
  screen.getByRole("button", { name: /commit/i }).closest("form")!;

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

  it("renders loading and fallback states from the draft hook", async () => {
    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });
    const button = screen.getByRole("button", { name: /commit/i });

    expect(input).toHaveAttribute("placeholder", "Loading...");
    expect(input).toHaveValue("");
    expect(button).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(input).toHaveValue("chore(nix): update flake.nix");
    expect(button).toBeEnabled();
    expect(screen.getByText(/still generating/i)).toBeInTheDocument();
  });

  it("renders generated subject and body returned by the draft hook", async () => {
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

  it("renders error fallback copy when lookup fails", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({ status: "error" });

    render(<MergeSection />);
    await flushPromises();

    expect(screen.getByRole("textbox", { name: "" })).toHaveValue(
      "chore(nix): update flake.nix",
    );
    expect(screen.getByText(/suggestion unavailable/i)).toBeInTheDocument();
  });

  it("submits the current subject and body, then clears the draft after success", async () => {
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): add shell package\n\nUpdates package list.",
    });
    useWidgetStore.getState().setEvolvePrompt("Add a package");

    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });
    expect(input).toHaveValue("feat(nix): add shell package");

    fireEvent.submit(commitForm());
    await flushPromises();

    expect(mockHandleCommit).toHaveBeenCalledWith({
      message: "feat(nix): add shell package\n\nUpdates package list.",
    });
    expect(useWidgetStore.getState().commitMessageSuggestion).toBeNull();
    expect(useWidgetStore.getState().evolvePrompt).toBe("");
    expect(input).toHaveValue("");
    expect(screen.queryByTestId("commit-body")).not.toBeInTheDocument();
  });

  it("preserves the edited draft after a failed commit", async () => {
    mockHandleCommit.mockResolvedValueOnce(false);
    mockGenerateCommitMessage.mockResolvedValueOnce({
      status: "ready",
      message: "feat(nix): add shell package\n\nUpdates package list.",
    });

    render(<MergeSection />);
    await flushPromises();

    const input = screen.getByRole("textbox", { name: "" });
    fireEvent.change(input, { target: { value: "custom subject" } });
    fireEvent.submit(commitForm());
    await flushPromises();

    expect(mockHandleCommit).toHaveBeenCalledWith({
      message: "custom subject\n\nUpdates package list.",
    });
    expect(input).toHaveValue("custom subject");
    expect(screen.getByTestId("commit-body")).toHaveTextContent("Updates package list.");
  });

  it("wires user edits through to submission without a generated body that arrives later", async () => {
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

    fireEvent.submit(commitForm());
    await flushPromises();

    expect(mockHandleCommit).toHaveBeenCalledWith({
      message: "custom commit subject",
    });
    expect(screen.queryByTestId("commit-body")).not.toBeInTheDocument();
  });
});
