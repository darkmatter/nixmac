import { invoke } from "@tauri-apps/api/core";
import { type Event, listen, once } from "@tauri-apps/api/event";
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
  floatingFooter?: boolean;
  windowShadow?: boolean;
  openrouterApiKey?: string;
  openaiApiKey?: string;
  summaryProvider?: string;
  summaryModel?: string;
  evolveProvider?: string;
  evolveModel?: string;
}

export interface GitFileStatus {
  working_tree?: string;
  index?: string;
  path: string;
}

/**
 * Git status returned from the backend.
 * All computed fields are calculated server-side for consistency.
 */
export interface GitStatus {
  // File lists
  files?: GitFileStatus[];
  created?: string[];
  deleted?: string[];
  modified?: string[];
  staged?: string[];
  notAdded?: string[];
  conflicted?: string[];

  // Branch info
  current?: string;
  tracking?: string;
  ahead?: number;
  behind?: number;

  // Computed state
  hasChanges?: boolean;
  hasUnstagedChanges?: boolean;
  allChangesStaged?: boolean;
  allChangesCleanlyStaged?: boolean;
}

export interface SummaryItem {
  title: string;
  description: string;
}

export interface SummaryResponse {
  items: SummaryItem[];
  instructions: string;
  commitMessage: string;
  filesChanged: number;
  diffLines: number;
  additions: number;
  deletions: number;
  diff: string;
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
  | "info";

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
    commit: (message: string) => invoke("git_commit", { message }),
    stash: (message: string) => invoke("git_stash", { message }),
    stageAll: () => invoke("git_stage_all"),
    unstageAll: () => invoke("git_unstage_all"),
    restoreAll: () => invoke("git_restore_all"),
  },
  darwin: {
    evolve: (description: string) => invoke("darwin_evolve", { description }),
    apply: (hostOverride?: string) => invoke("darwin_apply", { hostOverride }),
    applyStreamStart: (hostOverride?: string) =>
      invoke("darwin_apply_stream_start", { hostOverride }),
    applyStreamCancel: () => invoke("darwin_apply_stream_cancel"),
  },
  flake: {
    listHosts: () => invoke<string[]>("flake_list_hosts"),
    installedApps: () => invoke<unknown[]>("flake_installed_apps"),
    exists: () => invoke<boolean>("flake_exists"),
    bootstrapDefault: (hostname: string) =>
      invoke<void>("bootstrap_default_config", { hostname }),
  },
  // Summarization with fast model
  summarize: {
    changes: () => invoke<SummaryResponse>("summarize_changes"),
    commitMessage: () => invoke<string>("suggest_commit_message"),
  },
  ui: {
    getPrefs: () => invoke<DarwinPrefs | null>("ui_get_prefs"),
    setPrefs: (prefs: DarwinPrefs) => invoke("ui_set_prefs", { prefs }),
    setWindowShadow: (on: boolean) => invoke("ui_set_window_shadow", { on }),
  },
  models: {
    getCached: (provider: string) =>
      invoke<string[] | null>("get_cached_models", { provider }),
    setCached: (provider: string, models: string[]) =>
      invoke("set_cached_models", { provider, models }),
  },

  previewIndicator: {
    show: () => invoke("preview_indicator_show"),
    hide: () => invoke("preview_indicator_hide"),
    update: (state: PreviewIndicatorState) =>
      invoke("preview_indicator_update", { state }),
    getState: () =>
      invoke<PreviewIndicatorState>("preview_indicator_get_state"),
  },

  watcher: {
    start: () => invoke("watcher_start"),
    stop: () => invoke("watcher_stop"),
    isActive: () => invoke<boolean>("watcher_is_active"),
  },
  permissions: {
    checkAll: () => invoke<PermissionsState>("permissions_check_all"),
    request: (permissionId: string) =>
      invoke<Permission>("permissions_request", { permissionId }),
    allRequiredGranted: () =>
      invoke<boolean>("permissions_all_required_granted"),
    // macOS-specific permission checks via tauri-plugin-macos-permissions
    checkFullDiskAccess: () => checkFullDiskAccessPermission(),
    requestFullDiskAccess: () => requestFullDiskAccessPermission(),
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
