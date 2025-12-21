import { create } from "zustand";
import type { EvolveEvent } from "@/tauri-api";

export type { EvolveEvent, EvolveEventType } from "@/tauri-api";

// =============================================================================
// Types
// =============================================================================

/**
 * App state - computed entirely on the client based on local state.
 * The server does NOT track UI state - it just exposes data endpoints.
 */
export type AppState = "onboarding" | "idle" | "generating" | "preview";

export type PeekState = "hidden" | "peeking" | "expanded";
export type WidgetStep = "setup" | "overview" | "evolving" | "commit";
export type ProcessingAction = "evolve" | "apply" | "commit" | "cancel" | null;

export interface GitFileStatus {
  path: string;
  index?: string;
  working_tree?: string;
}

export interface GitStatus {
  hasChanges?: boolean;
  files?: GitFileStatus[];
}

/**
 * Analyze git status to determine what state changes are in.
 * - hasUnstagedChanges: Files with working_tree changes (not yet previewed)
 * - hasStagedChanges: Files with index changes (previewed/applied)
 * - allChangesStaged: All changes are staged (ready to commit)
 */
export function analyzeGitStatus(gitStatus: GitStatus | null): {
  hasUnstagedChanges: boolean;
  hasStagedChanges: boolean;
  allChangesStaged: boolean;
  unstagedFiles: GitFileStatus[];
  stagedFiles: GitFileStatus[];
} {
  const files = gitStatus?.files || [];
  const unstagedFiles = files.filter(
    (f) => f.working_tree && f.working_tree !== " "
  );
  const stagedFiles = files.filter(
    (f) => f.index && f.index !== " " && f.index !== "?"
  );

  return {
    hasUnstagedChanges: unstagedFiles.length > 0,
    hasStagedChanges: stagedFiles.length > 0,
    allChangesStaged: files.length > 0 && unstagedFiles.length === 0,
    unstagedFiles,
    stagedFiles,
  };
}

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
  isLoading: boolean;
}

export interface WidgetState {
  // Config (from backend)
  configDir: string;
  hosts: string[];
  host: string;

  // Git (from backend)
  gitStatus: GitStatus | null;

  // Client-side UI state (NOT from backend)
  isGenerating: boolean;
  showCommitScreen: boolean;

  // Evolution
  evolvePrompt: string;
  commitMsg: string;
  isProcessing: boolean;
  processingAction: ProcessingAction;
  evolveEvents: EvolveEvent[];

  // Summary (AI-generated)
  summary: SummaryState;

  // Console
  consoleLogs: string;
  consoleExpanded: boolean;

  // UI
  isExpanded: boolean;
  peekState: PeekState;
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
  setExpanded: (expanded: boolean) => void;
  setPeekState: (state: PeekState) => void;
  setSettingsOpen: (open: boolean) => void;
  setError: (error: string | null) => void;
  setConsoleExpanded: (expanded: boolean) => void;

  // Client-side state (NOT from server)
  setGenerating: (generating: boolean) => void;
  setShowCommitScreen: (show: boolean) => void;
  clearPreview: () => void;

  // Console
  appendLog: (text: string) => void;
  clearLogs: () => void;

  // Evolve events
  appendEvolveEvent: (event: EvolveEvent) => void;
  clearEvolveEvents: () => void;

  // Computed
  getAppState: () => AppState;
  getStep: () => WidgetStep;

  // Reset
  reset: () => void;
}

export type WidgetStore = WidgetState & WidgetActions;

// =============================================================================
// Initial State
// =============================================================================

export const initialWidgetState: WidgetState = {
  // Config
  configDir: "",
  hosts: [],
  host: "",

  // Git
  gitStatus: null,

  // Client-side UI state
  isGenerating: false,
  showCommitScreen: false,

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

  // Console
  consoleLogs: "",
  consoleExpanded: false,

  // UI
  isExpanded: false,
  peekState: "hidden",
  settingsOpen: false,
  error: null,
};

// =============================================================================
// Helper: Compute app state from store state
// =============================================================================

/**
 * Computes the app state based on current conditions.
 * This is the client-side state machine - the server does NOT track this.
 *
 * Rules (in priority order):
 * 1. If missing configDir or host → Onboarding
 * 2. If generating → Generating
 * 3. If has uncommitted changes → Preview (shows evolving step)
 * 4. Otherwise → Idle
 */
export function computeAppState(state: WidgetState): AppState {
  const hasConfigDir = !!state.configDir;
  const hasHostAttr = !!state.host;
  const hasUncommittedChanges = state.gitStatus?.hasChanges ?? false;

  // Rule 1: Missing configuration
  if (!(hasConfigDir && hasHostAttr)) {
    return "onboarding";
  }

  // Rule 2: Currently generating
  if (state.isGenerating) {
    return "generating";
  }

  // Rule 3: Has uncommitted changes - show evolving step
  // (either pending preview or ready to commit)
  if (hasUncommittedChanges) {
    return "preview";
  }

  // Rule 4: Default idle state
  return "idle";
}

export function appStateToStep(
  state: AppState,
  showCommitScreen: boolean
): WidgetStep {
  if (showCommitScreen) {
    return "commit";
  }
  switch (state) {
    case "onboarding":
      return "setup";
    case "generating":
    case "preview":
      return "evolving";
    default:
      return "overview";
  }
}

// =============================================================================
// Store Factory
// =============================================================================

/**
 * Create a widget store with optional initial state.
 * This factory pattern allows creating isolated stores for testing/Storybook.
 */
export function createWidgetStore(initialState?: Partial<WidgetState>) {
  return create<WidgetStore>((set, get) => ({
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
    setExpanded: (isExpanded) => set({ isExpanded }),
    setPeekState: (peekState) => set({ peekState }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    setError: (error) => set({ error }),
    setConsoleExpanded: (consoleExpanded) => set({ consoleExpanded }),

    // Client-side UI state (NOT from server)
    setGenerating: (isGenerating) => set({ isGenerating }),
    setShowCommitScreen: (showCommitScreen) => set({ showCommitScreen }),
    clearPreview: () =>
      set({
        showCommitScreen: false,
        summary: {
          items: [],
          instructions: null,
          commitMessage: null,
          filesChanged: 0,
          isLoading: false,
        },
      }),

    // Console
    appendLog: (text) =>
      set((state) => ({ consoleLogs: state.consoleLogs + text })),
    clearLogs: () => set({ consoleLogs: "" }),

    // Evolve events
    appendEvolveEvent: (event) =>
      set((state) => ({ evolveEvents: [...state.evolveEvents, event] })),
    clearEvolveEvents: () => set({ evolveEvents: [] }),

    // Computed - app state is computed entirely client-side
    getAppState: () => computeAppState(get()),
    getStep: () =>
      appStateToStep(computeAppState(get()), get().showCommitScreen),

    // Reset
    reset: () => set(initialWidgetState),
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
