import { create } from "zustand";
import { FeedbackType } from "@/types/feedback";
import type { HistoryItem, SummaryResponse, EvolveEvent, GitStatus, PermissionsState, RecommendedPrompt } from "@/tauri-api";
import { computeCurrentStep } from "@/components/widget/utils";
export type {
  SummaryResponse,
  EvolveEvent,
  EvolveEventType,
  GitFileStatus,
  GitStatus,
  PermissionsState,
} from "@/tauri-api";

// =============================================================================
// Types
// =============================================================================

/**
 * Widget step state - updated by useEffect based on app state.
 */
export type WidgetStep = "permissions" | "nix-setup" | "setup" | "evolving" | "merge" | "history";
export type ProcessingAction = "evolve" | "apply" | "merge" | "cancel" | null;
export type ConfirmPrefKey = "confirmBuild" | "confirmClear" | "confirmRollback";

// Rebuild state for showing progress inline in the widget
export type RebuildErrorType =
  | "infinite_recursion"
  | "evaluation_error"
  | "build_error"
  | "full_disk_access"
  | "user_cancelled"
  | "authorization_denied"
  | "generic_error";

export interface RebuildLine {
  id: number;
  text: string;
  type: "stdout" | "stderr" | "info";
}

export type RebuildContext = "rollback" | "apply";

export interface RebuildState {
  isRunning: boolean;
  context: RebuildContext;
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

  // Nix installation
  nixInstalled: boolean | null; // null = not checked yet
  nixInstalling: boolean;

  // nix-darwin (darwin-rebuild availability)
  darwinRebuildAvailable: boolean | null; // null = not checked yet
  darwinRebuildPrefetching: boolean;

  // Git (from backend)
  gitStatus: GitStatus | null;
  // Evolution
  evolvePrompt: string;
  isProcessing: boolean;
  processingAction: ProcessingAction;
  evolveEvents: EvolveEvent[];
  promptHistory: string[];

  // Summary (AI-generated)
  summary: SummaryResponse;

  // Rebuild state (for inline rebuild progress)
  rebuild: RebuildState;

  // Console
  consoleLogs: string;

  // History
  history: HistoryItem[];
  historyLoading: boolean;
  analyzingHistoryForHashes: Set<string>;

  // UI
  summaryLoading: boolean;
  summaryAvailable: boolean;
  isGenerating: boolean;
  settingsOpen: boolean;
  showHistory: boolean;
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
  recommendedPrompt: RecommendedPrompt | null;

  // Confirmation preferences
  confirmBuild: boolean;
  confirmClear: boolean;
  confirmRollback: boolean;
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
  setNixInstalled: (installed: boolean | null) => void;
  setNixInstalling: (installing: boolean) => void;
  setDarwinRebuildAvailable: (available: boolean | null) => void;
  setDarwinRebuildPrefetching: (prefetching: boolean) => void;
  setGitStatus: (status: GitStatus | null) => void;
  setEvolvePrompt: (prompt: string) => void;
  setProcessing: (isProcessing: boolean, action?: ProcessingAction) => void;
  setSummary: (summary: SummaryResponse) => void;
  setSettingsOpen: (open: boolean) => void;
  setShowHistory: (show: boolean) => void;
  setFeedbackOpen: (open: boolean) => void;
  setError: (error: string | null) => void;
  setPanicDetails: (
    details: { message: string; location?: string; backtrace?: string; timestamp: string } | null,
  ) => void;
  setPromptHistory: (history: string[]) => void;
  setSummaryAvailable: (available: boolean) => void;
  setRecommendedPrompt: (prompt: RecommendedPrompt | null) => void;

  // History
  setHistory: (history: HistoryItem[]) => void;
  setHistoryLoading: (loading: boolean) => void;
  addAnalyzingHistoryHash: (hash: string) => void;
  removeAnalyzingHistoryHash: (hash: string) => void;

  // Confirmation preferences
  setConfirmPref: (key: ConfirmPrefKey, value: boolean) => void;
  initConfirmPrefs: (prefs: Partial<Record<ConfirmPrefKey, boolean>>) => void;

  // Client-side state (NOT from server)
  setSummaryLoading: (loading: boolean) => void;
  setGenerating: (generating: boolean) => void;
  clearPreview: () => void;
  setFeedbackTypeOverride: (type: FeedbackType | null) => void;
  openFeedback: (type?: FeedbackType, initialText?: string) => void;

  // Console
  appendLog: (text: string) => void;
  clearLogs: () => void;

  // Evolve events
  appendEvolveEvent: (event: EvolveEvent) => void;
  clearEvolveEvents: () => void;

  // Rebuild state
  startRebuild: (context: RebuildContext) => void;
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
  context: "apply",
  lines: [],
  rawLines: [],
  exitCode: undefined,
  success: undefined,
  errorType: undefined,
  errorMessage: undefined,
};

export const initialSummaryState: SummaryResponse = {
  items: [],
  instructions: "",
  commitMessage: "",
  diff: "",
};

export const initialWidgetState: WidgetState = {
  // Permissions
  permissionsState: null,
  permissionsChecked: false,

  // Config
  configDir: "",
  hosts: [],
  host: "",

  // Nix
  nixInstalled: null,
  nixInstalling: false,

  // nix-darwin
  darwinRebuildAvailable: null,
  darwinRebuildPrefetching: false,

  // Git
  gitStatus: null,

  // Evolution
  evolvePrompt: "",
  isProcessing: false,
  processingAction: null,
  evolveEvents: [],
  promptHistory: [],

  // History
  history: [],
  historyLoading: false,
  analyzingHistoryForHashes: new Set<string>(),

  // Summary
  summary: initialSummaryState,
  summaryAvailable: false,

  // Rebuild
  rebuild: initialRebuildState,

  // Console
  consoleLogs: "",

  // UI
  summaryLoading: false,
  isBootstrapping: false,
  isGenerating: false,
  settingsOpen: false,
  showHistory: false,
  feedbackOpen: false,
  feedbackTypeOverride: null,
  feedbackInitialText: null,
  panicDetails: null,
  error: null,
  recommendedPrompt: null,

  // Confirmation preferences
  confirmBuild: true,
  confirmClear: true,
  confirmRollback: true,
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
    setProcessing: (isProcessing, action = null) =>
      set({
        isProcessing,
        processingAction: isProcessing ? action : null,
      }),
    setSummary: (summary) => set({ summary, summaryAvailable: true }),
    setSummaryLoading: (summaryLoading) => set({ summaryLoading }),
    setSummaryAvailable: (summaryAvailable) => set({ summaryAvailable }),
    setConfirmPref: (key, value) => set({ [key]: value }),
    initConfirmPrefs: (prefs) =>
      set({
        confirmBuild: prefs.confirmBuild ?? true,
        confirmClear: prefs.confirmClear ?? true,
        confirmRollback: prefs.confirmRollback ?? true,
      }),
    setHistory: (history) => set({ history }),
    setHistoryLoading: (historyLoading) => set({ historyLoading }),
    addAnalyzingHistoryHash: (hash) =>
      set((state) => ({ analyzingHistoryForHashes: new Set([...state.analyzingHistoryForHashes, hash]) })),
    removeAnalyzingHistoryHash: (hash) =>
      set((state) => {
        const next = new Set(state.analyzingHistoryForHashes);
        next.delete(hash);
        return { analyzingHistoryForHashes: next };
      }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    setShowHistory: (showHistory) => set({ showHistory }),
    setFeedbackOpen: (feedbackOpen) => set({ feedbackOpen }),
    setFeedbackTypeOverride: (feedbackTypeOverride) => set({ feedbackTypeOverride }),
    openFeedback: (type, initialText) =>
      set({
        feedbackOpen: true,
        feedbackTypeOverride: type ?? null,
        feedbackInitialText: initialText ?? null,
      }),
    setError: (error) => set({ error }),
    setPanicDetails: (panicDetails) => set({ panicDetails }),
    setPromptHistory: (promptHistory) => set({ promptHistory }),
    setRecommendedPrompt: (recommendedPrompt) => set({ recommendedPrompt }),

    // Client-side UI state (NOT from server)
    setBootstrapping: (isBootstrapping) => set({ isBootstrapping }),
    setNixInstalled: (nixInstalled) => set({ nixInstalled }),
    setNixInstalling: (nixInstalling) => set({ nixInstalling }),
    setDarwinRebuildAvailable: (darwinRebuildAvailable) => set({ darwinRebuildAvailable }),
    setDarwinRebuildPrefetching: (darwinRebuildPrefetching) => set({ darwinRebuildPrefetching }),
    setGenerating: (isGenerating) => set({ isGenerating }),
    clearPreview: () =>
      set({
        summary: initialSummaryState,
        summaryLoading: false,
        summaryAvailable: false,
      }),

    // Console
    appendLog: (text) => set((state) => ({ consoleLogs: state.consoleLogs + text })),
    clearLogs: () => set({ consoleLogs: "" }),

    // Evolve events
    appendEvolveEvent: (event) =>
      set((state) => ({ evolveEvents: [...state.evolveEvents, event] })),
    clearEvolveEvents: () => set({ evolveEvents: [] }),

    // Rebuild state
    startRebuild: (context) =>
      set({
        rebuild: {
          isRunning: true,
          context,
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
