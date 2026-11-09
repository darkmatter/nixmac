import { initialUiState, uiActions, viewModelActions } from "@nixmac/state";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSummary } from "@/hooks/use-summary";
import { MergeSection } from "./merge-section";

const mocks = vi.hoisted(() => ({
  generateCommitMessage: vi.fn<() => Promise<string>>(),
  handleCommit: vi.fn<() => Promise<void>>(),
}));

// The orpc client is the boundary under test: use-summary's real
// interaction with them is exercised for real.
vi.mock("@/lib/orpc", () => ({
  client: {
    summarizedChanges: {
      generateCommitMessage: mocks.generateCommitMessage,
    },
  },
}));

vi.mock("@/hooks/use-git-operations", () => ({
  useGitOperations: () => ({
    handleCommit: mocks.handleCommit,
  }),
}));

function resetStores() {
  uiActions.setState({ ...initialUiState });
  viewModelActions.setState({
    evolveEvents: [],
    changeMap: null,
    git: null,
    evolve: null,
    build: {
      externalBuildDetected: false,
      upstreamUpdateAvailable: false,
      rebuildNeeded: false,
    },
  });
}

describe("MergeSection commit-message generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleCommit.mockResolvedValue(undefined);
    resetStores();
  });

  it("does not regenerate on mount when the apply-time prefetch already produced a suggestion", () => {
    uiActions.setCommitMessageSuggestion("feat: prefetched\n\nbody");
    mocks.generateCommitMessage.mockResolvedValue("feat: should not run");

    render(<MergeSection />);

    expect(mocks.generateCommitMessage).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Commit message…")).toHaveValue("feat: prefetched");
  });

  it("generates once on mount when no suggestion exists", async () => {
    mocks.generateCommitMessage.mockResolvedValue("feat: generated\n\nbody");

    render(<MergeSection />);

    expect(mocks.generateCommitMessage).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Commit message…")).toHaveValue("feat: generated");
    });
  });

  it("joins the in-flight prefetch instead of issuing a second IPC call (fast build)", async () => {
    let resolve: (message: string) => void = () => {};
    mocks.generateCommitMessage.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    // The apply-time prefetch is still in flight when the save panel mounts.
    const { result: summary } = renderHook(() => useSummary());
    let prefetch: Promise<void> = Promise.resolve();
    act(() => {
      prefetch = summary.current.generateCommitMessage({ force: true });
    });

    render(<MergeSection />);

    expect(mocks.generateCommitMessage).toHaveBeenCalledTimes(1);
    // The field is disabled while the joined generation is pending — text
    // typed into it would be remounted away when the resolve re-seeds.
    // Committing mid-generation would submit an empty subject (disabled
    // inputs are omitted from FormData), so the button stays gated too.
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
    await act(async () => {
      resolve("feat: prefetched late");
      await prefetch;
    });
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Commit message…")).toHaveValue("feat: prefetched late");
    });
    expect(screen.getByPlaceholderText("Commit message…")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled();
  });

  it("regenerates on demand from the Regenerate button", async () => {
    mocks.generateCommitMessage.mockResolvedValue("feat: first");
    render(<MergeSection />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Commit message…")).toHaveValue("feat: first");
    });

    mocks.generateCommitMessage.mockResolvedValue("feat: second");
    await act(async () => {
      fireEvent.click(screen.getByTitle("Regenerate commit message"));
    });

    expect(mocks.generateCommitMessage).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Commit message…")).toHaveValue("feat: second");
    });
  });
});
