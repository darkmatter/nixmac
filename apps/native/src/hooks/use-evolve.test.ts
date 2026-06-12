import type { EvolveState, EvolutionResult, GitStatus, SemanticChangeMap } from "@/ipc/types";
import { initialUiState, useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";
import { mirrorChangeMapState } from "@/viewmodel/change-map";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";
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
    summarizedChanges: {
      findChangeMap: vi.fn(),
    },
  },
  ipcRenderer: {
    on: mocks.on,
  },
}));

const gitStatus: GitStatus = {
  files: [],
  branch: "main",
  diff: "",
  additions: 0,
  deletions: 0,
  headCommitHash: "abc123",
  cleanHead: true,
  changes: [],
};

const evolveState: EvolveState = {
  evolutionId: 1,
  currentChangesetId: 2,
  committable: false,
  backupBranch: null,
  rollbackBranch: null,
  rollbackStorePath: null,
  rollbackChangesetId: null,
  step: "evolve",
};

describe("useEvolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.promptHistoryAdd.mockResolvedValue(undefined);
    mocks.promptHistoryGet.mockResolvedValue([]);
    mocks.on.mockResolvedValue(vi.fn());

    const store = useWidgetStore.getState();
    useUiState.setState({ ...initialUiState });
    store.clearEvolveEvents();
    store.setConversationalResponse(null);
    mirrorChangeMapState(null);
    mirrorGitState(null);
    mirrorEvolveState(null);
  });

  it("preserves the current change map for conversational follow-ups", async () => {
    const existingMap: SemanticChangeMap = {
      groups: [],
      singles: [],
      unsummarizedHashes: ["existing-change"],
    };
    const conversationalResult: EvolutionResult = {
      changeMap: { groups: [], singles: [], unsummarizedHashes: [] },
      gitStatus,
      evolveState,
      conversationalResponse: "No file changes needed.",
      telemetry: {
        state: "conversational",
        iterations: 1,
        buildAttempts: 0,
        totalTokens: 10,
        editsCount: 0,
        thinkingCount: 0,
        toolCallsCount: 0,
        durationMs: 5,
      },
    };

    mocks.evolve.mockResolvedValue(conversationalResult);

    useUiState.getState().setEvolvePrompt("explain the current changes");
    mirrorChangeMapState(existingMap);

    await useEvolve().handleEvolve();

    expect(useViewModel.getState().changeMap).toBe(existingMap);
    expect(useWidgetStore.getState().conversationalResponse).toBe("No file changes needed.");
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
