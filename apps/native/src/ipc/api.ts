/**
 * @deprecated Although Tauri IPC provides generated types, it doesnt actually provide
 * the handlers. It also doesn't enforce the proper command contract. On the other hand,
 * oRPC is end-to-end.Therefore this API is deprecated in favor of oRPC bindings..
 * @see {@link import("./orpc-bindings")} for the oRPC client.
 */
import type { StarterTemplateId } from "@/components/widget/onboarding/lib/flake-ref";
import type {
  FeedbackShareOptions,
  HomebrewCheckResult,
  HomebrewItem,
  HomebrewState,
  JsonValue,
  LaunchdItem,
  OkResult,
  SystemDefault,
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
    /** @deprecated Use `client.github.disconnect()` or `orpc.github.disconnect` from `@/lib/orpc`. */
    disconnect: () => client.github.disconnect(),
  },
  account: {
    /** @deprecated Use `client.account.status()` or `orpc.account.status` from `@/lib/orpc`. */
    status: () => client.account.status(),
    /** @deprecated Use `client.account.signIn()` or `orpc.account.signIn` from `@/lib/orpc`. */
    signIn: (email: string, password: string) =>
      client.account.signIn({ email, password }),
    /** @deprecated Use `client.account.signInWeb()` or `orpc.account.signInWeb` from `@/lib/orpc`. */
    signInWeb: (email: string, password: string) =>
      client.account.signInWeb({ email, password }),
    /** @deprecated Use `client.account.signUpWeb()` or `orpc.account.signUpWeb` from `@/lib/orpc`. */
    signUpWeb: (name: string, email: string, password: string) =>
      client.account.signUpWeb({ name, email, password }),
    /** @deprecated Use `client.account.sendOtp()` or `orpc.account.sendOtp` from `@/lib/orpc`. */
    sendOtp: (email: string) => client.account.sendOtp({ email }),
    /** @deprecated Use `client.account.verifyOtp()` or `orpc.account.verifyOtp` from `@/lib/orpc`. */
    verifyOtp: (email: string, otp: string, name: string) =>
      client.account.verifyOtp({ email, otp, name }),
    /** @deprecated Use `client.account.signOut()` or `orpc.account.signOut` from `@/lib/orpc`. */
    signOut: () => client.account.signOut(),
    /** @deprecated Use `client.account.setServerUrl()` or `orpc.account.setServerUrl` from `@/lib/orpc`. */
    setServerUrl: (url: string) => client.account.setServerUrl({ url }),
  },
  sync: {
    /** @deprecated Use `client.sync.status()` or `orpc.sync.status` from `@/lib/orpc`. */
    status: () => client.sync.status(),
    /** @deprecated Use `client.sync.push()` or `orpc.sync.push` from `@/lib/orpc`. */
    push: () => client.sync.push(),
    /** @deprecated Use `client.sync.pull()` or `orpc.sync.pull` from `@/lib/orpc`. */
    pull: () => client.sync.pull(),
  },
  git: {
    /** @deprecated Use `client.git.state()` or `orpc.git.state` from `@/lib/orpc`. */
    state: () => client.git.state(),
    /** @deprecated Use `client.git.status()` or `orpc.git.status` from `@/lib/orpc`. */
    status: () => client.git.status(),
    /** @deprecated Use `client.git.statusAndCache()` or `orpc.git.statusAndCache` from `@/lib/orpc`. */
    statusAndCache: () => client.git.statusAndCache(),
    /** @deprecated Use `client.git.commit()` or `orpc.git.commit` from `@/lib/orpc`. */
    commit: (message: string) => client.git.commit({ message }),
    /** @deprecated Use `client.git.fileDiffContents()` or `orpc.git.fileDiffContents` from `@/lib/orpc`. */
    fileDiffContents: (filenames: string[]) => client.git.fileDiffContents({ filenames }),
    /** @deprecated Use `client.git.pullFromUpstream()` or `orpc.git.pullFromUpstream` from `@/lib/orpc`. */
    pullFromUpstream: () => client.git.pullFromUpstream(),
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
    /** @deprecated Use `client.nix.check()` or `orpc.nix.check` from `@/lib/orpc`. */
    check: () => client.nix.check(),
    /** @deprecated Use `client.nix.installState()` or `orpc.nix.installState` from `@/lib/orpc`. */
    installState: () => client.nix.installState(),
  },
  flake: {
    /** @deprecated Use `client.flake.listHosts()` or `orpc.flake.listHosts` from `@/lib/orpc`. */
    listHosts: () => client.flake.listHosts(),
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
    /** @deprecated Use `client.feedback.gatherMetadata()` or `orpc.feedback.gatherMetadata` from `@/lib/orpc`. */
    gatherMetadata: (feedbackType: string, share: FeedbackShareOptions) =>
      client.feedback.gatherMetadata({ request: { feedbackType, share } }),
    /** @deprecated Use `client.feedback.submit()` or `orpc.feedback.submit` from `@/lib/orpc`. */
    submit: (payload: string) => client.feedback.submit(payload),
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
    /** @deprecated Use `client.preferences.get()` or `orpc.preferences.get` from `@/lib/orpc`. */
    get: () => client.preferences.get(),
  },
  settings: {
    /** @deprecated Use `client.settings.export()` or `orpc.settings.export` from `@/lib/orpc`. */
    export: (includeSecrets: boolean) =>
      client.settings.export({ includeSecrets }),
    /** @deprecated Use `client.settings.import()` or `orpc.settings.import` from `@/lib/orpc`. */
    import: () => client.settings.import(),
  },
  devConfigs: {
    /**
     * Returns the static schema for every registered Configurable struct.
     * Same value every call — safe to cache.
     * @deprecated Use `client.devConfigs.schemas()` or `orpc.devConfigs.schemas` from `@/lib/orpc`.
     */
    schemas: () => client.devConfigs.schemas(),
    /**
     * Returns the current store-backed value of every registered Configurable,
     * keyed by struct name (matching `ConfigurableSchema.name`). Each value
     * is the full struct as a JSON object. Refresh this after `set` instead
     * of re-fetching schemas.
     * @deprecated Use `client.devConfigs.values()` or `orpc.devConfigs.values` from `@/lib/orpc`.
     */
    values: () =>
      client.devConfigs.values() as Promise<Record<string, JsonValue>>,
    /**
     * Replace a Configurable struct with a whole-struct payload. `value` must
     * be the full struct (every field), not a partial update — Serde validates
     * the whole thing in one pass on the backend.
     * @deprecated Use `client.devConfigs.set()` or `orpc.devConfigs.set` from `@/lib/orpc`.
     */
    set: (structName: string, value: Record<string, unknown>) =>
      client.devConfigs.set({ structName, value: value as JsonValue }),
  },
  models: {
    /** @deprecated Use `client.models.getCached()` or `orpc.models.getCached` from `@/lib/orpc`. */
    getCached: (provider: string) => client.models.getCached({ provider }),
    /** @deprecated Use `client.models.setCached()` or `orpc.models.setCached` from `@/lib/orpc`. */
    setCached: (provider: string, models: string[]) =>
      client.models.setCached({ provider, models }),
    /** @deprecated Use `client.models.clearCached()` or `orpc.models.clearCached` from `@/lib/orpc`. */
    clearCached: (provider: string) => client.models.clearCached({ provider }),
  },

  cli: {
    /** @deprecated Use `client.cli.checkTools()` or `orpc.cli.checkTools` from `@/lib/orpc`. */
    checkTools: () => client.cli.checkTools(),
    /** @deprecated Use `client.cli.listModels()` or `orpc.cli.listModels` from `@/lib/orpc`. */
    listModels: (tool: string) => client.cli.listModels({ tool }),
  },

  promptHistory: {
    /** @deprecated Use `client.promptHistory.get()` or `orpc.promptHistory.get` from `@/lib/orpc`. */
    get: () => client.promptHistory.get(),
    /** @deprecated Use `client.promptHistory.add()` or `orpc.promptHistory.add` from `@/lib/orpc`. */
    add: (prompt: string) => client.promptHistory.add({ prompt }),
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
    /** @deprecated Use `client.evolveMascot.show()` or `orpc.evolveMascot.show` from `@/lib/orpc`. */
    show: () => client.evolveMascot.show(),
    /** @deprecated Use `client.evolveMascot.hide()` or `orpc.evolveMascot.hide` from `@/lib/orpc`. */
    hide: () => client.evolveMascot.hide(),
  },

  scanner: {
    /** @deprecated Use `client.scanner.getRecommendedPrompt()` or `orpc.scanner.getRecommendedPrompt` from `@/lib/orpc`. */
    getRecommendedPrompt: () => client.scanner.getRecommendedPrompt(),
    /** @deprecated Use `client.scanner.scanDefaults()` or `orpc.scanner.scanDefaults` from `@/lib/orpc`. */
    scanDefaults: () => client.scanner.scanDefaults(),
    /** @deprecated Use `client.scanner.applyDefaults()` or `orpc.scanner.applyDefaults` from `@/lib/orpc`. */
    applyDefaults: (defaults: SystemDefault[]) =>
      client.scanner.applyDefaults({ defaults }),
  },
  permissions: {
    /**
     * Last-known permissions from the backend cell; null = never probed.
     * @deprecated Use `client.permissions.get()` or `orpc.permissions.get` from `@/lib/orpc`.
     */
    get: () => client.permissions.get(),
    /**
     * Probe all macOS permissions; the result arrives via `permissions_changed`.
     * @deprecated Use `client.permissions.refresh()` or `orpc.permissions.refresh` from `@/lib/orpc`.
     */
    refresh: () => client.permissions.refresh(),
    /** @deprecated Use `client.permissions.request()` or `orpc.permissions.request` from `@/lib/orpc`. */
    request: (permissionId: string) =>
      client.permissions.request({ permissionId }),
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
    get: () => client.history.get({ limit: null, offset: null }),
    /** @deprecated Use `client.history.generateFrom()` or `orpc.history.generateFrom` from `@/lib/orpc`. */
    generateFrom: (commitHash: string, number: number) =>
      client.history.generateFrom({ commitHash, number }),
  },

  editor: {
    /** @deprecated Use `client.editor.readFile()` or `orpc.editor.readFile` from `@/lib/orpc`. */
    readFile: (relPath: string) => client.editor.readFile({ relPath }),
    /** @deprecated Use `client.editor.writeFile()` or `orpc.editor.writeFile` from `@/lib/orpc`. */
    writeFile: (relPath: string, content: string) =>
      client.editor.writeFile({ relPath, content }),
  },

  lsp: {
    /** @deprecated Use `client.lsp.start()` or `orpc.lsp.start` from `@/lib/orpc`. */
    start: () => client.lsp.start(),
    /** @deprecated Use `client.lsp.send()` or `orpc.lsp.send` from `@/lib/orpc`. */
    send: (message: string) => client.lsp.send({ message }),
    /** @deprecated Use `client.lsp.stop()` or `orpc.lsp.stop` from `@/lib/orpc`. */
    stop: () => client.lsp.stop(),
  },

  homebrew: {
    /** Detects whether `brew` is installed. Guided-onboarding path (not yet on oRPC). */
    check: () => invoke<HomebrewCheckResult>("homebrew_check"),
    /** Runs the official Homebrew installer, streaming `homebrew:install:{data,end}` events. */
    installStream: () => invoke<OkResult>("homebrew_install_stream"),
    /** @deprecated Use `client.homebrew.getStateDiff()` or `orpc.homebrew.getStateDiff` from `@/lib/orpc`. */
    getStateDiff: () => client.homebrew.getStateDiff(),
    /** @deprecated Use `client.homebrew.applyDiff()` or `orpc.homebrew.applyDiff` from `@/lib/orpc`. */
    applyDiff: (diff: HomebrewState) => client.homebrew.applyDiff({ diff }),
    /** @deprecated Use `client.homebrew.addItems()` or `orpc.homebrew.addItems` from `@/lib/orpc`. */
    addItems: (items: HomebrewItem[]) => client.homebrew.addItems({ items }),
  },

  launchd: {
    /** @deprecated Use `client.launchd.scanItems()` or `orpc.launchd.scanItems` from `@/lib/orpc`. */
    scanLaunchdItems: () => client.launchd.scanItems(),
    /** @deprecated Use `client.launchd.applyItems()` or `orpc.launchd.applyItems` from `@/lib/orpc`. */
    applyLaunchdItems: (items: LaunchdItem[]) =>
      client.launchd.applyItems({ items }),
  },

  updater: {
    /** @deprecated Use `client.updater.checkUpdate()` or `orpc.updater.checkUpdate` from `@/lib/orpc`. */
    checkUpdate: () => client.updater.checkUpdate(),
    /** @deprecated Use `client.updater.installUpdate()` or `orpc.updater.installUpdate` from `@/lib/orpc`. */
    installUpdate: () => client.updater.installUpdate(),
    /** @deprecated Use `client.updater.installVersion()` or `orpc.updater.installVersion` from `@/lib/orpc`. */
    installVersion: (version: string) =>
      client.updater.installVersion({ version }),
    /** @deprecated Use `client.updater.relaunch()` or `orpc.updater.relaunch` from `@/lib/orpc`. */
    relaunch: () => client.updater.relaunch(),
    /** @deprecated Use `client.updater.clearPinnedVersion()` or `orpc.updater.clearPinnedVersion` from `@/lib/orpc`. */
    clearPinnedVersion: () => client.updater.clearPinnedVersion(),
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
