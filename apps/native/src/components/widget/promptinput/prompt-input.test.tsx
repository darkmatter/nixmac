import type { GitStatus } from "@/tauri-api";
import { useWidgetStore } from "@/stores/widget-store";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptInput } from "./prompt-input";

const mocks = vi.hoisted(() => ({
  buildCheck: vi.fn(),
  checkTools: vi.fn(),
  evolveFromManual: vi.fn(),
  getPrefs: vi.fn(),
  handleCommit: vi.fn(),
  handleEvolve: vi.fn(),
  handleRollback: vi.fn(),
}));

vi.mock("@/tauri-api", () => ({
  darwinAPI: {
    cli: {
      checkTools: mocks.checkTools,
    },
    ui: {
      getPrefs: mocks.getPrefs,
    },
  },
}));

vi.mock("@/hooks/use-evolve", () => ({
  useEvolve: () => ({
    buildCheck: mocks.buildCheck,
    evolveFromManual: mocks.evolveFromManual,
    handleEvolve: mocks.handleEvolve,
  }),
}));

vi.mock("@/hooks/use-git-operations", () => ({
  useGitOperations: () => ({
    handleCommit: mocks.handleCommit,
  }),
}));

vi.mock("@/hooks/use-rollback", () => ({
  useRollback: () => ({
    handleRollback: mocks.handleRollback,
  }),
}));

vi.mock("@/lib/ai-provider-validation", () => ({
  getProviderConfigInvalidReason: () => null,
}));

vi.mock("@/components/widget/promptinput/homebrew-badge", () => ({
  HomebrewBadge: () => null,
}));

vi.mock("@/components/widget/promptinput/mac-recommendation-chip", () => ({
  MacRecommendationChip: () => null,
}));

vi.mock("@/components/widget/promptinput/prompt-history-badge", () => ({
  PromptHistoryBadge: () => null,
}));

vi.mock("@/components/widget/promptinput/system-defaults-cta", () => ({
  SystemDefaultsCTA: () => null,
}));

const dirtyGitStatus: GitStatus = {
  additions: 1,
  branch: "main",
  changes: [],
  cleanHead: false,
  deletions: 0,
  diff: "diff --git a/flake.nix b/flake.nix",
  files: [{ changeType: "edited", path: "flake.nix" }],
  headCommitHash: "abc123",
};

const cleanGitStatus: GitStatus = {
  ...dirtyGitStatus,
  additions: 0,
  cleanHead: true,
  diff: "",
  files: [],
};

describe("PromptInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildCheck.mockResolvedValue({ passed: true });
    mocks.checkTools.mockResolvedValue({});
    mocks.getPrefs.mockResolvedValue({});

    const store = useWidgetStore.getState();
    store.setEvolvePrompt("Install vim");
    store.setEvolveState(null);
    store.setGitStatus(cleanGitStatus);
    store.setProcessing(false);
    store.setGenerating(false);
    store.setSettingsOpen(false, null);
  });

  it("opens the dirty-working-tree warning instead of starting evolution", async () => {
    useWidgetStore.getState().setGitStatus(dirtyGitStatus);

    render(<PromptInput />);

    fireEvent.click(screen.getByTestId("evolve-prompt-send"));

    expect(await screen.findByText("First, decide how to handle uncommitted changes.")).toBeInTheDocument();
    expect(mocks.evolveFromManual).not.toHaveBeenCalled();
    expect(mocks.handleEvolve).not.toHaveBeenCalled();
  });

  it("starts evolution directly when the working tree is clean", () => {
    render(<PromptInput />);

    fireEvent.click(screen.getByTestId("evolve-prompt-send"));

    expect(mocks.handleEvolve).toHaveBeenCalledTimes(1);
    expect(mocks.evolveFromManual).not.toHaveBeenCalled();
  });
});
