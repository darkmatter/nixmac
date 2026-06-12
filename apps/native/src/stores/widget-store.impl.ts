import { computeCurrentStep } from "@/components/widget/utils";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import type { WidgetStep } from "@/types/widget";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

// =============================================================================
// Types
// =============================================================================

// All state previously held here has migrated:
// - backend-mirrored fields (nix install, rebuild status/log, evolve events)
//   live in `stores/view-model.ts`, synced by `src/viewmodel/*`;
// - UI-owned fields (conversational response, evolution telemetry, rebuild
//   context) live in `stores/ui-state.ts`.
// The empty store shell remains only so the module surface keeps compiling;
// deleting the file is a later stage.
// biome-ignore lint/complexity/noBannedTypes: transitional empty state shape.
export type WidgetState = {};

type WidgetStore = WidgetState;

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
      () => ({
        ...initialState,
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

// =============================================================================
// Derived routing hook
// =============================================================================

/**
 * Hook to get the current widget step.
 *
 * Pure selectors over the two stores: backend-mirrored state (config,
 * permissions, evolve, nix install) comes from the ViewModel, transient UI
 * flags from UiState. Lives here (rather than `widget-store.ts`) so the
 * Storybook manual mock can re-export the real implementation.
 */
export function useCurrentStep(): WidgetStep {
  const evolveState = useViewModel((state) => state.evolve);
  const configDir = useViewModel((state) => state.preferences?.configDir ?? "");
  const host = useViewModel((state) => state.preferences?.hostAttr ?? "");
  const hosts = useViewModel((state) => state.hosts);
  const permissionsState = useViewModel((state) => state.permissions);
  const permissionsChecked = useViewModel((state) => state.permissionsHydrated);
  const nixInstalled = useViewModel((state) => state.nixInstall?.installed ?? null);
  const darwinRebuildAvailable = useViewModel(
    (state) => state.nixInstall?.darwinRebuildAvailable ?? null,
  );
  const showHistory = useUiState((state) => state.showHistory);
  const showFilesystem = useUiState((state) => state.showFilesystem);
  const isBootstrapping = useUiState((state) => state.isBootstrapping);
  return computeCurrentStep({
    nixInstalled,
    darwinRebuildAvailable,
    configDir,
    host,
    hosts,
    permissionsState,
    permissionsChecked,
    evolveState,
    showHistory,
    showFilesystem,
    isBootstrapping,
  });
}
