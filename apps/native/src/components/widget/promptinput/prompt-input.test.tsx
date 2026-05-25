import type { GitStatus } from "@/ipc/types";
import { useWidgetStore } from "@/stores/widget-store";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptInput } from "./prompt-input";

const mocks = vi.hoisted(() => ({
  handleEvolve: vi.fn(),
  evolveFromManual: vi.fn(),
}));

vi.mock("@/hooks/use-evolve", () => ({
  useEvolve: () => ({
    handleEvolve: mocks.handleEvolve,
    evolveFromManual: mocks.evolveFromManual,
    buildCheck: vi.fn().mockResolvedValue({ passed: true }),
  }),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    ui: {
      getPrefs: vi.fn().mockResolvedValue({}),
    },
    cli: {
      checkTools: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/components/widget/promptinput/begin-evolve-warning", () => ({
  BeginEvolveWarning: ({ open }: { open: boolean }) =>
    open ? <div data-testid="begin-evolve-warning">Resolve changes first</div> : null,
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

const dirtyGitStatus: GitStatus = {
  files: [{ path: "flake.nix", changeType: "edited" }],
  branch: "main",
  diff: "",
  additions: 1,
  deletions: 0,
  headCommitHash: "abc123",
  cleanHead: false,
  changes: [],
};

describe("PromptInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const store = useWidgetStore.getState();
    store.setEvolvePrompt("");
    store.setProcessing(false);
    store.setGenerating(false);
    store.setError(null);
    store.setGitStatus(null);
    store.setEvolveState(null);
    store.setSettingsOpen(false);
  });

  it("opens the begin-evolve warning instead of racing adoption when git is dirty", () => {
    const store = useWidgetStore.getState();
    store.setEvolvePrompt("install vim");
    store.setGitStatus(dirtyGitStatus);
    store.setEvolveState(null);

    render(<PromptInput />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByTestId("begin-evolve-warning")).toBeInTheDocument();
    expect(mocks.evolveFromManual).not.toHaveBeenCalled();
    expect(mocks.handleEvolve).not.toHaveBeenCalled();
  });

  it("submits directly when no dirty begin-state resolution is required", () => {
    const store = useWidgetStore.getState();
    store.setEvolvePrompt("install vim");
    store.setGitStatus({ ...dirtyGitStatus, cleanHead: true, files: [] });

    render(<PromptInput />);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.queryByTestId("begin-evolve-warning")).not.toBeInTheDocument();
    expect(mocks.evolveFromManual).not.toHaveBeenCalled();
    expect(mocks.handleEvolve).toHaveBeenCalledTimes(1);
  });
});
