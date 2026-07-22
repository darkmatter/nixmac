import type { ViewModelStore } from "./store";
import { viewModelStore } from "./store";

/** Subscribe to slices of the Rust-backed ViewModel. */
export const useViewModel = viewModelStore;

export type ViewModelSelector<T> = (state: ViewModelStore) => T;

export const selectEvolve = (state: ViewModelStore) => state.evolve;
export const selectGit = (state: ViewModelStore) => state.git;
export const selectChangeMap = (state: ViewModelStore) => state.changeMap;
export const selectPreferences = (state: ViewModelStore) => state.preferences;
export const selectHosts = (state: ViewModelStore) => state.hosts;
export const selectPermissions = (state: ViewModelStore) => state.permissions;
export const selectPermissionsHydrated = (state: ViewModelStore) => state.permissionsHydrated;
export const selectNixInstall = (state: ViewModelStore) => state.nixInstall;
export const selectRebuildStatus = (state: ViewModelStore) => state.rebuildStatus;
export const selectRebuildLog = (state: ViewModelStore) => state.rebuildLog;
export const selectEvolveEvents = (state: ViewModelStore) => state.evolveEvents;
export const selectPromptHistory = (state: ViewModelStore) => state.promptHistory;
export const selectExternalBuildDetected = (state: ViewModelStore) =>
  state.build.externalBuildDetected;
