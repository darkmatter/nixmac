import { create } from "zustand";
import type { EvolveEvent, GitStatus } from "@/tauri-api";
export type { EvolveEvent, EvolveEventType, GitFileStatus, GitStatus } from "@/tauri-api";

// =============================================================================
// Types
// =============================================================================

/**
 * Widget step state - updated by useEffect based on app state.
 */
export type WidgetStep = "setup" | "overview" | "evolving" | "commit";
export type ProcessingAction = "evolve" | "apply" | "commit" | "cancel" | null;

export interface SummaryItem {
  title: string;
  description: string;
}

export interface SummaryState {
  items: SummaryItem[];
  instructions: string | null;
  commitMessage: string | null;
  filesChanged: number;
  additions?: number;
  deletions?: number;
  diff?: string;
  isLoading: boolean;
}

// Rebuild state for showing progress inline in the widget
export type RebuildErrorType =
  | "infinite_recursion"
  | "evaluation_error"
  | "build_error"
  | "generic_error";

export interface RebuildLine {
  id: number;
  text: string;
  type: "stdout" | "stderr" | "info";
}

export interface RebuildState {
  isRunning: boolean;
  lines: RebuildLine[];
  exitCode?: number;
  success?: boolean;
  errorType?: RebuildErrorType;
  errorMessage?: string;
}

export interface WidgetState {
  // Config (from backend)
  configDir: string;
  hosts: string[];
  host: string;

  // Git (from backend)
  gitStatus: GitStatus | null;
  // Evolution
  evolvePrompt: string;
  commitMsg: string;
  isProcessing: boolean;
  processingAction: ProcessingAction;
  evolveEvents: EvolveEvent[];

  // Summary (AI-generated)
  summary: SummaryState;

  // Rebuild state (for inline rebuild progress)
  rebuild: RebuildState;

  // Console
  consoleLogs: string;

  // UI
  isGenerating: boolean;
  settingsOpen: boolean;
  error: string | null;
}

export interface WidgetActions {
  // Setters
  setConfigDir: (dir: string) => void;
  setHosts: (hosts: string[]) => void;
  setHost: (host: string) => void;
  setGitStatus: (status: GitStatus | null) => void;
  setEvolvePrompt: (prompt: string) => void;
  setCommitMsg: (msg: string) => void;
  setProcessing: (isProcessing: boolean, action?: ProcessingAction) => void;
  setSummary: (summary: Partial<SummaryState>) => void;
  setSettingsOpen: (open: boolean) => void;
  setError: (error: string | null) => void;

  // Client-side state (NOT from server)
  setGenerating: (generating: boolean) => void;
  clearPreview: () => void;

  // Console
  appendLog: (text: string) => void;
  clearLogs: () => void;

  // Evolve events
  appendEvolveEvent: (event: EvolveEvent) => void;
  clearEvolveEvents: () => void;

  // Rebuild state
  startRebuild: () => void;
  appendRebuildLine: (line: RebuildLine) => void;
  setRebuildError: (errorType: RebuildErrorType, errorMessage: string) => void;
  setRebuildComplete: (success: boolean, exitCode?: number) => void;
  clearRebuild: () => void;
}

export type WidgetStore = WidgetState & WidgetActions;

// =============================================================================
// Initial State
// =============================================================================

export const initialRebuildState: RebuildState = {
  isRunning: false,
  lines: [],
  exitCode: undefined,
  success: undefined,
  errorType: undefined,
  errorMessage: undefined,
};

export const initialWidgetState: WidgetState = {
  // Config
  configDir: "",
  hosts: [],
  host: "",

  // Git
  gitStatus: null,

  // Evolution
  evolvePrompt: "",
  commitMsg: "",
  isProcessing: false,
  processingAction: null,
  evolveEvents: [],

  // Summary
  summary: {
    items: [],
    instructions: null,
    commitMessage: null,
    filesChanged: 0,
    isLoading: false,
  },

  // Rebuild
  rebuild: initialRebuildState,

  // Console
  consoleLogs: "",

  // UI
  isGenerating: false,
  settingsOpen: false,
  error: null,
};

// =============================================================================
// Store Factory
// =============================================================================

/**
 * Create a widget store with optional initial state.
 * This factory pattern allows creating isolated stores for testing/Storybook.
 */
export function createWidgetStore(initialState?: Partial<WidgetState>) {
  return create<WidgetStore>((set, _get) => ({
    ...initialWidgetState,
    ...initialState,

    // Setters
    setConfigDir: (configDir) => set({ configDir }),
    setHosts: (hosts) => set({ hosts }),
    setHost: (host) => set({ host }),
    setGitStatus: (gitStatus) => set({ gitStatus }),
    setEvolvePrompt: (evolvePrompt) => set({ evolvePrompt }),
    setCommitMsg: (commitMsg) => set({ commitMsg }),
    setProcessing: (isProcessing, action = null) =>
      set({
        isProcessing,
        processingAction: isProcessing ? action : null,
      }),
    setSummary: (summary) =>
      set((state) => ({
        summary: { ...state.summary, ...summary },
      })),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    setError: (error) => set({ error }),

    // Client-side UI state (NOT from server)
    setGenerating: (isGenerating) => set({ isGenerating }),
    clearPreview: () =>
      set({
        summary: {
          items: [],
          instructions: null,
          commitMessage: null,
          filesChanged: 0,
          isLoading: false,
        },
      }),

    // Console
    appendLog: (text) => set((state) => ({ consoleLogs: state.consoleLogs + text })),
    clearLogs: () => set({ consoleLogs: "" }),

    // Evolve events
    appendEvolveEvent: (event) =>
      set((state) => ({ evolveEvents: [...state.evolveEvents, event] })),
    clearEvolveEvents: () => set({ evolveEvents: [] }),

    // Rebuild state
    startRebuild: () =>
      set({
        rebuild: {
          isRunning: true,
          lines: [{ id: 0, text: "Preparing rebuild...", type: "info" }],
          exitCode: undefined,
          success: undefined,
          errorType: undefined,
          errorMessage: undefined,
        },
      }),
    appendRebuildLine: (line) =>
      set((state) => ({
        rebuild: {
          ...state.rebuild,
          lines: [...state.rebuild.lines, line].slice(-50), // Keep last 50 lines
        },
      })),
    setRebuildError: (errorType, errorMessage) =>
      set((state) => ({
        rebuild: {
          ...state.rebuild,
          errorType,
          errorMessage,
        },
      })),
    setRebuildComplete: (success, exitCode) =>
      set((state) => ({
        rebuild: {
          ...state.rebuild,
          isRunning: false,
          success,
          exitCode,
        },
      })),
    clearRebuild: () => set({ rebuild: initialRebuildState }),
  }));
}

// =============================================================================
// Default Store Instance
// =============================================================================

/**
 * Default store instance for the main app.
 * Use createWidgetStore() for isolated testing instances.
 */
export const useWidgetStore = createWidgetStore();