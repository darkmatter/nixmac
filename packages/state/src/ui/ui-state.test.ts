import { FeedbackType } from "@nixmac/native/types/feedback";
import { beforeEach, describe, expect, it } from "vitest";
import { uiActions } from "./actions";
import { initialUiState } from "./store";
import { useUiState } from "./selectors";

describe("useUiState", () => {
  beforeEach(() => {
    uiActions.reset();
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
    uiActions.setSettingsOpen(true, "developer");
    uiActions.setProcessing(true, "evolve");
    uiActions.openFeedback(FeedbackType.Bug, "broken");
    uiActions.appendLog("first");
    uiActions.appendLog(" second");

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
    uiActions.setError("boom");
    expect(useUiState.getState().error).toBe("boom");
    uiActions.setError(null);
    expect(useUiState.getState().error).toBeNull();
  });

  it("setProcessing clears the action when not processing and defaults it to null", () => {
    uiActions.setProcessing(true, "apply");
    expect(useUiState.getState().processingAction).toBe("apply");

    uiActions.setProcessing(false, "apply");
    expect(useUiState.getState().isProcessing).toBe(false);
    expect(useUiState.getState().processingAction).toBeNull();

    uiActions.setProcessing(true);
    expect(useUiState.getState().processingAction).toBeNull();
  });

  it("setSettingsOpen(false) resets the active tab", () => {
    uiActions.setSettingsOpen(true, "api-keys");
    expect(useUiState.getState().settingsActiveTab).toBe("api-keys");

    uiActions.setSettingsOpen(false);
    expect(useUiState.getState().settingsOpen).toBe(false);
    expect(useUiState.getState().settingsActiveTab).toBeNull();
  });

  it("clearLogs resets the console buffer", () => {
    uiActions.appendLog("hello");
    uiActions.clearLogs();
    expect(useUiState.getState().consoleLogs).toBe("");
  });

  it("removing an absent analyzing hash is a no-op", () => {
    expect(() => uiActions.removeAnalyzingHistoryHash("nope")).not.toThrow();
    expect(useUiState.getState().analyzingHistoryForHashes.size).toBe(0);
  });

  it("tracks bootstrap and commit-message-suggestion state", () => {
    expect(useUiState.getState().isBootstrapping).toBe(false);
    expect(useUiState.getState().commitMessageSuggestion).toBeNull();

    uiActions.setBootstrapping(true);
    uiActions.setCommitMessageSuggestion("feat: add vim");
    expect(useUiState.getState().isBootstrapping).toBe(true);
    expect(useUiState.getState().commitMessageSuggestion).toBe("feat: add vim");

    uiActions.setBootstrapping(false);
    uiActions.setCommitMessageSuggestion(null);
    expect(useUiState.getState().isBootstrapping).toBe(false);
    expect(useUiState.getState().commitMessageSuggestion).toBeNull();
  });

  it("updates analyzing history hashes immutably", () => {
    const before = useUiState.getState().analyzingHistoryForHashes;

    uiActions.addAnalyzingHistoryHash("abc");
    const afterAdd = useUiState.getState().analyzingHistoryForHashes;
    uiActions.removeAnalyzingHistoryHash("abc");
    const afterRemove = useUiState.getState().analyzingHistoryForHashes;

    expect(afterAdd).not.toBe(before);
    expect(afterAdd.has("abc")).toBe(true);
    expect(afterRemove).not.toBe(afterAdd);
    expect(afterRemove.has("abc")).toBe(false);
  });

  it("reset restores initial state", () => {
    uiActions.setError("boom");
    uiActions.reset();
    expect(useUiState.getState()).toEqual(initialUiState);
  });
});
