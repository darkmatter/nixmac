import type { EvolveState, EvolutionResult, GitStatus, SemanticChangeMap } from "@/ipc/types";
import type { TelemetryEvent } from "@/lib/telemetry/types";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store";
import { mirrorChangeMapState } from "@/viewmodel/change-map";
import { mirrorEvolveState } from "@/viewmodel/evolve";
import { mirrorGitState } from "@/viewmodel/git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEvolve } from "./use-evolve";

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn<(event: TelemetryEvent) => void>(),
  evolve: vi.fn<() => Promise<EvolutionResult>>(),
  promptHistoryAdd: vi.fn<(prompt: string) => Promise<void>>(),
  promptHistoryGet: vi.fn<() => Promise<string[]>>(),
  on: vi.fn<() => Promise<() => void>>(),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    darwin: {
      evolve: mocks.evolve,
      evolveFromManual: vi.fn<() => Promise<void>>(),
      buildCheck: vi.fn<() => Promise<unknown>>(),
    },
    promptHistory: {
      add: mocks.promptHistoryAdd,
      get: mocks.promptHistoryGet,
    },
    summarizedChanges: {
      findChangeMap: vi.fn<() => Promise<void>>(),
    },
  },
  ipcRenderer: {
    on: mocks.on,
  },
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mocks.captureEvent,
  }),
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
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    mirrorChangeMapState(null);
    mirrorGitState(null);
    mirrorEvolveState(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    mirrorChangeMapState(existingMap);

    await useEvolve().handleEvolve();

    expect(useViewModel.getState().changeMap).toBe(existingMap);
    expect(useWidgetStore.getState().conversationalResponse).toBe("No file changes needed.");
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "evolve_started",
      props: { source: "prompt" },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "evolve_completed",
      props: { outcome: "conversational", step: "evolve" },
    });
  });

  it("emits category-only error telemetry for agent evolution failures", async () => {
    mocks.evolve.mockRejectedValue(new Error("agent crashed"));

    const store = useWidgetStore.getState();
    store.setEvolvePrompt("install vim");

    await useEvolve().handleEvolve();

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "evolve_failed",
      props: { stage: "agent" },
    });
    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "error_occurred",
      props: { category: "agent", surface: "gui" },
    });
  });

  it("does not convert build/apply message substrings into error_occurred categories", async () => {
    mocks.evolve.mockRejectedValue(new Error("build failed while applying changes"));

    const store = useWidgetStore.getState();
    store.setEvolvePrompt("install vim");

    await useEvolve().handleEvolve();

    expect(mocks.captureEvent).toHaveBeenCalledWith({
      name: "evolve_failed",
      props: { stage: "build" },
    });
    expect(mocks.captureEvent).not.toHaveBeenCalledWith({
      name: "error_occurred",
      props: { category: "build_error", surface: "gui" },
    });
  });
});
