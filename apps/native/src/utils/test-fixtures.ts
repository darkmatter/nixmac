import type {
  GlobalPreferences,
  NixInstallState,
  PermissionsState,
  RebuildStatus,
} from "@/ipc/types";

/**
 * Full `GlobalPreferences` value for tests and stories. Matches the backend
 * defaults; override only the fields a scenario cares about.
 */
export function makeGlobalPreferences(
  overrides: Partial<GlobalPreferences> = {},
): GlobalPreferences {
  return {
    hostAttr: null,
    configDir: null,
    repoRoot: null,
    sendDiagnostics: false,
    evolveProvider: null,
    evolveModel: null,
    summaryProvider: null,
    summaryModel: null,
    ollamaApiBaseUrl: null,
    vllmApiBaseUrl: null,
    confirmBuild: true,
    confirmClear: true,
    confirmRollback: true,
    autoSummarizeOnFocus: false,
    scanHomebrewOnStartup: true,
    defaultToDiffTab: false,
    experimentalSpinningMascot: false,
    developerMode: false,
    pinnedVersion: null,
    updateChannel: "stable",
    ...overrides,
  };
}

/** All-granted permissions snapshot for tests and stories. */
export function makeGrantedPermissions(): PermissionsState {
  return {
    permissions: [],
    allRequiredGranted: true,
    checkedAt: Date.now(),
  };
}

/** Fully installed nix/darwin-rebuild snapshot for tests and stories. */
export function makeNixInstallState(
  overrides: Partial<NixInstallState> = {},
): NixInstallState {
  return {
    installed: true,
    darwinRebuildAvailable: true,
    installing: false,
    installPhase: null,
    prefetching: false,
    lastError: null,
    ...overrides,
  };
}

/** Idle rebuild status for tests and stories; override per scenario. */
export function makeRebuildStatus(overrides: Partial<RebuildStatus> = {}): RebuildStatus {
  return {
    isRunning: false,
    success: null,
    exitCode: null,
    errorType: null,
    errorMessage: null,
    systemUntouched: null,
    ...overrides,
  };
}
