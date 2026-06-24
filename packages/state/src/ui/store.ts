// UI state — ephemeral widget-level state that does NOT come from Rust.
//
// This store owns transient UI concerns: which panel is open, loading flags,
// the current evolve prompt text, console log output, and processing state.
// Data that originates from the Rust backend (git status, evolve state,
// change maps) lives in the ViewModel store instead.
//
// The split prevents Rust-driven state updates from clobbering local UI
// concerns (e.g. closing a settings panel just because git status changed).

import { create } from "zustand";
import type { UiStateValues } from "./types";

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

export const uiStore = create<UiStateValues>()(() => initialUiState);
