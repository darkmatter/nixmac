import type { SemanticChangeMap } from "@/ipc/types";
import { initialUiState, useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEvolve } from "./use-evolve";

const mocks = vi.hoisted(() => ({
  evolve: vi.fn(),
  promptHistoryAdd: vi.fn(),
  promptHistoryGet: vi.fn(),
  on: vi.fn(),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    darwin: {
      evolve: mocks.evolve,
      evolveFromManual: vi.fn(),
      buildCheck: vi.fn(),
    },
    promptHistory: {
      add: mocks.promptHistoryAdd,
      get: mocks.promptHistoryGet,
    },
  },
  ipcRenderer: {
    on: mocks.on,
  },
}));

describe("useEvolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.promptHistoryAdd.mockResolvedValue(undefined);
    mocks.promptHistoryGet.mockResolvedValue([]);
    mocks.on.mockResolvedValue(vi.fn());

    useUiState.setState({ ...initialUiState });
    useViewModel.setState({
      evolveEvents: [],
      changeMap: null,
      git: null,
      evolve: null,
      build: { externalBuildDetected: false },
    });
  });

  it("leaves the mirrored change map alone — result state flows via cell events", async () => {
    const existingMap: SemanticChangeMap = {
      groups: [],
      singles: [],
      unsummarizedHashes: ["existing-change"],
    };

    mocks.evolve.mockResolvedValue(undefined);

    useUiState.getState().setEvolvePrompt("explain the current changes");
    useViewModel.setState({ changeMap: existingMap });

    await useEvolve().handleEvolve();

    expect(mocks.evolve).toHaveBeenCalledWith("explain the current changes");
    expect(useViewModel.getState().changeMap).toBe(existingMap);
    // Prompt is cleared on success.
    expect(useUiState.getState().evolvePrompt).toBe("");
  });

  it("surfaces failures without clearing the prompt", async () => {
    mocks.evolve.mockRejectedValue(new Error("AI evolution failed: boom"));

    useUiState.getState().setEvolvePrompt("install vim");

    await useEvolve().handleEvolve();

    expect(useUiState.getState().error).toContain("boom");
    expect(useUiState.getState().evolvePrompt).toBe("install vim");
    expect(useUiState.getState().isProcessing).toBe(false);
  });

  it("logs a stopped message when a safety limit is reached", async () => {
    const limitReachedResult: EvolutionResult = {
      changeMap: { groups: [], singles: [], unsummarizedHashes: [] },
      gitStatus,
      evolveState,
      conversationalResponse: null,
      telemetry: {
        state: "limitReached",
        iterations: 25,
        buildAttempts: 0,
        totalTokens: 50_000,
        editsCount: 0,
        thinkingCount: 0,
        toolCallsCount: 0,
        durationMs: 12_345,
      },
    };

    mocks.evolve.mockResolvedValue(limitReachedResult);

    const store = useWidgetStore.getState();
    store.setEvolvePrompt("install htop");

    await useEvolve().handleEvolve();

    const logs = useWidgetStore.getState().consoleLogs;
    expect(logs).toContain("Evolution stopped (safety limit reached)");
    expect(logs).not.toContain("✓ Evolution complete");
  });
});
