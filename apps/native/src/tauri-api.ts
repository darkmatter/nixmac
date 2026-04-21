import { invoke } from "@tauri-apps/api/core";
import { type Event, listen, once } from "@tauri-apps/api/event";
import {
  checkFullDiskAccessPermission,
  requestFullDiskAccessPermission,
} from "tauri-plugin-macos-permissions-api";
import type {
  EvolutionResult,
  EvolveState,
  GitStatus,
  HistoryItem,
  RollbackResult,
  SemanticChangeMap,
} from "./types/shared";

export type {
  ChangeType,
  EvolutionFailureResult,
  EvolutionResult,
  EvolutionState,
  EvolutionTelemetry,
  EvolveState,
  EvolveStep,
  GitFileStatus,
  GitStatus,
  HistoryItem,
  SemanticChangeMap,
  SummarizedChangeSet,
  WatcherEvent,
} from "./types/shared";
export type { Change, Commit } from "./types/sqlite";

export interface UnknownRecord {
  [key: string]: unknown;
}

export interface DarwinConfig {
  configDir: string;
  hostAttr?: string | null;
}

export interface DarwinPrefs {
  openrouterApiKey?: string;
  openaiApiKey?: string;
  summaryProvider?: string;
  summaryModel?: string;
  evolveProvider?: string;
  evolveModel?: string;
  maxIterations?: number;
  maxBuildAttempts?: number;
  ollamaApiBaseUrl?: string;
  vllmApiBaseUrl?: string;
  vllmApiKey?: string;
  sendDiagnostics?: boolean;
  confirmBuild?: boolean;
  confirmClear?: boolean;
  confirmRollback?: boolean;
}

export const DEFAULT_MAX_ITERATIONS = 25;

export interface ApplyResult {
  gitStatus: GitStatus;
  evolveState: EvolveState;
}

export interface CommitResult {
  hash: string;
  evolveState: EvolveState;
}


export interface PreviewIndicatorState {
  visible: boolean;
  summary: string | null;
  filesChanged: number;
  additions?: number;
  deletions?: number;
  isLoading: boolean;
}

// =============================================================================
// Feedback Types
// =============================================================================

export interface FeedbackShareOptions {
  currentAppState: boolean;
  systemInfo: boolean;
  usageStats: boolean;
  evolutionLog: boolean;
  changedNixFiles: boolean;
  aiProviderModelInfo: boolean;
  buildErrorOutput: boolean;
  flakeInputsSnapshot: boolean;
  appLogs: boolean;
}

export interface FeedbackSystemInfo {
  osName?: string;
  osVersion?: string;
  arch?: string;
  nixVersion?: string;
  appVersion?: string;
}

export interface FeedbackUsageStats {
  totalEvolutions?: number;
  successRate?: number;
  avgIterations?: number;
  lastComputedAt?: string;
  extra?: Record<string, unknown>;
}

export interface FeedbackAiProviderModelInfo {
  evolveProvider?: string;
  evolveModel?: string;
  summaryProvider?: string;
  summaryModel?: string;
  totalTokens?: number;
  latencyMs?: number;
  iterations?: number;
  buildAttempts?: number;
}

export interface FeedbackFlakeInputEntry {
  rev?: string;
  lastModified?: number;
  narHash?: string;
}

export interface FeedbackFlakeInputsSnapshot {
  nixpkgs?: FeedbackFlakeInputEntry;
  "nix-darwin"?: FeedbackFlakeInputEntry;
  "home-manager"?: FeedbackFlakeInputEntry;
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
  lastPromptText?: string;
}

// =============================================================================
// Permissions Types
// =============================================================================

export type PermissionStatus = "granted" | "denied" | "pending" | "unknown";

export interface Permission {
  id: string;
  name: string;
  description: string;
  required: boolean;
  canRequestProgrammatically: boolean;
  status: PermissionStatus;
  instructions?: string;
}

export interface PermissionsState {
  permissions: Permission[];
  allRequiredGranted: boolean;
  checkedAt: number | null;
}

// =============================================================================
// System Defaults Scanner Types
// =============================================================================

export interface SystemDefault {
  nixKey: string;
  label: string;
  category: string;
  currentValue: string;
  defaultValue: string;
}

export interface SystemDefaultsScan {
  defaults: SystemDefault[];
  totalScanned: number;
}

export interface RecommendedPrompt {
  id: string;
  promptText: string;
}

// =============================================================================
// Evolve Streaming Events
// =============================================================================

export type EvolveEventType =
  | "start"
  | "iteration"
  | "thinking"
  | "reading"
  | "editing"
  | "buildCheck"
  | "buildPass"
  | "buildFail"
  | "toolCall"
  | "apiRequest"
  | "apiResponse"
  | "question"
  | "complete"
  | "error"
  | "info"
  | "summarizing";

export interface EvolveEvent {
  /** Raw log output (detailed technical information) */
  raw: string;
  /** Human-readable summary of what's happening */
  summary: string;
  /** Event type for categorization in the UI */
  eventType: EvolveEventType;
  /** Current iteration number (if applicable) */
  iteration: number | null;
  /** Timestamp in milliseconds since evolution started */
  timestampMs: number;
}

export const EVOLVE_EVENT_CHANNEL = "darwin:evolve:event";
export const CONFIG_CHANGED_CHANNEL = "config:changed";

export interface ConfigChangedEvent {
  hasChanges: boolean;
}

export const darwinAPI = {
  config: {
    get: () => invoke<DarwinConfig | null>("config_get"),
    setDir: (dir: string) => invoke("config_set_dir", { dir }),
    pickDir: () => invoke("config_pick_dir"),
    setHostAttr: (host: string) => invoke("config_set_host_attr", { host }),
  },
  git: {
    initIfNeeded: () => invoke("git_init_if_needed"),
    status: () => invoke<GitStatus | null>("git_status"),
    statusAndCache: () => invoke<GitStatus | null>("git_status_and_cache"),
    cached: () => invoke<GitStatus | null>("git_cached"),
    commit: (message: string) => invoke<CommitResult>("git_commit", { message }),
    stash: (message: string) => invoke("git_stash", { message }),
  },
  darwin: {
    evolve: (description: string) => invoke<EvolutionResult>("darwin_evolve", { description }),
    evolveAnswer: (answer: string) => invoke<void>("darwin_evolve_answer", { answer }),
    buildCheck: () => invoke<{ passed: boolean; output: string }>("darwin_build_check"),
    evolveFromManual: () => invoke<number>("darwin_adopt_manual_changes"),
    evolveCancel: () => invoke("darwin_evolve_cancel"),
    apply: (hostOverride?: string) => invoke("darwin_apply", { hostOverride }),
    applyStreamStart: (hostOverride?: string) =>
      invoke("darwin_apply_stream_start", { hostOverride }),
    activateStorePath: (storePath: string) =>
      invoke("darwin_activate_store_path", { storePath }),
    applyStreamCancel: () => invoke("darwin_apply_stream_cancel"),
    finalizeApply: () => invoke<ApplyResult>("finalize_apply"),
    finalizeRollback: (storePath: string | null, changesetId: number | null) =>
      invoke<ApplyResult>("finalize_rollback", { storePath, changesetId }),
    rollbackErase: () => invoke<RollbackResult>("rollback_erase"),
    prepareRestore: (targetHash: string) => invoke<void>("prepare_restore", { targetHash }),
    abortRestore: () => invoke<void>("abort_restore"),
    finalizeRestore: (targetHash: string) => invoke<GitStatus>("finalize_restore", { targetHash }),
  },
  nix: {
    check: () =>
      invoke<{ installed: boolean; version?: string; darwin_rebuild_available: boolean }>(
        "nix_check",
      ),
    installStart: () => invoke("nix_install_start"),
    prefetchDarwinRebuild: () => invoke("darwin_rebuild_prefetch"),
  },
  flake: {
    listHosts: () => invoke<string[]>("flake_list_hosts"),
    installedApps: () => invoke<unknown[]>("flake_installed_apps"),
    exists: () => invoke<boolean>("flake_exists"),
    existsAt: (dir: string) => invoke<boolean>("flake_exists_at", { dir }),
    bootstrapDefault: (hostname: string) => invoke<void>("bootstrap_default_config", { hostname }),
    finalizeFlakeLock: () => invoke("finalize_flake_lock"),
  },
  path: {
    exists: (dir: string) => invoke<boolean>("path_exists", { dir }),
    normalize: (input: string) => invoke<string>("path_normalize", { input }),
  },
  summarizedChanges: {
    findChangeMap: () => invoke<SemanticChangeMap>("find_change_map"),
    summarizeCurrent: () => invoke<void>("summarize_current"),
    generateCommitMessage: () => invoke<string>("generate_commit_message"),
  },
  feedback: {
    gatherMetadata: (feedbackType: string, share: FeedbackShareOptions) =>
      invoke<FeedbackMetadata>("feedback_gather_metadata", { request: { feedbackType, share } }),
    submit: (payload: string) => invoke<boolean>("feedback_submit", { payload }),
  },
  ui: {
    getPrefs: () => invoke<DarwinPrefs | null>("ui_get_prefs"),
    setPrefs: (prefs: DarwinPrefs) => invoke("ui_set_prefs", { prefs }),
  },
  models: {
    getCached: (provider: string) => invoke<string[] | null>("get_cached_models", { provider }),
    setCached: (provider: string, models: string[]) =>
      invoke("set_cached_models", { provider, models }),
    clearCached: (provider: string) => invoke("clear_cached_models", { provider }),
  },

  cli: {
    checkTools: () => invoke<Record<string, boolean>>("check_cli_tools"),
    listModels: (tool: string) => invoke<string[]>("list_cli_models", { tool }),
  },

  promptHistory: {
    get: () => invoke<string[]>("get_prompt_history"),
    add: (prompt: string) => invoke("add_to_prompt_history", { prompt }),
  },

  previewIndicator: {
    show: () => invoke("preview_indicator_show"),
    hide: () => invoke("preview_indicator_hide"),
    update: (state: PreviewIndicatorState) => invoke("preview_indicator_update", { state }),
    getState: () => invoke<PreviewIndicatorState>("preview_indicator_get_state"),
  },

  scanner: {
    getRecommendedPrompt: () => invoke<RecommendedPrompt | null>("get_recommended_prompt"),
    scanDefaults: () => invoke<SystemDefaultsScan>("scan_system_defaults"),
    applyDefaults: (defaults: SystemDefault[]) =>
      invoke<{
        ok: boolean;
        count: number;
        changeMap: SemanticChangeMap;
        gitStatus: GitStatus;
        evolveState: EvolveState;
      }>("apply_system_defaults", { defaults }),
  },
  permissions: {
    checkAll: () => invoke<PermissionsState>("permissions_check_all"),
    request: (permissionId: string) => invoke<Permission>("permissions_request", { permissionId }),
    allRequiredGranted: () => invoke<boolean>("permissions_all_required_granted"),
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
    listFiles: () =>
      invoke<{ path: string; name: string; isDir: boolean }[]>("editor_list_files"),
  },

  lsp: {
    start: () => invoke<void>("lsp_start"),
    send: (message: string) => invoke<void>("lsp_send", { message }),
    stop: () => invoke<void>("lsp_stop"),
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
