// Zustand ViewModel — read-optimized projection of Rust state.
//
// IMPORTANT: DO NOT CREATE SETTERS ON THIS STATE. Setters create a path for UI
// state to become inconsistent with the source of truth (Rust state).
//
// This store holds a denormalized, query-friendly snapshot of the data that
// the Rust backend pushes via Tauri events. Components read from it directly
// instead of making IPC calls on every render.
//
// The `viewmodel/` modules are the only writers for Rust-owned slices:
// they hydrate through commands, then mirror backend events into this store.
// Stream-backed fields (`rebuildLog`, `evolveEvents`) are folds over backend
// event streams, also owned by `viewmodel/` modules.

import { create } from "zustand";
import type { ViewModelState } from "./types";

export const initialViewModelState: ViewModelState = {
  evolve: null,
  git: null,
  build: {
    externalBuildDetected: false,
  },
  changeMap: null,
  history: [],
  preferences: null,
  hosts: [],
  permissions: null,
  permissionsHydrated: false,
  promptHistory: [],
  nixInstall: null,
  rebuildStatus: null,
  rebuildLog: { lines: [], rawLines: [] },
  evolveEvents: [],
};

/**
 * Imperative writers for the ViewModel store. Per the module header, no domain
 * setters exist here — only the generic `reset`/`patch` used by `viewmodel/`
 * modules to mirror Rust state.
 */
export type ViewModelActions = {
  reset: () => void;
  patch: (partial: Partial<ViewModelState>) => void;
};

/** Combined store shape: state values plus the actions that mutate them. */
export type ViewModelStore = ViewModelState & ViewModelActions;

export const viewModelStore = create<ViewModelStore>()((set) => ({
  ...initialViewModelState,
  reset: () => set(initialViewModelState),
  patch: (partial) => set(partial),
}));

/**
 * Back-compat handle that exposes the store's own actions plus the store's
 * `getState`/`setState`/`subscribe` utilities. Zustand action references are
 * stable for the store's lifetime, so they are picked off the initial state
 * once. Kept so existing call sites that import `viewModelActions` keep
 * working; new code should prefer `viewModelStore` directly.
 */
const { reset, patch } = viewModelStore.getInitialState();

export const viewModelActions: ViewModelActions & {
  getState: typeof viewModelStore.getState;
  setState: typeof viewModelStore.setState;
  subscribe: typeof viewModelStore.subscribe;
} = {
  getState: viewModelStore.getState,
  setState: viewModelStore.setState,
  subscribe: viewModelStore.subscribe,
  reset,
  patch,
};
