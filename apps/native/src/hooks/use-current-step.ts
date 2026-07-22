import { computeCurrentStep } from "@/components/widget/utils";
import type { WidgetStep } from "@/types/widget";
import { useUiState, useViewModel } from "@nixmac/state";

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
  const activeStepOverride = useUiState((state) => state.activeStepOverride);
  const hasChanges = useViewModel((state) => (state.git?.changes.length ?? 0) > 0);
  const rebuildNeeded = useViewModel((state) => state.build.rebuildNeeded);
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
    activeStepOverride,
    hasChanges,
    rebuildNeeded,
  });
}
