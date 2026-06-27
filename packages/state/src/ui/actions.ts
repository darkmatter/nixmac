import type {
  EvolutionTelemetry,
  FileDiffContents,
  RecommendedPrompt,
} from "@nixmac/native/ipc/types";
import { FeedbackType } from "@nixmac/native/types/feedback";
import type { RebuildContext } from "@nixmac/native/types/rebuild";
import { initialUiState, uiStore } from "./store";
import type { ProcessingAction, SettingsTab, UiStateValues } from "./types";

/**
 * @todo This needs a pass to determine how much of this is redundant
 */
export const uiActions = {
  getState: uiStore.getState,
  setState: uiStore.setState,
  subscribe: uiStore.subscribe,
  reset: () => uiStore.setState(initialUiState),

  setSettingsOpen: (settingsOpen: boolean, tab?: SettingsTab | null) =>
    uiStore.setState({ settingsOpen, settingsActiveTab: tab ?? null }),
  setShowHistory: (showHistory: boolean) => uiStore.setState({ showHistory }),
  setShowFilesystem: (showFilesystem: boolean, section: string | null = null) =>
    uiStore.setState({
      showFilesystem,
      filesystemTargetSection: showFilesystem ? section : null,
    }),
  setFeedbackOpen: (feedbackOpen: boolean) => uiStore.setState({ feedbackOpen }),
  setFeedbackTypeOverride: (feedbackTypeOverride: FeedbackType | null) =>
    uiStore.setState({ feedbackTypeOverride }),
  openFeedback: (type?: FeedbackType, initialText?: string) =>
    uiStore.setState({
      feedbackOpen: true,
      feedbackTypeOverride: type ?? null,
      feedbackInitialText: initialText ?? null,
    }),
  setPanicDetails: (panicDetails: UiStateValues["panicDetails"]) =>
    uiStore.setState({ panicDetails }),
  setError: (error: string | null) => uiStore.setState({ error }),
  setEditingFile: (editingFile: string | null) => uiStore.setState({ editingFile }),
  setEvolvePrompt: (evolvePrompt: string) => uiStore.setState({ evolvePrompt }),
  setProcessing: (isProcessing: boolean, action: ProcessingAction = null) =>
    uiStore.setState({
      isProcessing,
      processingAction: isProcessing ? action : null,
    }),
  setSummarizing: (isSummarizing: boolean) => uiStore.setState({ isSummarizing }),
  setGenerating: (isGenerating: boolean) => uiStore.setState({ isGenerating }),
  appendLog: (text: string) =>
    uiStore.setState((state) => ({ consoleLogs: state.consoleLogs + text })),
  clearLogs: () => uiStore.setState({ consoleLogs: "" }),
  addAnalyzingHistoryHash: (hash: string) =>
    uiStore.setState((state) => ({
      analyzingHistoryForHashes: new Set([...state.analyzingHistoryForHashes, hash]),
    })),
  removeAnalyzingHistoryHash: (hash: string) =>
    uiStore.setState((state) => {
      const next = new Set(state.analyzingHistoryForHashes);
      next.delete(hash);
      return { analyzingHistoryForHashes: next };
    }),
  setBootstrapping: (isBootstrapping: boolean) => uiStore.setState({ isBootstrapping }),
  setRebuildContext: (rebuildContext: RebuildContext) => uiStore.setState({ rebuildContext }),
  setRebuildPanelDismissed: (rebuildPanelDismissed: boolean) =>
    uiStore.setState({ rebuildPanelDismissed }),
  setConversationalResponse: (conversationalResponse: string | null) =>
    uiStore.setState({ conversationalResponse }),
  setEvolutionTelemetry: (evolutionTelemetry: EvolutionTelemetry | null) =>
    uiStore.setState({ evolutionTelemetry }),
  setCommitMessageSuggestion: (commitMessageSuggestion: string | null) =>
    uiStore.setState({ commitMessageSuggestion }),
  setFileDiffContents: (fileDiffContents: Record<string, FileDiffContents>) =>
    uiStore.setState({ fileDiffContents }),
  setRecommendedPrompt: (recommendedPrompt: RecommendedPrompt | null | undefined) =>
    uiStore.setState({ recommendedPrompt }),
};
