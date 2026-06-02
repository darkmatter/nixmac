import type { EvolveState, EvolutionResult, GitStatus, SemanticChangeMap } from "@/ipc/types";
import { useWidgetStore } from "@/stores/widget-store";
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
    store.setEvolvePrompt("");
    store.setProcessing(false);
    store.setGenerating(false);
    store.setError(null);
    store.clearLogs();
    store.clearEvolveEvents();
    store.setConversationalResponse(null);
    store.setChangeMap(null);
    store.setSummaryAvailable(false);
    store.setGitStatus(null);
    store.setEvolveState(null);
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

    const store = useWidgetStore.getState();
    store.setEvolvePrompt("explain the current changes");
    store.setChangeMap(existingMap);
    store.setSummaryAvailable(true);

    await useEvolve().handleEvolve();

    expect(useWidgetStore.getState().changeMap).toBe(existingMap);
    expect(useWidgetStore.getState().summaryAvailable).toBe(true);
    expect(useWidgetStore.getState().conversationalResponse).toBe("No file changes needed.");
  });
});
