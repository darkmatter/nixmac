import { viewModelStore } from "./store";
import type { ViewModelState } from "./types";

/** Subscribe to slices of the Rust-backed ViewModel. */
export const useViewModel = viewModelStore;

export type ViewModelSelector<T> = (state: ViewModelState) => T;

export const selectEvolve = (state: ViewModelState) => state.evolve;
export const selectGit = (state: ViewModelState) => state.git;
export const selectChangeMap = (state: ViewModelState) => state.changeMap;
export const selectPreferences = (state: ViewModelState) => state.preferences;
export const selectHosts = (state: ViewModelState) => state.hosts;
export const selectPermissions = (state: ViewModelState) => state.permissions;
export const selectPermissionsHydrated = (state: ViewModelState) => state.permissionsHydrated;
export const selectNixInstall = (state: ViewModelState) => state.nixInstall;
export const selectRebuildStatus = (state: ViewModelState) => state.rebuildStatus;
export const selectRebuildLog = (state: ViewModelState) => state.rebuildLog;
export const selectEvolveEvents = (state: ViewModelState) => state.evolveEvents;
export const selectPromptHistory = (state: ViewModelState) => state.promptHistory;
export const selectHistory = (state: ViewModelState) => state.history;
export const selectExternalBuildDetected = (state: ViewModelState) =>
  state.build.externalBuildDetected;
