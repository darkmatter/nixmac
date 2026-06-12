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

  it("setError stores the message and can clear it with null", () => {
    useUiState.getState().setError("boom");
    expect(useUiState.getState().error).toBe("boom");
    useUiState.getState().setError(null);
    expect(useUiState.getState().error).toBeNull();
  });

  it("setProcessing clears the action when not processing and defaults it to null", () => {
    useUiState.getState().setProcessing(true, "apply");
    expect(useUiState.getState().processingAction).toBe("apply");

    useUiState.getState().setProcessing(false, "apply");
    expect(useUiState.getState().isProcessing).toBe(false);
    expect(useUiState.getState().processingAction).toBeNull();

    useUiState.getState().setProcessing(true);
    expect(useUiState.getState().processingAction).toBeNull();
  });

  it("setSettingsOpen(false) resets the active tab", () => {
    useUiState.getState().setSettingsOpen(true, "api-keys");
    expect(useUiState.getState().settingsActiveTab).toBe("api-keys");

    useUiState.getState().setSettingsOpen(false);
    expect(useUiState.getState().settingsOpen).toBe(false);
    expect(useUiState.getState().settingsActiveTab).toBeNull();
  });

  it("clearLogs resets the console buffer", () => {
    useUiState.getState().appendLog("hello");
    useUiState.getState().clearLogs();
    expect(useUiState.getState().consoleLogs).toBe("");
  });

  it("removing an absent analyzing hash is a no-op", () => {
    expect(() => useUiState.getState().removeAnalyzingHistoryHash("nope")).not.toThrow();
    expect(useUiState.getState().analyzingHistoryForHashes.size).toBe(0);
  });

  it("tracks bootstrap and commit-message-suggestion state", () => {
    expect(useUiState.getState().isBootstrapping).toBe(false);
    expect(useUiState.getState().commitMessageSuggestion).toBeNull();

    useUiState.getState().setBootstrapping(true);
    useUiState.getState().setCommitMessageSuggestion("feat: add vim");
    expect(useUiState.getState().isBootstrapping).toBe(true);
    expect(useUiState.getState().commitMessageSuggestion).toBe("feat: add vim");

    useUiState.getState().setBootstrapping(false);
    useUiState.getState().setCommitMessageSuggestion(null);
    expect(useUiState.getState().isBootstrapping).toBe(false);
    expect(useUiState.getState().commitMessageSuggestion).toBeNull();
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
