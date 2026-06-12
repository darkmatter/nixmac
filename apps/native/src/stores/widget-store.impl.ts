import { computeCurrentStep } from "@/components/widget/utils";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import type { BoolPrefKey, ConfirmPrefKey } from "@/types/preferences";
import { initialRebuildState, type RebuildContext, type RebuildErrorType, type RebuildLine, type RebuildState } from "@/types/rebuild";
import type { WidgetStep } from "@/types/widget";
import type {
  EvolutionTelemetry,
  EvolveEvent,
  FileDiffContents,
  PermissionsState,
  RecommendedPrompt,
  UpdateChannel,
} from "@/ipc/types";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

// =============================================================================
// Types
// =============================================================================

export interface WidgetState {
  // Permissions (checked on startup)
  permissionsState: PermissionsState | null;
  permissionsChecked: boolean;

  // Config (from backend)
  configDir: string;
  hosts: string[];
  host: string;

  // Nix installation
  nixInstalled: boolean | null; // null = not checked yet

  // nix-darwin (darwin-rebuild availability)
  darwinRebuildAvailable: boolean | null; // null = not checked yet

  fileDiffContents: Record<string, FileDiffContents>;

  // Evolution
  evolveEvents: EvolveEvent[];
  promptHistory: string[];
  conversationalResponse: string | null;
  evolutionTelemetry: EvolutionTelemetry | null;

  // Rebuild state (for inline rebuild progress)
  rebuild: RebuildState;

  // UI
  prefsLoaded: boolean;
  // `undefined` means "stale/unfetched", while `null` means "fetched and none found".
  recommendedPrompt: RecommendedPrompt | null | undefined;

  // Confirmation preferences
  confirmBuild: boolean;
  confirmClear: boolean;
  confirmRollback: boolean;

  // Summarization preferences
  autoSummarizeOnFocus: boolean;

  // Startup scanning preferences
  scanHomebrewOnStartup: boolean;

  // Default-tab preference
  defaultToDiffTab: boolean;

  // Experimental: spin the mascot in a corner indicator during evolve/build
  experimentalSpinningMascot: boolean;

  // Developer mode (hidden settings panel for bisecting / pinning to a past release)
  developerMode: boolean;
  pinnedVersion: string | null;
  updateChannel: UpdateChannel;
}

interface WidgetActions {
  // Permissions
  setPermissionsState: (state: PermissionsState | null) => void;
  setPermissionsChecked: (checked: boolean) => void;

  // Setters
  setConfigDir: (dir: string) => void;
  setHosts: (hosts: string[]) => void;
  setHost: (host: string) => void;
  setNixInstalled: (installed: boolean | null) => void;
  setDarwinRebuildAvailable: (available: boolean | null) => void;
  setFileDiffContents: (contents: Record<string, FileDiffContents>) => void;
  setPrefsLoaded: (loaded: boolean) => void;
  setPromptHistory: (history: string[]) => void;
  setRecommendedPrompt: (prompt: RecommendedPrompt | null | undefined) => void;

  // Boolean preferences
  setBoolPref: (key: BoolPrefKey, value: boolean) => void;
  initConfirmPrefs: (prefs: Partial<Record<ConfirmPrefKey, boolean>>) => void;

  // Summarization preferences
  setAutoSummarizeOnFocus: (value: boolean) => void;

  // Developer mode
  setDeveloperMode: (value: boolean) => void;
  setPinnedVersion: (value: string | null) => void;
  setUpdateChannel: (value: UpdateChannel) => void;

  // Evolve events
  appendEvolveEvent: (event: EvolveEvent) => void;
  clearEvolveEvents: () => void;
  setEvolutionTelemetry: (telemetry: EvolutionTelemetry | null) => void;

  setConversationalResponse: (response: string | null) => void;

  // Rebuild state
  startRebuild: (context: RebuildContext) => void;
  appendRebuildLine: (line: RebuildLine) => void;
  appendRawLine: (line: string) => void;
  setRebuildError: (errorType: RebuildErrorType, errorMessage: string, systemUntouched?: boolean) => void;
  setRebuildComplete: (success: boolean, exitCode?: number) => void;
  clearRebuild: () => void;
}

type WidgetStore = WidgetState & WidgetActions;

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

  // nix-darwin
  darwinRebuildAvailable: null,

  fileDiffContents: {},

  // Evolution
  evolveEvents: [],
  promptHistory: [],
  conversationalResponse: null,
  evolutionTelemetry: null,

  // Rebuild
  rebuild: initialRebuildState,

  // UI
  prefsLoaded: false,
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

  // Experimental features
  experimentalSpinningMascot: false,

  // Developer mode
  developerMode: false,
  pinnedVersion: null,
  updateChannel: "stable",
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
    setFileDiffContents: (fileDiffContents) => set({ fileDiffContents }),
    setBoolPref: (key: BoolPrefKey, value: boolean) => set({ [key]: value }),
    initConfirmPrefs: (prefs) =>
      set({
        confirmBuild: prefs.confirmBuild ?? true,
        confirmClear: prefs.confirmClear ?? true,
        confirmRollback: prefs.confirmRollback ?? true,
      }),
    setAutoSummarizeOnFocus: (value) => set({ autoSummarizeOnFocus: value }),
    setDeveloperMode: (value) => set({ developerMode: value }),
    setPinnedVersion: (value) => set({ pinnedVersion: value }),
    setUpdateChannel: (value) => set({ updateChannel: value }),
    setPrefsLoaded: (prefsLoaded) => set({ prefsLoaded }),
    setPromptHistory: (promptHistory) => set({ promptHistory }),
    setRecommendedPrompt: (recommendedPrompt) => set({ recommendedPrompt }),

    // Client-side UI state (NOT from server)
    setNixInstalled: (nixInstalled) => set({ nixInstalled }),
    setDarwinRebuildAvailable: (darwinRebuildAvailable) => set({ darwinRebuildAvailable }),
    setDarwinRebuildPrefetching: (darwinRebuildPrefetching) => set({ darwinRebuildPrefetching }),

    // Evolve events
    appendEvolveEvent: (event) =>
      set((state) => ({ evolveEvents: [...state.evolveEvents, event] })),
    clearEvolveEvents: () => set({ evolveEvents: [] }),
    setEvolutionTelemetry: (evolutionTelemetry) => set({ evolutionTelemetry }),

    // Conversational response
    setConversationalResponse: (conversationalResponse) => set({ conversationalResponse }),

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
          systemUntouched: undefined,
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
    setRebuildError: (errorType, errorMessage, systemUntouched) =>
      set((state) => ({
        rebuild: {
          ...state.rebuild,
          errorType,
          errorMessage,
          systemUntouched,
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
  const evolveState = useViewModel((state) => state.evolve);
  const showHistory = useUiState((state) => state.showHistory);
  const showFilesystem = useUiState((state) => state.showFilesystem);
  const isBootstrapping = useUiState((state) => state.isBootstrapping);
  return useWidgetStore((state) =>
    computeCurrentStep({ ...state, evolveState, showHistory, showFilesystem, isBootstrapping }),
  );
}
