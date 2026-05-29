import { computeCurrentStep } from "@/components/widget/utils";
import type {
  BoolPrefKey,
  ConfirmPrefKey,
  WidgetState,
  WidgetStep,
  WidgetStore,
} from "@/types/ui";
import { initialRebuildState } from "@/types/ui";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

// =============================================================================
// Initial State
// =============================================================================

const initialWidgetState: WidgetState = {
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
  nixInstallPhase: null,
  nixDownloadProgress: null,

  // nix-darwin
  darwinRebuildAvailable: null,

  // Routing state
  evolveState: null,
  externalBuildDetected: false,

  // Git
  gitStatus: null,
  fileDiffContents: {},

  // Evolution
  evolvePrompt: "",
  isProcessing: false,
  processingAction: null,
  evolveEvents: [],
  promptHistory: [],
  conversationalResponse: null,
  evolutionTelemetry: null,

  // History
  history: [],
  historyLoading: false,
  analyzingHistoryForHashes: new Set<string>(),

  changeMap: null,

  // Commit message suggestion
  commitMessageSuggestion: null,

  // Rebuild
  rebuild: initialRebuildState,

  // Console
  consoleLogs: "",

  // UI
  isBootstrapping: false,
  isSummarizing: false,
  isGenerating: false,
  settingsOpen: false,
  settingsActiveTab: null,
  prefsLoaded: false,
  showHistory: false,
  showFilesystem: false,
  filesystemTargetSection: null,
  feedbackOpen: false,
  feedbackTypeOverride: null,
  feedbackInitialText: null,
  panicDetails: null,
  error: null,
  recommendedPrompt: undefined,

  // Confirmation preferences
  confirmBuild: true,
  confirmClear: true,
  confirmRollback: true,

  // Summarization preferences
  autoSummarizeOnFocus: false,

  // Startup scanning preferences
  scanHomebrewOnStartup: true,

  // Default-tab preference
  defaultToDiffTab: false,

  // Developer mode
  developerMode: false,
  pinnedVersion: null,
  updateChannel: "stable",

  // Editor
  editingFile: null,
};

// =============================================================================
// Store Factory
// =============================================================================

/**
 * Create a widget store with optional initial state.
 * This factory pattern allows creating isolated stores for testing/Storybook.
 */
export function createWidgetStore(initialState?: Partial<WidgetState>) {
  return create<WidgetStore>()(
    devtools(
      (set, _get) => ({
    ...initialWidgetState,
    ...initialState,

    // Permissions
    setPermissionsState: (permissionsState) => set({ permissionsState }),
    setPermissionsChecked: (permissionsChecked) => set({ permissionsChecked }),

    // Setters
    setConfigDir: (configDir) => set({ configDir }),
    setHosts: (hosts) => set({ hosts }),
    setHost: (host) => set({ host }),
    setEvolveState: (evolveState) => set({ evolveState: evolveState }),
    setExternalBuildDetected: (externalBuildDetected) => set({ externalBuildDetected }),
    setGitStatus: (gitStatus) => set({ gitStatus }),
    setFileDiffContents: (fileDiffContents) => set({ fileDiffContents }),
    setEvolvePrompt: (evolvePrompt) => set({ evolvePrompt }),
    setProcessing: (isProcessing, action = null) =>
      set({
        isProcessing,
        processingAction: isProcessing ? action : null,
      }),
    setChangeMap: (changeMap) => set({ changeMap }),
    setBoolPref: (key: BoolPrefKey, value: boolean) => set({ [key]: value }),
    initConfirmPrefs: (prefs: Partial<Record<ConfirmPrefKey, boolean>>) =>
      set({
        confirmBuild: prefs.confirmBuild ?? true,
        confirmClear: prefs.confirmClear ?? true,
        confirmRollback: prefs.confirmRollback ?? true,
      }),
    setAutoSummarizeOnFocus: (value) => set({ autoSummarizeOnFocus: value }),
    setDeveloperMode: (value) => set({ developerMode: value }),
    setPinnedVersion: (value) => set({ pinnedVersion: value }),
    setUpdateChannel: (value) => set({ updateChannel: value }),
    setHistory: (history) => set({ history }),
    setHistoryLoading: (historyLoading) => set({ historyLoading }),
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
    setSettingsOpen: (settingsOpen, tab) =>
      set({ settingsOpen, settingsActiveTab: tab ?? null }),
    setPrefsLoaded: (prefsLoaded) => set({ prefsLoaded }),
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
    setError: (error) => set({ error }),
    setPanicDetails: (panicDetails) => set({ panicDetails }),
    setPromptHistory: (promptHistory) => set({ promptHistory }),
    setRecommendedPrompt: (recommendedPrompt) => set({ recommendedPrompt }),

    // Client-side UI state (NOT from server)
    setBootstrapping: (isBootstrapping) => set({ isBootstrapping }),
    setNixInstalled: (nixInstalled) => set({ nixInstalled }),
    setNixInstalling: (nixInstalling) => set({ nixInstalling }),
    setNixInstallPhase: (nixInstallPhase) => set({ nixInstallPhase }),
    setNixDownloadProgress: (nixDownloadProgress) => set({ nixDownloadProgress }),
    setDarwinRebuildAvailable: (darwinRebuildAvailable) => set({ darwinRebuildAvailable }),
    setSummarizing: (isSummarizing) => set({ isSummarizing }),
    setGenerating: (isGenerating) => set({ isGenerating }),

    // Console
    appendLog: (text) => set((state) => ({ consoleLogs: state.consoleLogs + text })),
    clearLogs: () => set({ consoleLogs: "" }),

    // Evolve events
    appendEvolveEvent: (event) =>
      set((state) => ({ evolveEvents: [...state.evolveEvents, event] })),
    clearEvolveEvents: () => set({ evolveEvents: [] }),
    setEvolutionTelemetry: (evolutionTelemetry) => set({ evolutionTelemetry }),

    // Conversational response
    setConversationalResponse: (conversationalResponse) => set({ conversationalResponse }),

    // Commit message suggestion
    setCommitMessageSuggestion: (commitMessageSuggestion) => set({ commitMessageSuggestion }),

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
      }),
      {
        name: "widget-store",
        enabled: import.meta.env.DEV,
      },
    ),
  );
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
