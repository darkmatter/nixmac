import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptInput } from "@/components/widget/promptinput/prompt-input";
import { EVOLVE_PROMPT_SUGGESTIONS_FLAG } from "@/components/widget/promptinput/prompt-suggestions-variant";
import { STARTER_PROMPT_CHIPS } from "@/components/widget/promptinput/starter-prompts";
import type { GitStatus } from "@/ipc/types";
import { makeGlobalPreferences } from "@/utils/test-fixtures";
import { uiActions, viewModelActions } from "@nixmac/state";

const mocks = vi.hoisted(() => ({
  handleEvolve: vi.fn<() => Promise<void>>(),
  evolveFromManual: vi.fn<() => Promise<void>>(),
  buildCheck: vi.fn<() => Promise<{ passed: boolean }>>(),
  getPrefs: vi.fn<() => Promise<Record<string, never>>>(),
  checkTools: vi.fn<() => Promise<{ claude: boolean; codex: boolean; opencode: boolean }>>(),
  getRecommendedPrompt: vi.fn<() => Promise<null>>(),
}));

vi.mock("@/hooks/use-evolve", () => ({
  useEvolve: () => ({
    handleEvolve: mocks.handleEvolve,
    evolveFromManual: mocks.evolveFromManual,
    buildCheck: mocks.buildCheck,
  }),
}));

vi.mock("@/components/widget/promptinput/homebrew-badge", () => ({
  HomebrewBadge: () => null,
}));

vi.mock("@/components/widget/promptinput/system-defaults-cta", () => ({
  SystemDefaultsCTA: () => null,
}));

// Mock the router so this test doesn't pull in the full component graph
// (router.tsx → DarwinWidget → EditorPanel → monaco, which needs matchMedia).
vi.mock("@/router", () => ({
  nav: {
    openSettings: vi.fn<() => void>(),
    goHome: vi.fn<() => void>(),
    closeSettings: vi.fn<() => void>(),
  },
}));

// The animated placeholder isn't under test here; stub it so its timers don't
// fire state updates outside act() after the assertions.
vi.mock("@/components/widget/promptinput/use-typewriter-placeholder", () => ({
  useTypewriterPlaceholder: () => ({ text: "", isTyping: false }),
}));

vi.mock("@/lib/providers/ai-provider-validation", () => ({
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
    scanner: {
      getRecommendedPrompt: mocks.getRecommendedPrompt,
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

const scrollIntoView = vi.fn<(options?: ScrollIntoViewOptions | boolean) => void>();
const originalScrollIntoView = Element.prototype.scrollIntoView;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function resetStore() {
  act(() => {
    uiActions.setEvolvePrompt("");
    uiActions.setRecommendedPrompt(null);
    viewModelActions.setState({
      git: null,
      evolve: null,
      build: {
        externalBuildDetected: false,
        upstreamUpdateAvailable: false,
        rebuildNeeded: false,
      },
      preferences: makeGlobalPreferences(),
      promptHistory: [],
    });
    uiActions.setProcessing(false);
  });
}

async function settleProviderValidation() {
  await waitFor(() => {
    expect(mocks.getPrefs).toHaveBeenCalled();
    expect(mocks.checkTools).toHaveBeenCalled();
  });
}

describe("<PromptInput>", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    resetStore();
    mocks.handleEvolve.mockResolvedValue();
    mocks.evolveFromManual.mockResolvedValue();
    mocks.buildCheck.mockResolvedValue({ passed: true });
    mocks.getPrefs.mockResolvedValue({});
    mocks.checkTools.mockResolvedValue({ claude: false, codex: false, opencode: false });
    mocks.getRecommendedPrompt.mockResolvedValue(null);
  });

  afterEach(() => {
    resetStore();
    scrollIntoView.mockReset();
    if (originalScrollIntoView) {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    } else {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("evolves directly on a dirty tree without opening a blocking dialog", async () => {
    uiActions.setEvolvePrompt("install vim");
    viewModelActions.setState({ git: dirtyGitStatus, evolve: null });

    render(<PromptInput />);
    await settleProviderValidation();

    fireEvent.click(screen.getByTestId("evolve-prompt-send"));

    await waitFor(() => {
      expect(mocks.handleEvolve).toHaveBeenCalled();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reveals and focuses a seeded starter prompt without submitting it", async () => {
    // The default suggestion variant is `spotlight`; force `chips` via the
    // developer override so the curated chips render for this scenario.
    viewModelActions.patch({
      preferences: makeGlobalPreferences({
        featureFlagOverrides: { [EVOLVE_PROMPT_SUGGESTIONS_FLAG]: "chips" },
      }),
    });

    const suggestion = STARTER_PROMPT_CHIPS.find(({ id }) => id === "dev-terminal");
    if (!suggestion) throw new Error("Expected dev-terminal starter prompt");

    render(<PromptInput />);
    await settleProviderValidation();

    const chip = screen.getByRole("button", { name: suggestion.label });
    expect(chip.querySelector("svg")).toBeInTheDocument();

    fireEvent.click(chip);

    const input = screen.getByTestId("evolve-prompt-input") as HTMLTextAreaElement;

    await waitFor(() => {
      expect(input).toHaveValue(suggestion.prompt);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
      expect(input).toHaveFocus();
    });
    expect(input.selectionStart).toBe(suggestion.prompt.length);
    expect(input.selectionEnd).toBe(suggestion.prompt.length);
    expect(mocks.handleEvolve).not.toHaveBeenCalled();
  });

  it("keeps focus on a prompt selected from history after the popover closes", async () => {
    const historyPrompt = "Show all file extensions in Finder";
    viewModelActions.setState({ promptHistory: [historyPrompt] });

    render(<PromptInput />);
    await settleProviderValidation();

    fireEvent.click(screen.getByRole("button", { name: "My History" }));
    fireEvent.click(await screen.findByText(historyPrompt));

    const input = screen.getByTestId("evolve-prompt-input") as HTMLTextAreaElement;
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search history...")).not.toBeInTheDocument();
      expect(input).toHaveValue(historyPrompt);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
      expect(input).toHaveFocus();
    });
    expect(input.selectionStart).toBe(historyPrompt.length);
    expect(input.selectionEnd).toBe(historyPrompt.length);
    expect(mocks.handleEvolve).not.toHaveBeenCalled();
  });

  it("restores focus to the history trigger when the popover closes without a selection", async () => {
    viewModelActions.setState({ promptHistory: ["Show all file extensions in Finder"] });

    render(<PromptInput />);
    await settleProviderValidation();

    const trigger = screen.getByRole("button", { name: "My History" });
    fireEvent.click(trigger);

    const search = await screen.findByPlaceholderText("Search history...");
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.keyDown(search, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search history...")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("routes the Mac recommendation through the same seed behavior", async () => {
    const recommendation = {
      id: "finder-extensions",
      promptText: "Show all file extensions in Finder",
    };
    uiActions.setRecommendedPrompt(recommendation);

    render(<PromptInput />);
    await settleProviderValidation();

    fireEvent.click(screen.getByRole("button", { name: recommendation.promptText }));

    const input = screen.getByTestId("evolve-prompt-input") as HTMLTextAreaElement;
    await waitFor(() => {
      expect(input).toHaveValue(recommendation.promptText);
      expect(scrollIntoView).toHaveBeenCalled();
      expect(input).toHaveFocus();
    });
    expect(input.selectionStart).toBe(recommendation.promptText.length);
    expect(input.selectionEnd).toBe(recommendation.promptText.length);
    expect(mocks.handleEvolve).not.toHaveBeenCalled();
  });

  it("avoids smooth scrolling when reduced motion is preferred", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    viewModelActions.patch({
      preferences: makeGlobalPreferences({
        featureFlagOverrides: { [EVOLVE_PROMPT_SUGGESTIONS_FLAG]: "chips" },
      }),
    });

    const suggestion = STARTER_PROMPT_CHIPS.find(({ id }) => id === "dev-terminal");
    if (!suggestion) throw new Error("Expected dev-terminal starter prompt");

    render(<PromptInput />);
    await settleProviderValidation();

    fireEvent.click(screen.getByRole("button", { name: suggestion.label }));

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "nearest" });
    });
  });
});
