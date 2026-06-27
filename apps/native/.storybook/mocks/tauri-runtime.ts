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
  maxTokenBudget: 50_000,
  maxBuildAttempts: 3,
  maxOutputTokens: 32768,
  sendDiagnostics: true,
  confirmBuild: false,
  confirmClear: false,
  confirmRollback: false,
  ollamaApiBaseUrl: "http://localhost:11434",
};

const baseGitStatus = () => ({
  files: [],
  branch: "main",
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
  committable: false,
  backupBranch: null,
  rollbackBranch: null,
  rollbackStorePath: null,
  rollbackChangesetId: null,
  step: "begin" as const,
});

const baseSetDirResult = () => ({
  dir: "/Users/demo/.darwin",
  evolveState: baseEvolveState(),
  hosts: [...defaultHosts],
});

const okResult = () => ({ ok: true });

const baseSemanticChangeMap = () => ({ groups: [], singles: [], unsummarizedHashes: [] });

const baseGitState = (gitStatus: unknown, externalBuildDetected = false) => ({
  gitStatus: gitStatus ?? null,
  externalBuildDetected,
});

const baseNixInstallState = () => ({
  installed: true,
  darwinRebuildAvailable: true,
  installing: false,
  installPhase: null,
  prefetching: false,
  lastError: null,
});

const baseRebuildStatus = () => ({
  isRunning: false,
  success: null,
  exitCode: null,
  errorType: null,
  errorMessage: null,
  systemUntouched: null,
});

const basePermissionsState = () => ({
  permissions: defaultPermissions.map((permission) => ({ ...permission })),
  allRequiredGranted: defaultPermissions
    .filter((permission) => permission.required)
    .every((permission) => permission.status === "granted"),
  checkedAt: 0,
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
    ? (event: { payload: T }) => {
      handler(event);
      removeListener(eventName, wrapped as (event: { payload: unknown }) => void);
    }
    : (handler as (event: { payload: unknown }) => void);

  const eventListeners = listeners.get(eventName) ?? new Set();
  eventListeners.add(wrapped as (event: { payload: unknown }) => void);
  listeners.set(eventName, eventListeners);

  return Promise.resolve(() =>
    removeListener(eventName, wrapped as (event: { payload: unknown }) => void),
  );
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

type OrpcHandler = (input: unknown) => unknown | Promise<unknown>;

/** Storybook oRPC procedure mocks keyed by dotted path (e.g. `config.setDir`). */
export const orpcHandlers: Record<string, OrpcHandler> = {
  "config.get": async () => ({
    configDir: "/Users/demo/.darwin",
    hostAttr: defaultHosts[0],
  }),
  "config.getThisHostname": async () => "demo-mac",
  "config.setHostAttr": async () => okResult(),
  "config.setDir": async () => baseSetDirResult(),
  "config.prepareNewDir": async (input) => {
    const dir = (input as { dir?: string } | undefined)?.dir ?? "/Users/demo/.darwin";
    return { dir, changed: true };
  },
  "config.pickDir": async () => baseSetDirResult(),
  "config.pickZip": async () => "/Users/demo/Downloads/nix-darwin.zip",
  "config.importGithub": async () => baseSetDirResult(),
  "config.importZip": async () => baseSetDirResult(),
  "flake.exists": async () => true,
  "flake.existsAt": async () => true,
  "flake.bootstrapDefault": async () => undefined,
  "path.exists": async () => true,
  "path.normalize": async (input) => (input as { input?: string } | undefined)?.input ?? "",
  "github.bootstrapStart": async () => ({
    installUrl: "https://github.com/apps/nixmac/installations/new",
    state: "demo",
    userCode: null,
    verificationUri: null,
    expiresIn: null,
    interval: null,
  }),
  "github.connectStart": async () => ({
    installUrl: "https://github.com/apps/nixmac/installations/new",
    state: "demo",
    userCode: null,
    verificationUri: null,
    expiresIn: null,
    interval: null,
  }),
  "github.status": async () => ({
    connected: false,
    login: null,
    installationId: 0,
  }),
  "github.listRepos": async () => [],
  "github.import": async () => baseSetDirResult(),
  "github.disconnect": async () => undefined,
  "evolveState.get": async () => baseEvolveState(),
  "evolveState.clear": async () => baseEvolveState(),
};

async function handleOrpcInvoke(args?: Record<string, unknown>) {
  const request = args?.request as { path?: string; input?: { json?: unknown } } | undefined;
  const path = request?.path;
  if (!path) {
    return { type: "response", status: 400, body: { json: { message: "missing oRPC path" } } };
  }

  const handler = orpcHandlers[path];
  if (!handler) {
    return { type: "response", status: 404, body: { json: { message: `unmocked oRPC path: ${path}` } } };
  }

  try {
    const json = await handler(request?.input?.json);
    return { type: "response", status: 200, body: { json } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { type: "response", status: 500, body: { json: { message } } };
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
  // The ViewModel hydrates each backend-owned slice on widget mount by invoking
  // its `get_*` command (see src/viewmodel/*). In Storybook there is no Rust
  // backend, so these reads must return the *current store snapshot* — otherwise
  // mounting the widget would clobber the state a story/its controls just
  // applied (or crash on a `null` payload the mirrors don't expect). This
  // mirrors the unidirectional-sync contract: hydrate = read the latest cell.
  const { useViewModel } = await import("@nixmac/state");
  const vm = useViewModel.getState();

  switch (command) {
    case "plugin:event|listen":
      return nextCallbackId++;
    case "plugin:event|unlisten":
    case "plugin:shell|open":
    case "plugin:macos-permissions|check_full_disk_access_permission":
    case "plugin:macos-permissions|request_full_disk_access_permission":
      return true;
    case "plugin:orpc|handle_rpc":
      return handleOrpcInvoke(args);
    case "config_get":
    case "plugin:darwin|read_config":
      return {
        configDir: vm.preferences?.configDir ?? "/Users/demo/.darwin",
        hostAttr: vm.preferences?.hostAttr ?? defaultHosts[0],
      };
    case "get_global_preferences":
      return vm.preferences;
    case "config_pick_dir":
      return baseSetDirResult();
    case "flake_list_hosts":
    case "plugin:darwin|list_hosts":
      return vm.hosts?.length ? [...vm.hosts] : [...defaultHosts];
    // GitState slice (event shape: `{ gitStatus, externalBuildDetected }`).
    case "get_git_state":
      return baseGitState(vm.git, vm.build?.externalBuildDetected ?? false);
    // GitStatus reads used by the explicit on-mount probe + manual refreshes.
    // Return the store value *verbatim* (including null) so the on-mount
    // `getInitialStatus` probe mirrors back exactly what a story applied —
    // a `?? baseGitStatus()` here would flip null → {} after first render and
    // make snapshots race the async mount.
    case "git_status":
    case "git_status_and_cache":
    case "plugin:darwin|git_status":
      return vm.git;
    case "get_evolve_state":
      return vm.evolve ?? baseEvolveState();
    case "get_change_map":
    case "find_change_map":
      return vm.changeMap;
    case "get_permissions":
      return vm.permissions ?? basePermissionsState();
    case "get_nix_install_state":
      return vm.nixInstall ?? baseNixInstallState();
    case "get_rebuild_status":
      return vm.rebuildStatus ?? baseRebuildStatus();
    case "get_prompt_history":
      // Verbatim (default []) so the async mount mirrors back what's there
      // instead of injecting a list that flips the prompt-history UI post-render.
      return [...vm.promptHistory];
    case "get_history":
      return vm.history ?? [];
    case "ui_get_prefs":
      return { ...prefs };
    case "permissions_check_all":
      return basePermissionsState();
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
  once: <T>(eventName: string, handler: (event: { payload: T }) => void) =>
    addListener(eventName, handler, true),
  emit,
};

export const storybookTauriAPI = {
  config: {
    get: async () => ({ configDir: "/Users/demo/.darwin", hostAttr: defaultHosts[0] }),
    setDir: async () => baseSetDirResult(),
    pickDir: async () => baseSetDirResult(),
    setHostAttr: async () => okResult(),
  },
  git: {
    status: async () => baseGitStatus(),
    statusAndCache: async () => {
      const { useViewModel } = await import("@nixmac/state");
      return viewModelActions.getState().git ?? baseGitStatus();
    },
    cached: async () => baseGitStatus(),
    commit: async () => ({ hash: "mock123", evolveState: baseEvolveState() }),
    fileDiffContents: async (_filenames: string[]) => ({}),
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
      changeMap: baseSemanticChangeMap(),
      gitStatus: baseGitStatus(),
      evolveState: baseEvolveState(),
      conversationalResponse: null,
      telemetry: {
        state: "generated" as const,
        iterations: 1,
        buildAttempts: 1,
        totalTokens: 500,
        editsCount: 1,
        thinkingCount: 1,
        toolCallsCount: 3,
        durationMs: 5000,
      },
    }),
    evolveAnswer: async () => okResult(),
    evolveCancel: async () => ({ ok: true, message: "Cancelled" }),
    buildCheck: async () => ({ passed: true, output: "Build check passed" }),
    evolveFromManual: async () => 0,
    applyStreamStart: async () => {
      emit("darwin:apply:end", { ok: true, code: 0 });
      return okResult();
    },
    activateStorePath: async () => okResult(),
    applyStreamCancel: async () => okResult(),
    finalizeApply: async () => ({ gitStatus: baseGitStatus(), evolveState: baseEvolveState() }),
    finalizeRollback: async () => ({ gitStatus: baseGitStatus(), evolveState: baseEvolveState() }),
    rollbackErase: async () => ({
      gitStatus: baseGitStatus(),
      evolveState: baseEvolveState(),
      rollbackStorePath: null,
      rollbackChangesetId: null,
    }),
    prepareRestore: async () => undefined,
    abortRestore: async () => undefined,
    finalizeRestore: async () => baseGitStatus(),
  },
  nix: {
    check: async () => ({ installed: true, version: "2.20.0", darwinRebuildAvailable: true }),
    installStart: async () => {
      emit("nix:install:end", { ok: true, code: 0, darwin_rebuild_available: true });
      return okResult();
    },
    prefetchDarwinRebuild: async () => {
      emit("nix:darwin-rebuild:end", { ok: true });
      return okResult();
    },
  },
  flake: {
    listHosts: async () => [...defaultHosts],
    installedApps: async () => [],
    exists: async () => true,
    existsAt: async () => true,
    bootstrapDefault: async () => undefined,
    finalizeFlakeLock: async () => okResult(),
  },
  path: {
    exists: async () => true,
    normalize: async (input: string) => input,
  },
  summarizedChanges: {
    findChangeMap: async () => {
      const { useViewModel } = await import("@nixmac/state");
      return viewModelActions.getState().changeMap ?? baseSemanticChangeMap();
    },
    summarizeCurrent: async () => baseSemanticChangeMap(),
    generateCommitMessage: async () => {
      const { useUiState } = await import("@nixmac/state");
      return useUiState.getState().commitMessageSuggestion ?? "chore: mock commit message";
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
      return okResult();
    },
  },
  models: {
    getCached: async (provider: string) => cachedModels.get(provider) ?? [],
    setCached: async (provider: string, models: string[]) => {
      cachedModels.set(provider, [...models]);
      return okResult();
    },
    clearCached: async (provider: string) => {
      cachedModels.delete(provider);
      return okResult();
    },
  },
  promptHistory: {
    get: async () => [...promptHistory],
    add: async (prompt: string) => {
      if (prompt) {
        promptHistory.unshift(prompt);
      }
      return okResult();
    },
  },
  previewIndicator: {
    show: async () => {
      previewIndicatorState = { ...previewIndicatorState, visible: true };
      return okResult();
    },
    hide: async () => {
      previewIndicatorState = { ...previewIndicatorState, visible: false };
      return okResult();
    },
    update: async (state: Partial<typeof previewIndicatorState>) => {
      previewIndicatorState = { ...previewIndicatorState, ...state };
      return okResult();
    },
    getState: async () => ({ ...previewIndicatorState }),
  },
  scanner: {
    getRecommendedPrompt: async () => null,
    scanDefaults: async () => ({ defaults: [], totalScanned: 0 }),
    applyDefaults: async () => ({
      ok: true,
      count: 0,
      changeMap: baseSemanticChangeMap(),
      gitStatus: baseGitStatus(),
      evolveState: baseEvolveState(),
    }),
  },
  evolveState: {
    get: async () => {
      // Return the store's current evolve state so init doesn't overwrite story state.
      // Dynamic import avoids circular dep at module-evaluation time; by the time
      // this async method is called the store module is fully initialized.
      const { useViewModel } = await import("@nixmac/state");
      return viewModelActions.getState().evolve ?? baseEvolveState();
    },
    clear: async () => baseEvolveState(),
  },
  cli: {
    checkTools: async () => ({ claude: true, codex: true, opencode: true }),
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
      allRequiredGranted: permissions
        .filter((permission) => permission.required)
        .every((permission) => permission.status === "granted"),
      checkedAt: Date.now(),
    }),
    request: async (permissionId: string) => {
      permissions = permissions.map((permission) =>
        permission.id === permissionId ? { ...permission, status: "granted" } : permission,
      );
      return (
        permissions.find((permission) => permission.id === permissionId) ?? {
          id: permissionId,
          status: "granted",
        }
      );
    },
    allRequiredGranted: async () =>
      permissions
        .filter((permission) => permission.required)
        .every((permission) => permission.status === "granted"),
    checkFullDiskAccess: async () => true,
    requestFullDiskAccess: async () => {
      permissions = permissions.map((permission) =>
        permission.id === "full-disk" ? { ...permission, status: "granted" } : permission,
      );
      return undefined;
    },
  },
  history: {
    get: async () => [],
    generateFrom: async () => undefined,
  },
  homebrew: {
    getStateDiff: async () => ({
      isInstalled: true,
      casks: [],
      brews: [],
      taps: [],
      source: null,
      lastChecked: Date.now(),
    }),
    applyDiff: async () => ({
      ok: true,
      count: 0,
      changeMap: baseSemanticChangeMap(),
      gitStatus: baseGitStatus(),
      evolveState: baseEvolveState(),
    }),
  },
  debug: {
    logBreadcrumb: async () => okResult(),
    markBootStage: async () => okResult(),
    sentryEvent: async () => undefined,
    clearTauriState: async () => undefined,
  },
  updater: {
    checkUpdate: async () => null,
    installUpdate: async () => undefined,
    installVersion: async () => undefined,
    relaunch: async () => undefined,
    clearPinnedVersion: async () => undefined,
  },
};

if (typeof window !== "undefined") {
  const storybookWindow = window as Window & {
    __NIXMAC__?: typeof storybookTauriAPI;
    tauriAPI?: typeof storybookTauriAPI;
    __TAURI_INTERNALS__?: {
      invoke: typeof invoke;
      transformCallback: typeof transformCallback;
    };
  };

  storybookWindow.__NIXMAC__ = storybookTauriAPI;
  storybookWindow.tauriAPI = storybookTauriAPI;
  storybookWindow.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
  };
}
