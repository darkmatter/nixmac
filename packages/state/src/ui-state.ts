// UI state — ephemeral widget-level state that does NOT come from Rust.
//
// This store owns transient UI concerns: which panel is open, loading flags,
// the current evolve prompt text, console log output, and processing state.
// Data that originates from the Rust backend (git status, evolve state,
// change maps) lives in the ViewModel store instead.
//
// The split prevents Rust-driven state updates from clobbering local UI
// concerns (e.g. closing a settings panel just because git status changed).

import type {
  EvolutionTelemetry,
  FileDiffContents,
  RecommendedPrompt,
} from "@nixmac/native/ipc/types";
import { FeedbackType } from "@nixmac/native/types/feedback";
import type { RebuildContext } from "@nixmac/native/types/rebuild";
import { create } from "zustand";

export type SettingsTab =
  | "general"
  | "account"
  | "api-keys"
  | "ai-models"
  | "preferences"
  | "tuning"
  | "developer";
type ProcessingAction = "evolve" | "apply" | "merge" | "cancel" | null;

/**
 * @todo This needs a pass to determine how much of this is redundant
 */
export type UiStateValues = {
  settingsOpen: boolean;
  settingsActiveTab: SettingsTab | null;
  showHistory: boolean;
  showFilesystem: boolean;
  filesystemTargetSection: string | null;
  feedbackOpen: boolean;
  feedbackTypeOverride: FeedbackType | null;
  feedbackInitialText: string | null;
  panicDetails: {
    message: string;
    location?: string;
    backtrace?: string;
    timestamp: string;
  } | null;
  error: string | null;
  editingFile: string | null;
  evolvePrompt: string;
  isProcessing: boolean;
  processingAction: ProcessingAction;
  isSummarizing: boolean;
  isGenerating: boolean;
  consoleLogs: string;
  analyzingHistoryForHashes: Set<string>;
  isBootstrapping: boolean;
  /** What kind of rebuild the overlay panel is reporting on. */
  rebuildContext: RebuildContext;
  /** True once the user (or a successful run) dismissed the rebuild panel. */
  rebuildPanelDismissed: boolean;
  /** Command result: assistant reply when an evolve turned out conversational. */
  conversationalResponse: string | null;
  /** Command result: telemetry of the last evolve run. */
  evolutionTelemetry: EvolutionTelemetry | null;
  commitMessageSuggestion: string | null;
  /** On-demand query result: per-file diff contents prefetched for the diff view. */
  fileDiffContents: Record<string, FileDiffContents>;
  /** On-demand query result. `undefined` means "stale/unfetched"; `null` means "fetched and none found". */
  recommendedPrompt: RecommendedPrompt | null | undefined;
};

/**
 * @todo This needs a pass to determine how much of this is redundant
 */
type UiStateActions = {
  setSettingsOpen: (open: boolean, tab?: SettingsTab | null) => void;
  setShowHistory: (show: boolean) => void;
  setShowFilesystem: (show: boolean, section?: string | null) => void;
  setFeedbackOpen: (open: boolean) => void;
  setFeedbackTypeOverride: (type: FeedbackType | null) => void;
  openFeedback: (type?: FeedbackType, initialText?: string) => void;
  setPanicDetails: (details: UiStateValues["panicDetails"]) => void;
  setError: (error: string | null) => void;
  setEditingFile: (file: string | null) => void;
  setEvolvePrompt: (prompt: string) => void;
  setProcessing: (isProcessing: boolean, action?: ProcessingAction) => void;
  setSummarizing: (summarizing: boolean) => void;
  setGenerating: (generating: boolean) => void;
  appendLog: (text: string) => void;
  clearLogs: () => void;
  addAnalyzingHistoryHash: (hash: string) => void;
  removeAnalyzingHistoryHash: (hash: string) => void;
  setBootstrapping: (isBootstrapping: boolean) => void;
  setRebuildContext: (context: RebuildContext) => void;
  setRebuildPanelDismissed: (dismissed: boolean) => void;
  setConversationalResponse: (response: string | null) => void;
  setEvolutionTelemetry: (telemetry: EvolutionTelemetry | null) => void;
  setCommitMessageSuggestion: (msg: string | null) => void;
  setFileDiffContents: (contents: Record<string, FileDiffContents>) => void;
  setRecommendedPrompt: (prompt: RecommendedPrompt | null | undefined) => void;
};

export type UiState = UiStateValues & UiStateActions;

export const initialUiState: UiStateValues = {
  settingsOpen: false,
  settingsActiveTab: null,
  showHistory: false,
  showFilesystem: false,
  filesystemTargetSection: null,
  feedbackOpen: false,
  feedbackTypeOverride: null,
  feedbackInitialText: null,
  panicDetails: null,
  error: null,
  editingFile: null,
  evolvePrompt: "",
  isProcessing: false,
  processingAction: null,
  isSummarizing: false,
  isGenerating: false,
  consoleLogs: "",
  analyzingHistoryForHashes: new Set<string>(),
  isBootstrapping: false,
  rebuildContext: "apply",
  rebuildPanelDismissed: false,
  conversationalResponse: null,
  evolutionTelemetry: null,
  commitMessageSuggestion: null,
  fileDiffContents: {},
  recommendedPrompt: undefined,
};

/**
 * @todo This needs a pass to determine how much of this is redundant
 */
export const useUiState = create<UiState>()((set) => ({
  ...initialUiState,
  setSettingsOpen: (settingsOpen, tab) => set({ settingsOpen, settingsActiveTab: tab ?? null }),
  setShowHistory: (showHistory) => set({ showHistory }),
  setShowFilesystem: (showFilesystem, section = null) =>
    set({ showFilesystem, filesystemTargetSection: showFilesystem ? section : null }),
  setFeedbackOpen: (feedbackOpen) => set({ feedbackOpen }),
  setFeedbackTypeOverride: (feedbackTypeOverride) => set({ feedbackTypeOverride }),
  openFeedback: (type, initialText) =>
    set({
      feedbackOpen: true,
      feedbackTypeOverride: type ?? null,
      feedbackInitialText: initialText ?? null,
    }),
  setPanicDetails: (panicDetails) => set({ panicDetails }),
  setError: (error) => set({ error }),
  setEditingFile: (editingFile) => set({ editingFile }),
  setEvolvePrompt: (evolvePrompt) => set({ evolvePrompt }),
  setProcessing: (isProcessing, action = null) =>
    set({
      isProcessing,
      processingAction: isProcessing ? action : null,
    }),
  setSummarizing: (isSummarizing) => set({ isSummarizing }),
  setGenerating: (isGenerating) => set({ isGenerating }),
  appendLog: (text) => set((state) => ({ consoleLogs: state.consoleLogs + text })),
  clearLogs: () => set({ consoleLogs: "" }),
  addAnalyzingHistoryHash: (hash) =>
    set((state) => ({
      analyzingHistoryForHashes: new Set([...state.analyzingHistoryForHashes, hash]),
    })),
  removeAnalyzingHistoryHash: (hash) =>
    set((state) => {
      const next = new Set(state.analyzingHistoryForHashes);
      next.delete(hash);
      return { analyzingHistoryForHashes: next };
    }),
  setBootstrapping: (isBootstrapping) => set({ isBootstrapping }),
  setRebuildContext: (rebuildContext) => set({ rebuildContext }),
  setRebuildPanelDismissed: (rebuildPanelDismissed) => set({ rebuildPanelDismissed }),
  setConversationalResponse: (conversationalResponse) => set({ conversationalResponse }),
  setEvolutionTelemetry: (evolutionTelemetry) => set({ evolutionTelemetry }),
  setCommitMessageSuggestion: (commitMessageSuggestion) => set({ commitMessageSuggestion }),
  setFileDiffContents: (fileDiffContents) => set({ fileDiffContents }),
  setRecommendedPrompt: (recommendedPrompt) => set({ recommendedPrompt }),
}));
