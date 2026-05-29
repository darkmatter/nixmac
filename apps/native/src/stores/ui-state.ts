// UI state — ephemeral widget-level state that does NOT come from Rust.
//
// This store owns transient UI concerns: which panel is open, loading flags,
// the current evolve prompt text, console log output, and processing state.
// Data that originates from the Rust backend (git status, evolve state,
// change maps) lives in the ViewModel store instead.
//
// The split prevents Rust-driven state updates from clobbering local UI
// concerns (e.g. closing a settings panel just because git status changed).

import { FeedbackType } from "@/types/feedback";
import { create } from "zustand";

export type SettingsTab = "general" | "api-keys" | "ai-models" | "preferences" | "tuning" | "developer";
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
};

/**
 * @todo This needs a pass to determine how much of this is redundant
 */
export const useUiState = create<UiState>()((set) => ({
  ...initialUiState,
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
}));
