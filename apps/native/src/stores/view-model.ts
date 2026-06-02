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
//
// `evolveActions` are thin IPC wrappers stored here so that the EvolutionView
// slice can call them without importing the API layer directly.
//

import { tauriAPI } from "@/ipc/api";
import type {
  EvolutionTelemetry,
  EvolveEvent,
  EvolveState,
  GitStatus,
  HistoryItem,
  PermissionsState,
  SemanticChangeMap,
} from "@/ipc/types";
import { create } from "zustand";

type BuildView = {
  externalBuildDetected: boolean;
};

type RebuildView = {
  isRunning: boolean;
};

type NixView = {
  installed: boolean | null;
  installing: boolean;
};

type DarwinRebuildView = {
  available: boolean | null;
  prefetching: boolean;
};

type EvolutionView = {
  events: EvolveEvent[];
  telemetry: EvolutionTelemetry | null;
  conversationalResponse: string | null;
};

type EvolveActions = {
  start: (description: string) => Promise<void>;
  cancel: () => Promise<void>;
  answer: (answer: string) => Promise<void>;
};

export type ViewModel = {
  evolve: EvolveState | null;
  git: GitStatus | null;
  build: BuildView;
  changeMap: SemanticChangeMap | null;
  history: HistoryItem[];
  rebuild: RebuildView;
  permissions: PermissionsState | null;
  nix: NixView;
  darwinRebuild: DarwinRebuildView;
  evolution: EvolutionView;
  evolveActions: EvolveActions;
};

export const useViewModel = create<ViewModel>()(() => ({
  evolve: null,
  git: null,
  build: {
    externalBuildDetected: false,
  },
  changeMap: null,
  history: [],
  rebuild: {
    isRunning: false,
  },
  permissions: null,
  nix: {
    installed: null,
    installing: false,
  },
  darwinRebuild: {
    available: null,
    prefetching: false,
  },
  evolution: {
    events: [],
    telemetry: null,
    conversationalResponse: null,
  },
  evolveActions: {
    start: (description) => tauriAPI.darwin.evolve(description).then(() => undefined),
    cancel: () => tauriAPI.darwin.evolveCancel().then(() => undefined),
    answer: (answer) => tauriAPI.darwin.evolveAnswer(answer).then(() => undefined),
  },
}));
