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
  EtcClobberCheckResult,
  EvolutionTelemetry,
  EvolveStep,
  FileDiffContents,
  RecommendedPrompt,
} from "@nixmac/native/ipc/types";
import type { FeedbackType } from "@nixmac/native/types/feedback";
import type { RebuildContext } from "@nixmac/native/types/rebuild";
import { enableMapSet } from "immer";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { ProcessingAction, SettingsTab, UiStateValues } from "./types";

// Immer v6+ no longer drafts Map/Set unless explicitly enabled. This store's
// `analyzingHistoryForHashes` is a Set, so opt in once at module load.
enableMapSet();

export const initialUiState: UiStateValues = {
  // @todo if we have more than one modal, they will stack because of this. Instead,
  // create an activeModalView state
  settingsOpen: false,
  // @todo this should be local to the settings component, not global state
  settingsActiveTab: null,
  // @todo move to router
  showHistory: false,
  // @todo move to router
  showFilesystem: false,
  filesystemTargetSection: null,
  // @todo move to modal router
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
  etcClobber: null,
  etcClobberDialogOpen: false,
  conversationalResponse: null,
  evolutionTelemetry: null,
  commitMessageSuggestion: null,
  fileDiffContents: {},
  recommendedPrompt: undefined,
  /**
   * Since the active step is computed, we need this override in case the user manually
   * clicks a previous step.
   */
  activeStepOverride: null,
};

/** Imperative writers for the UI store. */
export type UiStateActions = {
  reset: () => void;
  setSettingsOpen: (settingsOpen: boolean, tab?: SettingsTab | null) => void;
  setShowHistory: (showHistory: boolean) => void;
  setShowFilesystem: (showFilesystem: boolean, section?: string | null) => void;
  setFeedbackOpen: (feedbackOpen: boolean) => void;
  setFeedbackTypeOverride: (feedbackTypeOverride: FeedbackType | null) => void;
  openFeedback: (type?: FeedbackType, initialText?: string) => void;
  setPanicDetails: (panicDetails: UiStateValues["panicDetails"]) => void;
  setError: (error: string | null) => void;
  setEditingFile: (editingFile: string | null) => void;
  setEvolvePrompt: (evolvePrompt: string) => void;
  setProcessing: (isProcessing: boolean, action?: ProcessingAction) => void;
  setSummarizing: (isSummarizing: boolean) => void;
  setGenerating: (isGenerating: boolean) => void;
  appendLog: (text: string) => void;
  clearLogs: () => void;
  addAnalyzingHistoryHash: (hash: string) => void;
  removeAnalyzingHistoryHash: (hash: string) => void;
  setBootstrapping: (isBootstrapping: boolean) => void;
  setRebuildContext: (rebuildContext: RebuildContext) => void;
  setRebuildPanelDismissed: (rebuildPanelDismissed: boolean) => void;
  setEtcClobber: (etcClobber: EtcClobberCheckResult | null) => void;
  setEtcClobberDialogOpen: (etcClobberDialogOpen: boolean) => void;
  setConversationalResponse: (conversationalResponse: string | null) => void;
  setEvolutionTelemetry: (evolutionTelemetry: EvolutionTelemetry | null) => void;
  setCommitMessageSuggestion: (commitMessageSuggestion: string | null) => void;
  setFileDiffContents: (fileDiffContents: Record<string, FileDiffContents>) => void;
  setRecommendedPrompt: (recommendedPrompt: RecommendedPrompt | null | undefined) => void;
  setActiveStepOverride: (activeStepOverride: EvolveStep | null) => void;
};

/** Combined store shape: state values plus the actions that mutate them. */
export type UiStateStore = UiStateValues & UiStateActions;

export const uiStore = create<UiStateStore>()(
  immer((set) => ({
    ...initialUiState,
    reset: () => set(initialUiState),
    setSettingsOpen: (settingsOpen, tab) =>
      set({ settingsOpen, settingsActiveTab: tab ?? null }),
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
      set({ isProcessing, processingAction: isProcessing ? action : null }),
    setSummarizing: (isSummarizing) => set({ isSummarizing }),
    setGenerating: (isGenerating) => set({ isGenerating }),
    appendLog: (text) =>
      set((state) => {
        state.consoleLogs += text;
      }),
    clearLogs: () => set({ consoleLogs: "" }),
    addAnalyzingHistoryHash: (hash) =>
      set((state) => {
        state.analyzingHistoryForHashes.add(hash);
      }),
    removeAnalyzingHistoryHash: (hash) =>
      set((state) => {
        state.analyzingHistoryForHashes.delete(hash);
      }),
    setBootstrapping: (isBootstrapping) => set({ isBootstrapping }),
    setRebuildContext: (rebuildContext) => set({ rebuildContext }),
    setRebuildPanelDismissed: (rebuildPanelDismissed) => set({ rebuildPanelDismissed }),
    setEtcClobber: (etcClobber) => set({ etcClobber }),
    setEtcClobberDialogOpen: (etcClobberDialogOpen) => set({ etcClobberDialogOpen }),
    setConversationalResponse: (conversationalResponse) => set({ conversationalResponse }),
    setEvolutionTelemetry: (evolutionTelemetry) => set({ evolutionTelemetry }),
    setCommitMessageSuggestion: (commitMessageSuggestion) =>
      set({ commitMessageSuggestion }),
    setFileDiffContents: (fileDiffContents) => set({ fileDiffContents }),
    setRecommendedPrompt: (recommendedPrompt) => set({ recommendedPrompt }),
    setActiveStepOverride: (activeStepOverride) => set({ activeStepOverride }),
  })),
);

/**
 * Back-compat handle that exposes the store's own actions plus the store's
 * `getState`/`setState`/`subscribe` utilities. Zustand action references are
 * stable for the store's lifetime, so they are picked off the initial state
 * once. Kept so existing call sites that import `uiActions` keep working; new
 * code should prefer `uiStore` directly.
 */
const {
  reset,
  setSettingsOpen,
  setShowHistory,
  setShowFilesystem,
  setFeedbackOpen,
  setFeedbackTypeOverride,
  openFeedback,
  setPanicDetails,
  setError,
  setEditingFile,
  setEvolvePrompt,
  setProcessing,
  setSummarizing,
  setGenerating,
  appendLog,
  clearLogs,
  addAnalyzingHistoryHash,
  removeAnalyzingHistoryHash,
  setBootstrapping,
  setRebuildContext,
  setRebuildPanelDismissed,
  setEtcClobber,
  setEtcClobberDialogOpen,
  setConversationalResponse,
  setEvolutionTelemetry,
  setCommitMessageSuggestion,
  setFileDiffContents,
  setRecommendedPrompt,
  setActiveStepOverride,
} = uiStore.getInitialState();

export const uiActions: UiStateActions & {
  getState: typeof uiStore.getState;
  setState: typeof uiStore.setState;
  subscribe: typeof uiStore.subscribe;
} = {
  getState: uiStore.getState,
  setState: uiStore.setState,
  subscribe: uiStore.subscribe,
  reset,
  setSettingsOpen,
  setShowHistory,
  setShowFilesystem,
  setFeedbackOpen,
  setFeedbackTypeOverride,
  openFeedback,
  setPanicDetails,
  setError,
  setEditingFile,
  setEvolvePrompt,
  setProcessing,
  setSummarizing,
  setGenerating,
  appendLog,
  clearLogs,
  addAnalyzingHistoryHash,
  removeAnalyzingHistoryHash,
  setBootstrapping,
  setRebuildContext,
  setRebuildPanelDismissed,
  setEtcClobber,
  setEtcClobberDialogOpen,
  setConversationalResponse,
  setEvolutionTelemetry,
  setCommitMessageSuggestion,
  setFileDiffContents,
  setRecommendedPrompt,
  setActiveStepOverride,
};
