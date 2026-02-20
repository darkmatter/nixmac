import { create } from "zustand";
import type { ChangesSummary, EvolveEvent, GitStatus, PermissionsState } from "@/tauri-api";
import { computeCurrentStep } from "@/components/widget/utils";
export type {
  ChangesSummary,
  EvolveEvent,
  EvolveEventType,
  GitFileStatus,
  GitStatus,
  PermissionsState
} from "@/tauri-api";

// =============================================================================
// Types
// =============================================================================

/**
 * Widget step state - updated by useEffect based on app state.
 */
export type WidgetStep =
  | "permissions"
  | "setup"
  | "evolving"
  | "merge";
export type ProcessingAction = "evolve" | "apply" | "merge" | "cancel" | null;

// Rebuild state for showing progress inline in the widget
export type RebuildErrorType =
  | "infinite_recursion"
  | "evaluation_error"
  | "build_error"
  | "full_disk_access"
  | "generic_error";

export interface RebuildLine {
  id: number;
  text: string;
  type: "stdout" | "stderr" | "info";
}

export interface RebuildState {
  isRunning: boolean;
  lines: RebuildLine[];
  rawLines: string[];
  exitCode?: number;
  success?: boolean;
  errorType?: RebuildErrorType;
  errorMessage?: string;
}

export interface WidgetState {
  // Permissions (checked on startup)
  permissionsState: PermissionsState | null;
  permissionsChecked: boolean;

  // Config (from backend)
  configDir: string;
  hosts: string[];
  host: string;

  // Bootstrap (creating default config)
  isBootstrapping: boolean;

  // Git (from backend)
  gitStatus: GitStatus | null;
  // Evolution
  evolvePrompt: string;
  commitMsg: string;
  isProcessing: boolean;
  processingAction: ProcessingAction;
  evolveEvents: EvolveEvent[];

  // Summary (AI-generated)
  summary: ChangesSummary;

  // Rebuild state (for inline rebuild progress)
  rebuild: RebuildState;

  // Console
  consoleLogs: string;

  // UI
  summaryLoading: boolean;
  summaryStale: boolean;
  isGenerating: boolean;
  settingsOpen: boolean;
  feedbackOpen: boolean;
  error: string | null;
  suggestions: string[];
}

export interface WidgetActions {
  // Permissions
  setPermissionsState: (state: PermissionsState | null) => void;
  setPermissionsChecked: (checked: boolean) => void;

  // Setters
  setConfigDir: (dir: string) => void;
  setHosts: (hosts: string[]) => void;
  setHost: (host: string) => void;
  setBootstrapping: (isBootstrapping: boolean) => void;
  setGitStatus: (status: GitStatus | null) => void;
  setEvolvePrompt: (prompt: string) => void;
  setCommitMsg: (msg: string) => void;
  setProcessing: (isProcessing: boolean, action?: ProcessingAction) => void;
  setSummary: (summary: ChangesSummary) => void;
  setSettingsOpen: (open: boolean) => void;
  setFeedbackOpen: (open: boolean) => void;
  setError: (error: string | null) => void;

  // Client-side state (NOT from server)
  setSummaryLoading: (loading: boolean) => void;
  setSummaryStale: (stale: boolean) => void;
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
  appendRawLine: (line: string) => void;
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
  rawLines: [],
  exitCode: undefined,
  success: undefined,
  errorType: undefined,
  errorMessage: undefined,
};

export const initialSummaryState: ChangesSummary = {
  items: [],
  instructions: "",
  commitMessage: "",
};

export const initialWidgetState: WidgetState = {
  // Permissions
  permissionsState: null,
  permissionsChecked: false,

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
  summary: initialSummaryState,

  // Rebuild
  rebuild: initialRebuildState,

  // Console
  consoleLogs: "",

  // UI
  summaryLoading: false,
  summaryStale: false,
  isBootstrapping: false,
  isGenerating: false,
  settingsOpen: false,
  feedbackOpen: false,
  error: null,
  suggestions: ["Install vim", "Add Rectangle app", "Configure git"],
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

    // Permissions
    setPermissionsState: (permissionsState) => set({ permissionsState }),
    setPermissionsChecked: (permissionsChecked) => set({ permissionsChecked }),

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
    setSummary: (summary) => set({ summary, summaryStale: false }),
    setSummaryLoading: (summaryLoading) => set({ summaryLoading }),
    setSummaryStale: (summaryStale) => set({ summaryStale }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    setFeedbackOpen: (feedbackOpen) => set({ feedbackOpen }),
    setError: (error) => set({ error }),

    // Client-side UI state (NOT from server)
    setBootstrapping: (isBootstrapping) => set({ isBootstrapping }),
    setGenerating: (isGenerating) => set({ isGenerating }),
    clearPreview: () =>
      set({
        summary: initialSummaryState,
        summaryLoading: false,
        summaryStale: false,
      }),

    // Console
    appendLog: (text) =>
      set((state) => ({ consoleLogs: state.consoleLogs + text })),
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
          rawLines: [],
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
    appendRawLine: (line) =>
      set((state) => ({
        rebuild: {
          ...state.rebuild,
          rawLines: [...state.rebuild.rawLines, line].slice(-500), // Keep last 500 raw lines
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

/**
 * Hook to get the current widget step.
 * Uses a selector so components only re-render when the step actually changes.
 */
export function useCurrentStep(): WidgetStep {
  return useWidgetStore((state) => computeCurrentStep(state));
}
