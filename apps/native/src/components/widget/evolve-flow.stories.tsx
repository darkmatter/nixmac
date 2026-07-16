// @ts-nocheck - Storybook 10 factory types resolve story args too narrowly here
import preview from "#storybook/preview";
import { ErrorMessage } from "@/components/widget/layout/error-message";
import { Header } from "@/components/widget/layout/header";
import { StepContentWrapper } from "@/components/widget/layout/step-content-wrapper";
import { Stepper } from "@/components/widget/layout/stepper";
import { EvolveOverlayPanel } from "@/components/widget/overlays/evolve-overlay-panel";
import { BeginStep, CommitStep, FilesystemStep, HistoryStep, ReviewStep } from "@/components/widget/steps";
import type {
  Change,
  ChangeType,
  EvolveEvent,
  EvolveState,
  EvolveStep,
  GitStatus,
  PermissionsState,
  SemanticChangeMap,
} from "@/ipc/types";
import type { WidgetStep } from "@/types/widget";
import {
  makeGlobalPreferences,
  makeGrantedPermissions,
  makeNixInstallState,
  makeRebuildStatus,
} from "@/utils/test-fixtures";
import {
  initialUiState,
  onboardingActions,
  uiActions,
  useUiState,
  useViewModel,
  viewModelActions,
} from "@nixmac/state";
import type React from "react";
import { useEffect, useRef } from "react";
import { expect, userEvent, within } from "storybook/test";

type FlowGitPreset = "none" | "clean" | "dirty" | "manyFiles" | "unsummarized" | "allStaged";
type FlowChangeMapPreset = "none" | "summarized" | "withUnsummarized";
type FlowEventPreset = "none" | "early" | "detailed" | "complete" | "error";
type FlowRoutePreset = "home" | "settings";

type EvolveFlowArgs = {
  evolveStep: EvolveStep;
  evolutionId: number | null;
  committable: boolean;
  activeStepOverride: EvolveStep | null;
  gitStatus: FlowGitPreset;
  changeMap: FlowChangeMapPreset;
  evolveEvents: FlowEventPreset;
  evolvePrompt: string;
  commitMessageSuggestion: string | null;
  isGenerating: boolean;
  isProcessing: boolean;
  processingAction: "none" | "evolve" | "apply" | "merge" | "cancel";
  isSummarizing: boolean;
  error: string;
  showHistory: boolean;
  showFilesystem: boolean;
  externalBuildDetected: boolean;
  route: FlowRoutePreset;
  settingsTab: "none" | "general" | "account" | "api-keys" | "ai-models" | "preferences" | "tuning" | "developer";
  permissionsGranted: boolean;
  configDir: string;
  host: string;
  hostsListed: boolean;
  consoleLogs: string;
};

const defaultEvolveFlowArgs = {
  evolveStep: "begin",
  evolutionId: null,
  committable: false,
  activeStepOverride: null,
  gitStatus: "clean",
  changeMap: "none",
  evolveEvents: "none",
  evolvePrompt: "",
  commitMessageSuggestion: null,
  isGenerating: false,
  isProcessing: false,
  processingAction: "none",
  isSummarizing: false,
  error: "",
  showHistory: false,
  showFilesystem: false,
  externalBuildDetected: false,
  route: "home",
  settingsTab: "none",
  permissionsGranted: true,
  configDir: "/Users/demo/.darwin",
  host: "Demo-MacBook-Pro",
  hostsListed: true,
  consoleLogs: "",
} satisfies EvolveFlowArgs;

const DEMO_HOSTS = ["Demo-MacBook-Pro", "Work-MacBook"];
const STABLE_NOW_SECONDS = 1_700_000_000;

const cat = (category: string, description: string) => ({
  description,
  table: { category },
});

function makeChange(
  id: number,
  filename: string,
  changeType: ChangeType,
  diff: string,
  overrides: Partial<Change> = {},
): Change {
  return {
    id,
    hash: `${changeType}-${id}-${filename}`,
    filename,
    diff,
    lineCount: diff.split("\n").length,
    createdAt: STABLE_NOW_SECONDS + id,
    ownSummaryId: id,
    ...overrides,
  };
}

const baseChanges: Change[] = [
  makeChange(
    1,
    "configuration.nix",
    "edited",
    `@@ -3,6 +3,8 @@
 {
   environment.systemPackages = with pkgs; [
     vim
+    htop
+    btop
     git
     ripgrep
     fd`,
    { hash: "monitoring-packages" },
  ),
  makeChange(
    2,
    "modules/monitoring.nix",
    "new",
    `@@ -0,0 +1,12 @@
+{ pkgs, ... }:
+{
+  environment.systemPackages = with pkgs; [
+    htop
+    btop
+    bottom
+    bandwhich
+    procs
+  ];
+}`,
    { hash: "monitoring-module" },
  ),
];

const manyChanges: Change[] = [
  ...baseChanges,
  makeChange(
    3,
    "modules/darwin/fonts.nix",
    "new",
    `@@ -0,0 +1,5 @@
+{ pkgs, ... }:
+{
+  fonts.packages = [ pkgs.nerd-fonts.jetbrains-mono ];
+}`,
    { hash: "fonts-module" },
  ),
  makeChange(
    4,
    "modules/home/shell.nix",
    "removed",
    `@@ -1,6 +0,0 @@
-{ pkgs, ... }:
-{
-  programs.zsh.enable = true;
-}`,
    { hash: "removed-shell" },
  ),
  makeChange(
    5,
    "modules/darwin/terminal.nix",
    "edited",
    `@@ -4,6 +4,7 @@
   programs.alacritty = {
     enable = true;
+    settings.window.opacity = 0.92;
   };`,
    { hash: "terminal-opacity" },
  ),
];

function makeGitStatus(changes: Change[], overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    files: changes.map((change) => ({ path: change.filename, changeType: inferChangeType(change) })),
    branch: "main",
    diff: changes.map((change) => change.diff).join("\n"),
    additions: changes.reduce((sum, change) => sum + countPrefix(change.diff, "+"), 0),
    deletions: changes.reduce((sum, change) => sum + countPrefix(change.diff, "-"), 0),
    headCommitHash: "abc1234567890",
    cleanHead: changes.length === 0,
    changes,
    ...overrides,
  };
}

function countPrefix(diff: string, prefix: "+" | "-"): number {
  return diff
    .split("\n")
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
    .length;
}

function inferChangeType(change: Change): ChangeType {
  if (/^@@ -0(?:,0)? \+/.test(change.diff)) return "new";
  if (/^@@ -\d+(?:,\d+)? \+0(?:,0)? @@/.test(change.diff)) return "removed";
  return "edited";
}

const cleanGitStatus = makeGitStatus([]);
const dirtyGitStatus = makeGitStatus(baseChanges, { cleanHead: false });
const manyFilesGitStatus = makeGitStatus(manyChanges, { cleanHead: false });
const allStagedGitStatus = makeGitStatus(baseChanges, { cleanHead: false });
const unsummarizedGitStatus = makeGitStatus(manyChanges, { cleanHead: false });

const GIT_PRESETS: Record<FlowGitPreset, GitStatus | null> = {
  none: null,
  clean: cleanGitStatus,
  dirty: dirtyGitStatus,
  manyFiles: manyFilesGitStatus,
  unsummarized: unsummarizedGitStatus,
  allStaged: allStagedGitStatus,
};

const summarizedChangeMap: SemanticChangeMap = {
  groups: [
    {
      summary: {
        id: 1,
        title: "System Monitoring Tools",
        description:
          "Added htop, btop, bottom, bandwhich, and procs for comprehensive system monitoring. Created a dedicated monitoring module and updated the main configuration.",
        status: "DONE",
        createdAt: STABLE_NOW_SECONDS,
      },
      changes: [
        {
          ...baseChanges[0],
          title: "Add monitoring packages",
          description: "Added htop and btop to system packages.",
        },
        {
          ...baseChanges[1],
          title: "New monitoring module",
          description: "Dedicated module for system monitoring tools.",
        },
      ],
    },
  ],
  singles: [],
  unsummarizedHashes: [],
};

const changeMapWithUnsummarized: SemanticChangeMap = {
  ...summarizedChangeMap,
  unsummarizedHashes: ["fonts-module", "removed-shell", "terminal-opacity"],
};

const CHANGE_MAP_PRESETS: Record<FlowChangeMapPreset, SemanticChangeMap | null> = {
  none: null,
  summarized: summarizedChangeMap,
  withUnsummarized: changeMapWithUnsummarized,
};

function makeEvolveState(args: Pick<EvolveFlowArgs, "evolveStep" | "evolutionId" | "committable">): EvolveState {
  return {
    evolutionId: args.evolutionId,
    currentChangesetId: args.evolutionId ? 1 : null,
    committable: args.committable,
    backupBranch: args.evolutionId ? "backup/pre-evolve-1" : null,
    rollbackBranch: null,
    rollbackStorePath: args.committable ? "/nix/store/previous-system" : null,
    rollbackChangesetId: args.committable ? 1 : null,
    step: args.evolveStep,
    lastEvolutionState: null,
  };
}

const evolveEvents: EvolveEvent[] = [
  {
    raw: "Starting evolution with model gpt-5.1",
    summary: "Starting evolution",
    eventType: "start",
    iteration: null,
    timestampMs: 0,
  },
  {
    raw: "Iteration 1 of 25",
    summary: "Iteration 1",
    eventType: "iteration",
    iteration: 1,
    timestampMs: 1_200,
  },
  {
    raw: "Analyzing current configuration to understand package structure...",
    summary: "Thinking about changes",
    eventType: "thinking",
    iteration: 1,
    timestampMs: 2_400,
  },
  {
    raw: "read_file: configuration.nix",
    summary: "Reading configuration.nix",
    eventType: "reading",
    iteration: 1,
    timestampMs: 3_100,
  },
  {
    raw: "edit_file: configuration.nix — adding htop and btop",
    summary: "Editing configuration.nix",
    eventType: "editing",
    iteration: 1,
    timestampMs: 4_500,
  },
  {
    raw: "Creating modules/monitoring.nix with monitoring tools",
    summary: "Creating modules/monitoring.nix",
    eventType: "editing",
    iteration: 1,
    timestampMs: 5_800,
  },
  {
    raw: "Running nix eval to verify syntax...",
    summary: "Checking build",
    eventType: "buildCheck",
    iteration: 1,
    timestampMs: 7_200,
  },
  {
    raw: "Build check passed",
    summary: "Build passed",
    eventType: "buildPass",
    iteration: 1,
    timestampMs: 9_500,
  },
  {
    raw: "Summarizing changes...",
    summary: "Analyzing changes",
    eventType: "summarizing",
    iteration: null,
    timestampMs: 10_200,
  },
  {
    raw: "Evolution complete: 2 files changed, 14 additions",
    summary: "Evolution complete",
    eventType: "complete",
    iteration: null,
    timestampMs: 11_800,
  },
];

const EVOLVE_EVENT_PRESETS: Record<FlowEventPreset, EvolveEvent[]> = {
  none: [],
  early: evolveEvents.slice(0, 4),
  detailed: evolveEvents.slice(0, 8),
  complete: evolveEvents,
  error: [
    ...evolveEvents.slice(0, 4),
    {
      raw: "Error: API rate limit exceeded",
      summary: "Error: API rate limit exceeded",
      eventType: "error",
      iteration: 1,
      timestampMs: 4_200,
    },
  ],
};

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
        instructions: "Go to System Settings → Privacy & Security → Full Disk Access and add nixmac.",
      },
    ],
    allRequiredGranted: false,
    checkedAt: 0,
  };
}

function applyArgsToStores(args: EvolveFlowArgs) {
  const git = GIT_PRESETS[args.gitStatus];
  const evolve = makeEvolveState(args);

  viewModelActions.setState({
    preferences: makeGlobalPreferences({
      configDir: args.configDir || null,
      repoRoot: args.configDir || null,
      hostAttr: args.host || null,
      evolveProvider: "claude",
      evolveModels: { claude: "claude-sonnet-4.5" },
      summaryProvider: "claude",
      summaryModels: { claude: "claude-sonnet-4.5" },
      onboardingMacScannedAt: STABLE_NOW_SECONDS,
      onboardingLoginDecided: true,
      onboardingLastBuildAt: STABLE_NOW_SECONDS,
      scanHomebrewOnStartup: false,
    }),
    hosts: args.hostsListed ? [...DEMO_HOSTS] : [],
    permissions: args.permissionsGranted ? makeGrantedPermissions() : makeIncompletePermissions(),
    permissionsHydrated: true,
    nixInstall: makeNixInstallState(),
    evolve,
    git,
    changeMap: CHANGE_MAP_PRESETS[args.changeMap],
    evolveEvents: [...EVOLVE_EVENT_PRESETS[args.evolveEvents]],
    build: { externalBuildDetected: args.externalBuildDetected },
    rebuildStatus: makeRebuildStatus(),
    rebuildLog: { lines: [], rawLines: [], notices: [] },
    promptHistory: [],
    history: [],
  });

  onboardingActions.reset();

  uiActions.setState({
    ...initialUiState,
    activeStepOverride: args.activeStepOverride,
    evolvePrompt: args.evolvePrompt,
    commitMessageSuggestion: args.commitMessageSuggestion,
    isGenerating: args.isGenerating,
    isProcessing: args.isProcessing,
    processingAction: args.isProcessing && args.processingAction !== "none" ? args.processingAction : null,
    isSummarizing: args.isSummarizing,
    error: args.error || null,
    showHistory: args.showHistory,
    showFilesystem: args.showFilesystem,
    settingsOpen: args.route === "settings",
    settingsActiveTab: args.route === "settings" && args.settingsTab !== "none" ? args.settingsTab : null,
  });

  uiActions.clearLogs();
  if (args.consoleLogs) uiActions.appendLog(args.consoleLogs);

}

function resolveFlowStep(args: EvolveFlowArgs): WidgetStep {
  const hasConfig = Boolean(args.configDir && args.host && args.hostsListed);
  const hasChanges = (GIT_PRESETS[args.gitStatus]?.changes.length ?? 0) > 0;

  if (!args.permissionsGranted) return "permissions";
  if (!hasConfig) return "setup";
  if (args.showHistory) return "history";
  if (args.showFilesystem) return "filesystem";
  if (!hasChanges) return "begin";
  return (args.activeStepOverride ?? args.evolveStep) as WidgetStep;
}

function StepBody({ step }: { step: WidgetStep }) {
  switch (step) {
    case "begin":
      return <BeginStep />;
    case "evolve":
    case "manualEvolve":
      return <ReviewStep />;
    case "commit":
      return <CommitStep />;
    case "manualCommit":
      return <CommitStep isManual />;
    case "history":
      return <HistoryStep />;
    case "filesystem":
      return <FilesystemStep />;
    case "permissions":
      return <div className="p-6 text-sm text-muted-foreground">Permissions gate: grant required permissions to continue.</div>;
    case "setup":
      return <div className="p-6 text-sm text-muted-foreground">Setup gate: choose a config directory and host before evolving.</div>;
    case "nix-setup":
      return <div className="p-6 text-sm text-muted-foreground">Nix setup gate: install Nix and nix-darwin before evolving.</div>;
  }
}

function EvolveFlowShell({ step }: { step: WidgetStep }) {
  const edgeToEdge = step === "filesystem";

  return (
    <div className="flex min-h-[600px] min-w-[800px] h-full w-full flex-col bg-background/60">
      <Header />
      <Stepper />
      {edgeToEdge ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ErrorMessage />
          <StepBody step={step} />
        </div>
      ) : (
        <StepContentWrapper>
          <ErrorMessage />
          <StepBody step={step} />
        </StepContentWrapper>
      )}
      <EvolveOverlayPanel />
      {useUiState.getState().settingsOpen && (
        <div className="fixed inset-6 z-20 rounded-xl border border-border bg-background/95 p-6 shadow-2xl">
          <p className="font-medium text-sm">Settings overlay</p>
          <p className="mt-2 text-muted-foreground text-xs">
            Active tab: {useUiState.getState().settingsActiveTab ?? "general"}
          </p>
        </div>
      )}
    </div>
  );
}

function ControlledEvolveFlow(args: EvolveFlowArgs) {
  applyArgsToStores(args);

  return <EvolveFlowShell step={resolveFlowStep(args)} />;
}

function AnimatedEvolveFlow() {
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const baseArgs: EvolveFlowArgs = {
      ...defaultEvolveFlowArgs,
      evolvePrompt: "Add system monitoring tools like htop and btop",
    };
    applyArgsToStores(baseArgs);

    const t1 = setTimeout(() => {
      uiActions.setState({ isGenerating: true, isProcessing: true, processingAction: "evolve" });
      viewModelActions.setState({ evolveEvents: [evolveEvents[0]] });
    }, 800);
    timeoutsRef.current.push(t1);

    for (let i = 1; i < evolveEvents.length; i++) {
      const t = setTimeout(() => {
        viewModelActions.setState((state) => ({ evolveEvents: [...state.evolveEvents, evolveEvents[i]] }));
      }, 800 + i * 500);
      timeoutsRef.current.push(t);
    }

    const reviewAt = 800 + evolveEvents.length * 500 + 800;
    const t2 = setTimeout(() => {
      viewModelActions.setState({
        evolve: makeEvolveState({ evolveStep: "evolve", evolutionId: 1, committable: false }),
        git: dirtyGitStatus,
        changeMap: summarizedChangeMap,
      });
      uiActions.setState({ isGenerating: false, isProcessing: false, processingAction: null });
    }, reviewAt);
    timeoutsRef.current.push(t2);

    const t3 = setTimeout(() => {
      viewModelActions.setState({
        evolve: makeEvolveState({ evolveStep: "commit", evolutionId: 1, committable: true }),
        git: allStagedGitStatus,
      });
      uiActions.setState({
        commitMessageSuggestion:
          "feat: add system monitoring tools\n\nAdds htop, btop, bottom, bandwhich, and procs plus a dedicated monitoring module.",
      });
    }, reviewAt + 2_000);
    timeoutsRef.current.push(t3);

    return () => {
      for (const timeout of timeoutsRef.current) clearTimeout(timeout);
    };
  }, []);

  return <EvolveFlowShell step="begin" />;
}

const meta = preview.meta({
  title: "Flows/Evolve",
  component: ControlledEvolveFlow,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="flex h-screen w-screen items-center justify-center overflow-hidden p-4">
        <div className="h-[640px] w-[960px] overflow-hidden rounded-xl border border-border shadow-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  tags: ["autodocs"],
  argTypes: {
    evolveStep: {
      control: "select",
      options: ["begin", "evolve", "commit", "manualEvolve", "manualCommit"],
      ...cat("Evolve routing", "Backend evolve step; later steps only render when `gitStatus` has changes."),
    },
    evolutionId: {
      control: "number",
      ...cat("Evolve routing", "Null means manual drift; a number means AI-generated session."),
    },
    committable: {
      control: "boolean",
      ...cat("Evolve routing", "Build succeeded and changes can be committed."),
    },
    activeStepOverride: {
      control: "select",
      options: [null, "begin", "evolve", "commit", "manualEvolve", "manualCommit"],
      ...cat("Evolve routing", "Temporary stepper override used when navigating back to an earlier step."),
    },
    gitStatus: {
      control: "select",
      options: ["none", "clean", "dirty", "manyFiles", "unsummarized", "allStaged"],
      ...cat("Data", "Git change preset; `clean` and `none` force the Begin step."),
    },
    changeMap: {
      control: "select",
      options: ["none", "summarized", "withUnsummarized"],
      ...cat("Data", "Summary preset used by review/commit screens."),
    },
    evolveEvents: {
      control: "select",
      options: ["none", "early", "detailed", "complete", "error"],
      ...cat("Data", "Event timeline shown by the evolve overlay."),
    },
    evolvePrompt: { control: "text", ...cat("Prompt", "Text in the prompt box.") },
    commitMessageSuggestion: {
      control: "text",
      ...cat("Commit", "Suggested commit message used by the save step."),
    },
    isGenerating: {
      control: "boolean",
      ...cat("Processing", "Shows the evolve progress overlay and hides the stepper."),
    },
    isProcessing: { control: "boolean", ...cat("Processing", "Global busy flag.") },
    processingAction: {
      control: "select",
      options: ["none", "evolve", "apply", "merge", "cancel"],
      ...cat("Processing", "Which action is busy when `isProcessing` is true."),
    },
    isSummarizing: { control: "boolean", ...cat("Processing", "Summaries are being generated.") },
    error: { control: "text", ...cat("Processing", "Error banner text; empty hides it.") },
    showHistory: { control: "boolean", ...cat("Overlay routing", "History branch takes precedence over evolve steps.") },
    showFilesystem: {
      control: "boolean",
      ...cat("Overlay routing", "Filesystem branch takes precedence over evolve steps when enabled."),
    },
    externalBuildDetected: {
      control: "boolean",
      ...cat("Review branches", "Shows the external build banner above the review surface."),
    },
    route: {
      control: "select",
      options: ["home", "settings"],
      ...cat("Overlay routing", "Router-backed overlay route."),
    },
    settingsTab: {
      control: "select",
      options: ["none", "general", "account", "api-keys", "ai-models", "preferences", "tuning", "developer"],
      ...cat("Overlay routing", "Settings tab when route is `settings`."),
    },
    permissionsGranted: {
      control: "boolean",
      ...cat("Gates", "Required permissions gate; false routes before evolve flow."),
    },
    configDir: { control: "text", ...cat("Gates", "Selected config directory; empty routes to setup.") },
    host: { control: "select", options: ["", ...DEMO_HOSTS], ...cat("Gates", "Selected host.") },
    hostsListed: { control: "boolean", ...cat("Gates", "Whether hosts were discovered from the flake.") },
    consoleLogs: { control: "text", ...cat("Diagnostics", "Console output shown in the bottom console.") },
  },
  args: defaultEvolveFlowArgs,
});

export default meta;

export const Playground = meta.story({});

/** Step 1: ready to describe an AI evolution. */
export const Begin = meta.story({
  name: "1. Begin (idle)",
  args: { evolvePrompt: "Add system monitoring tools like htop and btop" },
});

/** Step 2: progress overlay while the AI evolution streams events. */
export const Evolving = meta.story({
  name: "2. Evolving (progress)",
  args: {
    isGenerating: true,
    isProcessing: true,
    processingAction: "evolve",
    evolveEvents: "detailed",
    evolvePrompt: "Add system monitoring tools",
    consoleLogs: '> Evolving: "Add system monitoring tools"\n',
  },
});

/** Progress overlay with an error event visible in the timeline. */
export const EvolvingWithErrorEvent = meta.story({
  args: {
    isGenerating: true,
    isProcessing: true,
    processingAction: "evolve",
    evolveEvents: "error",
    evolvePrompt: "Add system monitoring tools",
  },
});

/** Step 3: AI-generated changes ready for review and build. */
export const Review = meta.story({
  name: "3. Review (changes generated)",
  args: {
    evolveStep: "evolve",
    evolutionId: 1,
    gitStatus: "dirty",
    changeMap: "summarized",
    evolveEvents: "complete",
    consoleLogs: '> Evolving: "Add system monitoring tools"\n✓ Evolution complete\n',
  },
});

/** Review branch with unsummarized files mixed into summarized groups. */
export const ReviewWithUnsummarizedChanges = meta.story({
  args: {
    evolveStep: "evolve",
    evolutionId: 1,
    gitStatus: "unsummarized",
    changeMap: "withUnsummarized",
  },
});

/** Review branch with the external-build detected banner. */
export const ReviewWithExternalBuildDetected = meta.story({
  args: {
    evolveStep: "evolve",
    evolutionId: 1,
    gitStatus: "dirty",
    changeMap: "summarized",
    externalBuildDetected: true,
  },
});

/** Review interaction: switch from summary to the file diff list. */
export const ReviewDiffTab = meta.story({
  args: {
    evolveStep: "evolve",
    evolutionId: 1,
    gitStatus: "dirty",
    changeMap: "summarized",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("tab", { name: /diff/i }));
    await expect(await canvas.findByText("configuration.nix")).toBeInTheDocument();
  },
});

/** Review interaction: reveal the discard confirmation branch. */
export const ReviewDiscardConfirmation = meta.story({
  args: {
    evolveStep: "evolve",
    evolutionId: 1,
    gitStatus: "dirty",
    changeMap: "summarized",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /^discard$/i }));
    await expect(await canvas.findByText(/Discard all 2 changes/)).toBeInTheDocument();
  },
});

/** Step 4: build succeeded and changes are ready to commit. */
export const Save = meta.story({
  name: "4. Save (ready to commit)",
  args: {
    evolveStep: "commit",
    evolutionId: 1,
    committable: true,
    gitStatus: "allStaged",
    changeMap: "summarized",
    commitMessageSuggestion:
      "feat: add system monitoring tools\n\nAdds htop, btop, bottom, bandwhich, and procs plus a dedicated monitoring module.",
  },
});

/** Save branch while the commit action is running. */
export const SavingCommit = meta.story({
  args: {
    evolveStep: "commit",
    evolutionId: 1,
    committable: true,
    gitStatus: "allStaged",
    changeMap: "summarized",
    commitMessageSuggestion: "feat: add system monitoring tools",
    isProcessing: true,
    processingAction: "merge",
  },
});

/** Commit-step interaction: refine further returns to the prompt branch. */
export const SaveContinueEditing = meta.story({
  args: {
    evolveStep: "commit",
    evolutionId: 1,
    committable: true,
    gitStatus: "allStaged",
    changeMap: "summarized",
    commitMessageSuggestion: "feat: add system monitoring tools",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Radix dropdown content portals to document.body, outside the story canvas.
    const body = within(document.body);
    await userEvent.click(await canvas.findByRole("button", { name: "More change options" }));
    await userEvent.click(await body.findByText("Refine further"));
    await expect(await canvas.findByText(/Back to the drawing board/i)).toBeInTheDocument();
  },
});

/** Manual-drift review: no active AI evolution, so manual banner/dropdown appear. */
export const ManualDriftReview = meta.story({
  args: {
    evolveStep: "manualEvolve",
    evolutionId: null,
    gitStatus: "dirty",
    changeMap: "summarized",
  },
});

/** Manual-drift build check is busy while apply/rebuild is already running. */
export const ManualDriftApplyBusy = meta.story({
  args: {
    evolveStep: "manualEvolve",
    evolutionId: null,
    gitStatus: "dirty",
    changeMap: "summarized",
    isProcessing: true,
    processingAction: "apply",
  },
});

/** Manual changes have already been built and are ready to commit. */
export const ManualCommit = meta.story({
  args: {
    evolveStep: "manualCommit",
    evolutionId: null,
    committable: true,
    gitStatus: "allStaged",
    changeMap: "summarized",
    commitMessageSuggestion: "chore: save manual configuration changes",
  },
});

/** Backend says review, but no changes exist, so the flow correctly collapses to Begin. */
export const NoChangesFallsBackToBegin = meta.story({
  args: {
    evolveStep: "evolve",
    evolutionId: 1,
    gitStatus: "clean",
    changeMap: "none",
  },
});

/** Stepper back-navigation branch: backend is commit, active override shows the prompt. */
export const BackToPromptOverride = meta.story({
  args: {
    evolveStep: "commit",
    evolutionId: 1,
    committable: true,
    activeStepOverride: "begin",
    gitStatus: "allStaged",
    changeMap: "summarized",
  },
});

/** History branch takes precedence over the evolve journey. */
export const HistoryBranch = meta.story({
  args: { showHistory: true, gitStatus: "dirty", changeMap: "summarized" },
});

/** Filesystem branch takes precedence over the evolve journey. */
export const FilesystemBranch = meta.story({
  args: { showFilesystem: true },
});

/** Router-backed settings overlay branch. */
export const SettingsBranch = meta.story({
  args: { route: "settings", settingsTab: "ai-models" },
});

/** Error banner branch over the normal Begin screen. */
export const ErrorBanner = meta.story({
  args: { error: "Failed to connect to nix daemon. Is the Nix daemon running?" },
});

/** Setup gate branch: missing host/config routes before evolve can start. */
export const SetupGate = meta.story({
  args: { configDir: "", host: "", hostsListed: false },
});

/** Permissions gate branch: required permission is still pending. */
export const PermissionsGate = meta.story({
  args: { permissionsGranted: false },
});

/** Animated walkthrough: begin → evolving → review → save. Disabled in snapshot runner to avoid timer flakes. */
export const FullFlowAnimated = meta.story({
  parameters: {
    test: { disable: true },
  },
  render: () => <AnimatedEvolveFlow />,
});
