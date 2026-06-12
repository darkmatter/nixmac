import { invoke } from "@tauri-apps/api/core";
import { type Event, listen, once } from "@tauri-apps/api/event";
import {
  checkFullDiskAccessPermission,
  requestFullDiskAccessPermission,
} from "tauri-plugin-macos-permissions-api";
import type {
  AuthStatus,
  BuildCheckResult,
  CliToolsState,
  CommitResult,
  Config as DarwinConfig,
  ConfigEditApplyResult,
  ConfigurableSchema,
  JsonValue,
  EvolveCancelResult,
  EvolveState,
  ExportResult,
  FeedbackMetadata,
  FeedbackShareOptions,
  FileDiffContents,
  GitState,
  GitStatus,
  GlobalPreferences,
  HomebrewItem,
  HomebrewState,
  HistoryItem,
  ImportResult,
  LaunchdItem,
  NixCheckResult,
  NixInstallState,
  OkResult,
  Permission,
  PermissionsState,
  PreviewIndicatorState,
  RebuildStatus,
  RecommendedPrompt,
  RollbackResult,
  SemanticChangeMap,
  SetDirResult,
  SyncRemoteStatus,
  SyncResult,
  SystemDefault,
  SystemDefaultsScan,
  UpdateInfo,
} from "@/ipc/types";
import { getCachedPrefs, setPrefs } from "./preferences";


export const tauriAPI = {
  config: {
    get: () => invoke<DarwinConfig>("config_get"),
    setDir: (dir: string) => invoke<SetDirResult>("config_set_dir", { dir }),
    prepareNewDir: (dir: string) => invoke<SetDirResult>("config_prepare_new_dir", { dir }),
    pickDir: () => invoke<SetDirResult | null>("config_pick_dir"),
    setHostAttr: (host: string) => invoke<OkResult>("config_set_host_attr", { host }),
    pickZip: () => invoke<string | null>("config_pick_zip"),
    importGithub: (repoRef: string, dirName?: string) =>
      invoke<SetDirResult>("config_import_github", { repoRef, dirName: dirName ?? null }),
    importZip: (zipPath: string, dirName?: string) =>
      invoke<SetDirResult>("config_import_zip", { zipPath, dirName: dirName ?? null }),
    getThisHostname: () => invoke<string>("get_this_hostname"),
  },
  account: {
    status: () => invoke<AuthStatus>("account_status"),
    signIn: (email: string, password: string) =>
      invoke<AuthStatus>("account_sign_in", { email, password }),
    signOut: () => invoke<AuthStatus>("account_sign_out"),
    setServerUrl: (url: string) => invoke<AuthStatus>("account_set_server_url", { url }),
  },
  sync: {
    status: () => invoke<SyncRemoteStatus>("sync_status"),
    push: () => invoke<SyncResult>("sync_push"),
    pull: () => invoke<SyncResult>("sync_pull"),
  },
  git: {
    state: () => invoke<GitState>("get_git_state"),
    status: () => invoke<GitStatus>("git_status"),
    statusAndCache: () => invoke<GitStatus>("git_status_and_cache"),
    commit: (message: string) => invoke<CommitResult>("git_commit", { message }),
    fileDiffContents: (filenames: string[]) => invoke<Record<string, FileDiffContents>>("git_file_diff_contents", { filenames }),
  },
  darwin: {
    evolve: (description: string) => invoke<void>("darwin_evolve", { description }),
    evolveAnswer: (answer: string) => invoke<OkResult>("darwin_evolve_answer", { answer }),
    buildCheck: () => invoke<BuildCheckResult>("darwin_build_check"),
    evolveFromManual: () => invoke<number>("darwin_adopt_manual_changes"),
    evolveCancel: () => invoke<EvolveCancelResult>("darwin_evolve_cancel"),
    applyStreamStart: (hostOverride?: string) =>
      invoke<OkResult>("darwin_apply_stream_start", { hostOverride }),
    activateStorePath: (storePath: string) =>
      invoke<OkResult>("darwin_activate_store_path", { storePath }),
    finalizeApply: () => invoke<void>("finalize_apply"),
    finalizeRollback: (storePath: string | null, changesetId: number | null) =>
      invoke<void>("finalize_rollback", { storePath, changesetId }),
    rollbackErase: () => invoke<RollbackResult>("rollback_erase"),
    prepareRestore: (targetHash: string) => invoke<void>("prepare_restore", { targetHash }),
    abortRestore: () => invoke<void>("abort_restore"),
    finalizeRestore: (targetHash: string) => invoke<void>("finalize_restore", { targetHash }),
    rebuildStatus: () => invoke<RebuildStatus>("get_rebuild_status"),
  },
  nix: {
    check: () => invoke<NixCheckResult>("nix_check"),
    installState: () => invoke<NixInstallState>("get_nix_install_state"),
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
    getChangeMap: () => invoke<SemanticChangeMap>("get_change_map"),
    findChangeMap: () => invoke<SemanticChangeMap>("find_change_map"),
    summarizeCurrent: () => invoke<SemanticChangeMap>("summarize_current"),
    generateCommitMessage: () => invoke<string>("generate_commit_message"),
  },
  feedback: {
    gatherMetadata: (feedbackType: string, share: FeedbackShareOptions) =>
      invoke<FeedbackMetadata>("feedback_gather_metadata", { request: { feedbackType, share } }),
    submit: (payload: string) => invoke<boolean>("feedback_submit", { payload }),
  },
  debug: {
    logBreadcrumb: (label: string, detail?: string, clientTimestampUnixMs?: number) =>
      invoke<OkResult>("e2e_log_breadcrumb", {
        label,
        detail: detail ?? null,
        clientTimestampUnixMs: clientTimestampUnixMs ?? null,
      }),
    markBootStage: (stage: string, clientTimestampUnixMs?: number) =>
      invoke<OkResult>("e2e_mark_boot_stage", {
        stage,
        clientTimestampUnixMs: clientTimestampUnixMs ?? null,
      }),
    clearTauriState: () => invoke<void>("developer_clear_tauri_state"),
    sendTestNotification: () => invoke<void>("developer_send_test_notification"),
  },
  ui: {
    getPrefs: getCachedPrefs,
    setPrefs,
  },
  preferences: {
    get: () => invoke<GlobalPreferences>("get_global_preferences"),
  },
  settings: {
    export: (includeSecrets: boolean) =>
      invoke<ExportResult | null>("settings_export", { includeSecrets }),
    import: () => invoke<ImportResult | null>("settings_import"),
  },
  devConfigs: {
    /**
     * Returns the static schema for every registered Configurable struct.
     * Same value every call — safe to cache.
     */
    schemas: () => invoke<ConfigurableSchema[]>("dev_configs_schemas"),
    /**
     * Returns the current store-backed value of every registered Configurable,
     * keyed by struct name (matching `ConfigurableSchema.name`). Each value
     * is the full struct as a JSON object. Refresh this after `set` instead
     * of re-fetching schemas.
     */
    values: () => invoke<Record<string, JsonValue>>("dev_configs_values"),
    /**
     * Replace a Configurable struct with a whole-struct payload. `value` must
     * be the full struct (every field), not a partial update — Serde validates
     * the whole thing in one pass on the backend.
     */
    set: (structName: string, value: Record<string, unknown>) =>
      invoke<void>("dev_config_set", { structName, value }),
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

  // Experimental: the spinning-mascot corner indicator shown during evolve/build.
  evolveMascot: {
    show: () => invoke<OkResult>("evolve_mascot_show"),
    hide: () => invoke<OkResult>("evolve_mascot_hide"),
  },

  scanner: {
    getRecommendedPrompt: () => invoke<RecommendedPrompt | null>("get_recommended_prompt"),
    scanDefaults: () => invoke<SystemDefaultsScan>("scan_system_defaults"),
    applyDefaults: (defaults: SystemDefault[]) =>
      invoke<ConfigEditApplyResult>("apply_system_defaults", { defaults }),
  },
  permissions: {
    /** Last-known permissions from the backend cell; null = never probed. */
    get: () => invoke<PermissionsState | null>("get_permissions"),
    /** Probe all macOS permissions; the result arrives via `permissions_changed`. */
    refresh: () => invoke<void>("refresh_permissions"),
    checkAll: () => invoke<PermissionsState>("permissions_check_all"),
    request: (permissionId: string) => invoke<Permission>("permissions_request", { permissionId }),
    // macOS-specific permission checks via tauri-plugin-macos-permissions
    checkFullDiskAccess: () => checkFullDiskAccessPermission(),
    requestFullDiskAccess: () => requestFullDiskAccessPermission(),
  },

  evolveState: {
    get: () => invoke<EvolveState>("get_evolve_state"),
    clear: () => invoke<EvolveState>("clear_evolve_state"),
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
    addItems: (items: HomebrewItem[]) =>
      invoke<ConfigEditApplyResult>("homebrew_add_items", { items }),
  },

  launchd: {
    scanLaunchdItems: () => invoke<LaunchdItem[]>("scan_launchd_items"),
    applyLaunchdItems: (items: LaunchdItem[]) =>
      invoke<ConfigEditApplyResult>("apply_launchd_items", { items }),
  },

  updater: {
    checkUpdate: () => invoke<UpdateInfo | null>("check_update"),
    installUpdate: () => invoke<void>("install_update"),
    installVersion: (version: string) => invoke<void>("install_version", { version }),
    relaunch: () => invoke<void>("relaunch_after_update"),
    clearPinnedVersion: () => invoke<void>("clear_pinned_version"),
  },
};

export const ipcRenderer = {
  on: <T = unknown>(channel: string, listener: (event: Event<T>) => void) =>
    listen<T>(channel, listener),
  once: <T = unknown>(channel: string, listener: (event: Event<T>) => void) =>
    once<T>(channel, listener),
};

declare global {
  interface Window {
    tauriAPI?: typeof tauriAPI;
    __NIXMAC__?: typeof tauriAPI;
  }
}

window.__NIXMAC__ = tauriAPI;
window.tauriAPI = tauriAPI;
