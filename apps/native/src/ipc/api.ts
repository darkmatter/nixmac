/**
 * @deprecated Although Tauri IPC provides generated types, it doesnt actually provide
 * the handlers. It also doesn't enforce the proper command contract. On the other hand,
 * oRPC is end-to-end.Therefore this API is deprecated in favor of oRPC bindings..
 * @see {@link import("./orpc-bindings")} for the oRPC client.
 */
import type { StarterTemplateId } from "@/components/widget/onboarding/lib/flake-ref";
import type {
  AccountBilling,
  AuthStatus,
  CliToolsState,
  ConfigEditApplyResult,
  ConfigurableSchema,
  CreditBalance,
  ExportResult,
  FeedbackMetadata,
  FeedbackShareOptions,
  GitState,
  GitStatus,
  GlobalPreferences,
  HomebrewItem,
  HomebrewState,
  ImportResult,
  JsonValue,
  LaunchdItem,
  NixCheckResult,
  NixInstallState,
  OkResult,
  Permission,
  PermissionsState,
  RecommendedPrompt,
  SyncRemoteStatus,
  SyncResult,
  SystemDefault,
  SystemDefaultsScan,
  UpdateInfo,
} from "@/ipc/types";
import { client, type PreviewIndicatorState } from "@/lib/orpc";
import { invoke } from "@tauri-apps/api/core";
import { type Event, listen, once } from "@tauri-apps/api/event";
import {
  checkFullDiskAccessPermission,
  requestFullDiskAccessPermission,
} from "tauri-plugin-macos-permissions-api";
import { getCachedPrefs, setPrefs } from "./preferences";

/** @deprecated Legacy `invoke` IPC — migrate to oRPC (`client` / `orpc` from `@/lib/orpc`). Regenerate: `cd apps/native && bun run gen:orpc`. */
export const tauriAPI = {
  config: {
    /** @deprecated Use `client.config.get()` or `orpc.config.get` from `@/lib/orpc`. */
    get: () => client.config.get(),
    /** @deprecated Use `client.config.setDir()` or `orpc.config.setDir` from `@/lib/orpc`. */
    setDir: (dir: string) => client.config.setDir({ dir }),
    /** @deprecated Use `client.config.prepareNewDir()` or `orpc.config.prepareNewDir` from `@/lib/orpc`. */
    prepareNewDir: (dir: string) => client.config.prepareNewDir({ dir }),
    /** @deprecated Use `client.config.pickDir()` or `orpc.config.pickDir` from `@/lib/orpc`. */
    pickDir: () => client.config.pickDir(),
    /** @deprecated Use `client.config.setHostAttr()` or `orpc.config.setHostAttr` from `@/lib/orpc`. */
    setHostAttr: (host: string) => client.config.setHostAttr({ host }),
    /** @deprecated Use `client.config.pickZip()` or `orpc.config.pickZip` from `@/lib/orpc`. */
    pickZip: () => client.config.pickZip(),
    /** @deprecated Use `client.config.importGithub()` or `orpc.config.importGithub` from `@/lib/orpc`. */
    importGithub: (repoRef: string, dirName?: string) =>
      client.config.importGithub({ repoRef, dirName: dirName ?? null }),
    /** @deprecated Use `client.config.importZip()` or `orpc.config.importZip` from `@/lib/orpc`. */
    importZip: (zipPath: string, dirName?: string) =>
      client.config.importZip({ zipPath, dirName: dirName ?? null }),
    /** @deprecated Use `client.config.getThisHostname()` or `orpc.config.getThisHostname` from `@/lib/orpc`. */
    getThisHostname: () => client.config.getThisHostname(),
  },
  github: {
    /** @deprecated Use `client.github.bootstrapStart()` or `orpc.github.bootstrapStart` from `@/lib/orpc`. */
    bootstrapStart: () => client.github.bootstrapStart(),
    /** @deprecated Use `client.github.bootstrapStatus()` or `orpc.github.bootstrapStatus` from `@/lib/orpc`. */
    bootstrapStatus: (state: string) => client.github.bootstrapStatus({ state }),
    /** @deprecated Use `client.github.connectStart()` or `orpc.github.connectStart` from `@/lib/orpc`. */
    connectStart: () => client.github.connectStart(),
    /** @deprecated Use `client.github.status()` or `orpc.github.status` from `@/lib/orpc`. */
    status: () => client.github.status(),
    /** @deprecated Use `client.github.listRepos()` or `orpc.github.listRepos` from `@/lib/orpc`. */
    listRepos: () => client.github.listRepos(),
    /** @deprecated Use `client.github.import()` or `orpc.github.import` from `@/lib/orpc`. */
    import: (owner: string, repo: string, dirName?: string) =>
      client.github.import({ owner, repo, dirName: dirName ?? null }),
    /** @deprecated Use `client.github.disconnect()` or `orpc.github.disconnect` from `@/lib/orpc`. */
    disconnect: () => client.github.disconnect(),
  },
  account: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    status: () => invoke<AuthStatus>("account_status"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    signIn: (email: string, password: string) =>
      invoke<AuthStatus>("account_sign_in", { email, password }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    signInWeb: (email: string, password: string) =>
      invoke<AuthStatus>("account_sign_in_web", { email, password }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    signUpWeb: (name: string, email: string, password: string) =>
      invoke<AuthStatus>("account_sign_up_web", { name, email, password }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    sendOtp: (email: string) => invoke<void>("account_send_otp", { email }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    verifyOtp: (email: string, otp: string, name: string) =>
      invoke<AuthStatus>("account_verify_otp", { email, otp, name }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    createSubscriptionCheckout: (slug: "payg-tokens" | "pro") =>
      invoke<string>("account_create_subscription_checkout", { slug }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    billing: () => invoke<AccountBilling>("account_billing"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    creditBalance: () => invoke<CreditBalance>("account_credit_balance"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    signOut: () => invoke<AuthStatus>("account_sign_out"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    setServerUrl: (url: string) => invoke<AuthStatus>("account_set_server_url", { url }),
  },
  sync: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    status: () => invoke<SyncRemoteStatus>("sync_status"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    push: () => invoke<SyncResult>("sync_push"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    pull: () => invoke<SyncResult>("sync_pull"),
  },
  git: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    state: () => invoke<GitState>("get_git_state"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    status: () => invoke<GitStatus>("git_status"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    statusAndCache: () => invoke<GitStatus>("git_status_and_cache"),
    /** @deprecated Use `client.git.commit()` or `orpc.git.commit` from `@/lib/orpc`. */
    commit: (message: string) => client.git.commit({ message }),
    /** @deprecated Use `client.git.fileDiffContents()` or `orpc.git.fileDiffContents` from `@/lib/orpc`. */
    fileDiffContents: (filenames: string[]) => client.git.fileDiffContents({ filenames }),
  },
  darwin: {
    /** @deprecated Use `client.darwin.evolve()` or `orpc.darwin.evolve` from `@/lib/orpc`. */
    evolve: (description: string) => client.darwin.evolve({ description }),
    /** @deprecated Use `client.darwin.evolveAnswer()` or `orpc.darwin.evolveAnswer` from `@/lib/orpc`. */
    evolveAnswer: (answer: string) => client.darwin.evolveAnswer({ answer }),
    /** @deprecated Use `client.darwin.buildCheck()` or `orpc.darwin.buildCheck` from `@/lib/orpc`. */
    buildCheck: () => client.darwin.buildCheck(),
    /** @deprecated Use `client.darwin.evolveFromManual()` or `orpc.darwin.evolveFromManual` from `@/lib/orpc`. */
    evolveFromManual: async () => (await client.darwin.evolveFromManual()).evolutionId,
    /** @deprecated Use `client.darwin.evolveCancel()` or `orpc.darwin.evolveCancel` from `@/lib/orpc`. */
    evolveCancel: () => client.darwin.evolveCancel(),
    /** @deprecated Use `client.darwin.applyStreamStart()` or `orpc.darwin.applyStreamStart` from `@/lib/orpc`. */
    applyStreamStart: (hostOverride?: string) =>
      client.darwin.applyStreamStart({ hostOverride: hostOverride ?? null }),
    /** @deprecated Use `client.darwin.activateStorePath()` or `orpc.darwin.activateStorePath` from `@/lib/orpc`. */
    activateStorePath: (storePath: string) =>
      client.darwin.activateStorePath({ storePath }),
    /** @deprecated Use `client.darwin.finalizeApply()` or `orpc.darwin.finalizeApply` from `@/lib/orpc`. */
    finalizeApply: () => client.darwin.finalizeApply(),
    /** @deprecated Use `client.darwin.finalizeRollback()` or `orpc.darwin.finalizeRollback` from `@/lib/orpc`. */
    finalizeRollback: (storePath: string | null, changesetId: number | null) =>
      client.darwin.finalizeRollback({ storePath, changesetId }),
    /** @deprecated Use `client.darwin.rollbackErase()` or `orpc.darwin.rollbackErase` from `@/lib/orpc`. */
    rollbackErase: () => client.darwin.rollbackErase(),
    /** @deprecated Use `client.darwin.prepareRestore()` or `orpc.darwin.prepareRestore` from `@/lib/orpc`. */
    prepareRestore: (targetHash: string) => client.darwin.prepareRestore({ targetHash }),
    /** @deprecated Use `client.darwin.abortRestore()` or `orpc.darwin.abortRestore` from `@/lib/orpc`. */
    abortRestore: () => client.darwin.abortRestore(),
    /** @deprecated Use `client.darwin.finalizeRestore()` or `orpc.darwin.finalizeRestore` from `@/lib/orpc`. */
    finalizeRestore: (targetHash: string) => client.darwin.finalizeRestore({ targetHash }),
    /** @deprecated Use `client.darwin.rebuildStatus()` or `orpc.darwin.rebuildStatus` from `@/lib/orpc`. */
    rebuildStatus: () => client.darwin.rebuildStatus(),
  },
  nix: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    check: () => invoke<NixCheckResult>("nix_check"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    installState: () => invoke<NixInstallState>("get_nix_install_state"),
  },
  flake: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    listHosts: () => invoke<string[]>("flake_list_hosts"),
    /** @deprecated Use `client.flake.exists()` or `orpc.flake.exists` from `@/lib/orpc`. */
    exists: () => client.flake.exists(),
    /** @deprecated Use `client.flake.existsAt()` or `orpc.flake.existsAt` from `@/lib/orpc`. */
    existsAt: (dir: string) => client.flake.existsAt({ dir }),
    /** @deprecated Use `client.flake.bootstrapDefault()` or `orpc.flake.bootstrapDefault` from `@/lib/orpc`. */
    bootstrapDefault: (hostname: string, templateId?: StarterTemplateId) =>
      client.flake.bootstrapDefault({ hostname, templateId: templateId ?? null }),
  },
  path: {
    /** @deprecated Use `client.path.exists()` or `orpc.path.exists` from `@/lib/orpc`. */
    exists: (dir: string) => client.path.exists({ dir }),
    /** @deprecated Use `client.path.normalize()` or `orpc.path.normalize` from `@/lib/orpc`. */
    normalize: (input: string) => client.path.normalize({ input }),
  },
  summarizedChanges: {
    /** @deprecated Use `client.summarizedChanges.getChangeMap()` or `orpc.summarizedChanges.getChangeMap` from `@/lib/orpc`. */
    getChangeMap: () => client.summarizedChanges.getChangeMap(),
    /** @deprecated Use `client.summarizedChanges.findChangeMap()` or `orpc.summarizedChanges.findChangeMap` from `@/lib/orpc`. */
    findChangeMap: () => client.summarizedChanges.findChangeMap(),
    /** @deprecated Use `client.summarizedChanges.summarizeCurrent()` or `orpc.summarizedChanges.summarizeCurrent` from `@/lib/orpc`. */
    summarizeCurrent: () => client.summarizedChanges.summarizeCurrent(),
    /** @deprecated Use `client.summarizedChanges.generateCommitMessage()` or `orpc.summarizedChanges.generateCommitMessage` from `@/lib/orpc`. */
    generateCommitMessage: () => client.summarizedChanges.generateCommitMessage(),
  },
  feedback: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    gatherMetadata: (feedbackType: string, share: FeedbackShareOptions) =>
      invoke<FeedbackMetadata>("feedback_gather_metadata", { request: { feedbackType, share } }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
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
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    getPrefs: getCachedPrefs,
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    setPrefs,
  },
  preferences: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    get: () => invoke<GlobalPreferences>("get_global_preferences"),
  },
  settings: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    export: (includeSecrets: boolean) =>
      invoke<ExportResult | null>("settings_export", { includeSecrets }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    import: () => invoke<ImportResult | null>("settings_import"),
  },
  devConfigs: {
    /**
     * Returns the static schema for every registered Configurable struct.
     * Same value every call — safe to cache.
     * @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`.
     */
    schemas: () => invoke<ConfigurableSchema[]>("dev_configs_schemas"),
    /**
     * Returns the current store-backed value of every registered Configurable,
     * keyed by struct name (matching `ConfigurableSchema.name`). Each value
     * is the full struct as a JSON object. Refresh this after `set` instead
     * of re-fetching schemas.
     * @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`.
     */
    values: () => invoke<Record<string, JsonValue>>("dev_configs_values"),
    /**
     * Replace a Configurable struct with a whole-struct payload. `value` must
     * be the full struct (every field), not a partial update — Serde validates
     * the whole thing in one pass on the backend.
     * @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`.
     */
    set: (structName: string, value: Record<string, unknown>) =>
      invoke<void>("dev_config_set", { structName, value }),
  },
  models: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    getCached: (provider: string) => invoke<string[] | null>("get_cached_models", { provider }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    setCached: (provider: string, models: string[]) =>
      invoke<OkResult>("set_cached_models", { provider, models }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    clearCached: (provider: string) => invoke<OkResult>("clear_cached_models", { provider }),
  },

  cli: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    checkTools: () => invoke<CliToolsState>("check_cli_tools"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    listModels: (tool: string) => invoke<string[]>("list_cli_models", { tool }),
  },

  promptHistory: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    get: () => invoke<string[]>("get_prompt_history"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    add: (prompt: string) => invoke<OkResult>("add_to_prompt_history", { prompt }),
  },

  previewIndicator: {
    /** @deprecated Use `client.previewIndicator.show()` or `orpc.previewIndicator.show` from `@/lib/orpc`. */
    show: () => client.previewIndicator.show(),
    /** @deprecated Use `client.previewIndicator.hide()` or `orpc.previewIndicator.hide` from `@/lib/orpc`. */
    hide: () => client.previewIndicator.hide(),
    /** @deprecated Use `client.previewIndicator.update()` or `orpc.previewIndicator.update` from `@/lib/orpc`. */
    update: (state: PreviewIndicatorState) => client.previewIndicator.update(state),
    /** @deprecated Use `client.previewIndicator.getState()` or `orpc.previewIndicator.getState` from `@/lib/orpc`. */
    getState: () => client.previewIndicator.getState(),
  },

  // Experimental: the spinning-mascot corner indicator shown during evolve/build.
  evolveMascot: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    show: () => invoke<OkResult>("evolve_mascot_show"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    hide: () => invoke<OkResult>("evolve_mascot_hide"),
  },

  scanner: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    getRecommendedPrompt: () => invoke<RecommendedPrompt | null>("get_recommended_prompt"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    scanDefaults: () => invoke<SystemDefaultsScan>("scan_system_defaults"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    applyDefaults: (defaults: SystemDefault[]) =>
      invoke<ConfigEditApplyResult>("apply_system_defaults", { defaults }),
  },
  permissions: {
    /**
     * Last-known permissions from the backend cell; null = never probed.
     * @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`.
     */
    get: () => invoke<PermissionsState | null>("get_permissions"),
    /**
     * Probe all macOS permissions; the result arrives via `permissions_changed`.
     * @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`.
     */
    refresh: () => invoke<void>("refresh_permissions"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    request: (permissionId: string) => invoke<Permission>("permissions_request", { permissionId }),
    // macOS-specific permission checks via tauri-plugin-macos-permissions
    checkFullDiskAccess: () => checkFullDiskAccessPermission(),
    requestFullDiskAccess: () => requestFullDiskAccessPermission(),
  },

  evolveState: {
    /** @deprecated Use `client.evolveState.get()` or `orpc.evolveState.get` from `@/lib/orpc`. */
    get: () => client.evolveState.get(),
    /** @deprecated Use `client.evolveState.clear()` or `orpc.evolveState.clear` from `@/lib/orpc`. */
    clear: () => client.evolveState.clear(),
  },

  history: {
    /** @deprecated Use `client.history.get()` or `orpc.history.get` from `@/lib/orpc`. */
    get: () => client.history.get(),
    /** @deprecated Use `client.history.generateFrom()` or `orpc.history.generateFrom` from `@/lib/orpc`. */
    generateFrom: (commitHash: string, number: number) =>
      client.history.generateFrom({ commitHash, number }),
  },

  editor: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    readFile: (relPath: string) => invoke<string>("editor_read_file", { relPath }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    writeFile: (relPath: string, content: string) =>
      invoke<void>("editor_write_file", { relPath, content }),
  },

  lsp: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    start: () => invoke<void>("lsp_start"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    send: (message: string) => invoke<void>("lsp_send", { message }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    stop: () => invoke<void>("lsp_stop"),
  },

  homebrew: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    getStateDiff: () => invoke<HomebrewState>("homebrew_get_state_diff"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    applyDiff: (diff: HomebrewState) =>
      invoke<ConfigEditApplyResult>("homebrew_apply_diff", { diff }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    addItems: (items: HomebrewItem[]) =>
      invoke<ConfigEditApplyResult>("homebrew_add_items", { items }),
  },

  launchd: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    scanLaunchdItems: () => invoke<LaunchdItem[]>("scan_launchd_items"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    applyLaunchdItems: (items: LaunchdItem[]) =>
      invoke<ConfigEditApplyResult>("apply_launchd_items", { items }),
  },

  updater: {
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    checkUpdate: () => invoke<UpdateInfo | null>("check_update"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    installUpdate: () => invoke<void>("install_update"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    installVersion: (version: string) => invoke<void>("install_version", { version }),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
    relaunch: () => invoke<void>("relaunch_after_update"),
    /** @deprecated oRPC migration pending — add procedure in `src-tauri/src/orpc/` then `bun run gen:orpc`. */
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
