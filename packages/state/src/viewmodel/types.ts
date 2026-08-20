import type {
  EvolveEvent,
  EvolveState,
  GitStatus,
  GlobalPreferences,
  HomebrewInstallState,
  NixInstallState,
  OnboardingState,
  PermissionsState,
  RebuildStatus,
  SecretsVaultState,
  SemanticChangeMap,
} from "@nixmac/native/ipc/types";
import type { RebuildLine, RebuildNotice } from "@nixmac/native/types/rebuild";

type BuildView = {
  externalBuildDetected: boolean;
  upstreamUpdateAvailable: boolean;
  rebuildNeeded: boolean;
};

export type RebuildLog = {
  /** AI-summarized progress lines (last 50), folded from `darwin:apply:summary`. */
  lines: RebuildLine[];
  /** Raw darwin-rebuild output lines (last 500), folded from `darwin:apply:data`. */
  rawLines: string[];
  /** User-facing guidance produced by generic build-log trigger rules. */
  notices: RebuildNotice[];
};

/** Read-only projection of Rust-backed state. */
export type ViewModelState = {
  evolve: EvolveState | null;
  git: GitStatus | null;
  build: BuildView;
  changeMap: SemanticChangeMap | null;
  /** Mirrored `GlobalPreferences`; null until the slice hydrates. */
  preferences: GlobalPreferences | null;
  /** Mirrored onboarding lifecycle (completion latch); null until hydrated. */
  onboardingState: OnboardingState | null;
  /** Hosts listed from the flake; refreshed when preferences change. */
  hosts: string[];
  permissions: PermissionsState | null;
  /** True once the permissions slice has hydrated (even to null). */
  permissionsHydrated: boolean;
  /** True once the initial viewmodel hydration pass completes. */
  hydrated: boolean;
  promptHistory: string[];
  /** Mirrored nix / darwin-rebuild installation status; null until hydrated. */
  nixInstall: NixInstallState | null;
  /**
   * Mirrored Homebrew installation status and guided-install progress; null
   * until hydrated. Homebrew presence is prerequisite health, so it lives here
   * rather than in the onboarding session store.
   */
  homebrewInstall: HomebrewInstallState | null;
  /** Homebrew installer output fold; reset whenever a new install run starts. */
  homebrewLog: string[];
  /** Mirrored darwin-rebuild lifecycle status; null until hydrated. */
  rebuildStatus: RebuildStatus | null;
  /** Mirrored backend-owned secrets vault lifecycle; null until hydrated. */
  secretsVaultState: SecretsVaultState | null;
  /** Rebuild output fold; reset whenever a new rebuild run starts. */
  rebuildLog: RebuildLog;
  /** Evolve agent event stream; reset on each run's `start` event. */
  evolveEvents: EvolveEvent[];
};

/** @deprecated Use `ViewModelState`. */
export type ViewModel = ViewModelState;
