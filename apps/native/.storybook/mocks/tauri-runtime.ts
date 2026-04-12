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
  headIsBuilt: false,
  isMainBranch: true,
  branchHasBuiltCommit: false,
  diff: "",
  additions: 0,
  deletions: 0,
  headCommitHash: null,
  cleanHead: true,
  changes: [],
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
    statusAndCache: async () => baseGitStatus(),
    cached: async () => baseGitStatus(),
    commit: async () => undefined,
    stash: async () => undefined,
    stageAll: async () => undefined,
    unstageAll: async () => undefined,
    restoreAll: async () => undefined,
    checkoutNewBranch: async (branchName: string) => ({ ok: true, branch: branchName }),
    checkoutBranch: async () => undefined,
    checkoutMainBranch: async () => undefined,
    tagAsBuilt: async () => undefined,
    mergeBranch: async () => undefined,
  },
  darwin: {
    evolve: async () => ({ gitStatus: baseGitStatus(), summary: { ...summaryResponse } }),
    evolveCancel: async () => undefined,
    apply: async () => undefined,
    applyStreamStart: async () => {
      emit("darwin:apply:end", { ok: true, code: 0 });
      return undefined;
    },
    applyStreamCancel: async () => undefined,
    finalizeApply: async () => ({ gitStatus: baseGitStatus(), summary: { ...summaryResponse } }),
    rollbackErase: async () => ({ gitStatus: baseGitStatus(), summary: null }),
    restoreToCommit: async () => undefined,
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
    bootstrapDefault: async () => undefined,
    finalizeFlakeLock: async () => undefined,
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
    scanDefaults: async () => ({ defaults: [], totalScanned: 0 }),
    applyDefaults: async () => ({ ok: true, count: 0, summary: { ...summaryResponse }, gitStatus: baseGitStatus() }),
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
