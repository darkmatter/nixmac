import { uiStore } from "./store";
import type { UiStateValues } from "./types";

/** Subscribe to slices of ephemeral widget UI state. */
export const useUiState = uiStore;

export type UiStateSelector<T> = (state: UiStateValues) => T;

export const selectSettingsOpen = (state: UiStateValues) => state.settingsOpen;
export const selectSettingsActiveTab = (state: UiStateValues) => state.settingsActiveTab;
export const selectShowHistory = (state: UiStateValues) => state.showHistory;
export const selectShowFilesystem = (state: UiStateValues) => state.showFilesystem;
export const selectFilesystemTargetSection = (state: UiStateValues) =>
  state.filesystemTargetSection;
export const selectFeedbackOpen = (state: UiStateValues) => state.feedbackOpen;
export const selectError = (state: UiStateValues) => state.error;
export const selectEvolvePrompt = (state: UiStateValues) => state.evolvePrompt;
export const selectIsProcessing = (state: UiStateValues) => state.isProcessing;
export const selectProcessingAction = (state: UiStateValues) => state.processingAction;
export const selectIsGenerating = (state: UiStateValues) => state.isGenerating;
export const selectIsSummarizing = (state: UiStateValues) => state.isSummarizing;
export const selectConsoleLogs = (state: UiStateValues) => state.consoleLogs;
export const selectEditingFile = (state: UiStateValues) => state.editingFile;
export const selectRebuildContext = (state: UiStateValues) => state.rebuildContext;
export const selectRebuildPanelDismissed = (state: UiStateValues) => state.rebuildPanelDismissed;
export const selectConversationalResponse = (state: UiStateValues) => state.conversationalResponse;
export const selectEvolutionTelemetry = (state: UiStateValues) => state.evolutionTelemetry;
export const selectCommitMessageSuggestion = (state: UiStateValues) => state.commitMessageSuggestion;
export const selectRecommendedPrompt = (state: UiStateValues) => state.recommendedPrompt;
export const selectIsBootstrapping = (state: UiStateValues) => state.isBootstrapping;
