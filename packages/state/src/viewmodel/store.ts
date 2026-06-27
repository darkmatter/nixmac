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

export const viewModelStore = create<ViewModelState>()(() => initialViewModelState);
