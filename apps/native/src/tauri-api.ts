import { invoke } from "@tauri-apps/api/core";
import { type Event, listen, once } from "@tauri-apps/api/event";
import type { CommitRow, SummaryRow } from "./types/sqlite";
export type { CommitRow, SummaryRow } from "./types/sqlite";

export interface HistoryItem {
  hash: string;
  message: string | null;
  createdAt: number;
  commit: CommitRow | null;
  summary: SummaryRow | null;
}
import {
  checkFullDiskAccessPermission,
  requestFullDiskAccessPermission,
} from "tauri-plugin-macos-permissions-api";

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
  sendDiagnostics?: boolean;
  confirmBuild?: boolean;
  confirmClear?: boolean;
  confirmRollback?: boolean;
}

export interface GitFileStatus {
  path: string;
  changeType: "new" | "edited" | "removed" | "renamed";
}

/**
 * Git status returned from the backend.
 * Files are parsed from diff headers against main/master.
 */
export interface GitStatus {
  files?: GitFileStatus[];
  branch?: string;
  branchCommitMessages?: string[];
  headIsBuilt?: boolean;
  isMainBranch?: boolean;
  branchHasBuiltCommit?: boolean;
  diff?: string;
  additions?: number;
  deletions?: number;
  headCommitHash: string | null;
  cleanHead: boolean;
}

export interface SummaryItem {
  title: string;
  description: string;
}

/**
 * AI-generated summary of changes.
 */
export interface SummaryResponse {
  items: SummaryItem[];
  instructions: string;
  commitMessage: string;
  diff: string;
}

export interface GitStatusWithSummary<S = SummaryResponse> {
  gitStatus: GitStatus;
  summary: S;
}

export type EvolutionResult = GitStatusWithSummary;
export type WatcherEvent = GitStatusWithSummary<SummaryResponse | null>;
export type RollbackResult = GitStatusWithSummary<SummaryResponse | null>;

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
  nixConfig: boolean;
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
  nixConfigSnapshot?: string;
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
    commit: (message: string) => invoke("git_commit", { message }),
    stash: (message: string) => invoke("git_stash", { message }),
    stageAll: () => invoke("git_stage_all"),
    unstageAll: () => invoke("git_unstage_all"),
    restoreAll: () => invoke("git_restore_all"),
    checkoutNewBranch: (branchName: string) =>
      invoke<{ ok: boolean; branch: string }>("git_checkout_new_branch", { branchName }),
    checkoutBranch: (branchName: string) => invoke("git_checkout_branch", { branchName }),
    checkoutMainBranch: () => invoke("git_checkout_main_branch"),
    tagAsBuilt: () => invoke("git_tag_as_built"),
    mergeBranch: (branchName: string, squash?: boolean, commitMessage?: string) =>
      invoke("git_finalize_evolve", { branchName, squash, commitMessage }),
  },
  darwin: {
    evolve: (description: string) => invoke<EvolutionResult>("darwin_evolve", { description }),
    evolveCancel: () => invoke("darwin_evolve_cancel"),
    apply: (hostOverride?: string) => invoke("darwin_apply", { hostOverride }),
    applyStreamStart: (hostOverride?: string) =>
      invoke("darwin_apply_stream_start", { hostOverride }),
    applyStreamCancel: () => invoke("darwin_apply_stream_cancel"),
    finalizeApply: () => invoke<EvolutionResult>("finalize_apply"),
    rollbackErase: (keepBranch?: boolean) =>
      invoke<RollbackResult>("rollback_erase", { keepBranch }),
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
    bootstrapDefault: (hostname: string) => invoke<void>("bootstrap_default_config", { hostname }),
    finalizeFlakeLock: () => invoke("finalize_flake_lock"),
  },
  summary: {
    find: () => invoke<SummaryResponse | null>("find_summary"),
    generate: () => invoke<SummaryResponse>("summarize_changes"),
  },
  feedback: {
    gatherMetadata: (feedbackType: string, share: FeedbackShareOptions) =>
      invoke<FeedbackMetadata>("feedback_gather_metadata", { request: { feedbackType, share } }),
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
    scanDefaults: () => invoke<SystemDefaultsScan>("scan_system_defaults"),
    applyDefaults: (defaults: SystemDefault[]) =>
      invoke<{
        ok: boolean;
        count: number;
        summary: SummaryResponse;
        gitStatus: GitStatus;
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

  history: {
    get: () => invoke<HistoryItem[]>("get_history"),
    generateFrom: (commitHash: string, number: number) =>
      invoke<void>("generate_history_from", { commitHash, number }),
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
