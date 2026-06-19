import { computeCurrentStep } from "@/components/widget/utils";
import { useUiState } from "@/stores/ui-state";
import { useViewModel } from "@/stores/view-model";
import type { WidgetStep } from "@/types/widget";

/**
 * Hook to get the current widget step.
 *
 * Pure selectors over the two stores: backend-mirrored state (config,
 * permissions, evolve, nix install) comes from the ViewModel, transient UI
 * flags from UiState.
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
