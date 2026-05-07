import { invoke } from "@tauri-apps/api/core";
import { type Event, listen, once } from "@tauri-apps/api/event";
import {
  checkFullDiskAccessPermission,
  requestFullDiskAccessPermission,
} from "tauri-plugin-macos-permissions-api";
import type {
  BuildCheckResult,
  CliToolsState,
  CommitResult,
  Config as DarwinConfig,
  ConfigEditApplyResult,
  EvolveCancelResult,
  EvolutionResult,
  EvolveState,
  FeedbackAiProviderModelInfo,
  FeedbackFlakeInputsSnapshot,
  FeedbackPanicDetails,
  FeedbackShareOptions,
  FeedbackSystemInfo,
  FinalizeApplyResult,
  GitStatus,
  HomebrewState,
  HistoryItem,
  NixCheckResult,
  OkResult,
  Permission,
  PermissionsState,
  PreviewIndicatorState,
  RecommendedPrompt,
  RollbackResult,
  SemanticChangeMap,
  SetDirResult,
  SystemDefault,
  SystemDefaultsScan,
  UiPrefs as DarwinPrefs,
  UiPrefsUpdate as DarwinPrefsUpdate,
} from "./types/shared";

export type {
  BuildCheckResult,
  ChangeType,
  CliToolsState,
  CommitResult,
  Config as DarwinConfig,
  ConfigChangedEvent,
  ConfigEditApplyResult,
  DarwinApplyDataEvent,
  DarwinApplyEndEvent,
  DarwinApplySummaryEvent,
  EvolveCancelResult,
  EvolveEvent,
  EvolveEventType,
  EvolutionFailureResult,
  EvolutionResult,
  EvolutionState,
  EvolutionTelemetry,
  EvolveState,
  EvolveStep,
  FeedbackAiProviderModelInfo,
  FeedbackFlakeInputEntry,
  FeedbackFlakeInputsSnapshot,
  FeedbackMetadataRequest,
  FeedbackPanicDetails,
  FeedbackShareOptions,
  FeedbackSystemInfo,
  FinalizeApplyResult,
  GitFileStatus,
  GitStatus,
  HomebrewState,
  HistoryItem,
  NixCheckResult,
  NixDarwinRebuildEndEvent,
  NixInstallEndEvent,
  NixInstallErrorType,
  NixInstallPhase,
  NixInstallProgressEvent,
  OkResult,
  Permission,
  PermissionStatus,
  PermissionsState,
  PreviewIndicatorState,
  RecommendedPrompt,
  RebuildErrorType,
  SemanticChangeMap,
  SetDirResult,
  SummarizerUpdateEvent,
  SummarizedChangeSet,
  RustPanicEvent,
  SystemDefault,
  SystemDefaultsScan,
  UiPrefs as DarwinPrefs,
  UiPrefsUpdate as DarwinPrefsUpdate,
  WatcherEvent,
} from "./types/shared";
export type { Change, Commit } from "./types/sqlite";

export const DEFAULT_MAX_ITERATIONS = 25;

// =============================================================================
// Feedback Types
// =============================================================================

export interface FeedbackUsageStats {
  totalEvolutions?: number;
  successRate?: number;
  avgIterations?: number;
  lastComputedAt?: string;
  extra?: Record<string, unknown>;
}

export interface FeedbackMetadata {
  currentAppStateSnapshot?: unknown;
  systemInfo?: FeedbackSystemInfo;
  usageStats?: FeedbackUsageStats;
  evolutionLogContent?: string;
  changedNixFilesDiff?: string;
  aiProviderModelInfo?: FeedbackAiProviderModelInfo;
  buildErrorOutput?: string;
  flakeInputsSnapshot?: FeedbackFlakeInputsSnapshot;
  appLogsContent?: string;
  panicDetails?: FeedbackPanicDetails;
}

export const EVOLVE_EVENT_CHANNEL = "darwin:evolve:event";
export const CONFIG_CHANGED_CHANNEL = "config:changed";

export const darwinAPI = {
  config: {
    get: () => invoke<DarwinConfig>("config_get"),
    setDir: (dir: string) => invoke<SetDirResult>("config_set_dir", { dir }),
    pickDir: () => invoke<SetDirResult | null>("config_pick_dir"),
    setHostAttr: (host: string) => invoke<OkResult>("config_set_host_attr", { host }),
  },
  git: {
    status: () => invoke<GitStatus>("git_status"),
    statusAndCache: () => invoke<GitStatus>("git_status_and_cache"),
    commit: (message: string) => invoke<CommitResult>("git_commit", { message }),
    stash: (message: string) => invoke<OkResult>("git_stash", { message }),
  },
  darwin: {
    evolve: (description: string) => invoke<EvolutionResult>("darwin_evolve", { description }),
    evolveAnswer: (answer: string) => invoke<OkResult>("darwin_evolve_answer", { answer }),
    buildCheck: () => invoke<BuildCheckResult>("darwin_build_check"),
    evolveFromManual: () => invoke<number>("darwin_adopt_manual_changes"),
    evolveCancel: () => invoke<EvolveCancelResult>("darwin_evolve_cancel"),
    applyStreamStart: (hostOverride?: string) =>
      invoke<OkResult>("darwin_apply_stream_start", { hostOverride }),
    activateStorePath: (storePath: string) =>
      invoke<OkResult>("darwin_activate_store_path", { storePath }),
    finalizeApply: () => invoke<FinalizeApplyResult>("finalize_apply"),
    finalizeRollback: (storePath: string | null, changesetId: number | null) =>
      invoke<FinalizeApplyResult>("finalize_rollback", { storePath, changesetId }),
    rollbackErase: () => invoke<RollbackResult>("rollback_erase"),
    prepareRestore: (targetHash: string) => invoke<void>("prepare_restore", { targetHash }),
    abortRestore: () => invoke<void>("abort_restore"),
    finalizeRestore: (targetHash: string) => invoke<GitStatus>("finalize_restore", { targetHash }),
  },
  nix: {
    check: () => invoke<NixCheckResult>("nix_check"),
    installStart: () => invoke<OkResult>("nix_install_start"),
    prefetchDarwinRebuild: () => invoke<OkResult>("darwin_rebuild_prefetch"),
  },
  flake: {
    listHosts: () => invoke<string[]>("flake_list_hosts"),
    exists: () => invoke<boolean>("flake_exists"),
    existsAt: (dir: string) => invoke<boolean>("flake_exists_at", { dir }),
    bootstrapDefault: (hostname: string) => invoke<void>("bootstrap_default_config", { hostname }),
  },
  path: {
    exists: (dir: string) => invoke<boolean>("path_exists", { dir }),
    normalize: (input: string) => invoke<string>("path_normalize", { input }),
  },
  summarizedChanges: {
    findChangeMap: () => invoke<SemanticChangeMap>("find_change_map"),
    summarizeCurrent: () => invoke<SemanticChangeMap>("summarize_current"),
    generateCommitMessage: () => invoke<string>("generate_commit_message"),
  },
  feedback: {
    gatherMetadata: (feedbackType: string, share: FeedbackShareOptions) =>
      invoke<FeedbackMetadata>("feedback_gather_metadata", { request: { feedbackType, share } }),
    submit: (payload: string) => invoke<boolean>("feedback_submit", { payload }),
  },
  ui: {
    getPrefs: () => invoke<DarwinPrefs>("ui_get_prefs"),
    setPrefs: (prefs: Partial<DarwinPrefsUpdate>) => invoke<OkResult>("ui_set_prefs", { prefs }),
  },
  models: {
    getCached: (provider: string) => invoke<string[] | null>("get_cached_models", { provider }),
    setCached: (provider: string, models: string[]) =>
      invoke<OkResult>("set_cached_models", { provider, models }),
    clearCached: (provider: string) => invoke<OkResult>("clear_cached_models", { provider }),
  },

  cli: {
    checkTools: () => invoke<CliToolsState>("check_cli_tools"),
    listModels: (tool: string) => invoke<string[]>("list_cli_models", { tool }),
  },

  promptHistory: {
    get: () => invoke<string[]>("get_prompt_history"),
    add: (prompt: string) => invoke<OkResult>("add_to_prompt_history", { prompt }),
  },

  previewIndicator: {
    show: () => invoke<OkResult>("preview_indicator_show"),
    hide: () => invoke<OkResult>("preview_indicator_hide"),
    update: (state: PreviewIndicatorState) => invoke<OkResult>("preview_indicator_update", { state }),
    getState: () => invoke<PreviewIndicatorState>("preview_indicator_get_state"),
  },

  scanner: {
    getRecommendedPrompt: () => invoke<RecommendedPrompt | null>("get_recommended_prompt"),
    scanDefaults: () => invoke<SystemDefaultsScan>("scan_system_defaults"),
    applyDefaults: (defaults: SystemDefault[]) =>
      invoke<ConfigEditApplyResult>("apply_system_defaults", { defaults }),
  },
  permissions: {
    checkAll: () => invoke<PermissionsState>("permissions_check_all"),
    request: (permissionId: string) => invoke<Permission>("permissions_request", { permissionId }),
    // macOS-specific permission checks via tauri-plugin-macos-permissions
    checkFullDiskAccess: () => checkFullDiskAccessPermission(),
    requestFullDiskAccess: () => requestFullDiskAccessPermission(),
  },

  evolveState: {
    get: () => invoke<EvolveState>("routing_state_get"),
    clear: () => invoke<EvolveState>("routing_state_clear"),
  },

  history: {
    get: () => invoke<HistoryItem[]>("get_history"),
    generateFrom: (commitHash: string, number: number) =>
      invoke<void>("generate_history_from", { commitHash, number }),
  },

  editor: {
    readFile: (relPath: string) => invoke<string>("editor_read_file", { relPath }),
    writeFile: (relPath: string, content: string) =>
      invoke<void>("editor_write_file", { relPath, content }),
  },

  lsp: {
    start: () => invoke<void>("lsp_start"),
    send: (message: string) => invoke<void>("lsp_send", { message }),
    stop: () => invoke<void>("lsp_stop"),
  },

  homebrew: {
    getStateDiff: () => invoke<HomebrewState>("homebrew_get_state_diff"),
    applyDiff: (diff: HomebrewState) => invoke<ConfigEditApplyResult>("homebrew_apply_diff", { diff }),
  },

  updater: {
    installVersion: (version: string) => invoke<void>("install_version", { version }),
    relaunch: () => invoke<void>("relaunch_after_update"),
    clearPinnedVersion: () => invoke<void>("clear_pinned_version"),
  },

  debug: {
    sentryEvent: () => invoke<void>("debug_sentry_event"),
  },
};

export const ipcRenderer = {
  on: <T = unknown>(channel: string, listener: (event: Event<T>) => void) =>
    listen<T>(channel, listener),
  once: <T = unknown>(channel: string, listener: (event: Event<T>) => void) =>
    once<T>(channel, listener),
};

// const w = new Window("lol");
// w.once("tauri://window-created", (event) => {
//   console.log(event);
// });
// w.once("tauri://destroyed", (event) => {
//   console.log(event);
// });

declare global {
  interface Window {
    darwinAPI?: typeof darwinAPI;
    __NIXMAC__?: typeof darwinAPI;
  }
}

window.__NIXMAC__ = darwinAPI;
window.darwinAPI = darwinAPI;
