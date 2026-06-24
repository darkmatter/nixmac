import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptInput } from "@/components/widget/promptinput/prompt-input";
import type { GitStatus } from "@/ipc/types";
import { uiActions, viewModelActions } from "@nixmac/state";

const mocks = vi.hoisted(() => ({
  handleEvolve: vi.fn<() => Promise<void>>(),
  evolveFromManual: vi.fn<() => Promise<void>>(),
  buildCheck: vi.fn<() => Promise<{ passed: boolean }>>(),
  getPrefs: vi.fn<() => Promise<Record<string, never>>>(),
  checkTools: vi.fn<() => Promise<{ claude: boolean; codex: boolean; opencode: boolean }>>(),
}));

vi.mock("@/hooks/use-evolve", () => ({
  useEvolve: () => ({
    handleEvolve: mocks.handleEvolve,
    evolveFromManual: mocks.evolveFromManual,
    buildCheck: mocks.buildCheck,
  }),
}));

vi.mock("@/components/widget/promptinput/begin-evolve-warning", () => ({
  BeginEvolveWarning: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Resolve local changes</div> : null,
}));

vi.mock("@/components/widget/promptinput/mac-recommendation-chip", () => ({
  MacRecommendationChip: () => null,
}));

vi.mock("@/components/widget/promptinput/homebrew-badge", () => ({
  HomebrewBadge: () => null,
}));

vi.mock("@/components/widget/promptinput/prompt-history-badge", () => ({
  PromptHistoryBadge: () => null,
}));

vi.mock("@/components/widget/promptinput/system-defaults-cta", () => ({
  SystemDefaultsCTA: () => null,
}));

vi.mock("@/lib/ai-provider-validation", () => ({
  getProviderConfigInvalidReason: () => null,
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    ui: {
      getPrefs: mocks.getPrefs,
    },
    cli: {
      checkTools: mocks.checkTools,
    },
  },
}));

const dirtyGitStatus: GitStatus = {
  files: [{ path: "flake.nix", changeType: "edited" }],
  branch: "main",
  diff: "diff --git a/flake.nix b/flake.nix",
  additions: 1,
  deletions: 0,
  headCommitHash: "abc123",
  cleanHead: false,
  changes: [],
};

function resetStore() {
  uiActions.setEvolvePrompt("");
  viewModelActions.setState({
    git: null,
    evolve: null,
    build: { externalBuildDetected: false },
  });
  uiActions.setProcessing(false);
  uiActions.setSettingsOpen(false);
}

describe("<PromptInput>", () => {
  beforeEach(() => {
    resetStore();
    mocks.handleEvolve.mockResolvedValue();
    mocks.evolveFromManual.mockResolvedValue();
    mocks.buildCheck.mockResolvedValue({ passed: true });
    mocks.getPrefs.mockResolvedValue({});
    mocks.checkTools.mockResolvedValue({ claude: false, codex: false, opencode: false });
  });

  afterEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("opens the dirty-tree resolution dialog instead of racing adopt and evolve", async () => {
    uiActions.setEvolvePrompt("install vim");
    viewModelActions.setState({ git: dirtyGitStatus, evolve: null });

    render(<PromptInput />);

    fireEvent.click(screen.getByTestId("evolve-prompt-send"));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Resolve local changes");
    await waitFor(() => {
      expect(mocks.evolveFromManual).not.toHaveBeenCalled();
      expect(mocks.handleEvolve).not.toHaveBeenCalled();
    });
  });
});
