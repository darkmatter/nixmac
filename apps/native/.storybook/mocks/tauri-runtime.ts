const defaultHosts = ["Demo-MacBook-Pro", "Work-MacBook"];
let nextCallbackId = 1;

const defaultPermissions = [
  {
    id: "desktop",
    name: "Desktop Folder Access",
    description: "Required to manage and sync desktop files and configurations",
    required: true,
    canRequestProgrammatically: true,
    status: "granted",
  },
  {
    id: "documents",
    name: "Documents Folder Access",
    description: "Required to access and manage configuration files stored in Documents",
    required: true,
    canRequestProgrammatically: true,
    status: "granted",
  },
  {
    id: "admin",
    name: "Administrator Privileges",
    description: "Required to install system packages and modify system configurations",
    required: true,
    canRequestProgrammatically: false,
    status: "granted",
    instructions: "You will be prompted for your password when needed",
  },
  {
    id: "full-disk",
    name: "Full Disk Access",
    description: "Recommended for complete system management capabilities",
    required: false,
    canRequestProgrammatically: false,
    status: "granted",
    instructions:
      "First make sure nixmac is in your Applications folder (not running from the install disk image). Then go to System Settings -> Privacy & Security -> Full Disk Access and add nixmac to the list.",
  },
];

const transformCallback = () => nextCallbackId++;

let permissions = defaultPermissions.map((permission) => ({ ...permission }));
let previewIndicatorState = {
  visible: false,
  summary: null,
  filesChanged: 0,
  additions: 0,
  deletions: 0,
  isLoading: false,
};
const promptHistory = ["Install vim", "Configure git signing"];
const cachedModels = new Map<string, string[]>();
const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
const prefs = {
  summaryProvider: "openai",
  summaryModel: "gpt-5-mini",
  evolveProvider: "openai",
  evolveModel: "gpt-5",
  maxIterations: 25,
  maxBuildAttempts: 3,
  sendDiagnostics: true,
  confirmBuild: false,
  confirmClear: false,
  confirmRollback: false,
  ollamaApiBaseUrl: "http://localhost:11434",
};

const baseGitStatus = () => ({
  files: [],
  branch: "main",
  branchCommitMessages: [],
  isMainBranch: true,
  branchHasBuiltCommit: false,
  diff: "",
  additions: 0,
  deletions: 0,
  headCommitHash: null,
  cleanHead: true,
  changes: [],
});

const baseEvolveState = () => ({
  evolutionId: null,
  currentChangesetId: null,
  changesetAtBuild: null,
  committable: false,
  backupBranch: null,
  step: "begin" as const,
});

const summaryResponse = {
  items: [],
  instructions: "",
  commitMessage: "",
  diff: "",
};

function emit(eventName: string, payload: unknown) {
  const eventListeners = listeners.get(eventName);
  if (!eventListeners) {
    return;
  }

  for (const listener of eventListeners) {
    listener({ payload });
  }
}

function addListener<T>(eventName: string, handler: (event: { payload: T }) => void, once = false) {
  const wrapped = once
    ? ((event: { payload: T }) => {
        handler(event);
        removeListener(eventName, wrapped as (event: { payload: unknown }) => void);
      })
    : (handler as (event: { payload: unknown }) => void);

  const eventListeners = listeners.get(eventName) ?? new Set();
  eventListeners.add(wrapped as (event: { payload: unknown }) => void);
  listeners.set(eventName, eventListeners);

  return Promise.resolve(() => removeListener(eventName, wrapped as (event: { payload: unknown }) => void));
}

function removeListener(eventName: string, handler: (event: { payload: unknown }) => void) {
  const eventListeners = listeners.get(eventName);
  if (!eventListeners) {
    return;
  }

  eventListeners.delete(handler);
  if (eventListeners.size === 0) {
    listeners.delete(eventName);
  }
}

const mockNixFiles: Record<string, string> = {
  "flake.nix": `{
  description = "My nix-darwin configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    darwin.url = "github:LnL7/nix-darwin/master";
    darwin.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, darwin }: {
    darwinConfigurations."Demo-MacBook-Pro" = darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      modules = [ ./configuration.nix ];
    };
  };
}`,
  "configuration.nix": `{ config, pkgs, ... }:

{
  environment.systemPackages = with pkgs; [
    vim
    git
    ripgrep
    fd
    jq
  ];

  services.nix-daemon.enable = true;
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  system.stateVersion = 5;
}`,
};

function mockEditorReadFile(relPath: string): string {
  return mockNixFiles[relPath] ?? `# ${relPath}\n# File not found in mock data\n`;
}

function mockEditorListFiles() {
  return [
    { path: "flake.nix", name: "flake.nix", isDir: false },
    { path: "flake.lock", name: "flake.lock", isDir: false },
    { path: "configuration.nix", name: "configuration.nix", isDir: false },
    { path: "modules", name: "modules", isDir: true },
    { path: "modules/homebrew.nix", name: "homebrew.nix", isDir: false },
    { path: "modules/shell.nix", name: "shell.nix", isDir: false },
  ];
}

export async function invoke(command: string, args?: Record<string, unknown>) {
  switch (command) {
    case "plugin:event|listen":
      return nextCallbackId++;
    case "plugin:event|unlisten":
    case "plugin:shell|open":
    case "plugin:macos-permissions|check_full_disk_access_permission":
    case "plugin:macos-permissions|request_full_disk_access_permission":
      return true;
    case "config_get":
    case "plugin:darwin|read_config":
      return { configDir: "/Users/demo/.darwin", hostAttr: defaultHosts[0] };
    case "config_pick_dir":
      return "/Users/demo/.darwin";
    case "flake_list_hosts":
    case "plugin:darwin|list_hosts":
      return [...defaultHosts];
    case "git_status":
    case "git_status_and_cache":
    case "plugin:darwin|git_status":
      return baseGitStatus();
    case "ui_get_prefs":
      return { ...prefs };
    case "permissions_check_all":
      return {
        permissions: permissions.map((permission) => ({ ...permission })),
        allRequiredGranted: permissions.filter((permission) => permission.required).every((permission) => permission.status === "granted"),
        checkedAt: Date.now(),
      };
    case "preview_indicator_get_state":
      return { ...previewIndicatorState };
    case "editor_read_file":
      return mockEditorReadFile(args?.relPath as string);
    case "editor_write_file":
      return null;
    case "editor_list_files":
      return mockEditorListFiles();
    case "lsp_start":
    case "lsp_send":
    case "lsp_stop":
      return null;
    default:
      return null;
  }
}

export const tauriEvent = {
  listen: addListener,
  once: <T>(eventName: string, handler: (event: { payload: T }) => void) => addListener(eventName, handler, true),
  emit,
};

export const storybookDarwinAPI = {
  config: {
    get: async () => ({ configDir: "/Users/demo/.darwin", hostAttr: defaultHosts[0] }),
    setDir: async () => undefined,
    pickDir: async () => "/Users/demo/.darwin",
    setHostAttr: async () => undefined,
  },
  git: {
    initIfNeeded: async () => undefined,
    status: async () => baseGitStatus(),
    statusAndCache: async () => {
      const { useWidgetStore } = await import("../../src/stores/widget-store");
      return useWidgetStore.getState().gitStatus ?? baseGitStatus();
    },
    cached: async () => baseGitStatus(),
    commit: async () => ({ hash: "mock123", evolveState: baseEvolveState() }),
    stash: async () => undefined,
    stageAll: async () => undefined,
    unstageAll: async () => undefined,
    restoreAll: async () => undefined,
    checkoutNewBranch: async (branchName: string) => ({ ok: true, branch: branchName }),
    checkoutBranch: async () => undefined,
    checkoutMainBranch: async () => undefined,
    mergeBranch: async () => undefined,
  },
  darwin: {
    evolve: async () => ({
      changeMap: { groups: [], singles: [], unsummarizedHashes: [] },
      gitStatus: baseGitStatus(),
      evolveState: baseEvolveState(),
      conversationalResponse: null,
      telemetry: { state: "generated" as const, iterations: 1, buildAttempts: 1, totalTokens: 500, editsCount: 1, thinkingCount: 1, toolCallsCount: 3, durationMs: 5000 },
    }),
    evolveAnswer: async () => undefined,
    evolveCancel: async () => undefined,
    buildCheck: async () => ({ passed: true, output: "Build check passed" }),
    evolveFromManual: async () => 0,
    apply: async () => undefined,
    applyStreamStart: async () => {
      emit("darwin:apply:end", { ok: true, code: 0 });
      return undefined;
    },
    applyStreamCancel: async () => undefined,
    finalizeApply: async () => ({ gitStatus: baseGitStatus(), evolveState: baseEvolveState() }),
    rollbackErase: async () => ({ gitStatus: baseGitStatus(), evolveState: baseEvolveState() }),
    prepareRestore: async () => undefined,
    abortRestore: async () => undefined,
    finalizeRestore: async () => baseGitStatus(),
  },
  nix: {
    check: async () => ({ installed: true, version: "2.20.0", darwin_rebuild_available: true }),
    installStart: async () => {
      emit("nix:install:end", { ok: true, code: 0, darwin_rebuild_available: true });
      return undefined;
    },
    prefetchDarwinRebuild: async () => {
      emit("nix:darwin-rebuild:end", { ok: true });
      return undefined;
    },
  },
  flake: {
    listHosts: async () => [...defaultHosts],
    installedApps: async () => [],
    exists: async () => true,
    existsAt: async () => true,
    bootstrapDefault: async () => undefined,
    finalizeFlakeLock: async () => undefined,
  },
  path: {
    exists: async () => true,
    normalize: async (input: string) => input,
  },
  summarizedChanges: {
    findChangeMap: async () => {
      const { useWidgetStore } = await import("../../src/stores/widget-store");
      return useWidgetStore.getState().changeMap ?? { groups: [], singles: [], unsummarizedHashes: [] };
    },
    summarizeCurrent: async () => undefined,
    generateCommitMessage: async () => {
      const { useWidgetStore } = await import("../../src/stores/widget-store");
      return useWidgetStore.getState().commitMessageSuggestion ?? "chore: mock commit message";
    },
  },
  summary: {
    find: async () => null,
    generate: async () => ({ ...summaryResponse }),
  },
  feedback: {
    gatherMetadata: async () => ({}),
    submit: async () => true,
  },
  ui: {
    getPrefs: async () => ({ ...prefs }),
    setPrefs: async (nextPrefs: Record<string, unknown>) => {
      Object.assign(prefs, nextPrefs);
    },
  },
  models: {
    getCached: async (provider: string) => cachedModels.get(provider) ?? [],
    setCached: async (provider: string, models: string[]) => {
      cachedModels.set(provider, [...models]);
    },
    clearCached: async (provider: string) => {
      cachedModels.delete(provider);
    },
  },
  promptHistory: {
    get: async () => [...promptHistory],
    add: async (prompt: string) => {
      if (prompt) {
        promptHistory.unshift(prompt);
      }
    },
  },
  previewIndicator: {
    show: async () => {
      previewIndicatorState = { ...previewIndicatorState, visible: true };
    },
    hide: async () => {
      previewIndicatorState = { ...previewIndicatorState, visible: false };
    },
    update: async (state: Partial<typeof previewIndicatorState>) => {
      previewIndicatorState = { ...previewIndicatorState, ...state };
    },
    getState: async () => ({ ...previewIndicatorState }),
  },
  scanner: {
    getRecommendedPrompt: async () => null,
    scanDefaults: async () => ({ defaults: [], totalScanned: 0 }),
    applyDefaults: async () => ({ ok: true, count: 0, changeMap: { groups: [], singles: [], unsummarizedHashes: [] }, gitStatus: baseGitStatus(), evolveState: baseEvolveState() }),
  },
  evolveState: {
    get: async () => {
      // Return the store's current evolveState so init doesn't overwrite story state.
      // Dynamic import avoids circular dep at module-evaluation time; by the time
      // this async method is called the store module is fully initialized.
      const { useWidgetStore } = await import("../../src/stores/widget-store");
      return useWidgetStore.getState().evolveState ?? baseEvolveState();
    },
    clear: async () => baseEvolveState(),
  },
  cli: {
    checkTools: async () => ({}),
    listModels: async () => [],
  },
  editor: {
    readFile: async (relPath: string) => mockEditorReadFile(relPath),
    writeFile: async () => undefined,
    listFiles: async () => mockEditorListFiles(),
  },
  lsp: {
    start: async () => undefined,
    send: async () => undefined,
    stop: async () => undefined,
  },
  permissions: {
    checkAll: async () => ({
      permissions: permissions.map((permission) => ({ ...permission })),
      allRequiredGranted: permissions.filter((permission) => permission.required).every((permission) => permission.status === "granted"),
      checkedAt: Date.now(),
    }),
    request: async (permissionId: string) => {
      permissions = permissions.map((permission) =>
        permission.id === permissionId ? { ...permission, status: "granted" } : permission,
      );
      return permissions.find((permission) => permission.id === permissionId) ?? { id: permissionId, status: "granted" };
    },
    allRequiredGranted: async () => permissions.filter((permission) => permission.required).every((permission) => permission.status === "granted"),
    checkFullDiskAccess: async () => true,
    requestFullDiskAccess: async () => {
      permissions = permissions.map((permission) =>
        permission.id === "full-disk" ? { ...permission, status: "granted" } : permission,
      );
    },
  },
  history: {
    get: async () => [],
    generateFrom: async () => undefined,
  },
};

if (typeof window !== "undefined") {
  const storybookWindow = window as Window & {
    __NIXMAC__?: typeof storybookDarwinAPI;
    darwinAPI?: typeof storybookDarwinAPI;
    __TAURI_INTERNALS__?: {
      invoke: typeof invoke;
      transformCallback: typeof transformCallback;
    };
  };

  storybookWindow.__NIXMAC__ = storybookDarwinAPI;
  storybookWindow.darwinAPI = storybookDarwinAPI;
  storybookWindow.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
  };
}

