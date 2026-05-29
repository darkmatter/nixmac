import type {
  EvolutionTelemetry,
  EvolveEvent,
  EvolveState,
  RecommendedPrompt,
} from "@/ipc/types";
import type { WidgetStore } from "@/stores/widget-store.impl";
import type { StateCreator } from "zustand";

export const createEvolveSlice: StateCreator<
  WidgetStore,
  [],
  [],
  EvolveSlice
> = (set) => ({
  ...initialEvolveState,

  setEvolveState: (evolveState) => set({ evolveState }),
  appendEvolveEvent: (event) =>
    set((state) => ({ evolveEvents: [...state.evolveEvents, event] })),
  clearEvolveEvents: () => set({ evolveEvents: [] }),
  setConversationalResponse: (conversationalResponse) =>
    set({ conversationalResponse }),
  setRecommendedPrompt: (recommendedPrompt) => set({ recommendedPrompt }),
  setEvolutionTelemetry: (evolutionTelemetry) => set({ evolutionTelemetry }),
});

export type EvolveSliceState = {
  evolveState: EvolveState | null;
  evolveEvents: EvolveEvent[];
  conversationalResponse: string | null;
  // `undefined` means "stale/unfetched", while `null` means "fetched and none found".
  recommendedPrompt: RecommendedPrompt | null | undefined;
  evolutionTelemetry: EvolutionTelemetry | null;
};

export type EvolveActions = {
  setEvolveState: (state: EvolveState | null) => void;
  appendEvolveEvent: (event: EvolveEvent) => void;
  clearEvolveEvents: () => void;
  setConversationalResponse: (response: string | null) => void;
  setRecommendedPrompt: (prompt: RecommendedPrompt | null | undefined) => void;
  setEvolutionTelemetry: (telemetry: EvolutionTelemetry | null) => void;
};

export type EvolveSlice = EvolveSliceState & EvolveActions;

const initialEvolveState: EvolveSliceState = {
  evolveState: null,
  evolveEvents: [],
  conversationalResponse: null,
  recommendedPrompt: undefined,
  evolutionTelemetry: null,
};
