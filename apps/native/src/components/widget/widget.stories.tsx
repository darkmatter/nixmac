// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import type {
  EvolveEvent,
  EvolveState,
  GitStatus,
  PermissionsState,
  SemanticChangeMap,
} from "@/ipc/types";
import { uiActions, useUiState, viewModelActions } from "@nixmac/state";
import { useViewModel } from "@nixmac/state";
import {
  makeGlobalPreferences,
  makeGrantedPermissions,
  makeNixInstallState,
  makeRebuildStatus,
} from "@/utils/test-fixtures";
import type { Decorator } from "@storybook/react-vite";
import type React from "react";
// NOTE: these are Storybook's preview hooks, NOT React's. Mixing `useArgs`
// with React hooks in the same story/decorator throws "preview hooks can only
// be called inside decorators and story functions".
import { useArgs, useEffect } from "storybook/preview-api";
import { DarwinWidget } from "./widget";
import { RouterProvider, nav, router } from "@/router";

// =============================================================================
// Fixtures
//
// DarwinWidget takes no props — all of its state lives in the `useUiState`
// (transient UI) and `useViewModel` (backend mirror) Zustand stores, and the
// rendered "step" is *derived* from them by `computeCurrentStep`. So the
// controls below map to those store fields, and the rendered widget is a pure
// function of them. See `applyArgsToStores` / `computeArgsView` for the
// two-way binding.
// =============================================================================

const DEMO_HOSTS = ["Demo-MacBook-Pro", "Work-MacBook"];

/** Build a full `EvolveState`; the `step` field is what drives evolve routing. */
function makeEvolveState(overrides: Partial<EvolveState> = {}): EvolveState {
  return {
    evolutionId: null,
    currentChangesetId: null,
    committable: false,
    backupBranch: null,
    rollbackBranch: null,
    rollbackStorePath: null,
    rollbackChangesetId: null,
    step: "begin",
    lastEvolutionState: null,
    ...overrides,
  };
}

/** Permissions snapshot with a required permission still pending → Permissions step. */
function makeIncompletePermissions(): PermissionsState {
  return {
    permissions: [
      {
        id: "full-disk",
        name: "Full Disk Access",
        description: "Recommended for complete system management capabilities",
        required: true,
        canRequestProgrammatically: false,
        status: "pending",
        instructions:
          "Go to System Settings → Privacy & Security → Full Disk Access and add nixmac.",
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
    ],
    allRequiredGranted: false,
    checkedAt: 0,
  };
}

const GIT_PRESETS: Record<string, GitStatus | null> = {
  none: null,
  clean: {
    files: [],
    branch: "main",
    diff: "",
    additions: 0,
    deletions: 0,
    headCommitHash: null,
    cleanHead: true,
    changes: [],
  },
  dirty: {
    files: [
      { path: "modules/darwin/default.nix", changeType: "edited" },
      { path: "modules/home/default.nix", changeType: "edited" },
      { path: "modules/darwin/vim.nix", changeType: "new" },
    ],
    diff: "diff --git a/modules/darwin/default.nix b/modules/darwin/default.nix\n...",
    additions: 25,
    deletions: 3,
    branch: "main",
    headCommitHash: null,
    cleanHead: false,
    changes: [],
  },
  manyFiles: {
    files: [
      { path: "modules/darwin/default.nix", changeType: "edited" },
      { path: "modules/home/default.nix", changeType: "edited" },
      { path: "modules/darwin/vim.nix", changeType: "new" },
      { path: "modules/darwin/git.nix", changeType: "new" },
      { path: "modules/darwin/homebrew.nix", changeType: "edited" },
      { path: "modules/home/shell.nix", changeType: "edited" },
      { path: "flake.nix", changeType: "edited" },
      { path: "flake.lock", changeType: "edited" },
    ],
    diff: "diff --git a/modules/darwin/default.nix b/modules/darwin/default.nix\n...",
    additions: 120,
    deletions: 15,
    branch: "main",
    headCommitHash: null,
    cleanHead: false,
    changes: [],
  },
  // "Ready to commit" — same files, build succeeded so they're committable.
  allStaged: {
    files: [
      { path: "modules/darwin/default.nix", changeType: "edited" },
      { path: "modules/home/default.nix", changeType: "edited" },
      { path: "modules/darwin/vim.nix", changeType: "new" },
    ],
    diff: "diff --git a/modules/darwin/default.nix b/modules/darwin/default.nix\n...",
    additions: 25,
    deletions: 3,
    branch: "main",
    headCommitHash: null,
    cleanHead: false,
    changes: [],
  },
};

const SAMPLE_CHANGE_MAP: SemanticChangeMap = {
  groups: [
    {
      summary: {
        id: 1,
        title: "System Settings (4)",
        description: "Dock autohide, Finder path bar, trackpad tap-to-click, +1 more",
        status: "DONE",
        createdAt: 0,
      },
      changes: [
        {
          id: 1,
          hash: "mock-dock-autohide",
          filename: "modules/darwin/system-defaults.nix",
          diff: "",
          lineCount: 5,
          createdAt: 0,
          ownSummaryId: null,
          title: "Dock autohide enabled",
          description: "dock.autohide = true",
        },
        {
          id: 2,
          hash: "mock-finder-pathbar",
          filename: "modules/darwin/system-defaults.nix",
          diff: "",
          lineCount: 3,
          createdAt: 0,
          ownSummaryId: null,
          title: "Finder shows path bar",
          description: "finder.ShowPathbar = true",
        },
      ],
    },
  ],
  singles: [
    {
      id: 3,
      hash: "mock-key-repeat",
      filename: "modules/darwin/system-defaults.nix",
      diff: "",
      lineCount: 2,
      createdAt: 0,
      ownSummaryId: null,
      title: "Keyboard (1)",
      description: "KeyRepeat = 2",
    },
  ],
  unsummarizedHashes: [],
};

const CHANGE_MAP_PRESETS: Record<string, SemanticChangeMap | null> = {
  none: null,
  sample: SAMPLE_CHANGE_MAP,
};

const BASIC_EVOLVE_EVENTS: EvolveEvent[] = [
  {
    eventType: "start",
    summary: "Starting AI evolution...",
    raw: "Starting evolution with model gpt-5.1",
    iteration: null,
    timestampMs: 0,
  },
  {
    eventType: "iteration",
    summary: "Processing iteration 1...",
    raw: "Iteration 1 | messages=2",
    iteration: 1,
    timestampMs: 500,
  },
  {
    eventType: "apiRequest",
    summary: "Querying AI model...",
    raw: "Sending request to AI provider",
    iteration: 1,
    timestampMs: 550,
  },
  {
    eventType: "apiResponse",
    summary: "Received AI response",
    raw: "Received response | tokens used: 1523",
    iteration: 1,
    timestampMs: 2300,
  },
  {
    eventType: "thinking",
    summary: "Planning approach...",
    raw: "[planning] Analyzing configuration structure...",
    iteration: 1,
    timestampMs: 2400,
  },
  {
    eventType: "reading",
    summary: "Reading default.nix",
    raw: "Reading file: modules/darwin/default.nix",
    iteration: 2,
    timestampMs: 4600,
  },
];

const DETAILED_EVOLVE_EVENTS: EvolveEvent[] = [
  ...BASIC_EVOLVE_EVENTS,
  {
    eventType: "editing",
    summary: "Editing default.nix",
    raw: "Editing file: modules/darwin/default.nix",
    iteration: 3,
    timestampMs: 6000,
  },
  {
    eventType: "buildCheck",
    summary: "Running build check...",
    raw: "Running build check for host: Demo-MacBook-Pro",
    iteration: 3,
    timestampMs: 6500,
  },
];

const EVOLVE_EVENT_PRESETS: Record<string, EvolveEvent[]> = {
  none: [],
  basic: BASIC_EVOLVE_EVENTS,
  detailed: DETAILED_EVOLVE_EVENTS,
};

// =============================================================================
// Args <-> store binding
// =============================================================================

/**
 * Apply the control values to the two Zustand stores. Runs in a layout effect
 * (before paint and before the widget's own mount-time hydration), so the
 * widget always renders against the controlled state.
 */
function applyArgsToStores(a: Record<string, any>): void {
  const ui = useUiState.getState();
  const vm = viewModelActions.getState();

  // Seed *every* slice the widget re-hydrates on mount, so the async mount
  // sequence (startViewModelSync → checkPermissions/checkNix → getInitialStatus)
  // mirrors back exactly what's here and produces no post-render DOM change.
  // Otherwise the `afterEach` snapshot races those late writes → flaky.
  viewModelActions.setState({
    preferences: makeGlobalPreferences({
      ...(vm.preferences ?? {}),
      configDir: a.configDir || null,
      hostAttr: a.host || null,
      repoRoot: a.configDir || null,
    }),
    hosts: a.hostsListed ? [...DEMO_HOSTS] : [],
    permissions: a.permissionsGranted ? makeGrantedPermissions() : makeIncompletePermissions(),
    permissionsHydrated: true,
    nixInstall: makeNixInstallState(),
    evolve: makeEvolveState({ step: a.evolveStep, committable: a.committable }),
    git: GIT_PRESETS[a.gitStatus] ?? null,
    build: { externalBuildDetected: false },
    changeMap: CHANGE_MAP_PRESETS[a.changeMap] ?? null,
    evolveEvents: [...(EVOLVE_EVENT_PRESETS[a.evolveEvents] ?? [])],
    promptHistory: [],
    rebuildStatus: makeRebuildStatus(),
    rebuildLog: { lines: [], rawLines: [] },
    history: [],
  });

  uiActions.setShowHistory(a.showHistory);
  uiActions.setShowFilesystem(a.showFilesystem);
  uiActions.setFeedbackOpen(a.feedbackOpen);
  uiActions.setBootstrapping(a.isBootstrapping);
  uiActions.setEvolvePrompt(a.evolvePrompt ?? "");
  uiActions.setError(a.error ? a.error : null);
  uiActions.setGenerating(a.isGenerating);
  uiActions.setSummarizing(a.isSummarizing);
  uiActions.setProcessing(a.isProcessing, a.processingAction === "none" ? null : a.processingAction);

  // Settings open/tab is now router state — drive it via the router instance.
  if (a.settingsOpen) {
    nav.openSettings(a.settingsTab === "none" ? undefined : a.settingsTab);
  } else {
    nav.goHome();
  }

  uiActions.clearLogs();
  if (a.consoleLogs) uiActions.appendLog(a.consoleLogs);
}

/**
 * The subset of args that map cleanly back from store → control. These reflect
 * genuine widget interactions (typing a prompt, opening Settings, toggling
 * History) into the Controls panel, giving control/state equivalence.
 */
function computeArgsView(): Record<string, any> {
  const ui = useUiState.getState();
  const vm = viewModelActions.getState();
  const routerState = router.state;
  const settingsOpen = routerState.location.pathname === "/settings";
  const settingsTab = (routerState.location.search.tab as string | null) ?? "none";
  return {
    evolveStep: vm.evolve?.step ?? "begin",
    committable: vm.evolve?.committable ?? false,
    configDir: vm.preferences?.configDir ?? "",
    host: vm.preferences?.hostAttr ?? "",
    permissionsGranted: vm.permissions?.allRequiredGranted ?? true,
    isBootstrapping: ui.isBootstrapping,
    showHistory: ui.showHistory,
    showFilesystem: ui.showFilesystem,
    settingsOpen,
    settingsTab,
    feedbackOpen: ui.feedbackOpen,
    evolvePrompt: ui.evolvePrompt,
    error: ui.error ?? "",
    isProcessing: ui.isProcessing,
    processingAction: ui.processingAction ?? "none",
    isGenerating: ui.isGenerating,
    isSummarizing: ui.isSummarizing,
  };
}

const TWO_WAY_KEYS = Object.keys(computeArgsView());

// Module-scoped because the decorator applies args during its (synchronous)
// render body while the store subscription fires synchronously inside those
// writes — `applying` lets the subscription ignore its own echo. Only one
// story renders at a time, so sharing these is safe.
let applying = false;
let latestArgs: Record<string, any> = {};

/**
 * Decorator that two-way binds the Controls panel to the Zustand stores:
 *  - control → store: `applyArgsToStores` runs synchronously in the decorator
 *    body (same pattern as `seedViewModelBypass`), so the widget renders — and
 *    later hydrates — against the controlled state.
 *  - store → control: a store subscription pushes interaction-driven changes
 *    (typing a prompt, opening Settings, toggling History) back into the panel.
 *
 * The `applying` guard plus per-key diffing keep the cycle convergent rather
 * than looping.
 */
const withControls: Decorator = (Story, context) => {
  latestArgs = context.args;
  applying = true;
  applyArgsToStores(context.args);
  applying = false;

  const [, updateArgs] = useArgs();
  useEffect(() => {
    // The store→args mirror exists purely for interactive use. Under the
    // headless Vitest snapshot runner there is no interaction to reflect, and
    // its updateArgs→re-apply churn races the widget's async mount → flaky
    // snapshots. Skip it there.
    if ((globalThis as { __STORYBOOK_VITEST__?: boolean }).__STORYBOOK_VITEST__) return;
    const push = () => {
      if (applying) return;
      const view = computeArgsView();
      const diff: Record<string, any> = {};
      for (const key of TWO_WAY_KEYS) {
        if (!Object.is(view[key], latestArgs[key])) diff[key] = view[key];
      }
      if (Object.keys(diff).length > 0) updateArgs(diff);
    };
    const unsubUi = useUiState.subscribe(push);
    const unsubVm = useViewModel.subscribe(push);
    const unsubRouter = router.subscribe("onResolved", push);
    return () => {
      unsubUi();
      unsubVm();
      unsubRouter();
    };
  }, []);

  return <Story />;
};

// =============================================================================
// Meta
// =============================================================================

const cat = (category: string, description: string) => ({
  description,
  table: { category },
});

const meta = preview.meta({
  title: "Widget/DarwinWidget",
  component: DarwinWidget,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    withControls,
    (Story: React.ComponentType) => (
      <RouterProvider router={router}>
        <div className="flex h-screen w-screen items-center justify-center overflow-hidden p-4">
          <div className="h-[640px] w-[960px] overflow-hidden rounded-xl border border-border shadow-2xl">
            <Story />
          </div>
        </div>
      </RouterProvider>
    ),
  ],
  tags: ["autodocs"],
  render: () => <DarwinWidget />,
  argTypes: {
    // --- Routing / Gating: these compose exactly as `computeCurrentStep` does;
    // the precedence is permissions → setup → history → filesystem → evolve.step
    evolveStep: {
      control: "select",
      options: ["begin", "evolve", "commit", "manualEvolve", "manualCommit"],
      ...cat("Routing / Gating", "Evolve sub-step (used when no earlier gate wins)"),
    },
    configDir: {
      control: "text",
      ...cat("Routing / Gating", "Selected config dir; empty → Setup step"),
    },
    host: {
      control: "select",
      options: ["", "Demo-MacBook-Pro", "Work-MacBook"],
      ...cat("Routing / Gating", "Selected host; must be in the hosts list to pass Setup"),
    },
    hostsListed: {
      control: "boolean",
      ...cat("Routing / Gating", "Hosts discovered from the flake (false = fresh onboarding)"),
    },
    permissionsGranted: {
      control: "boolean",
      ...cat("Routing / Gating", "false → Permissions step"),
    },
    isBootstrapping: {
      control: "boolean",
      ...cat("Routing / Gating", "Creating a default config → Setup step"),
    },
    showHistory: { control: "boolean", ...cat("Routing / Gating", "Open the History panel") },
    showFilesystem: { control: "boolean", ...cat("Routing / Gating", "Open the Filesystem view") },

    // --- Evolve session
    committable: {
      control: "boolean",
      ...cat("Evolve session", "evolve.committable — build succeeded, ready to commit"),
    },

    // --- Processing & UI flags (transient `useUiState`)
    isProcessing: {
      control: "boolean",
      ...cat("Processing & UI", "Global processing flag (spinner / disabled inputs)"),
    },
    processingAction: {
      control: "select",
      options: ["none", "evolve", "apply", "merge", "cancel"],
      ...cat("Processing & UI", "Which long-running action is in flight"),
    },
    isGenerating: {
      control: "boolean",
      ...cat("Processing & UI", "AI is streaming an evolution (shows progress overlay)"),
    },
    isSummarizing: {
      control: "boolean",
      ...cat("Processing & UI", "Change summaries are being generated"),
    },
    evolvePrompt: { control: "text", ...cat("Processing & UI", "Text in the prompt input") },
    error: { control: "text", ...cat("Processing & UI", "Error banner text (empty = no error)") },
    settingsOpen: { control: "boolean", ...cat("Processing & UI", "Settings dialog open") },
    settingsTab: {
      control: "select",
      options: [
        "none",
        "general",
        "account",
        "api-keys",
        "ai-models",
        "preferences",
        "tuning",
        "developer",
      ],
      ...cat("Processing & UI", "Active settings tab"),
    },
    feedbackOpen: { control: "boolean", ...cat("Processing & UI", "Feedback dialog open") },

    // --- Data (backend mirror; chosen via preset so the control stays a scalar)
    gitStatus: {
      control: "select",
      options: ["none", "clean", "dirty", "manyFiles", "allStaged"],
      ...cat("Data", "Git status preset"),
    },
    changeMap: {
      control: "select",
      options: ["none", "sample"],
      ...cat("Data", "Semantic change map preset"),
    },
    evolveEvents: {
      control: "select",
      options: ["none", "basic", "detailed"],
      ...cat("Data", "Evolve event-stream preset (timeline)"),
    },
    consoleLogs: { control: "text", ...cat("Data", "Console output") },
  },
  args: {
    // Idle baseline: config + host selected, everything else off.
    evolveStep: "begin",
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hostsListed: true,
    permissionsGranted: true,
    isBootstrapping: false,
    showHistory: false,
    showFilesystem: false,
    committable: false,
    isProcessing: false,
    processingAction: "none",
    isGenerating: false,
    isSummarizing: false,
    evolvePrompt: "",
    error: "",
    settingsOpen: false,
    settingsTab: "none",
    feedbackOpen: false,
    gitStatus: "none",
    changeMap: "none",
    evolveEvents: "none",
    consoleLogs: "",
  },
});

export default meta;

// =============================================================================
// Stories: main lifecycle
//
// Every story is just an `args` override on the shared, fully-controlled
// render — so each one is also a live starting point you can tweak in the
// Controls panel.
// =============================================================================

/** Interactive playground — open Controls to drive any state. */
export const Playground = meta.story({});

/** First-time setup, no config selected yet. */
export const Onboarding = meta.story({
  args: { configDir: "", host: "", hostsListed: false },
});

/** Directory chosen, waiting for a host selection. */
export const OnboardingWithDirectory = meta.story({
  args: { host: "", hostsListed: true },
});

/** Default ready state. */
export const Idle = meta.story({});

/** Idle with a prompt typed in. */
export const IdleWithPrompt = meta.story({
  args: { evolvePrompt: "Install vim and configure git with my email" },
});

/** AI streaming an evolution. */
export const Generating = meta.story({
  args: {
    evolvePrompt: "Install vim and configure git",
    isGenerating: true,
    isProcessing: true,
    processingAction: "evolve",
    evolveEvents: "basic",
    consoleLogs: '> Evolving: "Install vim and configure git"\n',
  },
});

/** Streaming with a longer event timeline. */
export const GeneratingWithProgress = meta.story({
  args: {
    evolvePrompt: "Install vim and configure git",
    isGenerating: true,
    isProcessing: true,
    processingAction: "evolve",
    evolveEvents: "detailed",
    consoleLogs: '> Evolving: "Install vim and configure git"\n',
  },
});

/** Changes generated — Evolve step, waiting for the user to preview/apply. */
export const Evolving = meta.story({
  args: {
    evolveStep: "evolve",
    gitStatus: "dirty",
    changeMap: "sample",
    consoleLogs: '> Evolving: "Install vim"\n✓ Evolution complete\n',
  },
});

/** Running darwin-rebuild switch. */
export const Applying = meta.story({
  args: {
    evolveStep: "evolve",
    gitStatus: "dirty",
    isProcessing: true,
    processingAction: "apply",
    consoleLogs: "> Running darwin-rebuild switch...\nbuilding the system configuration...\n",
  },
});

/** Changes applied and built — ready to commit. */
export const Preview = meta.story({
  args: {
    evolveStep: "commit",
    committable: true,
    gitStatus: "allStaged",
    changeMap: "sample",
    consoleLogs:
      "> Running darwin-rebuild switch...\n✓ Apply complete\n\nChanges are now active. Commit to save or discard to revert.\n",
  },
});

/** Saving changes to git. */
export const Committing = meta.story({
  args: {
    evolveStep: "commit",
    committable: true,
    gitStatus: "allStaged",
    isProcessing: true,
    processingAction: "merge",
    consoleLogs: '> Committing: "feat(darwin): add vim and configure git"\n',
  },
});

// =============================================================================
// Stories: individual steps (reachable via the routing controls)
// =============================================================================

/** Permissions step — a required permission is still pending. */
export const PermissionsRequired = meta.story({
  args: { permissionsGranted: false },
});

/** Manual-edit flow: user is hand-editing generated changes. */
export const ManualEvolve = meta.story({
  args: { evolveStep: "manualEvolve", gitStatus: "dirty" },
});

/** Manual changes built and ready to commit. */
export const ManualCommit = meta.story({
  args: { evolveStep: "manualCommit", gitStatus: "allStaged", changeMap: "sample" },
});

/** History panel. */
export const HistoryView = meta.story({
  args: { showHistory: true, changeMap: "sample" },
});

/** Filesystem view. */
export const FilesystemView = meta.story({
  args: { showFilesystem: true },
});

// =============================================================================
// Stories: edge cases & overlays
// =============================================================================

/** Error banner. */
export const WithError = meta.story({
  args: { error: "Failed to connect to nix daemon. Is the Nix daemon running?" },
});

/** Many changed files. */
export const ManyChangedFiles = meta.story({
  args: { evolveStep: "evolve", gitStatus: "manyFiles", changeMap: "sample" },
});

/** Console with lots of output. */
export const ConsoleWithOutput = meta.story({
  args: {
    evolveStep: "commit",
    committable: true,
    gitStatus: "dirty",
    changeMap: "sample",
    consoleLogs: `> Running darwin-rebuild switch...
building the system configuration...
these 3 derivations will be built:
  /nix/store/abc123-darwin-system.drv
  /nix/store/def456-home-manager.drv
  /nix/store/ghi789-user-environment.drv
building '/nix/store/abc123-darwin-system.drv'...
copying path '/nix/store/...'
setting up /etc...
setting up launchd services...
setting up user defaults...
✓ Apply complete

Changes are now active. Commit to save or discard to revert.`,
  },
});

/** Settings dialog open. */
export const SettingsOpen = meta.story({
  args: { settingsOpen: true, settingsTab: "general" },
});

/** Feedback dialog open. */
export const FeedbackOpen = meta.story({
  args: { feedbackOpen: true },
});

/** Evolve step with unstaged changes — shows the Preview button. */
export const EvolvingWithUnstagedChanges = meta.story({
  args: { evolveStep: "evolve", gitStatus: "dirty" },
});

/** Evolve step, build succeeded — shows the Commit button. */
export const EvolvingReadyToCommit = meta.story({
  args: { evolveStep: "commit", committable: true, gitStatus: "allStaged", changeMap: "sample" },
});

/** Commit step — enter a commit message. */
export const CommitScreen = meta.story({
  args: { evolveStep: "commit", committable: true, gitStatus: "allStaged", changeMap: "sample" },
});
