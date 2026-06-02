import { FeedbackType } from "@/types/feedback";
import { beforeEach, describe, expect, it } from "vitest";
import { initialUiState, useUiState } from "./ui-state";

describe("useUiState", () => {
  beforeEach(() => {
    useUiState.setState(initialUiState);
  });

  it("keeps UI-only defaults outside the backend view model", () => {
    const state = useUiState.getState();

    expect(state.settingsOpen).toBe(false);
    expect(state.settingsActiveTab).toBeNull();
    expect(state.showHistory).toBe(false);
    expect(state.showFilesystem).toBe(false);
    expect(state.feedbackOpen).toBe(false);
    expect(state.error).toBeNull();
    expect(state.evolvePrompt).toBe("");
    expect(state.isProcessing).toBe(false);
    expect(state.consoleLogs).toBe("");
    expect(state.analyzingHistoryForHashes.size).toBe(0);
  });

  it("updates modal, processing, feedback, and log state through UI setters", () => {
    const state = useUiState.getState();

    state.setSettingsOpen(true, "developer");
    state.setProcessing(true, "evolve");
    state.openFeedback(FeedbackType.Bug, "broken");
    state.appendLog("first");
    state.appendLog(" second");

    const next = useUiState.getState();
    expect(next.settingsOpen).toBe(true);
    expect(next.settingsActiveTab).toBe("developer");
    expect(next.isProcessing).toBe(true);
    expect(next.processingAction).toBe("evolve");
    expect(next.feedbackOpen).toBe(true);
    expect(next.feedbackTypeOverride).toBe(FeedbackType.Bug);
    expect(next.feedbackInitialText).toBe("broken");
    expect(next.consoleLogs).toBe("first second");
  });

  it("updates analyzing history hashes immutably", () => {
    const before = useUiState.getState().analyzingHistoryForHashes;

    useUiState.getState().addAnalyzingHistoryHash("abc");
    const afterAdd = useUiState.getState().analyzingHistoryForHashes;
    useUiState.getState().removeAnalyzingHistoryHash("abc");
    const afterRemove = useUiState.getState().analyzingHistoryForHashes;

    expect(afterAdd).not.toBe(before);
    expect(afterAdd.has("abc")).toBe(true);
    expect(afterRemove).not.toBe(afterAdd);
    expect(afterRemove.has("abc")).toBe(false);
  });
});
