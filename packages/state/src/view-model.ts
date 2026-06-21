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

import type {
  EvolveEvent,
  EvolveState,
  GitStatus,
  GlobalPreferences,
  HistoryItem,
  NixInstallState,
  PermissionsState,
  RebuildStatus,
  SemanticChangeMap,
} from "@nixmac/native/ipc/types";
import type { RebuildLine } from "@nixmac/native/types/rebuild";
import { create } from "zustand";

type BuildView = {
  externalBuildDetected: boolean;
};

export type RebuildLog = {
  /** AI-summarized progress lines (last 50), folded from `darwin:apply:summary`. */
  lines: RebuildLine[];
  /** Raw darwin-rebuild output lines (last 500), folded from `darwin:apply:data`. */
  rawLines: string[];
};

export type ViewModel = {
  evolve: EvolveState | null;
  git: GitStatus | null;
  build: BuildView;
  changeMap: SemanticChangeMap | null;
  history: HistoryItem[];
  /** Mirrored `GlobalPreferences`; null until the slice hydrates. */
  preferences: GlobalPreferences | null;
  /** Hosts listed from the flake; refreshed when preferences change. */
  hosts: string[];
  permissions: PermissionsState | null;
  /** True once the permissions slice has hydrated (even to null). */
  permissionsHydrated: boolean;
  promptHistory: string[];
  /** Mirrored nix / darwin-rebuild installation status; null until hydrated. */
  nixInstall: NixInstallState | null;
  /** Mirrored darwin-rebuild lifecycle status; null until hydrated. */
  rebuildStatus: RebuildStatus | null;
  /** Rebuild output fold; reset whenever a new rebuild run starts. */
  rebuildLog: RebuildLog;
  /** Evolve agent event stream; reset on each run's `start` event. */
  evolveEvents: EvolveEvent[];
};

export const useViewModel = create<ViewModel>()(() => ({
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
}));
