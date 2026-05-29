import type { WidgetStep } from "@/components/widget/utils";
import { computeCurrentStep } from "@/components/widget/utils";
import { createConfigSlice, type ConfigSlice } from "@/stores/slices/config";
import { createConsoleSlice, type ConsoleSlice } from "@/stores/slices/console";
import { createEvolveSlice, type EvolveSlice } from "@/stores/slices/evolve";
import { createGitSlice, type GitSlice } from "@/stores/slices/git";
import { createHistorySlice, type HistorySlice } from "@/stores/slices/history";
import { createRebuildSlice, type RebuildSlice } from "@/stores/slices/rebuild";
import { createSetupSlice, type SetupSlice } from "@/stores/slices/setup";
import { createSummarySlice, type SummarySlice } from "@/stores/slices/summary";
import { useUiStore } from "@/stores/ui-store";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

export type WidgetStore = SetupSlice &
  ConfigSlice &
  EvolveSlice &
  GitSlice &
  RebuildSlice &
  HistorySlice &
  SummarySlice &
  ConsoleSlice;

export function createWidgetStore(initialState?: Partial<WidgetStore>) {
  return create<WidgetStore>()(
    devtools(
      (set, get, api) => ({
        ...createSetupSlice(set, get, api),
        ...createConfigSlice(set, get, api),
        ...createEvolveSlice(set, get, api),
        ...createGitSlice(set, get, api),
        ...createRebuildSlice(set, get, api),
        ...createHistorySlice(set, get, api),
        ...createSummarySlice(set, get, api),
        ...createConsoleSlice(set, get, api),
        ...initialState,
      }),
      {
        name: "widget-store",
        enabled: import.meta.env.DEV,
      },
    ),
  );
}

/**
 * Default store instance for the main app.
 * Use createWidgetStore() for isolated testing instances.
 */
export const useWidgetStore = createWidgetStore();

/**
 * Hook to get the current widget step.
 * Reads from the ViewModel store + the peer UI store (showHistory/showFilesystem live there).
 */
export function useCurrentStep(): WidgetStep {
  const widgetState = useWidgetStore();
  const uiState = useUiStore();
  return computeCurrentStep({ ...widgetState, ...uiState });
}
