import { uiStore } from "./store";
import type { UiStateStore } from "./store";

/** Subscribe to slices of ephemeral widget UI state. */
export const useUiState = uiStore;

export type UiStateSelector<T> = (state: UiStateStore) => T;

export const selectSettingsOpen = (state: UiStateStore) => state.settingsOpen;
export const selectSettingsActiveTab = (state: UiStateStore) => state.settingsActiveTab;
export const selectShowHistory = (state: UiStateStore) => state.showHistory;
export const selectShowFilesystem = (state: UiStateStore) => state.showFilesystem;
export const selectFilesystemTargetSection = (state: UiStateStore) =>
  state.filesystemTargetSection;
export const selectFeedbackOpen = (state: UiStateStore) => state.feedbackOpen;
export const selectError = (state: UiStateStore) => state.error;
export const selectEvolvePrompt = (state: UiStateStore) => state.evolvePrompt;
export const selectIsProcessing = (state: UiStateStore) => state.isProcessing;
export const selectProcessingAction = (state: UiStateStore) => state.processingAction;
export const selectIsGenerating = (state: UiStateStore) => state.isGenerating;
export const selectIsSummarizing = (state: UiStateStore) => state.isSummarizing;
export const selectConsoleLogs = (state: UiStateStore) => state.consoleLogs;
export const selectEditingFile = (state: UiStateStore) => state.editingFile;
export const selectRebuildContext = (state: UiStateStore) => state.rebuildContext;
export const selectRebuildPanelDismissed = (state: UiStateStore) => state.rebuildPanelDismissed;
export const selectConversationalResponse = (state: UiStateStore) => state.conversationalResponse;
export const selectEvolutionTelemetry = (state: UiStateStore) => state.evolutionTelemetry;
export const selectCommitMessageSuggestion = (state: UiStateStore) => state.commitMessageSuggestion;
export const selectRecommendedPrompt = (state: UiStateStore) => state.recommendedPrompt;
export const selectIsBootstrapping = (state: UiStateStore) => state.isBootstrapping;
