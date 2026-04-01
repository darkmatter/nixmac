// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { PermissionsScreen } from "@/components/permissions-screen";
import type { EvolveEvent, GitStatus } from "@/stores/widget-store";
import { useWidgetStore } from "@/stores/widget-store";
import type { SemanticChangeMap } from "@/types/shared";
import { fn } from "@storybook/test";
import type React from "react";
import { useEffect } from "react";
import { DarwinWidget } from "./widget";

// Mock Tauri API for Storybook
if (typeof window !== "undefined") {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string) => {
      console.log("Mock Tauri invoke:", cmd);
      if (cmd === "plugin:darwin|git_status") {
        return { files: [], diff: "" };
      }
      if (cmd === "plugin:darwin|read_config") {
        return { configDir: "/Users/demo/.darwin" };
      }
      if (cmd === "plugin:darwin|list_hosts") {
        return ["Demo-MacBook-Pro", "Work-MacBook"];
      }
      return null;
    },
  };
}

// =============================================================================
// Meta
// =============================================================================

// Storybook 10 alpha types have inference issues - cast to any until stable release
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const meta = preview.meta({
  title: "Widget/DarwinWidget",
  component: DarwinWidget,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="relative m-2 h-[600px] w-[400px] overflow-hidden rounded-xl border border-border shadow-2xl">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
});

export default meta;

// =============================================================================
// Mock Data
// =============================================================================

const mockGitStatus: GitStatus = {
  files: [
    { path: "modules/darwin/default.nix", changeType: "edited" },
    { path: "modules/home/default.nix", changeType: "edited" },
    { path: "modules/darwin/vim.nix", changeType: "new" },
  ],
  diff: "diff --git a/modules/darwin/default.nix b/modules/darwin/default.nix\n...",
  additions: 25,
  deletions: 3,
};

// All changes staged (ready for commit after preview)
const mockGitStatusAllStaged: GitStatus = {
  files: [
    { path: "modules/darwin/default.nix", changeType: "edited" },
    { path: "modules/home/default.nix", changeType: "edited" },
    { path: "modules/darwin/vim.nix", changeType: "new" },
  ],
  diff: "diff --git a/modules/darwin/default.nix b/modules/darwin/default.nix\n...",
  additions: 25,
  deletions: 3,
  headIsBuilt: true,
};

const mockEvolveEvents: EvolveEvent[] = [
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

const mockChangeMap: SemanticChangeMap = {
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
  missedHashes: [],
};

// =============================================================================
// Store Setup Wrapper
// =============================================================================

interface StoreState {
  configDir?: string;
  hosts?: string[];
  host?: string;
  gitStatus?: GitStatus | null;
  changeMap?: SemanticChangeMap | null;
  evolvePrompt?: string;
  isProcessing?: boolean;
  isGenerating?: boolean;
  processingAction?: "evolve" | "apply" | "commit" | "cancel" | null;
  evolveEvents?: EvolveEvent[];
  consoleLogs?: string;
  settingsOpen?: boolean;
  error?: string | null;
}

/**
 * Wrapper that sets up store state for each story.
 */
function StoryWidget({ storeState }: { storeState?: StoreState }) {
  useEffect(() => {
    const store = useWidgetStore.getState();

    // Set store state
    if (storeState?.configDir !== undefined) store.setConfigDir(storeState.configDir);
    if (storeState?.hosts !== undefined) store.setHosts(storeState.hosts);
    if (storeState?.host !== undefined) store.setHost(storeState.host);
    if (storeState?.gitStatus !== undefined) store.setGitStatus(storeState.gitStatus);
    if (storeState?.changeMap !== undefined) store.setChangeMap(storeState.changeMap);
    if (storeState?.evolvePrompt !== undefined) store.setEvolvePrompt(storeState.evolvePrompt);
    if (storeState?.isProcessing !== undefined)
      store.setProcessing(storeState.isProcessing, storeState.processingAction || null);
    if (storeState?.isGenerating !== undefined) store.setGenerating(storeState.isGenerating);
    if (storeState?.settingsOpen !== undefined) store.setSettingsOpen(storeState.settingsOpen);
    if (storeState?.error !== undefined) store.setError(storeState.error);

    if (storeState?.evolveEvents !== undefined) {
      store.clearEvolveEvents();
      for (const event of storeState.evolveEvents) {
        store.appendEvolveEvent(event);
      }
    }

    if (storeState?.consoleLogs !== undefined) {
      store.clearLogs();
      store.appendLog(storeState.consoleLogs);
    }
  }, [storeState]);

  return <DarwinWidget />;
}

// =============================================================================
// Stories: Main Lifecycle States
// =============================================================================

/**
 * Onboarding - First time setup when no config exists
 */
export const Onboarding = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "",
        host: "",
        hosts: [],
      }}
    />
  ),
});

/**
 * Onboarding with directory selected, waiting for host
 */
export const OnboardingWithDirectory = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
      }}
    />
  ),
});

/**
 * Idle - Default state, ready for new evolution
 */
export const Idle = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        gitStatus: null,
      }}
    />
  ),
});

/**
 * Idle with prompt entered
 */
export const IdleWithPrompt = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        evolvePrompt: "Install vim and configure git with my email",
      }}
    />
  ),
});

/**
 * Generating - AI is generating configuration changes
 */
export const Generating = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        evolvePrompt: "Install vim and configure git",
        isGenerating: true,
        isProcessing: true,
        processingAction: "evolve",
        evolveEvents: mockEvolveEvents,
        consoleLogs: '> Evolving: "Install vim and configure git"\n',
      }}
    />
  ),
});

/**
 * Generating with detailed progress - shows the streaming events UI with more events
 */
export const GeneratingWithProgress = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        evolvePrompt: "Install vim and configure git",
        isGenerating: true,
        isProcessing: true,
        processingAction: "evolve",
        evolveEvents: [
          ...mockEvolveEvents,
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
        ],
        consoleLogs: '> Evolving: "Install vim and configure git"\n',
      }}
    />
  ),
});

/**
 * Evolving - Changes generated, waiting for user action
 */
export const Evolving = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        gitStatus: mockGitStatus,
        consoleLogs: '> Evolving: "Install vim"\n✓ Evolution complete\n',
      }}
    />
  ),
});

/**
 * Applying - Running darwin-rebuild switch
 */
export const Applying = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        gitStatus: mockGitStatus,
        isProcessing: true,
        processingAction: "apply",
        consoleLogs: "> Running darwin-rebuild switch...\nbuilding the system configuration...\n",
      }}
    />
  ),
});

/**
 * Preview - Changes applied, waiting for commit
 */
export const Preview = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        gitStatus: mockGitStatus,
        changeMap: mockChangeMap,
        consoleLogs:
          "> Running darwin-rebuild switch...\n✓ Apply complete\n\nChanges are now active. Commit to save or discard to revert.\n",
      }}
    />
  ),
});

/**
 * Committing - Saving changes to git
 */
export const Committing = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        gitStatus: mockGitStatus,
        isProcessing: true,
        processingAction: "commit",
        consoleLogs: '> Committing: "feat(darwin): add vim and configure git"\n',
      }}
    />
  ),
});

// =============================================================================
// Stories: Edge Cases & Errors
// =============================================================================

/**
 * Error state - Shows error banner
 */
export const WithError = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        error: "Failed to connect to nix daemon. Is the Nix daemon running?",
      }}
    />
  ),
});

/**
 * Many changed files
 */
export const ManyChangedFiles = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        gitStatus: {
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
        },
        changeMap: mockChangeMap,
      }}
    />
  ),
});

/**
 * Console with lots of output
 */
export const ConsoleWithOutput = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        gitStatus: mockGitStatus,
        changeMap: mockChangeMap,
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
      }}
    />
  ),
});

/**
 * Settings dialog open
 */
export const SettingsOpen = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        settingsOpen: true,
      }}
    />
  ),
});

// =============================================================================
// Stories: New Preview/Commit Flow
// =============================================================================

/**
 * Evolving with unstaged changes - shows Preview button
 */
export const EvolvingWithUnstagedChanges = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        gitStatus: mockGitStatus,
      }}
    />
  ),
});

/**
 * Evolving with all changes staged - shows Commit button
 */
export const EvolvingReadyToCommit = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        gitStatus: mockGitStatusAllStaged,
        changeMap: mockChangeMap,
      }}
    />
  ),
});

/**
 * Commit Screen - enter commit message
 */
export const CommitScreen = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        gitStatus: mockGitStatusAllStaged,
        changeMap: mockChangeMap,
      }}
    />
  ),
});

/**
 * Commit Screen with message entered
 */
export const CommitScreenWithMessage = meta.story({
  render: () => (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
        gitStatus: mockGitStatusAllStaged,
        changeMap: mockChangeMap,
      }}
    />
  ),
});

// =============================================================================
// Stories: Onboarding Flow with Permissions
// =============================================================================

/**
 * Onboarding flow is now simpler - just show the setup step
 * Permissions are handled separately in the main app
 */
function OnboardingFlowWithPermissions() {
  return (
    <StoryWidget
      storeState={{
        configDir: "/Users/demo/.darwin",
        host: "Demo-MacBook-Pro",
        hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
      }}
    />
  );
}

/**
 * Full Onboarding Flow with Permissions
 *
 * This story demonstrates the complete onboarding experience:
 * 1. Setup step - Select config directory and host
 * 2. Permissions step - Grant required system permissions
 * 3. Main console - Ready to use nixmac
 *
 * Click "Browse" to select a directory, then select a host to proceed
 * to the permissions screen.
 */
export const OnboardingWithPermissions = meta.story({
  render: () => <OnboardingFlowWithPermissions />,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="relative h-screen w-full overflow-hidden">
        <Story />
      </div>
    ),
  ],
});

/**
 * Permissions step in onboarding - standalone view
 *
 * Shows just the permissions screen as it appears during onboarding,
 * without the widget wrapper.
 */
export const OnboardingPermissionsStep = meta.story({
  render: () => (
    <PermissionsScreen
      onComplete={() => {
        fn()();
      }}
    />
  ),
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div className="h-screen w-full">
        <Story />
      </div>
    ),
  ],
});
