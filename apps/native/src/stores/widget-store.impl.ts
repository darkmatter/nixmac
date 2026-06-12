import { initialRebuildState, type RebuildContext, type RebuildErrorType, type RebuildLine, type RebuildState } from "@/types/rebuild";
import type {
  EvolutionTelemetry,
  EvolveEvent,
} from "@/ipc/types";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

// =============================================================================
// Types
// =============================================================================

export interface WidgetState {
  // Nix installation
  nixInstalled: boolean | null; // null = not checked yet

  // nix-darwin (darwin-rebuild availability)
  darwinRebuildAvailable: boolean | null; // null = not checked yet

  // Evolution
  evolveEvents: EvolveEvent[];
  conversationalResponse: string | null;
  evolutionTelemetry: EvolutionTelemetry | null;

  // Rebuild state (for inline rebuild progress)
  rebuild: RebuildState;
}

interface WidgetActions {
  setNixInstalled: (installed: boolean | null) => void;
  setDarwinRebuildAvailable: (available: boolean | null) => void;
  setDarwinRebuildPrefetching: (prefetching: boolean) => void;

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
  // Nix
  nixInstalled: null,

  // nix-darwin
  darwinRebuildAvailable: null,

  // Evolution
  evolveEvents: [],
  conversationalResponse: null,
  evolutionTelemetry: null,

  // Rebuild
  rebuild: initialRebuildState,
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
