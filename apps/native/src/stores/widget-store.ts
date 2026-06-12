import { computeCurrentStep } from "@/components/widget/utils";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import { useWidgetStore } from "@/stores/widget-store.impl";
import type { WidgetStep } from "@/types/widget";

export * from "./widget-store.impl";

/**
 * Hook to get the current widget step.
 * Uses a selector so components only re-render when the step actually changes.
 *
 * Routing inputs are split across the stores: backend-mirrored state
 * (config, permissions, evolve) comes from the ViewModel, transient UI
 * flags from UiState, and the remaining Nix-install fields from the
 * widget store.
 */
export function useCurrentStep(): WidgetStep {
  const evolveState = useViewModel((state) => state.evolve);
  const configDir = useViewModel((state) => state.preferences?.configDir ?? "");
  const host = useViewModel((state) => state.preferences?.hostAttr ?? "");
  const hosts = useViewModel((state) => state.hosts);
  const permissionsState = useViewModel((state) => state.permissions);
  const permissionsChecked = useViewModel((state) => state.permissionsHydrated);
  const showHistory = useUiState((state) => state.showHistory);
  const showFilesystem = useUiState((state) => state.showFilesystem);
  const isBootstrapping = useUiState((state) => state.isBootstrapping);
  return useWidgetStore((state) =>
    computeCurrentStep({
      ...state,
      configDir,
      host,
      hosts,
      permissionsState,
      permissionsChecked,
      evolveState,
      showHistory,
      showFilesystem,
      isBootstrapping,
    }),
  );
}
