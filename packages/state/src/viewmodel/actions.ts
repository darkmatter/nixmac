import { initialViewModelState, viewModelStore } from "./store";
import type { ViewModelState } from "./types";

/** Imperative writers for the ViewModel store — use from sync modules, not UI. */
export const viewModelActions = {
  getState: viewModelStore.getState,
  setState: viewModelStore.setState,
  subscribe: viewModelStore.subscribe,
  reset: () => viewModelStore.setState(initialViewModelState),
  patch: (partial: Partial<ViewModelState>) => viewModelStore.setState(partial),
};
