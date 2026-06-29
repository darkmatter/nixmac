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

type BuildView = {
  externalBuildDetected: boolean;
};

export type RebuildLog = {
  /** AI-summarized progress lines (last 50), folded from `darwin:apply:summary`. */
  lines: RebuildLine[];
  /** Raw darwin-rebuild output lines (last 500), folded from `darwin:apply:data`. */
  rawLines: string[];
};

/** Read-only projection of Rust-backed state. */
export type ViewModelState = {
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

/** @deprecated Use `ViewModelState`. */
export type ViewModel = ViewModelState;
