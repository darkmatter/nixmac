// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import { orpcHandlers } from "#storybook/mocks/tauri-runtime";
import preview from "#storybook/preview";
import { OnboardingFlow } from "@/components/widget/onboarding/onboarding-flow";
import { tauriAPI } from "@/ipc/api";
import { onboardingActions, viewModelActions } from "@nixmac/state";
import type React from "react";
import { useEffect, useRef } from "react";

/**
 * Interactive, fully-mocked onboarding stories. Each story is a clickable
 * entry point into the real OnboardingFlow: a story-scoped backend patches the
 * (Storybook) tauriAPI singleton so every action drives the real ViewModel /
 * onboarding stores, letting you walk the whole flow end-to-end without a
 * Tauri backend.
 *
 * - Permissions → click each "Request" / "Open Settings" to grant.
 * - System Setup → "Check again" detects Nix on the 2nd probe.
 * - Config Directory → GitHub / local / flake-ref / "Start from scratch" all work;
 *   they populate a config dir.
 * - Choose Machine → pick the host that matches this Mac.
 * - Import Customizations → "Scan this Mac" returns mocked defaults/casks/taps.
 * - AI Inference → BYOK (saves a key) or hosted (sign in + mock subscription checkout).
 * - First Build → "Run build" streams a mocked log to success → celebration.
 */

const meta = preview.meta({
  title: "Widget/Onboarding/OnboardingFlow",
  component: OnboardingFlow,
  parameters: { layout: "centered" },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="dark relative min-h-[600px] min-w-[800px] overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <Story />
      </div>
    ),
  ],
});

export default meta;

const SAMPLE_HOSTS = ["macbook-pro", "mac-studio"];
const STEP_ORDER = ["permissions", "nix-setup", "config-dir", "setup", "customizations", "inference", "build"];

const PERMISSION_DEFS = [
  {
    id: "desktop",
    name: "Desktop Folder Access",
    description: "Lets nixmac read configs you keep on your Desktop.",
    required: true,
    canRequestProgrammatically: true,
    instructions: null,
  },
  {
    id: "documents",
    name: "Documents Folder Access",
    description: "Most flakes live in Documents — we need to read them.",
    required: true,
    canRequestProgrammatically: true,
    instructions: null,
  },
  {
    id: "admin",
    name: "Administrator Privileges",
    description: "Required to apply system changes with darwin-rebuild.",
    required: true,
    canRequestProgrammatically: false,
    instructions: "You'll be prompted for your password when a change needs it.",
  },
  {
    id: "full-disk",
    name: "Full Disk Access",
    description: "Required for darwin-rebuild to apply system changes.",
    required: true,
    canRequestProgrammatically: false,
    instructions: "System Settings → Privacy & Security → Full Disk Access",
  },
  {
    id: "app-management",
    name: "App Management",
    description: "Recommended so darwin-rebuild can update apps it manages.",
    required: false,
    canRequestProgrammatically: false,
    instructions: "System Settings → Privacy & Security → App Management",
  },
];

const MOCK_DEFAULTS = {
  totalScanned: 57,
  defaults: [
    {
      nixKey: "system.defaults.dock.expose-group-apps",
      label: "Group windows by application",
      category: "Dock",
      currentValue: "true",
      defaultValue: "false",
    },
    {
      nixKey: "system.defaults.WindowManager.HideDesktop",
      label: "Hide desktop items in Stage Manager",
      category: "Window Manager",
      currentValue: "true",
      defaultValue: "false",
    },
    {
      nixKey: "system.defaults.NSGlobalDomain.AppleShowAllExtensions",
      label: "Show all file extensions",
      category: "Finder",
      currentValue: "true",
      defaultValue: "false",
    },
  ],
};

const MOCK_HOMEBREW = {
  isInstalled: true,
  casks: ["raycast", "ghostty", "arc", "orbstack"],
  brews: [],
  taps: ["charmbracelet/tap", "withgraphite/tap"],
  source: "brew",
  lastChecked: 0,
};

const MOCK_LAUNCHD = [
  {
    label: "com.example.redis",
    scope: "LaunchAgent",
    name: "redis",
    programArguments: ["/opt/homebrew/bin/redis-server"],
    runAtLoad: true,
    keepAlive: true,
    environmentVariables: {},
    standardOutPath: null,
    standardErrorPath: null,
    workingDirectory: null,
  },
];

const MOCK_GITHUB_REPOS = [
  {
    owner: "you",
    name: "nix-darwin-config",
    private: true,
    updatedAt: "2026-06-19T10:00:00Z",
    defaultBranch: "main",
    hasFlake: true,
  },
  {
    owner: "you",
    name: "dotfiles",
    private: false,
    updatedAt: "2026-05-30T10:00:00Z",
    defaultBranch: "main",
    hasFlake: true,
  },
  {
    owner: "you",
    name: "personal-site",
    private: false,
    updatedAt: "2026-01-15T10:00:00Z",
    defaultBranch: "main",
    hasFlake: false,
  },
];

const BUILD_LINES = [
  "building the system configuration...",
  "evaluating flake...",
  "these 14 derivations will be built:",
  "  /nix/store/…-darwin-system-25.05.drv",
  "copying 132 paths from 'https://cache.nixos.org'...",
  "activating system configuration...",
  "setting up launchd services...",
  "✓ switched to configuration 'macbook-pro'.",
];

/**
 * Patches the Storybook tauriAPI singleton so onboarding actions drive the
 * real ViewModel/onboarding stores. Returns a restore fn to undo the patches
 * (so other stories in the snapshot runner aren't affected).
 */
function installBackend(startAt: string) {
  const startIdx = Math.max(0, STEP_ORDER.indexOf(startAt));
  const state = {
    permStatus: Object.fromEntries(
      PERMISSION_DEFS.map((p) => [p.id, startIdx >= 1 ? "granted" : "pending"]),
    ) as Record<string, string>,
    nix: startIdx >= 2 ? { installed: true, darwin: true } : { installed: null, darwin: null },
    nixProbes: 0,
    configDir: startIdx >= 3 ? "/Users/demo/.darwin" : "",
    hosts: startIdx >= 3 ? SAMPLE_HOSTS : [],
    hostAttr: startIdx >= 4 ? SAMPLE_HOSTS[0] : "",
    flakeExists: startIdx >= 3,
    macScannedAt: (startIdx >= 5 ? 1_700_000_000 : null) as number | null,
    evolveProvider: (startIdx >= 6 ? "openrouter" : null) as string | null,
    evolveModel: (startIdx >= 6 ? "anthropic/claude-sonnet-4" : null) as string | null,
    loginDecided: startIdx >= 6,
    lastBuildAt: null as number | null,
    githubConnected: false,
  };

  function permissionsState() {
    const permissions = PERMISSION_DEFS.map((p) => ({ ...p, status: state.permStatus[p.id] }));
    return {
      permissions,
      allRequiredGranted: permissions
        .filter((p) => p.required)
        .every((p) => p.status === "granted"),
      lastChecked: 0,
    };
  }

  function syncVM() {
    viewModelActions.setState({
      permissions: permissionsState(),
      permissionsHydrated: true,
      nixInstall: {
        installed: state.nix.installed,
        darwinRebuildAvailable: state.nix.darwin,
        installing: false,
      },
      preferences: {
        configDir: state.configDir || null,
        hostAttr: state.hostAttr || null,
        repoRoot: null,
        sendDiagnostics: false,
        evolveProvider: state.evolveProvider,
        evolveModel: state.evolveModel,
        summaryProvider: null,
        summaryModel: null,
        ollamaApiBaseUrl: null,
        openaiCompatibleApiBaseUrl: null,
        confirmBuild: true,
        confirmClear: true,
        confirmRollback: true,
        autoSummarizeOnFocus: false,
        scanHomebrewOnStartup: false,
        defaultToDiffTab: false,
        experimentalSpinningMascot: false,
        developerMode: false,
        pinnedVersion: null,
        updateChannel: "stable",
        onboardingMacScannedAt: state.macScannedAt,
        onboardingLoginDecided: state.loginDecided,
        onboardingLastBuildAt: state.lastBuildAt,
      },
      hosts: state.hosts,
      git: { headCommitHash: "abc1234", files: [], changes: [] } as any,
    });
  }

  // Seed the stores for the entry point.
  syncVM();
  onboardingActions.setState({
    trackedCustomizations: [],
    trackedCustomizationSources: {},
    inferenceDeferred: false,
    celebrating: false,
    viewingStep: null,
  });

  // ---- Patch tauriAPI methods, remembering originals for restore ----
  const saved: Array<[Record<string, any>, string, unknown]> = [];
  const ensure = (key: string) => {
    if (!(tauriAPI as any)[key]) {
      saved.push([tauriAPI as any, key, (tauriAPI as any)[key]]);
      (tauriAPI as any)[key] = {};
    }
    return (tauriAPI as any)[key];
  };
  const patch = (obj: Record<string, any>, key: string, fn: unknown) => {
    saved.push([obj, key, obj[key]]);
    obj[key] = fn;
  };
  const patchOrpc = (path: string, fn: (input: unknown) => unknown | Promise<unknown>) => {
    saved.push([orpcHandlers, path, orpcHandlers[path]]);
    orpcHandlers[path] = fn;
  };

  const setConfigWithHosts = (dir: string) => {
    state.configDir = dir;
    state.hosts = SAMPLE_HOSTS;
    state.flakeExists = true;
    syncVM();
    return { dir, changed: true };
  };

  // permissions
  patch(tauriAPI.permissions, "refresh", async () => {
    syncVM();
  });
  patch(tauriAPI.permissions, "get", async () => permissionsState());
  patch(tauriAPI.permissions, "request", async (id: string) => {
    state.permStatus[id] = "granted";
    syncVM();
    return { ...PERMISSION_DEFS.find((p) => p.id === id), status: "granted" };
  });
  patch(tauriAPI.permissions, "requestFullDiskAccess", async () => {
    state.permStatus["full-disk"] = "granted";
    syncVM();
  });
  patch(
    tauriAPI.permissions,
    "checkFullDiskAccess",
    async () => state.permStatus["full-disk"] === "granted",
  );

  // nix — first probe reports missing, subsequent probes report ready.
  patch(tauriAPI.nix, "check", async () => {
    state.nixProbes += 1;
    state.nix =
      state.nixProbes >= 2
        ? { installed: true, darwin: true }
        : { installed: false, darwin: false };
    syncVM();
    return {
      installed: state.nix.installed,
      version: "2.20.0",
      darwinRebuildAvailable: state.nix.darwin,
    };
  });
  patch(tauriAPI.nix, "installState", async () => ({
    installed: state.nix.installed,
    darwinRebuildAvailable: state.nix.darwin,
    installing: false,
  }));

  // config / flake — importing or picking a dir populates hosts; bootstrap + set-host finishes.
  ensure("config");
  patch(tauriAPI.config, "getThisHostname", async () => "demo-mac");
  patchOrpc("config.getThisHostname", async () => "demo-mac");
  patch(tauriAPI.config, "pickDir", async () =>
    setConfigWithHosts("/Users/demo/Documents/nix-darwin"),
  );
  patchOrpc("config.pickDir", async () => setConfigWithHosts("/Users/demo/Documents/nix-darwin"));
  patch(tauriAPI.config, "setDir", async (dir: string) => setConfigWithHosts(dir));
  patchOrpc("config.setDir", async (input) =>
    setConfigWithHosts((input as { dir: string }).dir),
  );
  patch(tauriAPI.config, "prepareNewDir", async (dir: string) => {
    state.configDir = dir;
    state.hosts = [];
    state.flakeExists = false;
    syncVM();
    return { dir, changed: true };
  });
  patchOrpc("config.prepareNewDir", async (input) => {
    const dir = (input as { dir: string }).dir;
    state.configDir = dir;
    state.hosts = [];
    state.flakeExists = false;
    syncVM();
    return { dir, changed: true };
  });
  patch(tauriAPI.config, "importGithub", async () => setConfigWithHosts("/Users/demo/.darwin"));
  patchOrpc("config.importGithub", async () => setConfigWithHosts("/Users/demo/.darwin"));
  patch(tauriAPI.config, "importZip", async () => setConfigWithHosts("/Users/demo/.darwin"));
  patchOrpc("config.importZip", async () => setConfigWithHosts("/Users/demo/.darwin"));
  patch(tauriAPI.config, "pickZip", async () => "/Users/demo/Downloads/nix-darwin.zip");
  patchOrpc("config.pickZip", async () => "/Users/demo/Downloads/nix-darwin.zip");
  patch(tauriAPI.config, "setHostAttr", async (host: string) => {
    state.hostAttr = host;
    syncVM();
    return { ok: true };
  });
  patchOrpc("config.setHostAttr", async (input) => {
    state.hostAttr = (input as { host: string }).host;
    syncVM();
    return { ok: true };
  });

  ensure("flake");
  patch(tauriAPI.flake, "listHosts", async () => state.hosts);
  patch(tauriAPI.flake, "exists", async () => state.flakeExists);
  patch(tauriAPI.flake, "existsAt", async () => state.flakeExists);
  patchOrpc("flake.exists", async () => state.flakeExists);
  patchOrpc("flake.existsAt", async () => state.flakeExists);
  patch(tauriAPI.flake, "bootstrapDefault", async (hostname: string) => {
    state.hosts = [hostname || "demo-mac"];
    state.flakeExists = true;
    syncVM();
  });
  patchOrpc("flake.bootstrapDefault", async (input) => {
    const hostname = (input as { hostname?: string }).hostname || "demo-mac";
    state.hosts = [hostname];
    state.flakeExists = true;
    syncVM();
  });
  patchOrpc("path.normalize", async (input) => {
    const value = (input as { input: string }).input;
    return value.startsWith("~/") ? `/Users/demo/${value.slice(2)}` : value;
  });
  patchOrpc("path.exists", async () => true);

  // GitHub App connection — connectStart simulates the user finishing the
  // browser install, so the poll then sees `connected`.
  ensure("github");
  patch(tauriAPI.github, "connectStart", async () => {
    state.githubConnected = true;
    return { installUrl: "https://github.com/apps/nixmac/installations/new", state: "demo" };
  });
  patchOrpc("github.connectStart", async () => {
    state.githubConnected = true;
    return {
      installUrl: "https://github.com/apps/nixmac/installations/new",
      state: "demo",
      userCode: null,
      verificationUri: null,
      expiresIn: null,
      interval: null,
    };
  });
  patch(tauriAPI.github, "status", async () => ({
    connected: state.githubConnected,
    login: state.githubConnected ? "you" : null,
    installationId: state.githubConnected ? 1 : null,
  }));
  patchOrpc("github.status", async () => ({
    connected: state.githubConnected,
    login: state.githubConnected ? "you" : null,
    installationId: state.githubConnected ? 1 : null,
  }));
  patch(tauriAPI.github, "listRepos", async () => MOCK_GITHUB_REPOS);
  patchOrpc("github.listRepos", async () => MOCK_GITHUB_REPOS);
  patch(tauriAPI.github, "import", async () => setConfigWithHosts("/Users/demo/.darwin"));
  patchOrpc("github.import", async () => setConfigWithHosts("/Users/demo/.darwin"));
  patch(tauriAPI.github, "disconnect", async () => {
    state.githubConnected = false;
  });

  ensure("path");
  patch(tauriAPI.path, "normalize", async (input: string) =>
    input.startsWith("~/") ? `/Users/demo/${input.slice(2)}` : input,
  );
  patch(tauriAPI.path, "exists", async () => true);

  // customizations scanners
  ensure("scanner");
  patch(tauriAPI.scanner, "scanDefaults", async () => MOCK_DEFAULTS);
  ensure("homebrew");
  patch(tauriAPI.homebrew, "getStateDiff", async () => MOCK_HOMEBREW);
  ensure("launchd");
  patch(tauriAPI.launchd, "scanLaunchdItems", async () => MOCK_LAUNCHD);

  // inference
  ensure("account");
  patch(tauriAPI.account, "sendOtp", async () => undefined);
  patch(tauriAPI.account, "verifyOtp", async (email: string) => ({
    signedIn: true,
    account: { id: "demo-account", email },
    keyId: null,
    serverUrl: "https://sync.nixmac.app",
    githubReady: true,
    webAccount: { id: "demo-account", email },
  }));
  ensure("ui");
  patch(tauriAPI.ui, "setPrefs", async (update: Record<string, unknown>) => {
    if (typeof update.onboardingMacScannedAt === "number") {
      state.macScannedAt = update.onboardingMacScannedAt;
    }
    if (update.onboardingLoginDecided === true) state.loginDecided = true;
    if (typeof update.evolveProvider === "string") state.evolveProvider = update.evolveProvider;
    if (typeof update.evolveModel === "string") state.evolveModel = update.evolveModel;
    syncVM();
    return { ok: true };
  });
  patch(tauriAPI.ui, "getPrefs", async () => ({}));

  // first build — stream a mocked log to success.
  const timers: ReturnType<typeof setTimeout>[] = [];
  ensure("darwin");
  patch(tauriAPI.darwin, "applyStreamStart", async () => {
    viewModelActions.setState({
      rebuildStatus: { isRunning: true, success: null, exitCode: null } as any,
      rebuildLog: { lines: [], rawLines: [], notices: [] },
    });
    BUILD_LINES.forEach((line, i) => {
      timers.push(
        setTimeout(
          () => {
            viewModelActions.setState((s: any) => ({
              rebuildLog: { ...s.rebuildLog, rawLines: [...s.rebuildLog.rawLines, line] },
            }));
            if (i === BUILD_LINES.length - 1) {
              viewModelActions.setState({
                rebuildStatus: { isRunning: false, success: true, exitCode: 0 } as any,
              });
            }
          },
          300 + i * 320,
        ),
      );
    });
    return { ok: true };
  });
  patch(tauriAPI.darwin, "finalizeApply", async () => {
    state.lastBuildAt = 1_700_000_100;
    syncVM();
    return {};
  });
  patch(tauriAPI.darwin, "rebuildStatus", async () => viewModelActions.getState().rebuildStatus);

  return () => {
    timers.forEach(clearTimeout);
    for (const [obj, key, value] of saved) obj[key] = value;
  };
}

function OnboardingHarness({ startAt = "permissions" }: { startAt?: string }) {
  // Patch synchronously on first render so child mount effects (e.g. the
  // permissions probe) hit the mocked backend, then restore on unmount.
  const restoreRef = useRef<(() => void) | null>(null);
  if (restoreRef.current === null) {
    restoreRef.current = installBackend(startAt);
  }
  useEffect(() => {
    return () => {
      restoreRef.current?.();
      restoreRef.current = null;
    };
  }, []);

  return <OnboardingFlow />;
}

/** Full clickable flow from the very first step. */
export const Playground = meta.story({
  render: () => <OnboardingHarness startAt="permissions" />,
});

export const Permissions = meta.story({
  render: () => <OnboardingHarness startAt="permissions" />,
});

export const NixSetup = meta.story({
  render: () => <OnboardingHarness startAt="nix-setup" />,
});

export const ConfigDirectory = meta.story({
  render: () => <OnboardingHarness startAt="config-dir" />,
});

export const Customizations = meta.story({
  render: () => <OnboardingHarness startAt="customizations" />,
});

export const Inference = meta.story({
  render: () => <OnboardingHarness startAt="inference" />,
});

export const FirstBuild = meta.story({
  render: () => <OnboardingHarness startAt="build" />,
});
